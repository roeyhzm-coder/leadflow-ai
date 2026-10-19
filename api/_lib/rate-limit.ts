import { getServiceClient } from './supabase.js'

/** Default per-caller budget for any path that spends money (Gemini, WhatsApp sends). */
export const PAID_API_RATE_LIMIT = 5
export const PAID_API_WINDOW_SECONDS = 60

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number }

/** Fallback buckets, keyed by `${key}:${windowStart}`; only live for one serverless instance. */
const memoryBuckets = new Map<string, number>()

/** After an RPC failure, skip it for this long so each request doesn't pay a failing round-trip. */
const RPC_RETRY_MS = 5 * 60 * 1000
let rpcRetryAt = 0
let fallbackAnnounced = false

function retryAfter(windowSeconds: number): number {
  const elapsed = Math.floor(Date.now() / 1000) % windowSeconds
  return Math.max(1, windowSeconds - elapsed)
}

/**
 * Same fixed-window rule as public.check_rate_limit, but per process. Used when the
 * RPC is unavailable so paid calls stay bounded instead of failing or running unlimited.
 */
function consumeMemoryRateLimit(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds
  const bucket = `${key}:${windowStart}`
  const count = (memoryBuckets.get(bucket) ?? 0) + 1
  memoryBuckets.set(bucket, count)

  if (memoryBuckets.size > 1000) {
    const cutoff = windowStart - windowSeconds
    for (const name of memoryBuckets.keys()) {
      if (Number(name.slice(name.lastIndexOf(':') + 1)) < cutoff) memoryBuckets.delete(name)
    }
  }

  return count <= limit ? { allowed: true } : { allowed: false, retryAfterSeconds: retryAfter(windowSeconds) }
}

/**
 * Counts one request against `key` in a fixed window shared across all serverless
 * instances (public.check_rate_limit in supabase/rate-limit.sql). If the RPC is
 * missing or errors, uses the in-memory limiter and re-tries the RPC every
 * RPC_RETRY_MS, so applying the SQL takes effect without a redeploy.
 */
export async function consumeRateLimit(
  key: string,
  limit: number = PAID_API_RATE_LIMIT,
  windowSeconds: number = PAID_API_WINDOW_SECONDS,
): Promise<RateLimitResult> {
  if (Date.now() < rpcRetryAt) {
    return consumeMemoryRateLimit(key, limit, windowSeconds)
  }

  try {
    const { data, error } = await getServiceClient().rpc('check_rate_limit', {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    })
    if (error) throw new Error(error.message)
    if (data === true) return { allowed: true }
    return { allowed: false, retryAfterSeconds: retryAfter(windowSeconds) }
  } catch (error) {
    rpcRetryAt = Date.now() + RPC_RETRY_MS
    // One informational line per instance; the fallback is an expected mode, not a fault.
    if (!fallbackAnnounced) {
      fallbackAnnounced = true
      console.info(
        'rate limiter: using in-memory mode (check_rate_limit RPC unavailable)',
        error instanceof Error ? error.message : error,
      )
    }
    return consumeMemoryRateLimit(key, limit, windowSeconds)
  }
}
