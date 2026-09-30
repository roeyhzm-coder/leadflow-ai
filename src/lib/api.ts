import { DEMO_TENANT_ID } from './demo-data.ts'
import {
  mergeDemoIntoLocalStorage,
  readLocalStore,
  saveLocalLeads,
  saveLocalTenant,
} from './storage.ts'
import { getSupabase } from './supabase.ts'
import type {
  Conversation,
  Lead,
  LeadStatus,
  Message,
  Tenant,
  TenantSettingsPatch,
} from './types.ts'

export type DataSource = 'api' | 'supabase' | 'local'

export type DashboardPayload = {
  tenant: Tenant
  leads: Lead[]
  conversations: Conversation[]
  source: DataSource
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  return JSON.parse(text) as unknown
}

async function getJson(path: string): Promise<unknown | null> {
  const response = await fetch(path)
  if (!response.ok) return null
  return parseJson(response)
}

async function sendJson(path: string, method: string, body: unknown): Promise<unknown | null> {
  const response = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) return null
  return parseJson(response)
}

function asTenantList(value: unknown): Tenant[] {
  if (!value || typeof value !== 'object') return []
  const record = value as { tenants?: Tenant[]; tenant?: Tenant }
  if (Array.isArray(record.tenants)) return record.tenants
  if (record.tenant) return [record.tenant]
  return []
}

function asLeadList(value: unknown): Lead[] {
  if (!value || typeof value !== 'object') return []
  const record = value as { leads?: Lead[]; lead?: Lead }
  if (Array.isArray(record.leads)) return record.leads
  if (record.lead) return [record.lead]
  return []
}

function asConversationList(value: unknown): Conversation[] {
  if (!value || typeof value !== 'object') return []
  const record = value as { conversations?: Conversation[] }
  return Array.isArray(record.conversations) ? record.conversations : []
}

function asMessageList(value: unknown): Message[] {
  if (!value || typeof value !== 'object') return []
  const record = value as { messages?: Message[] }
  return Array.isArray(record.messages) ? record.messages : []
}

export function loadDashboardLocal(): DashboardPayload {
  const merged = mergeDemoIntoLocalStorage()
  return {
    tenant: merged.tenant,
    leads: merged.leads,
    conversations: merged.conversations,
    source: 'local',
  }
}

export async function loadDashboard(): Promise<DashboardPayload> {
  const local = loadDashboardLocal()

  try {
    const tenantsRaw = await getJson('/api/tenants')
    const leadsRaw = await getJson(`/api/leads?tenant_id=${encodeURIComponent(DEMO_TENANT_ID)}`)
    const conversationsRaw = await getJson(
      `/api/leads?conversations=1&tenant_id=${encodeURIComponent(DEMO_TENANT_ID)}`,
    )
    const tenants = asTenantList(tenantsRaw)
    const leads = asLeadList(leadsRaw)
    const conversations = asConversationList(conversationsRaw)
    const tenant = tenants.find((item) => item.id === DEMO_TENANT_ID) ?? tenants[0]
    if (tenant) {
      return { tenant, leads, conversations, source: 'api' }
    }
  } catch {
    // Fall through to Supabase / local demo data.
  }

  const supabase = getSupabase()
  if (supabase) {
    try {
      const [{ data: tenant }, { data: leads }, { data: conversations }] = await Promise.all([
        supabase.from('tenants').select('*').eq('id', DEMO_TENANT_ID).maybeSingle(),
        supabase
          .from('leads')
          .select('*')
          .eq('tenant_id', DEMO_TENANT_ID)
          .order('created_at', { ascending: false }),
        supabase
          .from('conversations')
          .select('*')
          .eq('tenant_id', DEMO_TENANT_ID)
          .order('last_message_at', { ascending: false }),
      ])
      if (tenant) {
        return {
          tenant: tenant as Tenant,
          leads: (leads as Lead[]) ?? [],
          conversations: (conversations as Conversation[]) ?? [],
          source: 'supabase',
        }
      }
    } catch {
      // Fall through to local demo data.
    }
  }

  return local
}

export async function loadMessages(conversationId: string): Promise<Message[]> {
  try {
    const raw = await getJson(
      `/api/leads?conversation_id=${encodeURIComponent(conversationId)}`,
    )
    const fromApi = asMessageList(raw)
    if (fromApi.length > 0) return fromApi
  } catch {
    // Continue to fallbacks.
  }

  const supabase = getSupabase()
  if (supabase) {
    try {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
      if (data && data.length > 0) return data as Message[]
    } catch {
      // Continue to local fallback.
    }
  }

  return readLocalStore().messages.filter((item) => item.conversation_id === conversationId)
}

export async function updateLeadStatus(id: string, status: LeadStatus): Promise<Lead | null> {
  const local = readLocalStore()
  const nextLeads = local.leads.map((lead) => (lead.id === id ? { ...lead, status } : lead))
  saveLocalLeads(nextLeads)

  try {
    const raw = await sendJson('/api/leads', 'PATCH', { id, status })
    if (raw && typeof raw === 'object' && 'lead' in raw) {
      return (raw as { lead: Lead }).lead
    }
  } catch {
    // Try Supabase next.
  }

  const supabase = getSupabase()
  if (supabase) {
    try {
      const { data } = await supabase.from('leads').update({ status }).eq('id', id).select('*').single()
      if (data) return data as Lead
    } catch {
      // Keep local copy.
    }
  }

  return nextLeads.find((lead) => lead.id === id) ?? null
}

export async function updateTenantSettings(
  tenant: Tenant,
  patch: TenantSettingsPatch,
): Promise<Tenant> {
  const next: Tenant = {
    ...tenant,
    business_name: patch.business_name,
    system_prompt: patch.system_prompt,
    owner_phone: patch.owner_phone,
    target_goal: patch.target_goal ?? tenant.target_goal,
  }
  saveLocalTenant(next)

  try {
    const raw = await sendJson('/api/tenants', 'PATCH', { id: tenant.id, ...patch })
    if (raw && typeof raw === 'object' && 'tenant' in raw) {
      const saved = (raw as { tenant: Tenant }).tenant
      saveLocalTenant(saved)
      return saved
    }
  } catch {
    // Try Supabase next.
  }

  const supabase = getSupabase()
  if (supabase) {
    try {
      const { data } = await supabase
        .from('tenants')
        .update(patch)
        .eq('id', tenant.id)
        .select('*')
        .single()
      if (data) {
        saveLocalTenant(data as Tenant)
        return data as Tenant
      }
    } catch {
      // Keep local copy.
    }
  }

  return next
}
