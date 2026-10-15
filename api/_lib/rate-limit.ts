import { getServiceClient } from './supabase.js'

/** Default per-caller budget for any path that spends money (Gemini, WhatsApp sends). */
export const PAID_API_RATE_LIMIT = 5
export const PAID_API_WINDOW_SECONDS = 60

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number }

/** Thrown when the limiter itself cannot answer; callers must fail closed (no paid call). */
export class RateLimiterUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RateLimiterUnavailableError'
  }
}

/**
 * Counts one request against `key` in a fixed window shared across all serverless
 * instances (public.check_rate_limit in supabase/rate-limit.sql).
 */
export async function consumeRateLimit(
  key: string,
  limit: number = PAID_API_RATE_LIMIT,
  windowSeconds: number = PAID_API_WINDOW_SECONDS,
): Promise<RateLimitResult> {
  const { data, error } = await getServiceClient().rpc('check_rate_limit', {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  })
  if (error) throw new RateLimiterUnavailableError(error.message)
  if (data === true) return { allowed: true }

  const elapsed = Math.floor(Date.now() / 1000) % windowSeconds
  return { allowed: false, retryAfterSeconds: Math.max(1, windowSeconds - elapsed) }
}
