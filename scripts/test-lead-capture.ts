/**
 * Lead-capture verification: structured extraction from the model's JSON, field-wise
 * merging across turns, a single open lead per conversation, and one "qualified"
 * notification.
 *
 *   npx tsx scripts/test-lead-capture.ts          offline: scripted Gemini + in-memory lead store
 *   npx tsx scripts/test-lead-capture.ts --live   full flow against real Gemini + Supabase: creates a
 *                                                 throwaway inactive tenant, runs a 3-turn conversation,
 *                                                 verifies the leads row, then deletes the tenant
 *                                                 (cascade). Add --keep to leave the rows for inspection.
 */
import { randomUUID } from 'node:crypto'
import { asCapturedLead, runSalesAgent } from '../api/_lib/gemini.js'
import {
  isQualified,
  supabaseLeadStore,
  upsertCapturedLead,
  type LeadInsert,
  type LeadStore,
} from '../api/_lib/leads.js'
import type { CapturedLead, Conversation, Lead, Message } from '../api/_lib/types.js'
import {
  FIXTURE_TENANT,
  isLive,
  jsonReply,
  loadEnv,
  message,
  sleep,
  stubGenerate,
  Suite,
} from './_lib/test-kit.js'

loadEnv()
const suite = new Suite()

/** In-memory LeadStore with the same one-open-lead-per-conversation rule as the DB index. */
function memoryLeadStore(): LeadStore & { rows: Lead[] } {
  const rows: Lead[] = []
  return {
    rows,
    async findOpenLead(conversationId) {
      return rows.find((row) => row.conversation_id === conversationId && ['new', 'in_progress'].includes(row.status)) ?? null
    },
    async insertLead(row: LeadInsert) {
      if (rows.some((existing) => existing.conversation_id === row.conversation_id && ['new', 'in_progress'].includes(existing.status))) {
        return 'conflict'
      }
      const lead: Lead = { ...row, id: randomUUID(), created_at: new Date().toISOString() }
      rows.push(lead)
      return lead
    },
    async updateLead(id, patch) {
      const lead = rows.find((row) => row.id === id)
      if (!lead) throw new Error(`lead ${id} not found`)
      Object.assign(lead, patch)
      return lead
    },
  }
}

const conversation: Pick<Conversation, 'id' | 'customer_name' | 'customer_phone'> = {
  id: 'conv-lead-test',
  customer_name: 'Dana WhatsApp',
  customer_phone: '972501234567',
}

const emptyLead: CapturedLead = { customer_name: '', customer_phone: '', service_requested: '', preferred_time: '', notes: '' }

// ── Extraction parsing ──
suite.section('Structured extraction parsing')
suite.check('all-empty lead -> null', asCapturedLead(emptyLead) === null)
suite.check('non-object lead -> null', asCapturedLead('דנה') === null)
suite.check('local phone normalized to 972', asCapturedLead({ customer_phone: '050-123-4567' })?.customer_phone === '972501234567')
suite.check('junk phone dropped', asCapturedLead({ customer_phone: '123', customer_name: 'דנה' })?.customer_phone === '')
suite.check('single field (treatment) is enough to start a lead', asCapturedLead({ service_requested: 'בוטוקס' })?.service_requested === 'בוטוקס')

