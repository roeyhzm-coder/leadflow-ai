import { customerRequestsHuman, runSalesAgent } from './_lib/gemini.js'
import { applyCors, parseBody, type ApiRequest, type ApiResponse } from './_lib/http.js'
import { getServiceClient, normalizePhone, phonesMatch } from './_lib/supabase.js'
import type {
  CapturedLead,
  Conversation,
  GreenApiWebhook,
  Message,
  Tenant,
} from './_lib/types.js'
import {
  downloadWhatsAppFile,
  extractIncomingText,
  instanceIdOf,
  isAudioMessage,
  isFromOwner,
  isIncomingCustomerMessage,
  recipientPhone,
  resolveChatPhone,
  resolveCustomerName,
  resolveSenderPhone,
  sendWhatsAppText,
} from './_lib/whatsapp.js'

function json(res: ApiResponse, status: number, body: unknown): void {
  res.status(status).json(body)
}

function isMuted(conversation: Conversation): boolean {
  if (conversation.status === 'muted_by_human' || conversation.status === 'closed') {
    return true
  }
  if (!conversation.muted_until) return false
  return new Date(conversation.muted_until).getTime() > Date.now()
}

async function findTenant(payload: GreenApiWebhook): Promise<Tenant | null> {
  const supabase = getServiceClient()
  const instanceId = instanceIdOf(payload)
  if (instanceId) {
    const { data, error } = await supabase
      .from('tenants')
      .select('*')
      .eq('whatsapp_instance_id', instanceId)
      .eq('is_active', true)
      .maybeSingle()
    if (error) throw error
    if (data) return data as Tenant
  }

  const incomingTo = recipientPhone(payload)
  if (!incomingTo) return null

  const { data: tenants, error } = await supabase
    .from('tenants')
    .select('*')
    .eq('is_active', true)
  if (error) throw error
  return (
    (tenants as Tenant[] | null)?.find((tenant) =>
      phonesMatch(tenant.whatsapp_phone, incomingTo),
    ) ?? null
  )
}

async function getOrCreateConversation(
  tenant: Tenant,
  customerPhone: string,
  customerName: string,
): Promise<Conversation> {
  const supabase = getServiceClient()
  const phone = normalizePhone(customerPhone)

  const { data: existing, error: lookupError } = await supabase
    .from('conversations')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('customer_phone', phone)
    .maybeSingle()
  if (lookupError) throw lookupError

  if (existing) {
    const conversation = existing as Conversation
    if (customerName && conversation.customer_name !== customerName) {
      const { data: updated, error } = await supabase
        .from('conversations')
        .update({
          customer_name: customerName,
          last_message_at: new Date().toISOString(),
        })
        .eq('id', conversation.id)
        .select('*')
        .single()
      if (error) throw error
      return updated as Conversation
    }
    return conversation
  }

  const { data: created, error } = await supabase
    .from('conversations')
    .insert({
      tenant_id: tenant.id,
      customer_phone: phone,
      customer_name: customerName || null,
      status: 'active',
      last_message_at: new Date().toISOString(),
    })
    .select('*')
    .single()
  if (error) throw error
  return created as Conversation
}

async function insertMessage(
  conversationId: string,
  sender: Message['sender'],
  messageType: Message['message_type'],
  content: string,
  raw: unknown,
): Promise<void> {
  const supabase = getServiceClient()
  const { error } = await supabase.from('messages').insert({
    conversation_id: conversationId,
    sender,
    message_type: messageType,
    content,
    raw_payload: raw,
  })
  if (error) throw error

  const { error: touchError } = await supabase
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversationId)
  if (touchError) throw touchError
}

async function muteForOwner(conversationId: string): Promise<void> {
  const mutedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const { error } = await getServiceClient()
    .from('conversations')
    .update({ muted_until: mutedUntil, last_message_at: new Date().toISOString() })
    .eq('id', conversationId)
  if (error) throw error
}

async function muteForHumanRequest(conversationId: string): Promise<void> {
  const { error } = await getServiceClient()
    .from('conversations')
    .update({
      status: 'muted_by_human',
      last_message_at: new Date().toISOString(),
    })
    .eq('id', conversationId)
  if (error) throw error
}

async function recentHistory(conversationId: string): Promise<Message[]> {
  const { data, error } = await getServiceClient()
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) throw error
  return ((data as Message[]) ?? []).slice().reverse()
}

async function upsertLead(
  tenant: Tenant,
  conversation: Conversation,
  lead: CapturedLead,
): Promise<void> {
  const supabase = getServiceClient()
  const payload = {
    tenant_id: tenant.id,
    conversation_id: conversation.id,
    customer_name: lead.customer_name || conversation.customer_name,
    customer_phone: lead.customer_phone || conversation.customer_phone,
    service_requested: lead.service_requested,
    preferred_time: lead.preferred_time,
    notes: lead.notes,
    status: 'new',
  }

  const { data: existing, error: existingError } = await supabase
    .from('leads')
    .select('id')
    .eq('conversation_id', conversation.id)
    .in('status', ['new', 'in_progress'])
    .maybeSingle()
  if (existingError) throw existingError

  if (existing) {
    const { error } = await supabase.from('leads').update(payload).eq('id', existing.id)
    if (error) throw error
    return
  }

  const { error } = await supabase.from('leads').insert(payload)
  if (error) throw error
}

async function notifyOwner(tenant: Tenant, body: string): Promise<void> {
  if (!tenant.owner_phone) return
  try {
    await sendWhatsAppText(tenant, tenant.owner_phone, body)
  } catch (error) {
    console.error('Failed to notify owner', error)
  }
}

