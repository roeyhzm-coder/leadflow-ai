export type ApiRequest = {
  method?: string
  headers: Record<string, string | string[] | undefined>
  query: Record<string, string | string[] | undefined>
  body?: unknown
}

export type ApiResponse = {
  setHeader: (name: string, value: string) => void
  status: (code: number) => ApiResponse
  json: (body: unknown) => void
  send: (body: string) => void
  end: () => void
}

function allowedOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter((origin) => origin.length > 0)
}

/**
 * Cross-origin access only for origins in ALLOWED_ORIGINS (comma-separated); never `*`.
 * The dashboard calls /api same-origin and server-to-server webhooks send no Origin,
 * so neither needs an allowlist entry.
 */
export function applyCors(req: ApiRequest, res: ApiResponse): void {
  res.setHeader('Vary', 'Origin')
  const origin = readString(req.headers.origin)
  if (!origin || !allowedOrigins().includes(origin)) return
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

export function readString(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

export function parseBody<T>(req: ApiRequest): T {
  if (req.body && typeof req.body === 'object') {
    return req.body as T
  }
  if (typeof req.body === 'string' && req.body.length > 0) {
    return JSON.parse(req.body) as T
  }
  return {} as T
}
