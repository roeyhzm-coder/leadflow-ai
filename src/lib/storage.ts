import {
  DEMO_CONVERSATIONS,
  DEMO_LEADS,
  DEMO_MESSAGES,
  DEMO_TENANT,
} from './demo-data.ts'
import type { Conversation, Lead, Message, Tenant } from './types.ts'

const PREFIX = 'leadflow.v1.'

type StoreShape = {
  tenant: Tenant
  leads: Lead[]
  conversations: Conversation[]
  messages: Message[]
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private mode / disabled storage should not break the dashboard.
  }
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const map = new Map(current.map((item) => [item.id, item]))
  for (const item of incoming) {
    if (!map.has(item.id)) {
      map.set(item.id, item)
    }
  }
  return [...map.values()]
}

export function mergeDemoIntoLocalStorage(): StoreShape {
  const tenant = {
    ...DEMO_TENANT,
    ...readJson<Partial<Tenant>>(`${PREFIX}tenant`, {}),
    id: DEMO_TENANT.id,
  } as Tenant

  const leads = mergeById(readJson<Lead[]>(`${PREFIX}leads`, []), DEMO_LEADS)
  const conversations = mergeById(
    readJson<Conversation[]>(`${PREFIX}conversations`, []),
    DEMO_CONVERSATIONS,
  )
  const messages = mergeById(readJson<Message[]>(`${PREFIX}messages`, []), DEMO_MESSAGES)

  writeJson(`${PREFIX}tenant`, tenant)
  writeJson(`${PREFIX}leads`, leads)
  writeJson(`${PREFIX}conversations`, conversations)
  writeJson(`${PREFIX}messages`, messages)

  return { tenant, leads, conversations, messages }
}

export function readLocalStore(): StoreShape {
  return {
    tenant: readJson(`${PREFIX}tenant`, DEMO_TENANT),
    leads: readJson(`${PREFIX}leads`, DEMO_LEADS),
    conversations: readJson(`${PREFIX}conversations`, DEMO_CONVERSATIONS),
    messages: readJson(`${PREFIX}messages`, DEMO_MESSAGES),
  }
}

export function saveLocalLeads(leads: Lead[]): void {
  writeJson(`${PREFIX}leads`, leads)
}

export function saveLocalTenant(tenant: Tenant): void {
  writeJson(`${PREFIX}tenant`, tenant)
}
