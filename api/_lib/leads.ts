import type { SupabaseClient } from '@supabase/supabase-js'
import type { CapturedLead, Conversation, Lead, LeadStatus } from './types.js'

export type LeadFields = Pick<
  Lead,
  'customer_name' | 'customer_phone' | 'service_requested' | 'preferred_time' | 'notes'
>

export type LeadInsert = LeadFields & {
  tenant_id: string
  conversation_id: string
  status: LeadStatus
}

/** Storage seam for lead upserts; Supabase in production, in-memory in tests. */
export interface LeadStore {
  findOpenLead(conversationId: string): Promise<Lead | null>
  insertLead(row: LeadInsert): Promise<Lead | 'conflict'>
  updateLead(id: string, patch: LeadFields): Promise<Lead>
}

const OPEN_STATUSES: LeadStatus[] = ['new', 'in_progress']

function pick(next: string, previous: string | null, fallback: string | null = null): string | null {
  if (next.trim()) return next.trim()
  if (previous?.trim()) return previous
  return fallback?.trim() ? fallback : null
}

/**
 * Field-wise merge: a value the model just extracted wins, otherwise the stored value
 * is kept. The model only sees the latest messages, so details given earlier in the
 * conversation must survive later turns that omit them.
 */
export function mergeLead(
  existing: LeadFields | null,
  captured: CapturedLead,
  conversation: Pick<Conversation, 'customer_name' | 'customer_phone'>,
): LeadFields {
  return {
    customer_name: pick(captured.customer_name, existing?.customer_name ?? null, conversation.customer_name),
    customer_phone: pick(captured.customer_phone, existing?.customer_phone ?? null, conversation.customer_phone),
    service_requested: pick(captured.service_requested, existing?.service_requested ?? null),
    preferred_time: pick(captured.preferred_time, existing?.preferred_time ?? null),
    notes: pick(captured.notes, existing?.notes ?? null),
  }
}

/** Enough to book: who, what and when. */
export function isQualified(lead: LeadFields | null): boolean {
  return Boolean(lead?.customer_name && lead.service_requested && lead.preferred_time)
}

export type LeadUpsertResult = {
  lead: Lead
  created: boolean
  /** True only on the upsert that first made the lead qualified; used to notify staff once. */
  becameQualified: boolean
}

export async function upsertCapturedLead(
  store: LeadStore,
  tenantId: string,
  conversation: Pick<Conversation, 'id' | 'customer_name' | 'customer_phone'>,
  captured: CapturedLead,
): Promise<LeadUpsertResult> {
  const existing = await store.findOpenLead(conversation.id)
  if (existing) {
    // Read before the write: a store may update the returned object in place.
    const wasQualified = isQualified(existing)
    const merged = mergeLead(existing, captured, conversation)
    const lead = await store.updateLead(existing.id, merged)
    return { lead, created: false, becameQualified: isQualified(merged) && !wasQualified }
  }

  const merged = mergeLead(null, captured, conversation)
  const inserted = await store.insertLead({
    ...merged,
    tenant_id: tenantId,
    conversation_id: conversation.id,
    status: 'new',
  })
  if (inserted === 'conflict') {
    // A concurrent webhook created the open lead first; merge into it instead.
    const winner = await store.findOpenLead(conversation.id)
    if (!winner) throw new Error('Lead insert conflicted but no open lead was found')
    const winnerQualified = isQualified(winner)
    const remerged = mergeLead(winner, captured, conversation)
    const lead = await store.updateLead(winner.id, remerged)
    return { lead, created: false, becameQualified: isQualified(remerged) && !winnerQualified }
  }
  return { lead: inserted, created: true, becameQualified: isQualified(merged) }
}

export function supabaseLeadStore(client: SupabaseClient): LeadStore {
  return {
    async findOpenLead(conversationId) {
      const { data, error } = await client
        .from('leads')
        .select('*')
        .eq('conversation_id', conversationId)
        .in('status', OPEN_STATUSES)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return (data as Lead | null) ?? null
    },
    async insertLead(row) {
      const { data, error } = await client.from('leads').insert(row).select('*').single()
      // 23505: the one-open-lead-per-conversation index (see the enterprise migration).
      if (error?.code === '23505') return 'conflict'
      if (error) throw error
      return data as Lead
    },
    async updateLead(id, patch) {
      const { data, error } = await client.from('leads').update(patch).eq('id', id).select('*').single()
      if (error) throw error
      return data as Lead
    },
  }
}
