import { timingSafeEqual } from 'node:crypto'
import { customerRequestsHuman, runSalesAgent } from './_lib/gemini.js'
import {
  applyCors,
  parseBody,
  readString,
  type ApiRequest,
  type ApiResponse,
} from './_lib/http.js'
import {
  consumeRateLimit,
  PAID_API_RATE_LIMIT,
  PAID_API_WINDOW_SECONDS,
  type RateLimitResult,
} from './_lib/rate-limit.js'
import { getServiceClient, normalizePhone, phonesMatch } from './_lib/supabase.js'
import type {
  CapturedLead,
  Conversation,
  GreenApiWebhook,
  Message,
  Tenant,
} from './_lib/types.js'
import {
  downloadWhatsAppFile,
  extractIncomingText,
  instanceIdOf,
  isAudioMessage,
  isFromOwner,
  isAllowedTestSender,
  isIncomingCustomerMessage,
  isSelfChatTest,
  recipientPhone,
  resolveChatPhone,
  resolveCustomerName,
  resolveSenderPhone,
  sendWhatsAppText,
} from './_lib/whatsapp.js'

function json(res: ApiResponse, status: number, body: unknown): void {
  res.status(status).json(body)
}

/**
 * Tenant-wide ceiling on paid replies. The webhook is unauthenticated unless
 * GREEN_API_WEBHOOK_TOKEN is set, so per-phone limits alone can be dodged by
 * spoofing many numbers; this caps total Gemini/WhatsApp spend per tenant.
 */
const TENANT_RATE_LIMIT = 60

/**
 * Opt-in shared-secret check: set GREEN_API_WEBHOOK_TOKEN to the instance's
 * webhookUrlToken (Green API console) and Green API's Authorization header must match.
 */
function isAuthorizedWebhook(req: ApiRequest): boolean {
  const expected = process.env.GREEN_API_WEBHOOK_TOKEN?.trim()
  if (!expected) return true
  const header = readString(req.headers.authorization)?.trim() ?? ''
  const provided = header.replace(/^(Bearer|Basic)\s+/i, '')
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Per-customer limit first, then the tenant ceiling; both must pass before any paid call. */
async function consumePaidReplyBudget(tenant: Tenant, chatPhone: string): Promise<RateLimitResult> {
  const perCustomer = await consumeRateLimit(
    `webhook:${tenant.id}:${chatPhone}`,
    PAID_API_RATE_LIMIT,
    PAID_API_WINDOW_SECONDS,
  )
  if (!perCustomer.allowed) return perCustomer
  return consumeRateLimit(`webhook:${tenant.id}`, TENANT_RATE_LIMIT, PAID_API_WINDOW_SECONDS)
}

function isMuted(conversation: Conversation): boolean {
  if (conversation.status === 'muted_by_human' || conversation.status === 'closed') {
    return true
  }
  if (!conversation.muted_until) return false
  return new Date(conversation.muted_until).getTime() > Date.now()
}

async function findTenant(payload: GreenApiWebhook): Promise<Tenant | null> {
  const supabase = getServiceClient()
  const instanceId = instanceIdOf(payload)
  if (instanceId) {
    const { data, error } = await supabase
      .from('tenants')
      .select('*')
      .eq('whatsapp_instance_id', instanceId)
      .eq('is_active', true)
      .maybeSingle()
    if (error) throw error
    if (data) return data as Tenant
  }

  const incomingTo = recipientPhone(payload)
  if (!incomingTo) return null

  const { data: tenants, error } = await supabase
    .from('tenants')
    .select('*')
    .eq('is_active', true)
  if (error) throw error
  return (
    (tenants as Tenant[] | null)?.find((tenant) =>
      phonesMatch(tenant.whatsapp_phone, incomingTo),
    ) ?? null
  )
}

/** Green API message id, used to drop webhook retries that were already handled. */
function messageIdOf(payload: GreenApiWebhook): string {
  return payload.idMessage?.trim() ?? ''
}

async function alreadyProcessed(idMessage: string): Promise<boolean> {
  if (!idMessage) return false
  const { data, error } = await getServiceClient()
    .from('messages')
    .select('id')
    .eq('raw_payload->>idMessage', idMessage)
    .limit(1)
  if (error) throw error
  return (data?.length ?? 0) > 0
}

/** A message sent from the instance's own WhatsApp number must never reach the AI. */
function isSelfMessage(tenant: Tenant, payload: GreenApiWebhook, senderPhone: string): boolean {
  return (
    phonesMatch(senderPhone, recipientPhone(payload)) ||
    phonesMatch(senderPhone, tenant.whatsapp_phone)
  )
}

async function getOrCreateConversation(
  tenant: Tenant,
  customerPhone: string,
  customerName: string,
): Promise<Conversation> {
  const supabase = getServiceClient()
  const phone = normalizePhone(customerPhone)

  const { data: existing, error: lookupError } = await supabase
    .from('conversations')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('customer_phone', phone)
    .maybeSingle()
  if (lookupError) throw lookupError

  if (existing) {
    const conversation = existing as Conversation
    if (customerName && conversation.customer_name !== customerName) {
      const { data: updated, error } = await supabase
        .from('conversations')
        .update({
          customer_name: customerName,
          last_message_at: new Date().toISOString(),
        })
        .eq('id', conversation.id)
        .select('*')
        .single()
      if (error) throw error
      return updated as Conversation
    }
    return conversation
  }

  const { data: created, error } = await supabase
    .from('conversations')
    .insert({
      tenant_id: tenant.id,
      customer_phone: phone,
      customer_name: customerName || null,
      status: 'active',
      last_message_at: new Date().toISOString(),
    })
    .select('*')
    .single()
  if (error) throw error
  return created as Conversation
}

async function insertMessage(
  conversationId: string,
  sender: Message['sender'],
  messageType: Message['message_type'],
  content: string,
  raw: unknown,
): Promise<void> {
  const supabase = getServiceClient()
  const { error } = await supabase.from('messages').insert({
    conversation_id: conversationId,
    sender,
    message_type: messageType,
    content,
    raw_payload: raw,
  })
  if (error) throw error

  const { error: touchError } = await supabase
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversationId)
  if (touchError) throw touchError
}

