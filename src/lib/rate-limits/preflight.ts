import type { createClient } from 'v0-sdk'
import type { Profile } from '../config/profiles.ts'
import { CliError } from '../utils/errors.ts'
import { isStale, type RateLimitSnapshot, readCache, writeCache } from './cache.ts'

type V0Client = ReturnType<typeof createClient>

export async function fetchAndCache(client: V0Client, scope?: string): Promise<RateLimitSnapshot> {
  const res = scope ? await client.rateLimits.find({ scope }) : await client.rateLimits.find()
  const snap: RateLimitSnapshot = {
    limit: res.limit,
    fetchedAt: Date.now(),
  }
  if (res.remaining !== undefined) snap.remaining = res.remaining
  if (res.reset !== undefined) snap.reset = res.reset
  if (res.dailyLimit) snap.dailyLimit = res.dailyLimit
  if (scope) snap.scope = scope
  await writeCache(snap)
  return snap
}

export async function getSnapshot(
  client: V0Client,
  profile: Profile,
  scope?: string,
): Promise<RateLimitSnapshot> {
  const maxAge = (profile.rate_limits?.refresh_interval_seconds ?? 60) * 1000
  const cached = await readCache(scope)
  if (cached && !isStale(cached, maxAge)) return cached
  return fetchAndCache(client, scope)
}

export async function assertRateLimitOk(
  client: V0Client,
  profile: Profile,
  opts: { scope?: string; force?: boolean; outputMode: 'human' | 'json' },
): Promise<RateLimitSnapshot> {
  const snap = await getSnapshot(client, profile, opts.scope)
  if (opts.force) return snap

  const threshold = profile.rate_limits?.low_remaining_threshold ?? 50
  const blockOnJson = profile.rate_limits?.block_on_low_json ?? true
  const remaining = snap.dailyLimit?.remaining ?? snap.remaining

  if (remaining !== undefined && remaining < threshold) {
    if (opts.outputMode === 'json' && blockOnJson) {
      throw new CliError(
        {
          code: 'rate_limit_low',
          type: 'rate_limit_error',
          message: `Rate limit low: ${remaining} remaining (threshold ${threshold})`,
          userMessage: `Only ${remaining} requests remaining today; aborting. Pass --force to override.`,
        },
        3,
      )
    }
  }
  return snap
}
