/**
 * Runs the live Glow Clinic tenant prompt through Gemini for one patient message
 * and sends the AI reply over Green API. Calls paid APIs (Gemini + WhatsApp) once.
 * Usage: npx tsx scripts/test-aesthetic-reply.ts [phone] [message]
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DEFAULT_PHONE = '972504572767'
const DEFAULT_MESSAGE = 'היי, רציתי לברר לגבי טיפול בוטוקס במצח, כמה זה עולה?'
const INSTANCE_ID = '710722751571'

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

// Env must be loaded before the API modules read process.env.
loadEnv(resolve(process.cwd(), '.env'))
loadEnv(resolve(process.cwd(), '.env.local'))

async function main(): Promise<void> {
  const { runSalesAgent } = await import('../api/_lib/gemini.ts')
  const { getServiceClient, toChatId } = await import('../api/_lib/supabase.ts')
  const { sendWhatsAppText } = await import('../api/_lib/whatsapp.ts')
  type Tenant = import('../api/_lib/types.ts').Tenant

  const phone = process.argv[2]?.trim() || DEFAULT_PHONE
  const message = process.argv[3]?.trim() || DEFAULT_MESSAGE

  const { data, error } = await getServiceClient()
    .from('tenants')
    .select('*')
    .eq('whatsapp_instance_id', INSTANCE_ID)
    .eq('is_active', true)
    .single()
  if (error) {
    throw new Error(`Tenant lookup failed: ${error.message}`)
  }
  const tenant = data as Tenant

  console.log(`tenant: ${tenant.business_name}`)
  console.log(`patient message: ${message}`)

  const agent = await runSalesAgent({ tenant, history: [], userText: message, customerPhone: phone })
  console.log(`AI reply: ${agent.reply}`)
  console.log(`lead captured: ${agent.lead ? JSON.stringify(agent.lead) : 'none'}`)

  console.log(`sending to: ${toChatId(phone)}`)
  const sent = await sendWhatsAppText(tenant, phone, agent.reply)
  console.log(`status: ${sent.status}`)
  console.log(`idMessage: ${sent.idMessage || '(missing)'}`)

  if (sent.status !== 200 || !sent.idMessage) {
    process.exit(1)
  }
  console.log('AESTHETIC PIPELINE SEND OK')
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
