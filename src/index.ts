#!/usr/bin/env bun
import { Command } from 'commander'
import pkg from '../package.json' with { type: 'json' }
import { auditCommand } from './commands/audit.ts'
import { authCommand } from './commands/auth.ts'
import { chatCommand } from './commands/chat.ts'
import { deployCommand } from './commands/deploy.ts'
import { doctorCommand } from './commands/doctor.ts'
import { hookCommand } from './commands/hook.ts'
import { integrationsCommand } from './commands/integrations.ts'
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

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`[fatal] ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
