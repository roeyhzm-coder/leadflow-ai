/**
 * Posts a realistic Green API incomingMessageReceived payload to the live webhook.
 * Usage: npx tsx scripts/test-live-webhook.ts [url]
 */
const DEFAULT_URL = 'https://leadflow-ai-snowy-one.vercel.app/api/webhook'

const payload = {
  typeWebhook: 'incomingMessageReceived',
  instanceData: { idInstance: 710722751571 },
  senderData: {
    chatId: '972500000000@c.us',
    sender: '972500000000@c.us',
    chatName: 'Test User',
  },
  messageData: {
    typeMessage: 'textMessage',
    textMessageData: {
      textMessage:
        'היי, מה המחיר של שטיפה וציפוי קרמי ומתי אפשר להגיע?',
    },
  },
}

async function main(): Promise<void> {
  const url = process.argv[2]?.trim() || DEFAULT_URL
  console.log(`POST ${url}`)
  console.log('payload:', JSON.stringify(payload, null, 2))

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const text = await response.text()
  let body: unknown = text
  try {
    body = JSON.parse(text) as unknown
  } catch {
    // keep raw text
  }

  console.log(`status: ${response.status}`)
  console.log('body:', typeof body === 'string' ? body : JSON.stringify(body, null, 2))

  if (response.status !== 200) {
    process.exit(1)
  }

  if (
    body &&
    typeof body === 'object' &&
    'ok' in body &&
    (body as { ok?: unknown }).ok === true
  ) {
    console.log('LIVE WEBHOOK OK')
    return
  }

  console.error('Unexpected 200 body — expected { ok: true, ... }')
  process.exit(1)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
