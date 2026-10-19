/**
 * Verifies /api/leads and /api/tenants reject unauthenticated requests with 401 on
 * every method, before touching the database (offline; no Supabase calls are made).
 *
 *   npx tsx scripts/test-api-auth.ts               offline handler checks
 *   npx tsx scripts/test-api-auth.ts --live [url]  also probes a deployed origin
 *                                                  (default https://leadflow-ai-snowy-one.vercel.app)
 */
import leadsHandler from '../api/leads.js'
import tenantsHandler from '../api/tenants.js'
import type { ApiRequest, ApiResponse } from '../api/_lib/http.js'
import { isLive, Suite } from './_lib/test-kit.js'

const suite = new Suite()

type Captured = { status: number; body: unknown; headers: Record<string, string> }

async function invoke(
  handler: (req: ApiRequest, res: ApiResponse) => Promise<void>,
  method: string,
  authorization?: string,
): Promise<Captured> {
  const captured: Captured = { status: 0, body: undefined, headers: {} }
  const res: ApiResponse = {
    setHeader: (name, value) => {
      captured.headers[name.toLowerCase()] = value
    },
    status: (code) => {
      captured.status = code
      return res
    },
    json: (body) => {
      captured.body = body
    },
    send: (body) => {
      captured.body = body
    },
    end: () => undefined,
  }
  const req: ApiRequest = {
    method,
    headers: authorization ? { authorization } : {},
    query: { id: '00000000-0000-4000-8000-000000000000' },
    body: { id: '00000000-0000-4000-8000-000000000000', status: 'new', tenant_id: 'x', business_name: 'x' },
  }
  await handler(req, res)
  return captured
}

// Make any accidental database access fail loudly instead of reaching a real project.
process.env.SUPABASE_URL = 'http://127.0.0.1:9'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'offline-test'

suite.section('Unauthenticated requests are rejected (offline)')
for (const [name, handler] of [
  ['/api/leads', leadsHandler],
  ['/api/tenants', tenantsHandler],
] as const) {
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
    const missing = await invoke(handler, method)
    suite.check(`${method} ${name} without token -> 401`, missing.status === 401, missing)
    const wrongScheme = await invoke(handler, method, 'Basic dXNlcjpwYXNz')
    suite.check(`${method} ${name} with non-Bearer auth -> 401`, wrongScheme.status === 401, wrongScheme)
  }
  const missing = await invoke(handler, 'GET')
  suite.check(`${name} sends WWW-Authenticate`, missing.headers['www-authenticate'] === 'Bearer')
  suite.check(`${name} 401 body leaks no data`, JSON.stringify(missing.body) === '{"error":"Unauthorized"}', missing.body)
  const preflight = await invoke(handler, 'OPTIONS')
  suite.check(`${name} CORS preflight still answers 200`, preflight.status === 200)
}

if (isLive) {
  const origin = (process.argv.find((arg) => arg.startsWith('http')) ?? 'https://leadflow-ai-snowy-one.vercel.app').replace(/\/$/, '')
  suite.section(`Deployed origin ${origin}`)
  for (const path of ['/api/leads', '/api/tenants', '/api/leads?conversations=1']) {
    const response = await fetch(`${origin}${path}`)
    suite.check(`GET ${path} without token -> 401`, response.status === 401, response.status)
    const forged = await fetch(`${origin}${path}`, { headers: { Authorization: 'Bearer not-a-real-jwt' } })
    suite.check(`GET ${path} with forged token -> 401`, forged.status === 401, forged.status)
  }
}

suite.finish()
