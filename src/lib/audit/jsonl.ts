// Two-phase audit on top of cligentic/foundation/audit-log. We call the
// cligentic primitive twice per command invocation: once with result
// "pending" (before the fetch) and once with the terminal result ("ok",
// "error", "blocked", "dry-run").
//
// The block's AuditRecord shape is honored exactly — everything v0-cli
// specific (auditId, apiKeyPrefix, duration, intent token id, response
// payload) lives inside `meta`. That keeps `cligentic tailAudit` and any
// downstream consumer of the JSONL format working unchanged.

import { randomUUID } from 'node:crypto'
import { type AuditRecord, audit as cligenticAudit } from '../../cli/foundation/audit-log.ts'
import type { NormalizedError } from '../utils/errors.ts'
import { auditDir, ensureConfigDir } from '../utils/path.ts'

export type TrustLevel = 'T0' | 'T1' | 'T2' | 'T3'

export interface AuditEntry {
  auditId: string
  command: string
  trustLevel: TrustLevel
  profile: string
  apiKeyPrefix?: string
  input?: unknown
  dryRun: boolean
  startedAt: string
}

type TerminalResult = 'ok' | 'error' | 'blocked' | 'dry-run'

function writeAudit(
  entry: AuditEntry,
  result: AuditRecord['result'],
  extra: Record<string, unknown>,
): void {
  if (process.env.V0_CLI_NO_AUDIT) return
  const record: AuditRecord = {
    kind: 'cmd.run',
    command: entry.command,
    result,
    tier: entry.trustLevel,
    profile: entry.profile,
    meta: {
      auditId: entry.auditId,
      dryRun: entry.dryRun,
      ...(entry.apiKeyPrefix !== undefined ? { apiKeyPrefix: entry.apiKeyPrefix } : {}),
      ...(entry.input !== undefined ? { input: entry.input } : {}),
      ...extra,
    },
  }
  cligenticAudit(auditDir(), record)
}

export async function auditStart(
  partial: Omit<AuditEntry, 'auditId' | 'startedAt'> & {
    cmd?: string
    command?: string
  },
): Promise<AuditEntry> {
  await ensureConfigDir()
  const entry: AuditEntry = {
    auditId: `aud_${randomUUID().slice(0, 12)}`,
    command: partial.command ?? partial.cmd ?? '',
    trustLevel: partial.trustLevel,
    profile: partial.profile,
    dryRun: partial.dryRun,
    startedAt: new Date().toISOString(),
    ...(partial.apiKeyPrefix !== undefined ? { apiKeyPrefix: partial.apiKeyPrefix } : {}),
    ...(partial.input !== undefined ? { input: partial.input } : {}),
  }
  writeAudit(entry, 'ok', { phase: 'pending' })
  return entry
}

export async function auditFinish(
  entry: AuditEntry,
  update: {
    status: 'ok' | 'error' | 'cancelled'
    result?: unknown
    error?: NormalizedError
    durationMs?: number
    intentTokenId?: string
  },
): Promise<void> {
  const durationMs = update.durationMs ?? Date.now() - Date.parse(entry.startedAt)
  const mappedResult: TerminalResult =
    update.status === 'cancelled'
      ? 'blocked'
      : update.status === 'error'
        ? 'error'
        : entry.dryRun
          ? 'dry-run'
          : 'ok'
  writeAudit(entry, mappedResult, {
    phase: 'final',
    durationMs,
    ...(update.result !== undefined ? { result: update.result } : {}),
    ...(update.error !== undefined ? { error: update.error } : {}),
    ...(update.intentTokenId !== undefined ? { intentTokenId: update.intentTokenId } : {}),
  })
}
