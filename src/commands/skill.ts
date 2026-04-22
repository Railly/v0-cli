import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { readFile, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { bullet, kv, section } from '../lib/output/human.ts'
import { emitSuccess } from '../lib/output/json.ts'
import { runCommand } from '../lib/runner.ts'
import { color } from '../lib/ui/color.ts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SKILL_SLUG = 'Railly/v0-cli'
// Claude Code's agent-SDK installs skills under ~/.claude/skills/<name>/.
// Cursor and other MCP-aware runtimes usually follow the same layout; if
// yours doesn't, the --path flag on status lets you point at it.
const DEFAULT_SKILL_DIR = join(homedir(), '.claude', 'skills', 'v0-cli')
const REMOTE_SKILL_URL =
  'https://raw.githubusercontent.com/Railly/v0-cli/main/skill/SKILL.md'

// ---------------------------------------------------------------------------
// Subprocess helper: runs `npx skills add/update …` with inherited stdio so
// the user sees the real output (download progress, prompts, etc).
// ---------------------------------------------------------------------------

interface InstallerOutcome {
  ok: boolean
  exitCode: number | null
  command: string[]
}

function runInstaller(args: string[]): Promise<InstallerOutcome> {
  return new Promise((resolve) => {
    const child = spawn(args[0] ?? '', args.slice(1), {
      stdio: 'inherit',
      env: process.env,
    })
    child.on('exit', (code) => {
      resolve({ ok: code === 0, exitCode: code, command: args })
    })
    child.on('error', () => {
      resolve({ ok: false, exitCode: null, command: args })
    })
  })
}

// ---------------------------------------------------------------------------
// Status helper — compares local SKILL.md to the main branch on GitHub.
// Returns a compact report the command can render in either mode.
// ---------------------------------------------------------------------------

interface SkillStatus {
  installed: boolean
  path: string
  /** SHA-256 of the local SKILL.md content (undefined when not installed). */
  localSha?: string
  /** SHA-256 of the remote SKILL.md content (undefined on network failure). */
  remoteSha?: string
  /** `installedAt` ms epoch — mtime of SKILL.md */
  installedAt?: number
  /** True when both SHAs are known and match. */
  current?: boolean
  /** Human-readable drift summary. */
  drift?: 'up-to-date' | 'stale' | 'unknown' | 'not-installed'
}

async function sha256(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function probeSkillStatus(skillDir: string): Promise<SkillStatus> {
  const skillPath = join(skillDir, 'SKILL.md')
  const status: SkillStatus = { installed: false, path: skillDir }

  if (!existsSync(skillPath)) {
    status.drift = 'not-installed'
    return status
  }
  status.installed = true

  try {
    const local = await readFile(skillPath, 'utf8')
    status.localSha = await sha256(local)
  } catch {
    // unreadable — treat as not installed
    status.installed = false
    status.drift = 'not-installed'
    return status
  }
  try {
    const s = await stat(skillPath)
    status.installedAt = s.mtimeMs
  } catch {
    // ignore
  }

  // Fetch remote with a short timeout so status never hangs the CLI.
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 5000)
    const res = await fetch(REMOTE_SKILL_URL, { signal: ctrl.signal })
    clearTimeout(t)
    if (res.ok) {
      const remote = await res.text()
      status.remoteSha = await sha256(remote)
      status.current = status.localSha === status.remoteSha
      status.drift = status.current ? 'up-to-date' : 'stale'
    } else {
      status.drift = 'unknown'
    }
  } catch {
    status.drift = 'unknown'
  }

  return status
}

// ---------------------------------------------------------------------------
// Command factory
// ---------------------------------------------------------------------------

