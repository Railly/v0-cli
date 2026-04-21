import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse, stringify } from 'smol-toml'
import { ensureConfigDir, profilesDir } from '../utils/path.ts'

export interface ProfileAuth {
  api_key?: string
}

export interface ProfileDefaults {
  privacy?: 'public' | 'private' | 'team' | 'team-edit' | 'unlisted'
  model_id?: string
  output?: 'human' | 'json'
  wait_timeout?: number
  scope?: string
}

export interface ProfileTrust {
  secret_patterns?: string[]
  killswitch_path?: string
  intent_ttl_minutes?: number
}

export interface ProfileDelivery {
  whatsapp_phone?: string
}

export interface ProfileRateLimits {
  refresh_interval_seconds?: number
  low_remaining_threshold?: number
  block_on_low_json?: boolean
}

export interface Profile {
  profile?: { name?: string; description?: string }
  auth?: ProfileAuth
  defaults?: ProfileDefaults
  trust?: ProfileTrust
  delivery?: ProfileDelivery
  rate_limits?: ProfileRateLimits
}

const DEFAULT_PROFILE: Profile = {
  profile: { name: 'default', description: 'Default v0-cli profile' },
  defaults: {
    privacy: 'private',
    model_id: 'v0-auto',
    output: 'human',
    wait_timeout: 600,
  },
  trust: {
    secret_patterns: ['*SECRET*', '*KEY*', '*TOKEN*', '*_SK_*', '*PRIVATE*'],
    intent_ttl_minutes: 15,
  },
  rate_limits: {
    refresh_interval_seconds: 60,
    low_remaining_threshold: 50,
    block_on_low_json: true,
  },
}

export function profilePath(name: string): string {
  return join(profilesDir(), `${name}.toml`)
}

export function activeProfileName(override?: string): string {
  return override ?? process.env.V0_PROFILE ?? 'default'
}

export async function loadProfile(name?: string): Promise<Profile> {
  const n = activeProfileName(name)
  try {
    const raw = await readFile(profilePath(n), 'utf8')
    return { ...DEFAULT_PROFILE, ...(parse(raw) as Profile) }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return DEFAULT_PROFILE
    }
    throw err
  }
}

export async function saveProfile(name: string, profile: Profile): Promise<void> {
  await ensureConfigDir()
  const merged = { ...DEFAULT_PROFILE, ...profile }
  await writeFile(profilePath(name), stringify(merged as Record<string, unknown>), { mode: 0o600 })
}

export function resolveApiKey(profile: Profile, override?: string): string | undefined {
  return override ?? process.env.V0_API_KEY ?? profile.auth?.api_key
}
