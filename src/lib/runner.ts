import type { Command } from 'commander'
import type { createClient } from 'v0-sdk'
import type { GlobalOpts } from '../types/cli.ts'
import { apiKeyPrefix, buildClient } from './api/client.ts'
import { auditFinish, auditStart, type TrustLevel } from './audit/jsonl.ts'
import { activeProfileName, loadProfile, type Profile, resolveApiKey } from './config/profiles.ts'
import { emitError, emitSuccess } from './output/json.ts'
import { assertKillswitchOff } from './trust/killswitch.ts'
import { classifyCommand } from './trust/ladder.ts'
import { exitCodeFor, normalizeError } from './utils/errors.ts'
import { detectDefaultMode } from './utils/tty.ts'

export interface CommandContext {
  program: Command
  cmd: Command
  opts: GlobalOpts
  profile: Profile
  profileName: string
  client: ReturnType<typeof createClient>
  mode: 'human' | 'json'
  commandPath: string[]
  trust: TrustLevel
}

type RunFn = (ctx: CommandContext) => Promise<void>

function collectPath(cmd: Command): string[] {
  const parts: string[] = []
  let c: Command | null = cmd
  while (c?.parent) {
    parts.unshift(c.name())
    c = c.parent
  }
  return parts
}

function readGlobals(cmd: Command): GlobalOpts {
  const opts: GlobalOpts = {}
  let c: Command | null = cmd
  while (c) {
    Object.assign(opts, c.opts())
    c = c.parent
  }
  return opts
}

export function runCommand(fn: RunFn): (...args: unknown[]) => Promise<void> {
  return async (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command
    const program = cmd.parent ? (topProgram(cmd) as Command) : cmd
    const opts = readGlobals(cmd) as GlobalOpts
    const commandPath = collectPath(cmd)
    const mode = opts.json ? 'json' : detectDefaultMode()
    const profileName = activeProfileName(opts.profile)
    const profile = await loadProfile(profileName)
    const trust = classifyCommand(commandPath)

    // Killswitch pre-check for T2+.
    if (trust === 'T2' || trust === 'T3') {
      await assertKillswitchOff(`${commandPath.join(' ')}`)
    }

    const audit = await auditStart({
      cmd: `v0 ${commandPath.join(' ')}`,
      trustLevel: trust,
      profile: profileName,
      apiKeyPrefix: apiKeyPrefix(resolveApiKey(profile, opts.apiKey)),
      dryRun: !!opts.dryRun,
    })

    try {
      const client = buildClient({
        profile,
        ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
        ...(opts.baseUrl !== undefined ? { baseUrl: opts.baseUrl } : {}),
      })
      await fn({ program, cmd, opts, profile, profileName, client, mode, commandPath, trust })
      await auditFinish(audit, { status: 'ok' })
    } catch (err) {
      const normalized = normalizeError(err)
      normalized.command = `v0 ${commandPath.join(' ')}`
      normalized.auditId = audit.auditId
      const code = exitCodeFor(normalized)
      await auditFinish(audit, { status: 'error', error: normalized })
      if (mode === 'json') {
        emitError(normalized, code)
      } else {
        process.stderr.write(`${errorLine(normalized)}\n`)
        process.exit(code)
      }
    }
  }
}

function errorLine(err: ReturnType<typeof normalizeError>): string {
  const tag = err.type.replace(/_error$/, '')
  return `[${tag}] ${err.userMessage ?? err.message}`
}

function topProgram(cmd: Command): Command {
  let c = cmd
  while (c.parent) c = c.parent
  return c
}

// Convenience re-export.
export { emitSuccess }