async function muteForOwner(conversationId: string): Promise<void> {
  const mutedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const { error } = await getServiceClient()
    .from('conversations')
    .update({ muted_until: mutedUntil, last_message_at: new Date().toISOString() })
    .eq('id', conversationId)
  if (error) throw error
}

async function muteForHumanRequest(conversationId: string): Promise<void> {
  const { error } = await getServiceClient()
    .from('conversations')
    .update({
      status: 'muted_by_human',
      last_message_at: new Date().toISOString(),
    })
    .eq('id', conversationId)
  if (error) throw error
}

async function recentHistory(conversationId: string): Promise<Message[]> {
  const { data, error } = await getServiceClient()
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) throw error
  return ((data as Message[]) ?? []).slice().reverse()
}

async function upsertLead(
  tenant: Tenant,
  conversation: Conversation,
  lead: CapturedLead,
): Promise<void> {
  const supabase = getServiceClient()
  const payload = {
    tenant_id: tenant.id,
    conversation_id: conversation.id,
    customer_name: lead.customer_name || conversation.customer_name,
    customer_phone: lead.customer_phone || conversation.customer_phone,
    service_requested: lead.service_requested,
    preferred_time: lead.preferred_time,
    notes: lead.notes,
    status: 'new',
  }

  const { data: existing, error: existingError } = await supabase
    .from('leads')
    .select('id')
    .eq('conversation_id', conversation.id)
    .in('status', ['new', 'in_progress'])
    .maybeSingle()
  if (existingError) throw existingError

  if (existing) {
    const { error } = await supabase.from('leads').update(payload).eq('id', existing.id)
    if (error) throw error
    return
  }

  const { error } = await supabase.from('leads').insert(payload)
  if (error) throw error
}

async function notifyOwner(tenant: Tenant, body: string): Promise<void> {
  if (!tenant.owner_phone) return
  try {
    await sendWhatsAppText(tenant, tenant.owner_phone, body)
  } catch (error) {
    console.error('Failed to notify owner', error)
  }
}