// ── Scripted conversation through the engine ──
suite.section('Conversation flow (scripted Gemini, in-memory store)')
{
  const store = memoryLeadStore()
  const turns: Array<{ customer: string; reply: string; lead: Record<string, string> | null }> = [
    { customer: 'היי, מה שלומכם?', reply: 'היי! במה אפשר לעזור?', lead: null },
    {
      customer: 'מעניין אותי בוטוקס במצח',
      reply: 'בשמחה. עשית בוטוקס בעבר?',
      lead: { customer_name: '', customer_phone: '', service_requested: 'בוטוקס במצח', preferred_time: '', notes: '' },
    },
    {
      customer: 'לא, פעם ראשונה. קוראים לי דנה כהן',
      reply: 'נעים מאוד דנה! מתי נוח לך להגיע לייעוץ?',
      // The model "forgot" the treatment this turn; the merge must keep it.
      lead: { customer_name: 'דנה כהן', customer_phone: '', service_requested: '', preferred_time: '', notes: 'פעם ראשונה' },
    },
    {
      customer: 'חמישי אחרי 17:00',
      reply: 'מעולה, רשמתי. הצוות יחזור לאישור השעה.',
      lead: { customer_name: '', customer_phone: '', service_requested: '', preferred_time: 'חמישי אחרי 17:00', notes: '' },
    },
    {
      customer: 'ואפשר שיחזרו למספר 052-7654321?',
      reply: 'בטח, עדכנתי.',
      lead: { customer_name: '', customer_phone: '052-7654321', service_requested: '', preferred_time: '', notes: '' },
    },
  ]

  const history: Message[] = []
  const qualifiedOnTurn: number[] = []
  let createdCount = 0

  for (const [index, turn] of turns.entries()) {
    const stub = stubGenerate(() => jsonReply(turn.reply, turn.lead))
    const result = await runSalesAgent({ tenant: FIXTURE_TENANT, history, userText: turn.customer, generate: stub.generate })
    history.push(message('customer', turn.customer, conversation.id), message('bot', result.reply, conversation.id))
    if (result.lead) {
      const upsert = await upsertCapturedLead(store, FIXTURE_TENANT.id, conversation, result.lead)
      if (upsert.created) createdCount += 1
      if (upsert.becameQualified) qualifiedOnTurn.push(index + 1)
    }
    if (index === 1) suite.check('turn 2: lead row created from the treatment alone', store.rows.length === 1)
  }

  const lead = store.rows[0]
  suite.check('exactly one lead row for the conversation', store.rows.length === 1 && createdCount === 1, store.rows.length)
  suite.check('name captured', lead?.customer_name === 'דנה כהן', lead?.customer_name)
  suite.check('treatment survived the turn that omitted it', lead?.service_requested === 'בוטוקס במצח', lead?.service_requested)
  suite.check('preferred time captured', lead?.preferred_time === 'חמישי אחרי 17:00')
  suite.check('explicit callback number overrides chat phone', lead?.customer_phone === '972527654321', lead?.customer_phone)
  suite.check('notes kept', lead?.notes === 'פעם ראשונה')
  suite.check('status new', lead?.status === 'new')
  suite.check('qualified exactly once, on turn 4', JSON.stringify(qualifiedOnTurn) === '[4]', qualifiedOnTurn)
  suite.check('isQualified(final)', isQualified(lead ?? null))
}
{
  const store = memoryLeadStore()
  const first = await upsertCapturedLead(store, FIXTURE_TENANT.id, conversation, { ...emptyLead, service_requested: 'סקין בוסטר' })
  suite.check('chat phone used when none given', first.lead.customer_phone === conversation.customer_phone)
  suite.check('WhatsApp profile name used as fallback', first.lead.customer_name === conversation.customer_name)
}
{
  // Simulate a concurrent webhook inserting the open lead between find and insert.
  const store = memoryLeadStore()
  const racing: LeadStore = {
    findOpenLead: (() => {
      let calls = 0
      return async (conversationId: string) => {
        calls += 1
        if (calls === 1) {
          await store.insertLead({
            ...emptyLead,
            customer_name: 'דנה כהן',
            customer_phone: conversation.customer_phone,
            service_requested: null,
            preferred_time: null,
            notes: null,
            tenant_id: FIXTURE_TENANT.id,
            conversation_id: conversationId,
            status: 'new',
          })
          return null
        }
        return store.findOpenLead(conversationId)
      }
    })(),
    insertLead: (row) => store.insertLead(row),
    updateLead: (id, patch) => store.updateLead(id, patch),
  }
  const result = await upsertCapturedLead(racing, FIXTURE_TENANT.id, conversation, { ...emptyLead, service_requested: 'מילוי שפתיים' })
  suite.check('insert race merges into the winner (no duplicate row)', store.rows.length === 1 && !result.created)
  suite.check('merged row has both racers\' fields', store.rows[0]?.customer_name === 'דנה כהן' && store.rows[0]?.service_requested === 'מילוי שפתיים')
}

