import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function configDir(): string {
  return process.env.V0_CLI_CONFIG_DIR ?? join(homedir(), '.v0cli')
}

export function profilesDir(): string {
  return join(configDir(), 'profiles')
}

export function cacheDir(): string {
  return join(configDir(), 'cache')
}

export function auditDir(): string {
  return join(configDir(), 'audit')
}

export function intentsDir(): string {
  return join(configDir(), 'intents')
}

export function logsDir(): string {
  return join(configDir(), 'logs')
}

export function killswitchPath(): string {
  return join(configDir(), 'killswitch')
}

export async function ensureConfigDir(): Promise<void> {
  await mkdir(configDir(), { recursive: true })
  await mkdir(profilesDir(), { recursive: true })
  await mkdir(cacheDir(), { recursive: true })
  await mkdir(auditDir(), { recursive: true })
  await mkdir(intentsDir(), { recursive: true })
  await mkdir(logsDir(), { recursive: true })
}
