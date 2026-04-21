import { createClient, type V0ClientConfig } from 'v0-sdk'
import type { Profile } from '../config/profiles.ts'
import { resolveApiKey } from '../config/profiles.ts'
import { CliError } from '../utils/errors.ts'

export interface BuildClientOpts {
  profile: Profile
  apiKey?: string
  baseUrl?: string
}

export function buildClient({ profile, apiKey, baseUrl }: BuildClientOpts) {
  const key = resolveApiKey(profile, apiKey)
  if (!key) {
    throw new CliError(
      {
        code: 'missing_api_key',
        type: 'auth_error',
        message: 'V0_API_KEY not set',
        userMessage:
          'No v0 API key found. Set V0_API_KEY in your shell, or run `v0 auth login` to save one to a profile.',
      },
      2,
    )
  }
  const config: V0ClientConfig = { apiKey: key }
  if (baseUrl ?? process.env.V0_BASE_URL) {
    config.baseUrl = baseUrl ?? process.env.V0_BASE_URL
  }
  return createClient(config)
}

export function apiKeyPrefix(key: string | undefined): string | undefined {
  if (!key) return undefined
  return `${key.slice(0, 6)}…`
}
