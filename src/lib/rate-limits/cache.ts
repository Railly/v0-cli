import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cacheDir, ensureConfigDir } from '../utils/path.ts'

export interface RateLimitSnapshot {
  limit: number
  remaining?: number
  reset?: number
  dailyLimit?: {
    limit: number
    remaining: number
    reset: number
    isWithinGracePeriod: boolean
  }
  fetchedAt: number
  scope?: string
}

function cachePath(scope?: string): string {
  const suffix = scope ? `-${scope}` : ''
  return join(cacheDir(), `rate-limits${suffix}.json`)
}

export async function readCache(scope?: string): Promise<RateLimitSnapshot | null> {
  try {
    const raw = await readFile(cachePath(scope), 'utf8')
    return JSON.parse(raw) as RateLimitSnapshot
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export async function writeCache(snap: RateLimitSnapshot): Promise<void> {
  await ensureConfigDir()
  await writeFile(cachePath(snap.scope), JSON.stringify(snap, null, 2), { mode: 0o600 })
}

export function isStale(snap: RateLimitSnapshot, maxAgeMs: number): boolean {
  return Date.now() - snap.fetchedAt > maxAgeMs
}
