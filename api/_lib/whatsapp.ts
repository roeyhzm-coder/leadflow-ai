/// <reference types="node" />
import { normalizePhone, phonesMatch, toChatId } from './supabase.js'
import type { GreenApiWebhook, Tenant } from './types.js'

/** Canonical Green API host for instance 710722751571 — ignores bad Vercel dashboard values. */
export const DEFAULT_GREEN_API_HOST = 'https://7107.api.greenapi.com'
export const DEFAULT_WHATSAPP_INSTANCE_ID = '710722751571'

function firstEnv(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value) return value
  }
  return ''
}

/**
 * Resolve Green API host from the instance ID. Green API serves each instance
 * only from the host named after the first 4 digits of its ID
 * (710722751571 -> 7107.api.greenapi.com); any other host answers 403. A
 * WHATSAPP_API_URL value is honored only when it matches that host, so a stale
 * or misconfigured Vercel dashboard variable cannot break outbound sends.
 */
export function resolveGreenApiHost(
  configured: string | undefined = process.env.WHATSAPP_API_URL,
  instanceId: string = DEFAULT_WHATSAPP_INSTANCE_ID,
): string {
  const expected = /^\d{4}/.test(instanceId)
    ? `https://${instanceId.slice(0, 4)}.api.greenapi.com`
    : DEFAULT_GREEN_API_HOST
  const candidate = (configured ?? '').trim().replace(/\/$/, '')
  return candidate === expected ? candidate : expected
}

function apiRoot(instanceId?: string): { base: string; token: string } {
  const base = resolveGreenApiHost(
    firstEnv('WHATSAPP_API_URL', 'GREEN_API_URL', 'VITE_WHATSAPP_API_URL') ||
      undefined,
    instanceId,
  )
  const token = firstEnv(
    'WHATSAPP_API_TOKEN',
    'GREEN_API_TOKEN',
    'VITE_WHATSAPP_API_TOKEN',
  )
  if (!token) {
    throw new Error('Missing WhatsApp configuration. Set WHATSAPP_API_TOKEN.')
  }
  return { base, token }
}

function instanceUrl(instanceId: string, method: string): string {
  const { base, token } = apiRoot(instanceId)
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

/**
 * Numbers from ALLOWED_TEST_NUMBERS (comma-separated), normalized to 972XXXXXXXXX.
 * Returns null when unset, empty or "*", meaning every sender is allowed.
 */
export function allowedTestNumbers(
  raw: string | undefined = process.env.ALLOWED_TEST_NUMBERS,
): ReadonlySet<string> | null {
  const value = raw?.trim() ?? ''
  if (!value || value === '*') return null
  const numbers = value
    .split(',')
    .map((entry) => normalizePhone(entry))
    .filter((entry) => entry.length > 0)
  return numbers.length > 0 ? new Set(numbers) : null
}

/** True when no allowlist is configured or any of the given phones is on it. */
export function isAllowedTestSender(...phones: Array<string | null | undefined>): boolean {
  const allowed = allowedTestNumbers()
  if (!allowed) return true
  return phones.some((phone) => {
    const normalized = normalizePhone(phone)
    return normalized.length > 0 && allowed.has(normalized)
  })
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
