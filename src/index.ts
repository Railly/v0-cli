#!/usr/bin/env bun
import { Command } from 'commander'
import pkg from '../package.json' with { type: 'json' }
import { isBackgroundWorker, runBackgroundWorker } from './lib/background/spawn.ts'

// Background worker fast-path: bypass commander entirely. The parent CLI spawns
// this process with V0CLI_BACKGROUND_WORKER=1 and a JSON payload on stdin, then
// unrefs once it sees the handshake line. Everything after is worker logic.
if (isBackgroundWorker()) {
  await runBackgroundWorker()
  process.exit(0)
}

import { auditCommand } from './commands/audit.ts'
import { authCommand } from './commands/auth.ts'
import { chatCommand } from './commands/chat.ts'
import { deployCommand } from './commands/deploy.ts'
import { doctorCommand } from './commands/doctor.ts'
import { envCommand } from './commands/env.ts'
import { hookCommand } from './commands/hook.ts'
import { initCommand } from './commands/init.ts'
import { integrationsCommand } from './commands/integrations.ts'
import { intentCommand } from './commands/intent.ts'
import { killswitchCommand } from './commands/killswitch.ts'
import { mcpServerCommand } from './commands/mcp-server.ts'
import { msgCommand } from './commands/msg.ts'
import { projectCommand } from './commands/project.ts'
import { rateLimitsCommand } from './commands/rate-limits.ts'
import { reportCommand } from './commands/report.ts'
import { schemaCommand } from './commands/schema.ts'
import { userCommand } from './commands/user.ts'
import { versionCommand } from './commands/version.ts'
import { mountHelp } from './lib/ui/help.ts'

const program = new Command()

program
  .name('v0')
  .description('Agent-first CLI for the v0 Platform API (api.v0.dev/v1).')
  .version(pkg.version)
  .option('--json', 'force machine-readable JSON output (auto when stdout is not a TTY)')
  .option('--dry-run', 'preview without calling mutating endpoints')
  .option('--fields <list>', 'comma-separated whitelist of top-level keys in output')
  .option('--profile <name>', 'profile from ~/.v0cli/profiles/<name>.toml')
  .option('--confirm <token>', 'intent token (T3 ops)')
  .option('--yes, -y', 'skip interactive confirm (T2 only)')
  .option('--no-input', 'disable interactive prompts')
  .option('--quiet, -q', 'suppress progress; only print results')
  .option('--verbose, -v', 'debug logs to stderr')
  .option('--base-url <url>', 'override API base URL (default https://api.v0.dev/v1)')
  .option('--api-key <key>', 'override V0_API_KEY for one invocation')
  .option('--wait-timeout <seconds>', 'for --wait loops', '600')
  .option('--force', 'bypass client-side rate-limit preflight (never bypasses API 429)')
  .option('--scope <scope>', 'scope id for commands that accept it')

mountHelp(program)

program.addCommand(authCommand())
program.addCommand(userCommand())
program.addCommand(rateLimitsCommand())
program.addCommand(doctorCommand())
program.addCommand(initCommand())
program.addCommand(envCommand())
program.addCommand(intentCommand())
program.addCommand(projectCommand())
program.addCommand(chatCommand())
program.addCommand(versionCommand())
program.addCommand(msgCommand())
program.addCommand(deployCommand())
program.addCommand(hookCommand())
program.addCommand(mcpServerCommand())
program.addCommand(integrationsCommand())
program.addCommand(reportCommand())
program.addCommand(schemaCommand())
program.addCommand(auditCommand())
program.addCommand(killswitchCommand())

// Shorthand router: turns a single positional arg into either
//   `v0 chat init <source>`   when it looks like a path, URL, or template id
//   `v0 chat create <prompt>` otherwise (the default — a free-form message)
//
// Kicks in only when the first non-flag argument is not a registered command.
const knownCommands = new Set(program.commands.map((c) => c.name()))
const argv = [...process.argv]
const firstArgIdx = argv.findIndex((a, i) => i >= 2 && !a.startsWith('-'))
if (firstArgIdx !== -1) {
  const firstArg = argv[firstArgIdx] ?? ''
  if (!knownCommands.has(firstArg)) {
    // Route to `chat init` when the arg is unambiguously a concrete source:
    // a path (starts with ./, ../, ~/, /, or is . | ..), an http(s) URL,
    // an SSH git remote, or a template id. Bare words like "dashboard" are
    // prompts and go to `chat create`.
    const isSourceLike =
      firstArg === '.' ||
      firstArg === '..' ||
      firstArg.startsWith('./') ||
      firstArg.startsWith('../') ||
      firstArg.startsWith('~/') ||
      firstArg.startsWith('/') ||
      /^https?:\/\//i.test(firstArg) ||
      /^git@[\w.-]+:/.test(firstArg) ||
      /^(template_|tpl_)/i.test(firstArg)
    // v0.app/templates/<slug>-<id> URLs are also init sources (templates).
    // The detectSourceKind helper handles the extraction; here we just need
    // to decide between init vs create. HTTP URLs already route to init
    // through `isSourceLike`, so v0.app URLs are covered.
    if (isSourceLike) {
      argv.splice(firstArgIdx, 0, 'chat', 'init')
    } else {
      argv.splice(firstArgIdx, 0, 'chat', 'create')
    }
  }
}

program.parseAsync(argv).catch((err) => {
  process.stderr.write(`[fatal] ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
