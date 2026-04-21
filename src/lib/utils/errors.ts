export interface V0ApiError {
  code: string
  type: string
  message: string
  userMessage?: string
}

export interface NormalizedError {
  code: string
  type: string
  message: string
  userMessage?: string
  status?: number
  command?: string
  auditId?: string | undefined
}

export class CliError extends Error {
  readonly normalized: NormalizedError
  readonly exitCode: number

  constructor(normalized: NormalizedError, exitCode: number) {
    super(normalized.message)
    this.normalized = normalized
    this.exitCode = exitCode
  }
}

export const ExitCodes = {
  Ok: 0,
  ApiError: 1,
  ValidationError: 2,
  RateLimited: 3,
  Killswitch: 4,
  IntentRequired: 5,
  NetworkError: 6,
} as const

export function normalizeError(err: unknown): NormalizedError {
  if (err instanceof CliError) {
    return err.normalized
  }

  if (err instanceof Error) {
    const m = /^HTTP (\d+): (.*)$/s.exec(err.message)
    if (m) {
      const status = Number(m[1])
      const body = m[2] ?? ''
      try {
        const parsed = JSON.parse(body)
        if (parsed.error) {
          const e = parsed.error as V0ApiError
          return {
            code: e.code ?? 'unknown_error',
            type: e.type ?? 'unknown_error',
            message: e.message ?? err.message,
            userMessage: e.userMessage,
            status,
          }
        }
      } catch {
        // body wasn't JSON
      }
      return {
        code: `http_${status}`,
        type: 'http_error',
        message: body || err.message,
        status,
      }
    }

    return {
      code: 'client_error',
      type: 'client_error',
      message: err.message,
    }
  }

  return {
    code: 'unknown_error',
    type: 'unknown_error',
    message: String(err),
  }
}

export function exitCodeFor(err: NormalizedError): number {
  if (err.status === 429) return ExitCodes.RateLimited
  if (err.type === 'killswitch') return ExitCodes.Killswitch
  if (err.type === 'intent_required' || err.type === 'intent_invalid')
    return ExitCodes.IntentRequired
  if (err.type === 'validation_error' || err.code === 'validation_error')
    return ExitCodes.ValidationError
  if (err.type === 'network_error') return ExitCodes.NetworkError
  return ExitCodes.ApiError
}
