import { readFile, writeFile } from 'node:fs/promises'
import { CliError } from '../utils/errors.ts'

export interface DotEnvEntry {
  key: string
  value: string
  line: number
}

const LINE_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/

function stripQuotes(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    const last = trimmed[trimmed.length - 1]
    if (first === '"' && last === '"') {
      return trimmed.slice(1, -1).replace(/\\\\/g, '\\').replace(/\\"/g, '"')
    }
    if (first === "'" && last === "'") {
      return trimmed.slice(1, -1)
    }
  }
  return trimmed
}

export function parseDotEnv(contents: string): DotEnvEntry[] {
  const entries: DotEnvEntry[] = []
  const lines = contents.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!line.trim() || line.trim().startsWith('#')) continue
    const match = LINE_RE.exec(line)
    if (!match) continue
    const [, key, rawValue] = match
    if (!key) continue
    const hashIdx = rawValue!.indexOf(' #')
    const cleanedValue = hashIdx >= 0 ? rawValue!.slice(0, hashIdx) : rawValue!
    entries.push({ key, value: stripQuotes(cleanedValue ?? ''), line: i + 1 })
  }
  return entries
}

export async function readDotEnv(path: string): Promise<DotEnvEntry[]> {
  try {
    const contents = await readFile(path, 'utf8')
    return parseDotEnv(contents)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new CliError(
      {
        code: 'dotenv_read_error',
        type: 'validation_error',
        message: (err as Error).message,
        userMessage: `Could not read ${path}: ${(err as Error).message}`,
      },
      2,
    )
  }
}

function escapeValue(value: string): string {
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) return value
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export async function writeDotEnv(
  path: string,
  entries: Array<{ key: string; value: string }>,
): Promise<void> {
  const lines = entries.map(({ key, value }) => `${key}=${escapeValue(value)}`)
  await writeFile(path, `${lines.join('\n')}\n`, { mode: 0o600 })
}

export interface DiffResult {
  toCreate: Array<{ key: string; value: string }>
  toUpdate: Array<{ key: string; value: string; previous: string }>
  toDelete: Array<{ key: string }>
  unchanged: string[]
}

export interface RemoteEnvVar {
  id: string
  key: string
  value?: string
}

export function diffLocalVsRemote(local: DotEnvEntry[], remote: RemoteEnvVar[]): DiffResult {
  const remoteByKey = new Map(remote.map((r) => [r.key, r]))
  const localByKey = new Map(local.map((l) => [l.key, l]))
  const out: DiffResult = {
    toCreate: [],
    toUpdate: [],
    toDelete: [],
    unchanged: [],
  }
  for (const entry of local) {
    const existing = remoteByKey.get(entry.key)
    if (!existing) {
      out.toCreate.push({ key: entry.key, value: entry.value })
    } else if (existing.value !== undefined && existing.value !== entry.value) {
      out.toUpdate.push({ key: entry.key, value: entry.value, previous: existing.value })
    } else if (existing.value === undefined) {
      // remote returned redacted value (no --decrypted); treat as unchanged to avoid clobbering
      out.unchanged.push(entry.key)
    } else {
      out.unchanged.push(entry.key)
    }
  }
  for (const r of remote) {
    if (!localByKey.has(r.key)) out.toDelete.push({ key: r.key })
  }
  return out
}
