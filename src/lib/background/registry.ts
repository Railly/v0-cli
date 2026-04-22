import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pendingDir } from '../utils/path.ts'

export type PendingStatus = 'running' | 'done' | 'failed'

export interface PendingRecord {
  chatId: string
  prompt: string
  startedAt: string
  finishedAt?: string
  pid?: number
  streamLog: string
  status: PendingStatus
  result?: {
    versionId?: string
    files: number
    webUrl?: string
    demo?: string
    title?: string
  }
  error?: string
}

export async function ensurePendingDir(): Promise<string> {
  const dir = pendingDir()
  await mkdir(dir, { recursive: true })
  return dir
}

export function pendingPath(chatId: string): string {
  return join(pendingDir(), `${chatId}.json`)
}

export function streamLogPath(chatId: string): string {
  return join(pendingDir(), `${chatId}.ndjson`)
}

export async function savePending(rec: PendingRecord): Promise<void> {
  await ensurePendingDir()
  await writeFile(pendingPath(rec.chatId), JSON.stringify(rec, null, 2), { mode: 0o600 })
}

export async function loadPending(chatId: string): Promise<PendingRecord | null> {
  try {
    const raw = await readFile(pendingPath(chatId), 'utf8')
    return JSON.parse(raw) as PendingRecord
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export async function listPending(): Promise<PendingRecord[]> {
  await ensurePendingDir()
  const entries = await readdir(pendingDir())
  const out: PendingRecord[] = []
  for (const e of entries) {
    if (!e.endsWith('.json')) continue
    try {
      const raw = await readFile(join(pendingDir(), e), 'utf8')
      out.push(JSON.parse(raw) as PendingRecord)
    } catch {
      // skip corrupted entries
    }
  }
  return out.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

export async function removePending(chatId: string): Promise<void> {
  for (const p of [pendingPath(chatId), streamLogPath(chatId)]) {
    try {
      await unlink(p)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }
}

export async function cleanPending(olderThanMs = 60 * 60 * 1000): Promise<number> {
  const now = Date.now()
  const records = await listPending()
  let removed = 0
  for (const r of records) {
    if (r.status === 'running') continue
    const finishedAt = r.finishedAt ? Date.parse(r.finishedAt) : Number.NaN
    const ts = Number.isFinite(finishedAt) ? finishedAt : Date.parse(r.startedAt)
    if (now - ts >= olderThanMs) {
      await removePending(r.chatId)
      removed++
    }
  }
  return removed
}

export function isProcessAlive(pid?: number): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