/**
 * Sends a bot reply, then stores it with the Green API idMessage so any webhook
 * echo of this send is dropped by alreadyProcessed. Returns the send error, if any.
 */
async function sendBotReply(
  tenant: Tenant,
  conversationId: string,
  chatPhone: string,
  text: string,
  kind: 'gemini' | 'human_handoff',
): Promise<string | null> {
  let sendError: string | null = null
  let idMessage: string | null = null
  try {
    idMessage = (await sendWhatsAppText(tenant, chatPhone, text)).idMessage || null
  } catch (error) {
    sendError = error instanceof Error ? error.message : 'WhatsApp send failed'
    console.error(`WhatsApp send failed (${kind})`, error)
  }
  await insertMessage(conversationId, 'bot', 'text', text, { kind, idMessage })
  return sendError
}

async function maybeDownloadAudio(
  payload: GreenApiWebhook,
): Promise<{ data: string; mimeType: string } | undefined> {
  const url = payload.messageData?.fileMessageData?.downloadUrl
  if (!url) return undefined
  const file = await downloadWhatsAppFile(url)
  return {
    data: file.buffer.toString('base64'),
    mimeType: payload.messageData?.fileMessageData?.mimeType?.split(';')[0] || file.mimeType,
  }
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  applyCors(req, res)

  if (req.method === 'OPTIONS') {
    json(res, 200, { ok: true })
    return
  }

  if (req.method === 'GET') {
    json(res, 200, { ok: true, service: 'leadflow-ai-webhook' })
    return
  }

  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' })
    return
  }

  if (!isAuthorizedWebhook(req)) {
    json(res, 401, { error: 'Unauthorized' })
    return
  }

  const payload = parseBody<GreenApiWebhook>(req)
  const typeWebhook = payload.typeWebhook ?? ''

  // Only patient messages run the AI. Staff replies sent from the clinic phone
  // (outgoingMessageReceived) are kept solely to mute the bot; everything else,
  // including the bot's own API sends (outgoingAPIMessageReceived), is dropped.
  if (
    typeWebhook !== 'incomingMessageReceived' &&
    typeWebhook !== 'outgoingMessageReceived'
  ) {
    json(res, 200, { ok: true, ignored: typeWebhook || 'unknown' })
    return
  }

  const chatPhone = resolveChatPhone(payload)
  const senderPhone = resolveSenderPhone(payload)

  // ALLOWED_TEST_NUMBERS restricts the bot to listed numbers; personal contacts
  // never reach Supabase or Gemini. Unset, empty or "*" answers everyone.
  if (!isAllowedTestSender(senderPhone, chatPhone)) {
    console.info('webhook skipped: sender not in ALLOWED_TEST_NUMBERS', {
      typeWebhook,
      senderPhone,
      chatPhone,
    })
    json(res, 200, { ok: true, ignored: 'not_whitelisted', senderPhone })
    return
  }

  try {
    const tenant = await findTenant(payload)
    if (!tenant) {
      json(res, 200, { ok: true, ignored: 'tenant_not_found' })
      return
    }

    const senderName = resolveCustomerName(payload)
    if (!chatPhone) {
      json(res, 200, { ok: true, ignored: 'missing_chat' })
      return
    }

    // Owner testing the bot from their own "message yourself" chat (see isSelfChatTest).
    const selfChatTest = isSelfChatTest(payload)

    if (
      !selfChatTest &&
      typeWebhook === 'incomingMessageReceived' &&
      isSelfMessage(tenant, payload, senderPhone)
    ) {
      json(res, 200, { ok: true, ignored: 'self_message' })
      return
    }

    const idMessage = messageIdOf(payload)
    if (await alreadyProcessed(idMessage)) {
      json(res, 200, { ok: true, ignored: 'duplicate', idMessage })
      return
    }

    const conversation = await getOrCreateConversation(tenant, chatPhone, senderName)
    const incomingText = extractIncomingText(payload)
    const audio = isAudioMessage(payload)

    if (
      !selfChatTest &&
      (typeWebhook === 'outgoingMessageReceived' || isFromOwner(tenant, senderPhone))
    ) {
      await insertMessage(
        conversation.id,
        'human',
        audio ? 'audio' : 'text',
        incomingText || (audio ? '[הודעה קולית מהנציג]' : ''),
        payload,
      )
      await muteForOwner(conversation.id)
      json(res, 200, { ok: true, muted: true, reason: 'owner_takeover' })
      return
    }

    if (!selfChatTest && !isIncomingCustomerMessage(typeWebhook)) {
      json(res, 200, { ok: true, ignored: typeWebhook })
      return
    }

    await insertMessage(
      conversation.id,
      'customer',
      audio ? 'audio' : 'text',
      incomingText || (audio ? '[הודעה קולית]' : ''),
      payload,
    )

    const latest = {
      ...conversation,
      status: conversation.status,
      muted_until: conversation.muted_until,
    }
    const { data: fresh } = await getServiceClient()
      .from('conversations')
      .select('*')
      .eq('id', conversation.id)
      .single()
    const current = (fresh as Conversation | null) ?? latest

    // In a self-chat test the "owner takeover" mute was set by the tester's own
    // earlier messages, so only explicit handoff/closed statuses apply.
    if (selfChatTest ? isMuted({ ...current, muted_until: null }) : isMuted(current)) {
      json(res, 200, { ok: true, ignored: 'muted' })
      return
    }

    // The customer message is already stored, so a throttled request loses no data;
    // a Green API retry of it is dropped by the duplicate check above.
    const budget = await consumePaidReplyBudget(tenant, chatPhone)
    if (!budget.allowed) {
      res.setHeader('Retry-After', String(budget.retryAfterSeconds))
      json(res, 429, {
        ok: false,
        error: 'Too many requests',
        retryAfter: budget.retryAfterSeconds,
      })
      return
    }

    if (customerRequestsHuman(incomingText)) {
      await muteForHumanRequest(conversation.id)
      const ack =
        'הבנתי, מעביר אתכם לנציג אנושי עכשיו. מישהו מהצוות יחזור אליכם כאן בהקדם.'
      const sendError = await sendBotReply(tenant, conversation.id, chatPhone, ack, 'human_handoff')
      await notifyOwner(
        tenant,
        `🙋 לקוח ביקש נציג אנושי\nעסק: ${tenant.business_name}\nשם: ${senderName || 'לא ידוע'}\nטלפון: ${chatPhone}\nהודעה: ${incomingText}`,
      )
      json(res, 200, {
        ok: true,
        handed_off: true,
        ...(sendError ? { send_error: sendError } : {}),
      })
      return
    }

    let userText = incomingText
    let audioPayload: { data: string; mimeType: string } | undefined
    if (audio) {
      audioPayload = await maybeDownloadAudio(payload)
      if (!audioPayload && !userText) {
        userText = 'הלקוח שלח הודעה קולית שלא הצלחנו להוריד. בקש ממנו לכתוב בקצרה מה הוא צריך.'
      }
    }

    const history = await recentHistory(conversation.id)
    const agent = await runSalesAgent({
      tenant,
      history,
      userText: userText || 'שלום',
      customerPhone: chatPhone,
      audio: audioPayload,
    })

    const sendError = await sendBotReply(tenant, conversation.id, chatPhone, agent.reply, 'gemini')

    if (agent.lead) {
      await upsertLead(tenant, conversation, agent.lead)
      await notifyOwner(
        tenant,
        `🎯 ליד חדש — ${tenant.business_name}\nשם: ${agent.lead.customer_name || senderName || 'לא צוין'}\nטלפון: ${agent.lead.customer_phone || chatPhone}\nשירות: ${agent.lead.service_requested}\nזמן מועדף: ${agent.lead.preferred_time || 'לא צוין'}\nהערות: ${agent.lead.notes || '—'}`,
      )
    }

    json(res, 200, {
      ok: true,
      replied: true,
      lead: Boolean(agent.lead),
      ...(sendError ? { send_error: sendError } : {}),
    })
  } catch (error) {
    console.error('webhook failed', error)
    json(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : 'Webhook processing failed',
    })
  }
}
