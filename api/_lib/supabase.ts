import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null = null

export function getServiceClient(): SupabaseClient {
  if (cached) return cached

  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error(
      'Missing Supabase configuration. Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    )
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cached
}

export function digitsOnly(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '')
}

export function normalizePhone(value: string | null | undefined): string {
  let digits = digitsOnly(value)
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith('0') && digits.length === 10) {
    digits = `972${digits.slice(1)}`
  }
  return digits
}

export function toChatId(phone: string): string {
  const normalized = normalizePhone(phone)
  if (normalized.includes('@')) return phone
  return `${normalized}@c.us`
}

export function phoneFromChatId(chatId: string): string {
  return normalizePhone(chatId.replace(/@c\.us$/i, '').replace(/@g\.us$/i, ''))
}

export function phonesMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = normalizePhone(a)
  const right = normalizePhone(b)
  if (!left || !right) return false
  if (left === right) return true
  const minLen = Math.min(left.length, right.length)
  if (minLen < 8) return false
  return left.slice(-9) === right.slice(-9)
}
