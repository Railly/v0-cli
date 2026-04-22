// Audit tail on top of cligentic/foundation/audit-log. The cligentic block
// already implements "read N newest JSONL records across rotated daily
// files" — we reuse it and layer v0-cli-specific filters (time window,
// command regex) on top.

import { tailAudit } from '../../cli/foundation/audit-log.ts'
import { auditDir } from '../utils/path.ts'

export interface TailOpts {
  sinceMs?: number
  cmdFilter?: string
  limit?: number
}

export interface TailEntry {
  ts: string
  command: string
  result: string
  tier?: string
  profile?: string
  meta?: Record<string, unknown>
}

export async function tailEntries(opts: TailOpts = {}): Promise<TailEntry[]> {
  // Pull more than requested so post-filters still land `limit` rows.
  const overfetch = Math.max((opts.limit ?? 20) * 4, 200)
  const raw = tailAudit(auditDir(), overfetch)

  const cutoff = opts.sinceMs ?? 0
  const cmdRe = opts.cmdFilter ? new RegExp(opts.cmdFilter) : null

  const out: TailEntry[] = []
  // cligentic returns newest-first; we preserve that order.
  for (const entry of raw) {
    const ts = Date.parse(entry.ts)
    if (cutoff && ts < cutoff) continue
    if (cmdRe && !cmdRe.test(entry.command)) continue
    const row: TailEntry = {
      ts: entry.ts,
      command: entry.command,
      result: entry.result,
    }
    if (entry.tier !== undefined) row.tier = entry.tier
    if (entry.profile !== undefined) row.profile = entry.profile
    if (entry.meta !== undefined) row.meta = entry.meta
    out.push(row)
    if (opts.limit && out.length >= opts.limit) break
  }
  return out
}
