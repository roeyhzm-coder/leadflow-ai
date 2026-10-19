import type { PriceListItem, Tenant } from './types.js'

/** Longest customer message forwarded to the model; longer input is truncated. */
export const MAX_CUSTOMER_TEXT_LENGTH = 1000

/** Spoken when the output guard rejects a model reply (unlisted price, leak). */
export const COORDINATOR_REPLY =
  'שאלה מצוינת! מתאם/ת רפואי/ת מהצוות יבהירו את הפרטים המדויקים ויחזרו אליך בהקדם. בינתיים, אשמח לעזור בתיאום פגישת ייעוץ.'

// Zero-width, bidi-override and other invisible format characters used to smuggle instructions.
const INVISIBLE_CHARS = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]/g

/** Strips invisible characters, collapses whitespace runs and caps the length. */
export function sanitizeCustomerText(text: string): string {
  const cleaned = text
    .replace(INVISIBLE_CHARS, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return cleaned.length > MAX_CUSTOMER_TEXT_LENGTH
    ? cleaned.slice(0, MAX_CUSTOMER_TEXT_LENGTH)
    : cleaned
}

const INJECTION_PATTERNS: Array<{ reason: string; pattern: RegExp }> = [
  {
    reason: 'override_instructions',
    pattern: /\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(instructions?|rules|prompts?|guidelines|directives)\b/i,
  },
  {
    reason: 'override_instructions',
    // Imperatives only: "שכחתי לשאול על הכללים" must not match.
    pattern: /(^|\s)(תתעלם|התעלם|התעלמי|תתעלמי|תשכח|תשכחי|עקוף|תעקוף)\s.{0,20}(הוראות|הנחיות|הכללים|החוקים|פרומפט)/u,
  },
  {
    reason: 'prompt_extraction',
    pattern: /\b(system|hidden|initial|original|developer)\s+(prompt|instructions?|message)\b/i,
  },
  {
    reason: 'prompt_extraction',
    pattern: /\b(reveal|show|print|repeat|output|leak|dump)\b.{0,30}\b(instructions?|prompt|rules|configuration)\b/i,
  },
  {
    reason: 'prompt_extraction',
    pattern: /(חשוף|תחשוף|הצג|תציג|תראה לי|הראה|תגלה|גלה|תדפיס|תעתיק).{0,25}(הוראות|הנחיות|פרומפט|כללי המערכת|ההגדרות)/u,
  },
  { reason: 'prompt_extraction', pattern: /(פרומפט|הנחיות|הוראות)\s+(ה)?(מערכת|סודיות|נסתרות)/u },
  {
    reason: 'secret_extraction',
    pattern: /\b(api[\s_-]?key|access[\s_-]?token|secret[\s_-]?key|service[\s_-]?role|env(ironment)?\s+variables?|GEMINI_API|password)\b/i,
  },
  { reason: 'secret_extraction', pattern: /(מפתח|מפתחות)\s*ה?-?\s*(API|אייפיאי|גישה|סודי)|סיסמ(ה|א)\s+(של|למערכת)/iu },
  {
    reason: 'role_override',
    pattern: /\b(you are now|from now on you|act as|pretend (to be|you are)|roleplay|role-play|jailbreak|DAN mode|developer mode|do anything now)\b/i,
  },
  { reason: 'role_override', pattern: /(מעכשיו אתה|מעכשיו את|תעמיד פנים|תעמידי פנים|תשחק תפקיד|שחק תפקיד|מצב מפתח)/u },
]

export type InjectionCheck = { flagged: false } | { flagged: true; reason: string }

/**
 * Cheap pre-filter for obvious prompt-injection attempts. Flagged messages get a
 * canned deflection and never reach the model. The system prompt still carries
 * anti-jailbreak rules for anything this misses.
 */
export function detectPromptInjection(text: string): InjectionCheck {
  const normalized = sanitizeCustomerText(text)
  for (const { reason, pattern } of INJECTION_PATTERNS) {
    if (pattern.test(normalized)) return { flagged: true, reason }
  }
  return { flagged: false }
}

export function injectionDeflection(tenant: Tenant): string {
  return `אני כאן כדי לעזור בשאלות על השירותים של ${tenant.business_name} ובתיאום פגישה. במה אפשר לעזור?`
}

/** Validates tenants.price_list; malformed entries are dropped. */
export function parsePriceList(value: unknown): PriceListItem[] {
  if (!Array.isArray(value)) return []
  const items: PriceListItem[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const service = typeof record.service === 'string' ? record.service.trim() : ''
    if (!service) continue
    const amount = (key: string): number | undefined => {
      const raw = record[key]
      return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : undefined
    }
    const text = (key: string): string | undefined => {
      const raw = record[key]
      return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined
    }
    const item: PriceListItem = { service }
    const price = amount('price')
    const priceFrom = amount('price_from')
    const priceTo = amount('price_to')
    const unit = text('unit')
    const notes = text('notes')
    if (price !== undefined) item.price = price
    if (priceFrom !== undefined) item.price_from = priceFrom
    if (priceTo !== undefined) item.price_to = priceTo
    if (unit) item.unit = unit
    if (notes) item.notes = notes
    items.push(item)
  }
  return items
}

function allowedAmounts(priceList: PriceListItem[]): Set<number> {
  const amounts = new Set<number>()
  for (const item of priceList) {
    for (const value of [item.price, item.price_from, item.price_to]) {
      if (value !== undefined) amounts.add(value)
    }
  }
  return amounts
}

const AMOUNT = String.raw`(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)`
const CURRENCY = String.raw`(?:₪|ש["״']?ח|שקלים|שקל|NIS|ILS)`
const PRICE_PATTERN = new RegExp(`(?:₪\\s*${AMOUNT})|(?:${AMOUNT}\\s*${CURRENCY})`, 'giu')

/** Every currency-tagged amount in `text`, e.g. "800 ₪" or "₪1,400". */
export function extractQuotedPrices(text: string): number[] {
  const prices: number[] = []
  for (const match of text.matchAll(PRICE_PATTERN)) {
    const raw = match[1] ?? match[2]
    if (raw) prices.push(Number(raw.replace(/,/g, '')))
  }
  return prices
}

const SECRET_PATTERNS = [
  /AIza[0-9A-Za-z_-]{20,}/, // Google API key
  /\bsk-[A-Za-z0-9_-]{20,}/, // generic secret key
  /eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/, // JWT (Supabase keys)
]

// Section headers of the tenant playbook (prompts.ts) and of buildSystemInstruction.
const PROMPT_MARKERS =
  /(כללי מערכת|CLOSED-WORLD|ROLE & IDENTITY|systemInstruction|SECURITY RULES|PRICE LIST \(authoritative\)|===\s*(ROLE|PRICING|FAQ|MEDICAL DISCLAIMER|AFTER HOURS|STYLE|OUTPUT)\b)/i

export type ReplyCheck = { ok: true } | { ok: false; reason: string }

/**
 * Last line of defense on model output: blocks leaked secrets, prompt section markers,
 * verbatim lines of `confidentialText` (the guardrail rules), and, when the tenant has
 * a price list, any quoted amount not on it.
 */
export function checkReply(reply: string, tenant: Tenant, confidentialText: string): ReplyCheck {
  if (SECRET_PATTERNS.some((pattern) => pattern.test(reply))) {
    return { ok: false, reason: 'secret_leak' }
  }
  if (PROMPT_MARKERS.test(reply)) {
    return { ok: false, reason: 'prompt_leak' }
  }
  const leakedLine = confidentialText
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length >= 40 && reply.includes(line))
  if (leakedLine) {
    return { ok: false, reason: 'prompt_leak' }
  }

  const priceList = parsePriceList(tenant.price_list)
  if (priceList.length > 0) {
    const allowed = allowedAmounts(priceList)
    const unlisted = extractQuotedPrices(reply).find((amount) => !allowed.has(amount))
    if (unlisted !== undefined) {
      return { ok: false, reason: `unlisted_price:${unlisted}` }
    }
  }
  return { ok: true }
}
