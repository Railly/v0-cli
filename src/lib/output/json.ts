import type { NormalizedError } from '../utils/errors.ts'

export interface SuccessEnvelope<T> {
  data: T
}

export interface ErrorEnvelope {
  error: NormalizedError
}

export function emitSuccess<T>(data: T): void {
  const payload: SuccessEnvelope<T> = { data }
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
}

export function emitRaw(obj: unknown): void {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`)
}

export function emitError(err: NormalizedError, exitCode: number): never {
  const payload: ErrorEnvelope = { error: err }
  process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`)
  process.exit(exitCode)
}

export function applyFields<T extends Record<string, unknown>>(
  obj: T,
  fields?: string,
): Partial<T> | T {
  if (!fields) return obj
  const keys = fields
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const out: Partial<T> = {}
  for (const k of keys) {
    if (k in obj) out[k as keyof T] = obj[k as keyof T]
  }
  return out
}

export function applyFieldsArray<T extends Record<string, unknown>>(
  arr: T[],
  fields?: string,
): (Partial<T> | T)[] {
  if (!fields) return arr
  return arr.map((o) => applyFields(o, fields))
}
