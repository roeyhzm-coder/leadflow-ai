import {
  mergeDemoIntoLocalStorage,
  readLocalStore,
  saveLocalLeads,
  saveLocalTenant,
} from './storage.ts'
import type {
  Conversation,
  Lead,
  LeadStatus,
  Message,
  Tenant,
  TenantRole,
  TenantSettingsPatch,
} from './types.ts'

export type DataSource = 'api' | 'local'

export type DashboardPayload = {
  tenant: Tenant
  tenants: Tenant[]
  role: TenantRole
  leads: Lead[]
  conversations: Conversation[]
  source: DataSource
}

/** Data access used by the dashboard: authenticated /api calls, or local demo data. */
export type DashboardApi = {
  /** Null when the signed-in user is not a member of any tenant. */
  load(tenantId?: string): Promise<DashboardPayload | null>
  loadMessages(conversationId: string): Promise<Message[]>
  updateLeadStatus(id: string, status: LeadStatus): Promise<Lead>
  updateTenantSettings(tenant: Tenant, patch: TenantSettingsPatch): Promise<Tenant>
}

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function errorMessage(body: unknown): string | null {
  if (body && typeof body === 'object' && 'error' in body) {
    const value = (body as { error: unknown }).error
    if (typeof value === 'string') return value
  }
  return null
}

function field<T>(body: unknown, key: string): T | undefined {
  if (!body || typeof body !== 'object') return undefined
  return (body as Record<string, unknown>)[key] as T | undefined
}

/**
 * Calls /api with the current Supabase access token. `getToken` returns a fresh
 * (auto-refreshed) token, or null when signed out.
 */
export function createRemoteApi(getToken: () => Promise<string | null>): DashboardApi {
  async function call(path: string, init: RequestInit = {}): Promise<unknown> {
    const token = await getToken()
    if (!token) throw new ApiError(401, 'Not signed in')
    const response = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...init.headers,
      },
    })
    const body = await parseJson(response)
    if (!response.ok) {
      throw new ApiError(response.status, errorMessage(body) ?? `Request failed (${response.status})`)
    }
    return body
  }

  return {
    async load(tenantId) {
      const body = await call('/api/tenants')
      const tenants = field<Tenant[]>(body, 'tenants') ?? []
      const roles = field<Record<string, TenantRole>>(body, 'roles') ?? {}
      const tenant = tenants.find((item) => item.id === tenantId) ?? tenants[0]
      if (!tenant) return null

      const id = encodeURIComponent(tenant.id)
      const [leadsBody, conversationsBody] = await Promise.all([
        call(`/api/leads?tenant_id=${id}`),
        call(`/api/leads?conversations=1&tenant_id=${id}`),
      ])
      return {
        tenant,
        tenants,
        role: roles[tenant.id] ?? 'staff',
        leads: field<Lead[]>(leadsBody, 'leads') ?? [],
        conversations: field<Conversation[]>(conversationsBody, 'conversations') ?? [],
        source: 'api',
      }
    },

    async loadMessages(conversationId) {
      const body = await call(`/api/leads?conversation_id=${encodeURIComponent(conversationId)}`)
      return field<Message[]>(body, 'messages') ?? []
    },

    async updateLeadStatus(id, status) {
      const body = await call('/api/leads', { method: 'PATCH', body: JSON.stringify({ id, status }) })
      const lead = field<Lead>(body, 'lead')
      if (!lead) throw new ApiError(500, 'Malformed response')
      return lead
    },

    async updateTenantSettings(tenant, patch) {
      const body = await call('/api/tenants', {
        method: 'PATCH',
        body: JSON.stringify({ id: tenant.id, ...patch }),
      })
      const saved = field<Tenant>(body, 'tenant')
      if (!saved) throw new ApiError(500, 'Malformed response')
      return saved
    },
  }
}

/** Demo mode for when Supabase is not configured: browser-local sample data only. */
export function createLocalApi(): DashboardApi {
  return {
    async load() {
      const merged = mergeDemoIntoLocalStorage()
      return {
        tenant: merged.tenant,
        tenants: [merged.tenant],
        role: 'owner',
        leads: merged.leads,
        conversations: merged.conversations,
        source: 'local',
      }
    },

    async loadMessages(conversationId) {
      return readLocalStore().messages.filter((item) => item.conversation_id === conversationId)
    },

    async updateLeadStatus(id, status) {
      const leads = readLocalStore().leads.map((lead) => (lead.id === id ? { ...lead, status } : lead))
      saveLocalLeads(leads)
      const lead = leads.find((item) => item.id === id)
      if (!lead) throw new ApiError(404, 'Lead not found')
      return lead
    },

    async updateTenantSettings(tenant, patch) {
      const next: Tenant = {
        ...tenant,
        business_name: patch.business_name,
        system_prompt: patch.system_prompt,
        owner_phone: patch.owner_phone,
        target_goal: patch.target_goal ?? tenant.target_goal,
      }
      saveLocalTenant(next)
      return next
    },
  }
}