// ── Live: real Gemini + Supabase ──
if (isLive) {
  suite.section('Live flow (Gemini + Supabase, paid)')
  const { getServiceClient } = await import('../api/_lib/supabase.js')
  const supabase = getServiceClient()
  const keep = process.argv.includes('--keep')
  let tenantId: string | null = null

  try {
    // Inactive tenant with a unique fake instance id: webhook routing can never select it.
    const { data: tenantRow, error: tenantError } = await supabase
      .from('tenants')
      .insert({
        business_name: 'LeadFlow QA - auto-delete',
        whatsapp_instance_id: `qa-${Date.now()}`,
        // NOT NULL in the live DB; unused placeholders (the tenant is inactive and this script never sends WhatsApp).
        whatsapp_phone: `9725${String(Date.now() % 1e8).padStart(8, '0')}`,
        owner_phone: '972500000000',
        system_prompt: FIXTURE_TENANT.system_prompt,
        target_goal: FIXTURE_TENANT.target_goal,
        is_active: false,
      })
      .select('id')
      .single()
    if (tenantError) throw tenantError
    tenantId = (tenantRow as { id: string }).id

    const { data: conversationRow, error: conversationError } = await supabase
      .from('conversations')
      .insert({ tenant_id: tenantId, customer_phone: '972500000123', status: 'active' })
      .select('*')
      .single()
    if (conversationError) throw conversationError
    const liveConversation = conversationRow as Conversation
    // Price list etc. come from the fixture so the run does not depend on the migration.
    const tenant = { ...FIXTURE_TENANT, id: tenantId }

    const store = supabaseLeadStore(supabase)
    const history: Message[] = []
    for (const text of ['היי, אני מתעניינת בבוטוקס במצח', 'קוראים לי דנה כהן, לא עשיתי בעבר', 'יום חמישי אחרי 17:00 מתאים לי']) {
      const result = await runSalesAgent({ tenant, history, userText: text })
      console.log(`    customer: ${text}\n    bot [${result.outcome}]: ${result.reply}\n    lead: ${JSON.stringify(result.lead)}`)
      suite.check(`model answered: ${text}`, result.outcome !== 'fallback', result.reason)
      for (const [sender, content] of [['customer', text], ['bot', result.reply]] as const) {
        const { data, error } = await supabase
          .from('messages')
          .insert({ conversation_id: liveConversation.id, sender, message_type: 'text', content })
          .select('*')
          .single()
        if (error) throw error
        history.push(data as Message)
      }
      if (result.lead) await upsertCapturedLead(store, tenantId, liveConversation, result.lead)
      await sleep(1500)
    }

    const { data: leads, error: leadsError } = await supabase.from('leads').select('*').eq('conversation_id', liveConversation.id)
    if (leadsError) throw leadsError
    const rows = (leads as Lead[]) ?? []
    console.log(`    leads row: ${JSON.stringify(rows[0] ?? null)}`)
    suite.check('exactly one lead row in Supabase', rows.length === 1, rows.length)
    suite.check('lead name contains דנה', Boolean(rows[0]?.customer_name?.includes('דנה')), rows[0]?.customer_name)
    suite.check('lead treatment mentions botox', /בוטוקס|botox/i.test(rows[0]?.service_requested ?? ''), rows[0]?.service_requested)
    suite.check('lead preferred time captured', /חמישי|17/.test(rows[0]?.preferred_time ?? ''), rows[0]?.preferred_time)
    suite.check('lead phone is the chat phone', rows[0]?.customer_phone === '972500000123', rows[0]?.customer_phone)
  } catch (error) {
    suite.check('live flow completed without errors', false, error instanceof Error ? error.message : error)
  } finally {
    if (tenantId && !keep) {
      const { error } = await supabase.from('tenants').delete().eq('id', tenantId)
      suite.check('cleanup: QA tenant deleted (cascade)', !error, error?.message)
    } else if (tenantId) {
      console.log(`    kept QA tenant ${tenantId}`)
    }
  }
} else {
  console.log('\n(live Supabase/Gemini flow skipped; run with --live to include it)')
}

suite.finish()
