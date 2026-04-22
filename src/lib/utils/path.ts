// Thin wrapper over cligentic/xdg-paths. All paths used in v0-cli resolve
// through a single AppPaths tree so the rest of the codebase doesn't import
// the cligentic block directly.
//
// Layout by default:
//   ~/.v0cli/                                 (when V0_CLI_HOME is set)
//   ~/Library/Application Support/v0cli/      (macOS default)
//   ~/.config/v0cli/                          (Linux XDG)
//
// Set V0_CLI_HOME to pin the layout anywhere (tests, CI, migrations).

import { join } from 'node:path'
import { type AppPaths, ensureHome, getAppPaths } from '../../cli/foundation/xdg-paths.ts'

const APP_NAME = 'v0cli'

// Intentionally uncached. getAppPaths is cheap (pure env + path joins) and
// caching would break test fixtures that flip V0CLI_HOME per test.
export function paths(): AppPaths {
  return getAppPaths(APP_NAME)
}

export function configDir(): string {
  return paths().config
}

export function profilesDir(): string {
  return join(paths().config, 'profiles')
}

export function cacheDir(): string {
  return paths().cache
}

export function auditDir(): string {
  return paths().audit
}

export function intentsDir(): string {
  return join(paths().state, 'intents')
}

export function logsDir(): string {
  return join(paths().state, 'logs')
}

export function killswitchPath(): string {
  return join(paths().state, 'killswitch')
}

export function pendingDir(): string {
  return join(paths().state, 'pending')
}

export async function ensureConfigDir(): Promise<void> {
  const p = paths()
  ensureHome(p)
  // Our own subdirs on top of cligentic's canonical tree.
  const { mkdir } = await import('node:fs/promises')
  await mkdir(profilesDir(), { recursive: true, mode: 0o700 })
  await mkdir(intentsDir(), { recursive: true, mode: 0o700 })
  await mkdir(logsDir(), { recursive: true })
  await mkdir(pendingDir(), { recursive: true })
}
