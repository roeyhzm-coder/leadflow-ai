import { normalizePhone, phonesMatch, toChatId } from './supabase'
import type { GreenApiWebhook, Tenant } from './types'

function apiRoot(): { base: string; token: string } {
  const base = (process.env.WHATSAPP_API_URL ?? '').replace(/\/$/, '')
  const token = process.env.WHATSAPP_API_TOKEN ?? ''
  if (!base || !token) {
    throw new Error(
      'Missing WhatsApp configuration. Set WHATSAPP_API_URL and WHATSAPP_API_TOKEN.',
    )
  }
  return { base, token }
}

function instanceUrl(instanceId: string, method: string): string {
  const { base, token } = apiRoot()
  return `${base}/waInstance${instanceId}/${method}/${token}`
}

export async function sendWhatsAppText(
  tenant: Tenant,
  toPhone: string,
  message: string,
): Promise<void> {
  const instanceId = tenant.whatsapp_instance_id
  if (!instanceId) {
    throw new Error('Tenant is missing whatsapp_instance_id')
  }

  const response = await fetch(instanceUrl(instanceId, 'sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chatId: toChatId(toPhone),
      message,
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`WhatsApp send failed (${response.status}): ${detail}`)
  }
}

export async function downloadWhatsAppFile(
  url: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const headers: Record<string, string> = {}
  try {
    const { token } = apiRoot()
    headers.Authorization = `Bearer ${token}`
  } catch {
    // Public Green-API downloadUrl usually does not require auth.
  }

  const response = await fetch(url, { headers })
  if (!response.ok) {
    throw new Error(`Failed to download WhatsApp media (${response.status})`)
  }

  const mimeType = response.headers.get('content-type') ?? 'audio/ogg'
  const buffer = Buffer.from(await response.arrayBuffer())
  return { buffer, mimeType: mimeType.split(';')[0] ?? 'audio/ogg' }
}

export function extractIncomingText(payload: GreenApiWebhook): string {
  const data = payload.messageData
  if (!data) return ''
  return (
    data.textMessageData?.textMessage ??
    data.extendedTextMessageData?.text ??
    data.quotedMessage?.textMessage ??
    data.fileMessageData?.caption ??
    ''
  ).trim()
}

export function isAudioMessage(payload: GreenApiWebhook): boolean {
  const type = payload.messageData?.typeMessage ?? ''
  return type === 'audioMessage' || type === 'pttMessage' || type === 'voiceMessage'
}

export function isIncomingCustomerMessage(typeWebhook: string | undefined): boolean {
  return typeWebhook === 'incomingMessageReceived'
}

export function resolveSenderPhone(payload: GreenApiWebhook): string {
  const raw =
    payload.senderData?.sender ??
    payload.senderData?.chatId ??
    ''
  return normalizePhone(raw)
}

export function resolveChatPhone(payload: GreenApiWebhook): string {
  return normalizePhone(payload.senderData?.chatId ?? payload.senderData?.sender ?? '')
}

export function resolveCustomerName(payload: GreenApiWebhook): string {
  return (
    payload.senderData?.senderContactName ??
    payload.senderData?.senderName ??
    payload.senderData?.chatName ??
    ''
  ).trim()
}

export function isFromOwner(tenant: Tenant, senderPhone: string): boolean {
  return phonesMatch(tenant.owner_phone, senderPhone)
}

export function recipientPhone(payload: GreenApiWebhook): string {
  return normalizePhone(payload.instanceData?.wid ?? '')
}

export function instanceIdOf(payload: GreenApiWebhook): string {
  const id = payload.instanceData?.idInstance
  return id === undefined || id === null ? '' : String(id)
}
