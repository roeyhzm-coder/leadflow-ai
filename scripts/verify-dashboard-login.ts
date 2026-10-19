/**
 * End-to-end check of dashboard sign-in against production, without a password:
 *   1. the deployed frontend bundle is built with Supabase (login screen, not demo mode)
 *   2. tenant_members rows point at real, confirmed users
 *   3. a server-minted one-time magic-link token (no e-mail sent) is exchanged for a real
 *      session, and the deployed /api is called with it exactly like the dashboard does
 *   4. that session is revoked afterwards
 * Read-only apart from creating and revoking that one session.
 *
 * Usage: npx tsx scripts/verify-dashboard-login.ts [email] [origin]
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
const args = process.argv.slice(2)
const emailArg = args.find((arg) => arg.includes('@'))?.toLowerCase()
const origin = (args.find((arg) => arg.startsWith('http')) ?? 'https://leadflow-ai-snowy-one.vercel.app').replace(/\/$/, '')
const projectRef = new URL(url).hostname.split('.')[0] ?? ''

const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, serviceKey, options)

// ── 1. Deployed frontend ──
suite.section(`Deployed frontend ${origin}`)
const html = await (await fetch(origin)).text()
const scriptPath = /<script[^>]+src="([^"]+\.js)"/.exec(html)?.[1]
suite.check('index.html references a JS bundle', Boolean(scriptPath))
if (scriptPath) {
  const bundle = await (await fetch(new URL(scriptPath, origin))).text()
  suite.check(
    `bundle built with VITE_SUPABASE_URL for ${projectRef} (login screen, not demo mode)`,
    bundle.includes(projectRef),
    'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing in Vercel env at build time',
  )
  suite.check('bundle contains the login screen', bundle.includes('כניסה ללוח הלידים'))
  suite.check('bundle has no service-role key', !bundle.includes(serviceKey))
}

// ── 2. Memberships ──
suite.section('tenant_members')
const { data: memberRows, error: memberError } = await admin
  .from('tenant_members')
  .select('tenant_id, user_id, role, tenants(business_name)')
if (memberError) throw memberError
type MemberRow = { tenant_id: string; user_id: string; role: string; tenants: { business_name: string } | null }
const members = (memberRows as unknown as MemberRow[]) ?? []
suite.check('at least one membership row', members.length > 0)

const resolved: Array<MemberRow & { email: string }> = []
for (const member of members) {
  const { data, error } = await admin.auth.admin.getUserById(member.user_id)
  const user = data.user
  console.log(
    `    ${user?.email ?? '(missing user)'} -> ${member.tenants?.business_name ?? member.tenant_id} [${member.role}]` +
      `${user?.email_confirmed_at ? '' : ' (email NOT confirmed)'}${user?.last_sign_in_at ? `, last sign-in ${user.last_sign_in_at}` : ''}`,
  )
  suite.check(`member ${member.user_id.slice(0, 8)} is a real auth user`, !error && Boolean(user), error?.message)
  if (user?.email) {
    suite.check(`${user.email} has a confirmed email (required for password sign-in)`, Boolean(user.email_confirmed_at))
    resolved.push({ ...member, email: user.email.toLowerCase() })
  }
}

const target = emailArg ? resolved.find((member) => member.email === emailArg) : resolved.find((member) => member.role === 'owner') ?? resolved[0]
if (!target) {
  suite.check(emailArg ? `${emailArg} is a tenant member` : 'a member with an email exists', false)
  suite.finish()
  process.exit()
}

// ── 3. Real session against the deployed API ──
suite.section(`Session for ${target.email} against ${origin}/api`)
const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email: target.email })
suite.check('one-time sign-in token minted (no email sent)', !linkError && Boolean(link.properties?.hashed_token), linkError?.message)

const browser = createClient(url, anonKey, options)
const { data: otp, error: otpError } = await browser.auth.verifyOtp({
  type: 'email',
  token_hash: link.properties?.hashed_token ?? '',
})
const token = otp.session?.access_token ?? ''
suite.check('token exchanged for a session (Supabase Auth sign-in works)', !otpError && Boolean(token), otpError?.message)

try {
  if (token) {
    const call = async (path: string): Promise<{ status: number; body: Record<string, unknown> }> => {
      const response = await fetch(`${origin}${path}`, { headers: { Authorization: `Bearer ${token}` } })
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
      return { status: response.status, body }
    }

    const tenantsResponse = await call('/api/tenants')
    const tenants = (tenantsResponse.body.tenants as Array<{ id: string; business_name: string }> | undefined) ?? []
    const roles = (tenantsResponse.body.roles as Record<string, string> | undefined) ?? {}
    suite.check('GET /api/tenants -> 200', tenantsResponse.status === 200, tenantsResponse)
    suite.check(
      `sees own tenant "${target.tenants?.business_name}" with role ${target.role}`,
      tenants.some((tenant) => tenant.id === target.tenant_id) && roles[target.tenant_id] === target.role,
      { tenants: tenants.map((tenant) => tenant.business_name), roles },
    )
    const memberTenantIds = new Set(members.filter((member) => member.user_id === target.user_id).map((member) => member.tenant_id))
    suite.check(
      'sees only tenants it is a member of',
      tenants.every((tenant) => memberTenantIds.has(tenant.id)) || roles[tenants[0]?.id ?? ''] === 'admin',
      tenants.map((tenant) => tenant.business_name),
    )

    const id = encodeURIComponent(target.tenant_id)
    const leadsResponse = await call(`/api/leads?tenant_id=${id}`)
    const leads = (leadsResponse.body.leads as Array<{ tenant_id: string }> | undefined) ?? []
    suite.check(`GET /api/leads -> 200 (${leads.length} leads)`, leadsResponse.status === 200, leadsResponse.status)
    suite.check('all leads belong to the tenant', leads.every((lead) => lead.tenant_id === target.tenant_id))
    const conversationsResponse = await call(`/api/leads?conversations=1&tenant_id=${id}`)
    const conversations = (conversationsResponse.body.conversations as Array<{ id: string }> | undefined) ?? []
    suite.check(`GET conversations -> 200 (${conversations.length} conversations)`, conversationsResponse.status === 200)
    if (conversations[0]) {
      const messagesResponse = await call(`/api/leads?conversation_id=${encodeURIComponent(conversations[0].id)}`)
      suite.check('GET conversation messages -> 200', messagesResponse.status === 200, messagesResponse.status)
    }

    // A tenant the user does not belong to must stay invisible.
    const { data: allTenants } = await admin.from('tenants').select('id, business_name')
    const foreign = ((allTenants as Array<{ id: string; business_name: string }> | null) ?? []).find(
      (tenant) => !memberTenantIds.has(tenant.id),
    )
    if (foreign && roles[target.tenant_id] !== 'admin') {
      const crossTenant = await call(`/api/leads?tenant_id=${encodeURIComponent(foreign.id)}`)
      suite.check(`foreign tenant "${foreign.business_name}" -> 404`, crossTenant.status === 404, crossTenant.status)
    } else {
      console.log('    (no foreign tenant to test cross-tenant isolation against)')
    }
  }
} finally {
  // ── 4. Revoke the verification session ──
  if (token) {
    const { error } = await browser.auth.signOut({ scope: 'local' })
    suite.check('verification session revoked', !error, error?.message)
  }
}

suite.finish()