async function maybeDownloadAudio(
  payload: GreenApiWebhook,
): Promise<{ data: string; mimeType: string } | undefined> {
  const url = payload.messageData?.fileMessageData?.downloadUrl
  if (!url) return undefined
  const file = await downloadWhatsAppFile(url)
  return {
    data: file.buffer.toString('base64'),
    mimeType: payload.messageData?.fileMessageData?.mimeType?.split(';')[0] || file.mimeType,
  }
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  applyCors(res)

  if (req.method === 'OPTIONS') {
    json(res, 200, { ok: true })
    return
  }

  if (req.method === 'GET') {
    json(res, 200, { ok: true, service: 'leadflow-ai-webhook' })
    return
  }

  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' })
    return
  }

  const payload = parseBody<GreenApiWebhook>(req)
  const typeWebhook = payload.typeWebhook ?? ''

  if (typeWebhook === 'outgoingAPIMessageReceived') {
    json(res, 200, { ok: true, ignored: 'bot_echo' })
    return
  }

  if (
    typeWebhook !== 'incomingMessageReceived' &&
    typeWebhook !== 'outgoingMessageReceived'
  ) {
    json(res, 200, { ok: true, ignored: typeWebhook || 'unknown' })
    return
  }

  try {
    const tenant = await findTenant(payload)
    if (!tenant) {
      json(res, 200, { ok: true, ignored: 'tenant_not_found' })
      return
    }

    const chatPhone = resolveChatPhone(payload)
    const senderPhone = resolveSenderPhone(payload)
    const senderName = resolveCustomerName(payload)
    if (!chatPhone) {
      json(res, 200, { ok: true, ignored: 'missing_chat' })
      return
    }

    const conversation = await getOrCreateConversation(tenant, chatPhone, senderName)
    const incomingText = extractIncomingText(payload)
    const audio = isAudioMessage(payload)

    if (typeWebhook === 'outgoingMessageReceived' || isFromOwner(tenant, senderPhone)) {
      await insertMessage(
        conversation.id,
        'human',
        audio ? 'audio' : 'text',
        incomingText || (audio ? '[הודעה קולית מהנציג]' : ''),
        payload,
      )
      await muteForOwner(conversation.id)
      json(res, 200, { ok: true, muted: true, reason: 'owner_takeover' })
      return
    }

    if (!isIncomingCustomerMessage(typeWebhook)) {
      json(res, 200, { ok: true, ignored: typeWebhook })
      return
    }

    await insertMessage(
      conversation.id,
      'customer',
      audio ? 'audio' : 'text',
      incomingText || (audio ? '[הודעה קולית]' : ''),
      payload,
    )

    const latest = {
      ...conversation,
      status: conversation.status,
      muted_until: conversation.muted_until,
    }
    const { data: fresh } = await getServiceClient()
      .from('conversations')
      .select('*')
      .eq('id', conversation.id)
      .single()
    const current = (fresh as Conversation | null) ?? latest

    if (isMuted(current)) {
      json(res, 200, { ok: true, ignored: 'muted' })
      return
    }

    if (customerRequestsHuman(incomingText)) {
      await muteForHumanRequest(conversation.id)
      const ack =
        'הבנתי, מעביר אתכם לנציג אנושי עכשיו. מישהו מהצוות יחזור אליכם כאן בהקדם.'
      await insertMessage(conversation.id, 'bot', 'text', ack, {
        kind: 'human_handoff',
      })
      await sendWhatsAppText(tenant, chatPhone, ack)
      await notifyOwner(
        tenant,
        `🙋 לקוח ביקש נציג אנושי\nעסק: ${tenant.business_name}\nשם: ${senderName || 'לא ידוע'}\nטלפון: ${chatPhone}\nהודעה: ${incomingText}`,
      )
      json(res, 200, { ok: true, handed_off: true })
      return
    }

    let userText = incomingText
    let audioPayload: { data: string; mimeType: string } | undefined
    if (audio) {
      audioPayload = await maybeDownloadAudio(payload)
      if (!audioPayload && !userText) {
        userText = 'הלקוח שלח הודעה קולית שלא הצלחנו להוריד. בקש ממנו לכתוב בקצרה מה הוא צריך.'
      }
    }

    const history = await recentHistory(conversation.id)
    const agent = await runSalesAgent({
      tenant,
      history,
      userText: userText || 'שלום',
      customerPhone: chatPhone,
      audio: audioPayload,
    })

    await insertMessage(conversation.id, 'bot', 'text', agent.reply, {
      kind: 'gemini',
    })
    await sendWhatsAppText(tenant, chatPhone, agent.reply)

    if (agent.lead) {
      await upsertLead(tenant, conversation, agent.lead)
      await notifyOwner(
        tenant,
        `🎯 ליד חדש — ${tenant.business_name}\nשם: ${agent.lead.customer_name || senderName || 'לא צוין'}\nטלפון: ${agent.lead.customer_phone || chatPhone}\nשירות: ${agent.lead.service_requested}\nזמן מועדף: ${agent.lead.preferred_time || 'לא צוין'}\nהערות: ${agent.lead.notes || '—'}`,
      )
    }

    json(res, 200, { ok: true, replied: true, lead: Boolean(agent.lead) })
  } catch (error) {
    console.error('webhook failed', error)
    json(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : 'Webhook processing failed',
    })
  }
}
