import { canRead, isOwner, memberTenantIds, requireAuth } from './_lib/auth.js'
import { applyCors, parseBody, readString, type ApiRequest, type ApiResponse } from './_lib/http.js'
import { getServiceClient } from './_lib/supabase.js'
import type { Conversation, Lead, LeadStatus, Message } from './_lib/types.js'

const STATUSES: LeadStatus[] = ['new', 'in_progress', 'converted', 'dismissed']

function json(res: ApiResponse, status: number, body: unknown): void {
  res.status(status).json(body)
}

function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === 'string' && (STATUSES as string[]).includes(value)
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * Every query is scoped to the caller's tenant_members rows. Records outside them
 * answer 404 (not 403) so the API does not confirm that a foreign id exists.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  applyCors(req, res)

  if (req.method === 'OPTIONS') {
    json(res, 200, { ok: true })
    return
  }

  try {
    const auth = await requireAuth(req, res)
    if (!auth) return

    const supabase = getServiceClient()
    const tenantIds = memberTenantIds(auth)

    const leadInScope = async (id: string): Promise<Lead | null> => {
      const { data, error } = await supabase.from('leads').select('*').eq('id', id).maybeSingle()
      if (error) throw error
      const lead = data as Lead | null
      return lead && canRead(auth, lead.tenant_id) ? lead : null
    }

    if (req.method === 'GET') {
      const leadId = readString(req.query.id)
      const conversationId = readString(req.query.conversation_id)
      const tenantId = readString(req.query.tenant_id)
      const conversationsOnly = readString(req.query.conversations)

      if (tenantId && !canRead(auth, tenantId)) {
        json(res, 404, { error: 'Tenant not found' })
        return
      }
      const scope = tenantId ? [tenantId] : tenantIds
      if (scope.length === 0) {
        json(res, 200, { leads: [], conversations: [], messages: [] })
        return
      }

      if (conversationsOnly === '1' || conversationsOnly === 'true') {
        const { data, error } = await supabase
          .from('conversations')
          .select('*')
          .in('tenant_id', scope)
          .order('last_message_at', { ascending: false })
        if (error) throw error
        json(res, 200, { conversations: (data as Conversation[]) ?? [] })
        return
      }

      if (conversationId) {
        const { data: conversation, error: conversationError } = await supabase
          .from('conversations')
          .select('tenant_id')
          .eq('id', conversationId)
          .maybeSingle()
        if (conversationError) throw conversationError
        if (!conversation || !canRead(auth, (conversation as { tenant_id: string }).tenant_id)) {
          json(res, 404, { error: 'Conversation not found' })
          return
        }
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: true })
        if (error) throw error
        json(res, 200, { messages: (data as Message[]) ?? [] })
        return
      }

      if (leadId) {
        const lead = await leadInScope(leadId)
        if (!lead) {
          json(res, 404, { error: 'Lead not found' })
          return
        }
        let messages: Message[] = []
        if (lead.conversation_id) {
          const { data: history, error: msgError } = await supabase
            .from('messages')
            .select('*')
            .eq('conversation_id', lead.conversation_id)
            .order('created_at', { ascending: true })
          if (msgError) throw msgError
          messages = (history as Message[]) ?? []
        }
        json(res, 200, { lead, messages })
        return
      }

      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .in('tenant_id', scope)
        .order('created_at', { ascending: false })
      if (error) throw error
      json(res, 200, { leads: (data as Lead[]) ?? [] })
      return
    }

    if (req.method === 'POST') {
      const body = parseBody<Partial<Lead>>(req)
      if (!body.tenant_id) {
        json(res, 400, { error: 'tenant_id is required' })
        return
      }
      if (!canRead(auth, body.tenant_id)) {
        json(res, 404, { error: 'Tenant not found' })
        return
      }
      if (body.conversation_id) {
        const { data: conversation, error } = await supabase
          .from('conversations')
          .select('tenant_id')
          .eq('id', body.conversation_id)
          .maybeSingle()
        if (error) throw error
        if ((conversation as { tenant_id: string } | null)?.tenant_id !== body.tenant_id) {
          json(res, 400, { error: 'conversation_id does not belong to tenant_id' })
          return
        }
      }
      const { data, error } = await supabase
        .from('leads')
        .insert({
          tenant_id: body.tenant_id,
          conversation_id: body.conversation_id ?? null,
          customer_name: optionalText(body.customer_name),
          customer_phone: optionalText(body.customer_phone),
          service_requested: optionalText(body.service_requested),
          preferred_time: optionalText(body.preferred_time),
          notes: optionalText(body.notes),
          status: isLeadStatus(body.status) ? body.status : 'new',
        })
        .select('*')
        .single()
      if (error) throw error
      json(res, 201, { lead: data })
      return
    }

    if (req.method === 'PATCH' || req.method === 'PUT') {
      const body = parseBody<{ id?: string; status?: string; notes?: string }>(req)
      const id = body.id ?? readString(req.query.id)
      if (!id) {
        json(res, 400, { error: 'id is required' })
        return
      }
      const patch: Record<string, string> = {}
      if (body.status) {
        if (!isLeadStatus(body.status)) {
          json(res, 400, { error: 'Invalid status' })
          return
        }
        patch.status = body.status
      }
      if (typeof body.notes === 'string') patch.notes = body.notes
      if (Object.keys(patch).length === 0) {
        json(res, 400, { error: 'No fields to update' })
        return
      }
      if (!(await leadInScope(id))) {
        json(res, 404, { error: 'Lead not found' })
        return
      }
      const { data, error } = await supabase
        .from('leads')
        .update(patch)
        .eq('id', id)
        .select('*')
        .single()
      if (error) throw error
      json(res, 200, { lead: data })
      return
    }

    if (req.method === 'DELETE') {
      const id = readString(req.query.id)
      if (!id) {
        json(res, 400, { error: 'id is required' })
        return
      }
      const lead = await leadInScope(id)
      if (!lead) {
        json(res, 404, { error: 'Lead not found' })
        return
      }
      if (!isOwner(auth, lead.tenant_id)) {
        json(res, 403, { error: 'Only tenant owners can delete leads' })
        return
      }
      const { error } = await supabase.from('leads').delete().eq('id', id)
      if (error) throw error
      json(res, 200, { ok: true })
      return
    }

    json(res, 405, { error: 'Method not allowed' })
  } catch (error) {
    console.error('leads api failed', error)
    json(res, 500, { error: 'Failed to process leads request' })
  }
}
