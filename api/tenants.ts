import { applyCors, parseBody, readString, type ApiRequest, type ApiResponse } from './_lib/http.js'
import { getServiceClient } from './_lib/supabase.js'
import type { Tenant } from './_lib/types.js'

function json(res: ApiResponse, status: number, body: unknown): void {
  res.status(status).json(body)
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
      const id = readString(req.query.id)
      if (id) {
        const { data, error } = await supabase.from('tenants').select('*').eq('id', id).maybeSingle()
        if (error) throw error
        if (!data) {
          json(res, 404, { error: 'Tenant not found' })
          return
        }
        json(res, 200, { tenant: data as Tenant })
        return
      }

      const { data, error } = await supabase
        .from('tenants')
        .select('*')
        .order('created_at', { ascending: true })
      if (error) throw error
      json(res, 200, { tenants: (data as Tenant[]) ?? [] })
      return
    }

    if (req.method === 'POST') {
      const body = parseBody<Partial<Tenant>>(req)
      if (!body.business_name?.trim()) {
        json(res, 400, { error: 'business_name is required' })
        return
      }
      const { data, error } = await supabase
        .from('tenants')
        .insert({
          business_name: body.business_name.trim(),
          whatsapp_instance_id: body.whatsapp_instance_id ?? null,
          whatsapp_phone: body.whatsapp_phone ?? null,
          owner_phone: body.owner_phone ?? null,
          system_prompt: body.system_prompt ?? null,
          target_goal: body.target_goal ?? null,
          is_active: body.is_active ?? true,
        })
        .select('*')
        .single()
      if (error) throw error
      json(res, 201, { tenant: data })
      return
    }

    if (req.method === 'PATCH' || req.method === 'PUT') {
      const body = parseBody<Partial<Tenant> & { id?: string }>(req)
      const id = body.id ?? readString(req.query.id)
      if (!id) {
        json(res, 400, { error: 'id is required' })
        return
      }

      const patch: Record<string, unknown> = {}
      if (typeof body.business_name === 'string') patch.business_name = body.business_name.trim()
      if (body.whatsapp_instance_id !== undefined) {
        patch.whatsapp_instance_id = body.whatsapp_instance_id
      }
      if (body.whatsapp_phone !== undefined) patch.whatsapp_phone = body.whatsapp_phone
      if (body.owner_phone !== undefined) patch.owner_phone = body.owner_phone
      if (body.system_prompt !== undefined) patch.system_prompt = body.system_prompt
      if (body.target_goal !== undefined) patch.target_goal = body.target_goal
      if (typeof body.is_active === 'boolean') patch.is_active = body.is_active

      if (Object.keys(patch).length === 0) {
        json(res, 400, { error: 'No fields to update' })
        return
      }

      const { data, error } = await supabase
        .from('tenants')
        .update(patch)
        .eq('id', id)
        .select('*')
        .single()
      if (error) throw error
      json(res, 200, { tenant: data })
      return
    }

    if (req.method === 'DELETE') {
      const id = readString(req.query.id)
      if (!id) {
        json(res, 400, { error: 'id is required' })
        return
      }
      const { error } = await supabase.from('tenants').update({ is_active: false }).eq('id', id)
      if (error) throw error
      json(res, 200, { ok: true })
      return
    }

    json(res, 405, { error: 'Method not allowed' })
  } catch (error) {
    console.error('tenants api failed', error)
    json(res, 500, {
      error: error instanceof Error ? error.message : 'Failed to process tenants request',
    })
  }
}
