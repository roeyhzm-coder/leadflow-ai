/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { GenerateFn, GenerateRequest, GenerateResponse } from '../../api/_lib/gemini.js'
import { AESTHETIC_CLINIC_GOAL, AESTHETIC_CLINIC_NAME, AESTHETIC_CLINIC_PROMPT } from '../../api/_lib/prompts.js'
import type { Message, Tenant } from '../../api/_lib/types.js'

/** Loads .env then .env.local without overriding variables already set. */
export function loadEnv(): void {
  for (const file of ['.env', '.env.local']) {
    let raw: string
    try {
      raw = readFileSync(resolve(process.cwd(), file), 'utf8')
    } catch {
      continue
    }
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (process.env[key] === undefined) process.env[key] = value
    }
  }
}

export const isLive = process.argv.includes('--live')

/** Minimal assertion runner: prints each check and exits non-zero if any failed. */
export class Suite {
  private passed = 0
  private failed: string[] = []

  section(title: string): void {
    console.log(`\n── ${title}`)
  }

  check(name: string, condition: boolean, detail?: unknown): void {
    if (condition) {
      this.passed += 1
      console.log(`  ✓ ${name}`)
      return
    }
    this.failed.push(name)
    console.log(`  ✗ ${name}`)
    if (detail !== undefined) {
      console.log(`      ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
    }
  }

  /** Sets the exit code instead of calling process.exit, which trips a libuv assertion on Windows while sockets close. */
  finish(): void {
    const total = this.passed + this.failed.length
    console.log(`\n${this.passed}/${total} checks passed`)
    if (this.failed.length > 0) {
      console.log(`Failed:\n${this.failed.map((name) => `  - ${name}`).join('\n')}`)
    }
    process.exitCode = this.failed.length > 0 ? 1 : 0
  }
}

/** Glow Clinic as it looks after the enterprise migration (in memory, never written to the DB). */
export const FIXTURE_TENANT: Tenant = {
  id: '00000000-0000-4000-8000-000000000001',
  created_at: '2026-10-19T00:00:00.000Z',
  business_name: AESTHETIC_CLINIC_NAME,
  whatsapp_instance_id: 'fixture',
  whatsapp_phone: '972500000001',
  owner_phone: '972500000002',
  system_prompt: AESTHETIC_CLINIC_PROMPT,
  target_goal: AESTHETIC_CLINIC_GOAL,
  is_active: true,
  business_hours: { days: [0, 1, 2, 3, 4], open: '09:00', close: '19:00', timezone: 'Asia/Jerusalem' },
  price_list: [
    { service: 'בוטוקס לאזורי הבעה (מצח, בין הגבות, צידי עיניים)', price_from: 800, unit: 'לאזור' },
    { service: 'מילוי ועיצוב שפתיים / הדגשת קו לסת בחומצה היאלורונית', price_from: 1400, unit: 'למזרק' },
    { service: 'סקין בוסטר וחידוש מרקם העור', price_from: 1200, unit: 'לטיפול' },
  ],
  faq: [{ question: 'האם פגישת הייעוץ בתשלום?', answer: 'פגישת הייעוץ הראשונית עם הרופא/ה ללא עלות.' }],
  notification_phone: null,
  notification_email: null,
}

/** Records every request and answers with `responder` (which may throw to simulate failures). */
export function stubGenerate(
  responder: (request: GenerateRequest, call: number) => GenerateResponse | Promise<GenerateResponse>,
): { generate: GenerateFn; calls: GenerateRequest[] } {
  const calls: GenerateRequest[] = []
  const generate: GenerateFn = async (request) => {
    calls.push(request)
    return responder(request, calls.length)
  }
  return { generate, calls }
}

export function jsonReply(reply: string, lead: Record<string, string> | null = null): GenerateResponse {
  return { text: JSON.stringify({ reply, lead }), finishReason: 'STOP' }
}

let messageSeq = 0

export function message(sender: Message['sender'], content: string, conversationId = 'conv-test'): Message {
  messageSeq += 1
  return {
    id: `msg-${messageSeq}`,
    created_at: new Date(Date.UTC(2026, 9, 19, 8, 0, messageSeq)).toISOString(),
    conversation_id: conversationId,
    sender,
    message_type: 'text',
    content,
    raw_payload: null,
  }
}

export function systemInstructionOf(request: GenerateRequest | undefined): string {
  const value = request?.config.systemInstruction
  return typeof value === 'string' ? value : ''
}

export const sleep = (ms: number): Promise<void> => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
