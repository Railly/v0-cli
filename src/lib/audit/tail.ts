import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { auditDir } from '../utils/path.ts'
import type { AuditEntry } from './jsonl.ts'

export interface TailOpts {
  sinceMs?: number
  cmdFilter?: string
  limit?: number
}

export async function tailEntries(opts: TailOpts = {}): Promise<AuditEntry[]> {
  const dir = auditDir()
  let files: string[]
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.jsonl')).sort()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }

  const cutoff = opts.sinceMs ?? 0
  const cmdRe = opts.cmdFilter ? new RegExp(opts.cmdFilter) : null
  const out: AuditEntry[] = []

  for (const f of files) {
    const raw = await readFile(join(dir, f), 'utf8')
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const entry = JSON.parse(line) as AuditEntry
        const ts = Date.parse(entry.ts)
        if (cutoff && ts < cutoff) continue
        if (cmdRe && !cmdRe.test(entry.cmd)) continue
        out.push(entry)
      } catch {
        // skip malformed lines
      }
    }
  }

  if (opts.limit && out.length > opts.limit) {
    return out.slice(-opts.limit)
  }
  return out
}
