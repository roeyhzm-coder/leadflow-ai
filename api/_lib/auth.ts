import { readString, type ApiRequest, type ApiResponse } from './http.js'
import { getServiceClient } from './supabase.js'

export type TenantRole = 'owner' | 'staff'

export type AuthContext = {
  userId: string
  email: string
  /** tenant_id -> role for every tenant the caller belongs to. */
  roles: ReadonlyMap<string, TenantRole>
  /** Listed in PLATFORM_ADMIN_EMAILS: may create tenants and re-route WhatsApp instances. */
  isPlatformAdmin: boolean
}

function bearerToken(req: ApiRequest): string {
  const header = readString(req.headers.authorization)?.trim() ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match?.[1]?.trim() ?? ''
}

function platformAdminEmails(): ReadonlySet<string> {
  return new Set(
    (process.env.PLATFORM_ADMIN_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0),
  )
}

/**
 * Validates the caller's Supabase access token (signature, expiry and revocation are
 * checked by Supabase Auth) and loads their tenant memberships. Sends 401 and returns
 * null when the token is missing or invalid. Membership lookup errors propagate, so
 * callers fail closed with a 500 rather than serving data.
 */
export async function requireAuth(req: ApiRequest, res: ApiResponse): Promise<AuthContext | null> {
  const token = bearerToken(req)
  if (!token) {
    res.setHeader('WWW-Authenticate', 'Bearer')
    res.status(401).json({ error: 'Unauthorized' })
    return null
  }

  const supabase = getServiceClient()
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) {
    res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"')
    res.status(401).json({ error: 'Unauthorized' })
    return null
  }

  const { data: memberships, error: membershipError } = await supabase
    .from('tenant_members')
    .select('tenant_id, role')
    .eq('user_id', data.user.id)
  if (membershipError) throw membershipError

  const roles = new Map<string, TenantRole>()
  for (const row of (memberships as Array<{ tenant_id: string; role: string }> | null) ?? []) {
    roles.set(row.tenant_id, row.role === 'owner' ? 'owner' : 'staff')
  }

  const email = data.user.email?.toLowerCase() ?? ''
  return {
    userId: data.user.id,
    email,
    roles,
    isPlatformAdmin: email.length > 0 && platformAdminEmails().has(email),
  }
}

export function canRead(auth: AuthContext, tenantId: string | null | undefined): boolean {
  return Boolean(tenantId && auth.roles.has(tenantId))
}

export function isOwner(auth: AuthContext, tenantId: string | null | undefined): boolean {
  return Boolean(tenantId && auth.roles.get(tenantId) === 'owner')
}

export function memberTenantIds(auth: AuthContext): string[] {
  return [...auth.roles.keys()]
}
