import { randomUUID } from 'node:crypto'
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { NormalizedError } from '../utils/errors.ts'
import { auditDir, ensureConfigDir } from '../utils/path.ts'

export type TrustLevel = 'T0' | 'T1' | 'T2' | 'T3'

export interface AuditEntry {
  ts: string
  auditId: string
  cmd: string
  trustLevel: TrustLevel
  profile: string
  apiKeyPrefix?: string
  input?: unknown
  dryRun: boolean
  status: 'pending' | 'ok' | 'error' | 'cancelled'
  result?: unknown
  error?: NormalizedError
  durationMs?: number
  intentTokenId?: string
}

function todayFile(): string {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d = String(now.getUTCDate()).padStart(2, '0')
  return join(auditDir(), `${y}-${m}-${d}.jsonl`)
}

async function write(entry: AuditEntry): Promise<void> {
  if (process.env.V0_CLI_NO_AUDIT) return
  await ensureConfigDir()
  await appendFile(todayFile(), `${JSON.stringify(entry)}\n`, { mode: 0o600 })
}

export async function auditStart(
  partial: Omit<AuditEntry, 'ts' | 'auditId' | 'status'>,
): Promise<AuditEntry> {
  const entry: AuditEntry = {
    ...partial,
    ts: new Date().toISOString(),
    auditId: `aud_${randomUUID().slice(0, 12)}`,
    status: 'pending',
  }
  await write(entry)
  return entry
}

export async function auditFinish(
  entry: AuditEntry,
  update: Pick<AuditEntry, 'status'> & Partial<AuditEntry>,
): Promise<void> {
  const finished: AuditEntry = {
    ...entry,
    ...update,
    ts: new Date().toISOString(),
    durationMs: update.durationMs ?? Date.now() - Date.parse(entry.ts),
  }
  await write(finished)
}
