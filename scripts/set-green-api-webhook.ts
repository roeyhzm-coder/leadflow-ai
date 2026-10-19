/**
 * Points Green API instance webhooks at the production endpoint and verifies the result.
 * Usage: npx tsx scripts/set-green-api-webhook.ts [webhookUrl]
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEFAULT_WHATSAPP_INSTANCE_ID, resolveGreenApiHost } from '../api/_lib/whatsapp.ts'

const DEFAULT_WEBHOOK_URL = 'https://leadflow-ai-snowy-one.vercel.app/api/webhook'

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

type GreenApiSettings = {
  webhookUrl?: string
  incomingWebhook?: string
  outgoingMessageWebhook?: string
  outgoingAPIMessageWebhook?: string
  stateWebhook?: string
}

async function callGreenApi(url: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, init)
  const text = await response.text()
  let body: unknown = text
  try {
    body = JSON.parse(text) as unknown
  } catch {
    // keep raw text
  }
  return { status: response.status, body }
}

async function main(): Promise<void> {
  const token = (process.env.WHATSAPP_API_TOKEN ?? '').trim()
  if (!token) {
    throw new Error('WHATSAPP_API_TOKEN is missing in .env')
  }

  const instanceId =
    (process.env.WHATSAPP_INSTANCE_ID ?? '').trim() || DEFAULT_WHATSAPP_INSTANCE_ID
  const host = resolveGreenApiHost(process.env.WHATSAPP_API_URL, instanceId)
  const webhookUrl = process.argv[2]?.trim() || DEFAULT_WEBHOOK_URL
  const base = `${host}/waInstance${instanceId}`

  const settings: GreenApiSettings = {
    webhookUrl,
    incomingWebhook: 'yes',
    outgoingMessageWebhook: 'yes',
  }

  console.log(`instance: ${instanceId}`)
  console.log(`endpoint: ${base}/setSettings/<token>`)
  console.log('settings:', JSON.stringify(settings))

  const set = await callGreenApi(`${base}/setSettings/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
  console.log(`setSettings status: ${set.status}`)
  console.log('setSettings body:', JSON.stringify(set.body))
  if (set.status !== 200) {
    process.exit(1)
  }

  const state = await callGreenApi(`${base}/getStateInstance/${token}`)
  console.log(`getStateInstance: ${state.status} ${JSON.stringify(state.body)}`)

  const get = await callGreenApi(`${base}/getSettings/${token}`)
  if (get.status !== 200 || !get.body || typeof get.body !== 'object') {
    console.error(`getSettings failed: ${get.status} ${JSON.stringify(get.body)}`)
    process.exit(1)
  }

  const current = get.body as GreenApiSettings
  console.log(
    'getSettings:',
    JSON.stringify({
      webhookUrl: current.webhookUrl,
      incomingWebhook: current.incomingWebhook,
      outgoingMessageWebhook: current.outgoingMessageWebhook,
      outgoingAPIMessageWebhook: current.outgoingAPIMessageWebhook,
      stateWebhook: current.stateWebhook,
    }),
  )

  const mismatched = (Object.keys(settings) as Array<keyof GreenApiSettings>).filter(
    (key) => current[key] !== settings[key],
  )
  if (mismatched.length > 0) {
    console.error(
      `Settings not applied yet for: ${mismatched.join(', ')} (Green API can take up to 5 minutes)`,
    )
    process.exit(1)
  }

  console.log('GREEN API WEBHOOK SETTINGS OK')
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
