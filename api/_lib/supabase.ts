/// <reference types="node" />
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null = null

function firstEnv(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value) return value
  }
  return ''
}

export function getServiceClient(): SupabaseClient {
  if (cached) return cached

  const url = firstEnv('SUPABASE_URL', 'VITE_SUPABASE_URL')
  const key = firstEnv('SUPABASE_SERVICE_ROLE_KEY')

  if (!url || !key) {
    throw new Error(
      'Missing Supabase configuration. Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.',
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
