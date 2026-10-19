/**
 * Read-only check that supabase/apply-all.sql took effect on the configured project.
 * The only write is one api_rate_limits counter row (key "verify:<timestamp>") from
 * calling check_rate_limit; it is cleaned up by the RPC's own expiry sweep.
 * Usage: npx tsx scripts/verify-migration.ts
 */
import { createClient } from '@supabase/supabase-js'
import { loadEnv, Suite } from './_lib/test-kit.js'

loadEnv()
const suite = new Suite()

const url = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim() || ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || ''
const anonKey = process.env.VITE_SUPABASE_ANON_KEY?.trim() || ''
if (!url || !serviceKey || !anonKey) {
  throw new Error('Need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and VITE_SUPABASE_ANON_KEY in .env')
}
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, serviceKey, options)
const anon = createClient(url, anonKey, options)

type TenantRow = {
  id: string
  business_name: string
  whatsapp_instance_id: string | null
  whatsapp_phone: string | null
  owner_phone: string | null
  business_hours: { timezone?: string } | null
  price_list: unknown[]
  faq: unknown[]
}

console.log(`Project: ${url}`)

suite.section('New columns')
const tenants = await admin
  .from('tenants')
  .select('id, business_name, whatsapp_instance_id, whatsapp_phone, owner_phone, business_hours, price_list, faq, notification_phone, notification_email')
suite.check('tenants: business_hours, price_list, faq, notification_* exist', !tenants.error, tenants.error?.message)
const conversations = await admin.from('conversations').select('metadata').limit(1)
suite.check('conversations.metadata exists', !conversations.error, conversations.error?.message)
const messages = await admin.from('messages').select('raw_message_id').limit(1)
suite.check('messages.raw_message_id exists', !messages.error, messages.error?.message)
const members = await admin.from('tenant_members').select('tenant_id, user_id, role')
suite.check('tenant_members table exists', !members.error, members.error?.message)

suite.section('Data')
const rows = (tenants.data as TenantRow[] | null) ?? []
const glow = rows.find((row) => row.whatsapp_instance_id === '710722751571')
suite.check('Glow Clinic tenant found (instance 710722751571)', Boolean(glow))
suite.check('Glow price list seeded (3 items)', glow?.price_list.length === 3, glow?.price_list.length)
suite.check('Glow FAQ present', (glow?.faq.length ?? 0) > 0, glow?.faq.length)
suite.check(
  'every tenant has business_hours (Asia/Jerusalem default)',
  rows.length > 0 && rows.every((row) => row.business_hours?.timezone),
  rows.map((row) => row.business_hours),
)
const badPhones = rows.filter(
  (row) => !/^\d{9,15}$/.test(row.whatsapp_phone ?? '') || !/^\d{9,15}$/.test(row.owner_phone ?? ''),
)
suite.check(
  'all tenant phones normalized to 9-15 digits (NOT NULL + format checks applied)',
  badPhones.length === 0,
  badPhones.map((row) => ({ tenant: row.business_name, whatsapp_phone: row.whatsapp_phone, owner_phone: row.owner_phone })),
)

const total = await admin.from('messages').select('id', { count: 'exact', head: true })
const withId = await admin.from('messages').select('id', { count: 'exact', head: true }).not('raw_message_id', 'is', null)
const legacyWithId = await admin
  .from('messages')
  .select('id', { count: 'exact', head: true })
  .not('raw_payload->>idMessage', 'is', null)
console.log(`    messages: ${total.count ?? '?'} total, ${legacyWithId.count ?? '?'} with a Green API id, ${withId.count ?? '?'} backfilled`)
suite.check(
  'raw_message_id backfilled for messages that carry a Green API id',
  (withId.count ?? 0) > 0 || (legacyWithId.count ?? 0) === 0,
  { backfilled: withId.count, withGreenId: legacyWithId.count },
)

suite.section('Rate limiter')
const rpc = await admin.rpc('check_rate_limit', { p_key: `verify:${Date.now()}`, p_limit: 5, p_window_seconds: 60 })
suite.check('check_rate_limit RPC exists and allows a first call', !rpc.error && rpc.data === true, rpc.error?.message ?? rpc.data)

suite.section('RLS (anon key, signed out)')
for (const table of ['tenants', 'conversations', 'messages', 'leads', 'tenant_members'] as const) {
  const result = await anon.from(table).select('*').limit(5)
  suite.check(
    `anon sees no ${table} rows (open demo policies dropped)`,
    (result.data?.length ?? 0) === 0,
    result.error?.message ?? `${result.data?.length} rows visible`,
  )
}
const anonRpc = await anon.rpc('check_rate_limit', { p_key: 'verify:anon', p_limit: 5, p_window_seconds: 60 })
suite.check('anon cannot call check_rate_limit', Boolean(anonRpc.error))

suite.section('Dashboard access')
const memberRows = (members.data as Array<{ tenant_id: string; role: string }> | null) ?? []
console.log(`    tenant_members rows: ${memberRows.length}${memberRows.length ? ` (${memberRows.map((row) => row.role).join(', ')})` : ''}`)
if (memberRows.length === 0) {
  console.log('    No members yet: nobody can use the dashboard until you run the grant snippet at the end of apply-all.sql.')
}

suite.finish()