export function skillCommand(): Command {
  const cmd = new Command('skill').description(
    'Manage the companion agent skill (Claude Code / Cursor / MCP-aware).',
  )

  cmd
    .command('install')
    .description('Install the v0-cli agent skill via `npx skills`. T0.')
    .option(
      '--command <args...>',
      'override installer command (default: npx -y skills add Railly/v0-cli)',
    )
    .action(
      runCommand(async ({ mode, cmd, recordResult }) => {
        const raw = cmd.opts<{ command?: string[] }>()
        const args =
          raw.command && raw.command.length > 0
            ? raw.command
            : ['npx', '-y', 'skills', 'add', SKILL_SLUG]
        if (mode === 'human') {
          process.stdout.write(
            `${color.dim('Installing v0-cli skill via:')} ${color.accent(args.join(' '))}\n\n`,
          )
        }
        const outcome = await runInstaller(args)
        recordResult({
          installed: outcome.ok,
          command: outcome.command,
          exitCode: outcome.exitCode,
        })
        if (mode === 'json') {
          return emitSuccess({
            installed: outcome.ok,
            command: outcome.command,
            exitCode: outcome.exitCode,
            skillSlug: SKILL_SLUG,
          })
        }
        if (outcome.ok) {
          process.stdout.write(`${bullet(color.success('Skill installed.'))}\n`)
          process.stdout.write(
            `${color.dim('Restart your agent runtime (Claude Code, Cursor) so it picks up the new skill.')}\n`,
          )
        } else {
          process.stdout.write(
            `${bullet(color.error(`Installer exited with code ${outcome.exitCode ?? 'null'}`))}\n`,
          )
          process.exit(1)
        }
      }),
    )

  cmd
    .command('update')
    .description(
      'Update the skill to the latest version via `npx skills update`. T0.',
    )
    .option(
      '--command <args...>',
      'override installer command (default: npx -y skills update v0-cli)',
    )
    .action(
      runCommand(async ({ mode, cmd, recordResult }) => {
        const raw = cmd.opts<{ command?: string[] }>()
        // The `skills` CLI exposes `update` as a first-class verb (alias
        // `upgrade`) distinct from `add`. It takes the skill NAME (not the
        // slug) — skills installed via `add Railly/v0-cli` live under the
        // folder name `v0-cli`. So the update target is the bare name.
        const args =
          raw.command && raw.command.length > 0
            ? raw.command
            : ['npx', '-y', 'skills', 'update', 'v0-cli', '-y']
        if (mode === 'human') {
          process.stdout.write(
            `${color.dim('Updating v0-cli skill via:')} ${color.accent(args.join(' '))}\n\n`,
          )
        }
        const outcome = await runInstaller(args)
        recordResult({
          updated: outcome.ok,
          command: outcome.command,
          exitCode: outcome.exitCode,
        })
        if (mode === 'json') {
          return emitSuccess({
            updated: outcome.ok,
            command: outcome.command,
            exitCode: outcome.exitCode,
            skillSlug: SKILL_SLUG,
          })
        }
        if (outcome.ok) {
          process.stdout.write(`${bullet(color.success('Skill updated.'))}\n`)
          process.stdout.write(
            `${color.dim('Restart your agent runtime to pick up the new version.')}\n`,
          )
        } else {
          process.stdout.write(
            `${bullet(color.error(`Installer exited with code ${outcome.exitCode ?? 'null'}`))}\n`,
          )
          process.exit(1)
        }
      }),
    )

  cmd
    .command('status')
    .description(
      'Show whether the skill is installed and whether it matches the latest on main. T0.',
    )
    .option(
      '--path <dir>',
      'skill install dir (default: ~/.claude/skills/v0-cli)',
    )
    .action(
      runCommand(async ({ mode, cmd, recordResult }) => {
        const raw = cmd.opts<{ path?: string }>()
        const dir = raw.path ?? DEFAULT_SKILL_DIR
        const status = await probeSkillStatus(dir)
        recordResult(status)

        if (mode === 'json') return emitSuccess(status)

        process.stdout.write(`${section('v0 skill status')}\n`)
        process.stdout.write(`${kv('path', status.path)}\n`)
        if (!status.installed) {
          process.stdout.write(
            `${kv('state', color.warn('not installed'))}\n${color.dim('Install with:')} ${color.accent('v0 skill install')}\n`,
          )
          return
        }
        process.stdout.write(`${kv('state', color.success('installed'))}\n`)
        if (status.installedAt) {
          const ago = Math.floor((Date.now() - status.installedAt) / 1000)
          const agoStr =
            ago < 60
              ? `${ago}s ago`
              : ago < 3600
                ? `${Math.floor(ago / 60)}m ago`
                : ago < 86400
                  ? `${Math.floor(ago / 3600)}h ago`
                  : `${Math.floor(ago / 86400)}d ago`
          process.stdout.write(`${kv('installed', agoStr)}\n`)
        }
        if (status.drift === 'up-to-date') {
          process.stdout.write(`${kv('remote', color.success('up to date'))}\n`)
        } else if (status.drift === 'stale') {
          process.stdout.write(`${kv('remote', color.warn('stale — local differs from main'))}\n`)
          process.stdout.write(
            `${color.dim('Update with:')} ${color.accent('v0 skill update')}\n`,
          )
        } else if (status.drift === 'unknown') {
          process.stdout.write(`${kv('remote', color.dim('unreachable (offline?)'))}\n`)
        }
        if (status.localSha) {
          process.stdout.write(`${kv('local sha', status.localSha.slice(0, 12))}\n`)
        }
        if (status.remoteSha) {
          process.stdout.write(`${kv('remote sha', status.remoteSha.slice(0, 12))}\n`)
        }
      }),
    )

  cmd
    .command('uninstall')
    .description('Delete the installed skill directory. T0.')
    .option(
      '--path <dir>',
      'skill install dir (default: ~/.claude/skills/v0-cli)',
    )
    .option('--yes, -y', 'skip interactive confirm')
    .action(
      runCommand(async ({ mode, cmd, opts, recordResult }) => {
        const raw = cmd.opts<{ path?: string; yes?: boolean }>()
        const dir = raw.path ?? DEFAULT_SKILL_DIR
        if (!existsSync(dir)) {
          recordResult({ removed: false, path: dir, reason: 'not-installed' })
          if (mode === 'json') {
            return emitSuccess({ removed: false, path: dir, reason: 'not-installed' })
          }
          process.stdout.write(
            `${bullet(color.dim(`Nothing to remove — ${dir} does not exist.`))}\n`,
          )
          return
        }

        const info = statSync(dir)
        if (!info.isDirectory()) {
          throw new Error(`Expected a directory at ${dir}`)
        }

        // Human mode: interactive confirm unless --yes (or inherited opts.yes).
        // JSON mode: require --yes explicitly so scripts can't blow away a
        // skill dir by accident.
        const yes = !!(raw.yes || opts.yes)
        if (!yes && mode === 'human') {
          const clack = await import('@clack/prompts')
          const ok = await clack.confirm({
            message: `Remove ${dir}?`,
            initialValue: false,
          })
          if (clack.isCancel(ok) || !ok) {
            process.stdout.write(`${color.dim('Cancelled.')}\n`)
            process.exit(130)
          }
        }
        if (!yes && mode === 'json') {
          throw new Error('skill uninstall in JSON mode requires --yes')
        }

        await rm(dir, { recursive: true, force: true })
        recordResult({ removed: true, path: dir })
        if (mode === 'json') return emitSuccess({ removed: true, path: dir })
        process.stdout.write(`${bullet(color.success(`Removed ${dir}`))}\n`)
      }),
    )

  return cmd
}
