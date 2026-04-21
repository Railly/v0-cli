export interface BackoffOpts {
  maxRetries?: number
  baseMs?: number
  maxMs?: number
  shouldRetry?: (err: unknown) => boolean
}

const defaultShouldRetry = (err: unknown): boolean => {
  if (!(err instanceof Error)) return false
  const m = /^HTTP (\d+):/.exec(err.message)
  if (!m) return false
  const status = Number(m[1])
  return status === 429 || (status >= 500 && status < 600)
}

export async function withBackoff<T>(fn: () => Promise<T>, opts: BackoffOpts = {}): Promise<T> {
  const maxRetries = opts.maxRetries ?? 4
  const baseMs = opts.baseMs ?? 1000
  const maxMs = opts.maxMs ?? 16_000
  const shouldRetry = opts.shouldRetry ?? defaultShouldRetry

  let attempt = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn()
    } catch (err) {
      if (attempt >= maxRetries || !shouldRetry(err)) throw err
      const base = Math.min(baseMs * 2 ** attempt, maxMs)
      const jitter = Math.random() * base * 0.25
      await new Promise((r) => setTimeout(r, base + jitter))
      attempt += 1
    }
  }
}
