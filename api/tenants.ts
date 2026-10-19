import { canRead, isOwner, memberTenantIds, requireAuth, type AuthContext } from './_lib/auth.js'
import { parseBusinessHours } from './_lib/business-hours.js'
import { parsePriceList } from './_lib/guardrails.js'
import { applyCors, parseBody, readString, type ApiRequest, type ApiResponse } from './_lib/http.js'
import { getServiceClient, normalizePhone } from './_lib/supabase.js'
import type { Tenant } from './_lib/types.js'

function json(res: ApiResponse, status: number, body: unknown): void {
  res.status(status).json(body)
}

/** Normalized 972XXXXXXXXX phone, or null when the value is not a plausible number. */
function validPhone(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const phone = normalizePhone(value)
  return /^\d{9,15}$/.test(phone) ? phone : null
}

function rolesFor(auth: AuthContext, tenants: Tenant[]): Record<string, string> {
  return Object.fromEntries(
    tenants.map((tenant) => [tenant.id, auth.roles.get(tenant.id) ?? (auth.isPlatformAdmin ? 'admin' : 'staff')]),
  )
}

/**
 * Members read their tenants; owners edit settings. Fields that steer webhook routing
 * (whatsapp_instance_id, whatsapp_phone, is_active), creating and deactivating tenants
 * are reserved for PLATFORM_ADMIN_EMAILS, so an owner cannot claim another clinic's instance.
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

    if (req.method === 'GET') {
      const id = readString(req.query.id)
      if (id) {
        if (!canRead(auth, id) && !auth.isPlatformAdmin) {
          json(res, 404, { error: 'Tenant not found' })
          return
        }
        const { data, error } = await supabase.from('tenants').select('*').eq('id', id).maybeSingle()
        if (error) throw error
        if (!data) {
          json(res, 404, { error: 'Tenant not found' })
          return
        }
        const tenant = data as Tenant
        json(res, 200, { tenant, roles: rolesFor(auth, [tenant]) })
        return
      }

      let query = supabase.from('tenants').select('*').order('created_at', { ascending: true })
      if (!auth.isPlatformAdmin) {
        const ids = memberTenantIds(auth)
        if (ids.length === 0) {
          json(res, 200, { tenants: [], roles: {} })
          return
        }
        query = query.in('id', ids)
      }
      const { data, error } = await query
      if (error) throw error
      const tenants = (data as Tenant[]) ?? []
      json(res, 200, { tenants, roles: rolesFor(auth, tenants) })
      return
    }

    if (req.method === 'POST') {
      if (!auth.isPlatformAdmin) {
        json(res, 403, { error: 'Only platform admins can create tenants' })
        return
      }
      const body = parseBody<Partial<Tenant>>(req)
      const whatsappPhone = validPhone(body.whatsapp_phone)
      const ownerPhone = validPhone(body.owner_phone)
      if (!body.business_name?.trim() || !whatsappPhone || !ownerPhone) {
        json(res, 400, { error: 'business_name, whatsapp_phone and owner_phone (valid phone numbers) are required' })
        return
      }
      const { data, error } = await supabase
        .from('tenants')
        .insert({
          business_name: body.business_name.trim(),
          whatsapp_instance_id: body.whatsapp_instance_id?.trim() || null,
          whatsapp_phone: whatsappPhone,
          owner_phone: ownerPhone,
          system_prompt: body.system_prompt ?? null,
          target_goal: body.target_goal ?? null,
          is_active: body.is_active ?? true,
        })
        .select('*')
        .single()
      if (error) throw error
      const tenant = data as Tenant

      // The creator owns the new tenant; roll the tenant back if that cannot be recorded.
      const { error: memberError } = await supabase
        .from('tenant_members')
        .insert({ tenant_id: tenant.id, user_id: auth.userId, role: 'owner' })
      if (memberError) {
        await supabase.from('tenants').delete().eq('id', tenant.id)
        throw memberError
      }
      json(res, 201, { tenant })
      return
    }

    if (req.method === 'PATCH' || req.method === 'PUT') {
      const body = parseBody<Partial<Tenant> & { id?: string }>(req)
      const id = body.id ?? readString(req.query.id)
      if (!id) {
        json(res, 400, { error: 'id is required' })
        return
      }
      if (!canRead(auth, id) && !auth.isPlatformAdmin) {
        json(res, 404, { error: 'Tenant not found' })
        return
      }
      if (!isOwner(auth, id) && !auth.isPlatformAdmin) {
        json(res, 403, { error: 'Only tenant owners can change settings' })
        return
      }

      const routingFields = (['whatsapp_instance_id', 'whatsapp_phone', 'is_active'] as const).filter(
        (field) => body[field] !== undefined,
      )
      if (routingFields.length > 0 && !auth.isPlatformAdmin) {
        json(res, 403, { error: `Only platform admins can change ${routingFields.join(', ')}` })
        return
      }

      const patch: Record<string, unknown> = {}
      if (typeof body.business_name === 'string') {
        if (!body.business_name.trim()) {
          json(res, 400, { error: 'business_name cannot be empty' })
          return
        }
        patch.business_name = body.business_name.trim()
      }
      if (body.whatsapp_instance_id !== undefined) {
        patch.whatsapp_instance_id = body.whatsapp_instance_id?.trim() || null
      }
      // whatsapp_phone and owner_phone are NOT NULL in production.
      for (const field of ['whatsapp_phone', 'owner_phone'] as const) {
        if (body[field] === undefined) continue
        const phone = validPhone(body[field])
        if (!phone) {
          json(res, 400, { error: `${field} must be a valid phone number` })
          return
        }
        patch[field] = phone
      }
      if (body.notification_phone !== undefined) {
        const raw = body.notification_phone?.trim() ?? ''
        const phone = raw ? validPhone(raw) : null
        if (raw && !phone) {
          json(res, 400, { error: 'notification_phone must be a valid phone number' })
          return
        }
        patch.notification_phone = phone
      }
      if (body.system_prompt !== undefined) patch.system_prompt = body.system_prompt
      if (body.target_goal !== undefined) patch.target_goal = body.target_goal
      if (typeof body.is_active === 'boolean') patch.is_active = body.is_active
      if (body.notification_email !== undefined) patch.notification_email = body.notification_email?.trim() || null

      if (body.business_hours !== undefined) {
        const hours = body.business_hours === null ? null : parseBusinessHours(body.business_hours)
        if (body.business_hours !== null && !hours) {
          json(res, 400, {
            error: 'Invalid business_hours: expected { days: [0-6], open: "HH:MM", close: "HH:MM", timezone }',
          })
          return
        }
        patch.business_hours = hours
      }
      if (body.price_list !== undefined) {
        if (!Array.isArray(body.price_list)) {
          json(res, 400, { error: 'price_list must be an array of { service, price | price_from | price_to }' })
          return
        }
        patch.price_list = parsePriceList(body.price_list)
      }
      if (body.faq !== undefined) {
        if (!Array.isArray(body.faq)) {
          json(res, 400, { error: 'faq must be an array of { question, answer }' })
          return
        }
        patch.faq = body.faq.filter(
          (item) => typeof item?.question === 'string' && typeof item?.answer === 'string',
        )
      }

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
      if (!auth.isPlatformAdmin) {
        json(res, 403, { error: 'Only platform admins can deactivate tenants' })
        return
      }
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
    json(res, 500, { error: 'Failed to process tenants request' })
  }
}
