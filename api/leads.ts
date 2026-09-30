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

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  applyCors(res)

  if (req.method === 'OPTIONS') {
    json(res, 200, { ok: true })
    return
  }

  try {
    const supabase = getServiceClient()

    if (req.method === 'GET') {
      const leadId = readString(req.query.id)
      const conversationId = readString(req.query.conversation_id)
      const tenantId = readString(req.query.tenant_id)
      const conversationsOnly = readString(req.query.conversations)

      if (conversationsOnly === '1' || conversationsOnly === 'true') {
        let query = supabase
          .from('conversations')
          .select('*')
          .order('last_message_at', { ascending: false })
        if (tenantId) query = query.eq('tenant_id', tenantId)
        const { data, error } = await query
        if (error) throw error
        json(res, 200, { conversations: (data as Conversation[]) ?? [] })
        return
      }

      if (conversationId) {
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
        const { data: lead, error } = await supabase
          .from('leads')
          .select('*')
          .eq('id', leadId)
          .maybeSingle()
        if (error) throw error
        if (!lead) {
          json(res, 404, { error: 'Lead not found' })
          return
        }
        let messages: Message[] = []
        const convId = (lead as Lead).conversation_id
        if (convId) {
          const { data: history, error: msgError } = await supabase
            .from('messages')
            .select('*')
            .eq('conversation_id', convId)
            .order('created_at', { ascending: true })
          if (msgError) throw msgError
          messages = (history as Message[]) ?? []
        }
        json(res, 200, { lead, messages })
        return
      }

      let query = supabase.from('leads').select('*').order('created_at', { ascending: false })
      if (tenantId) query = query.eq('tenant_id', tenantId)
      const { data, error } = await query
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
      const { data, error } = await supabase
        .from('leads')
        .insert({
          tenant_id: body.tenant_id,
          conversation_id: body.conversation_id ?? null,
          customer_name: body.customer_name ?? null,
          customer_phone: body.customer_phone ?? null,
          service_requested: body.service_requested ?? null,
          preferred_time: body.preferred_time ?? null,
          notes: body.notes ?? null,
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
      const { error } = await supabase.from('leads').delete().eq('id', id)
      if (error) throw error
      json(res, 200, { ok: true })
      return
    }

    json(res, 405, { error: 'Method not allowed' })
  } catch (error) {
    console.error('leads api failed', error)
    json(res, 500, {
      error: error instanceof Error ? error.message : 'Failed to process leads request',
    })
  }
}
