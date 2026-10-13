/**
 * Sends a direct Green API test message using the hardcoded host fallback.
 * Usage: npx tsx scripts/verify-whatsapp-send.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DEFAULT_GREEN_API_HOST,
  DEFAULT_WHATSAPP_INSTANCE_ID,
  resolveGreenApiHost,
} from '../api/_lib/whatsapp.ts'

function loadEnv(filePath: string): void {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    return
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

loadEnv(resolve(process.cwd(), '.env'))
loadEnv(resolve(process.cwd(), '.env.local'))

async function main(): Promise<void> {
  const token = (process.env.WHATSAPP_API_TOKEN ?? '').trim()
  if (!token) {
    throw new Error('WHATSAPP_API_TOKEN is missing in .env')
  }

  const instanceId =
    (process.env.WHATSAPP_INSTANCE_ID ?? '').trim() || DEFAULT_WHATSAPP_INSTANCE_ID
  const host = resolveGreenApiHost(process.env.WHATSAPP_API_URL, instanceId)
  const chatId = '972504572767@c.us'
  const message = 'בדיקת מערכת LeadFlow AI: חיבור תקין 100%'
  const url = `${host}/waInstance${instanceId}/sendMessage/${token}`

  console.log(`host: ${host}`)
  console.log(`fallback default: ${DEFAULT_GREEN_API_HOST}`)
  console.log(`endpoint: ${host}/waInstance${instanceId}/sendMessage/<token>`)
  console.log(`chatId: ${chatId}`)

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId, message }),
  })

  const text = await response.text()
  let body: unknown = text
  try {
    body = JSON.parse(text) as unknown
  } catch {
    // keep raw
  }

  console.log(`status: ${response.status}`)
  console.log(
    'body:',
    typeof body === 'string' ? body : JSON.stringify(body, null, 2),
  )

  const idMessage =
    body &&
    typeof body === 'object' &&
    'idMessage' in body &&
    typeof (body as { idMessage?: unknown }).idMessage === 'string'
      ? (body as { idMessage: string }).idMessage
      : null

  if (idMessage) {
    console.log(`idMessage: ${idMessage}`)
  }

  if (!response.ok || !idMessage) {
    process.exit(1)
  }

  console.log('WHATSAPP SEND OK')
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
