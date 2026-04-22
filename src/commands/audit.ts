import { Command } from 'commander'
import { tailEntries } from '../lib/audit/tail.ts'
import { section } from '../lib/output/human.ts'
import { emitSuccess } from '../lib/output/json.ts'
import { color } from '../lib/ui/color.ts'
import { detectDefaultMode } from '../lib/utils/tty.ts'

function parseSince(s?: string): number | undefined {
  if (!s) return undefined
  const m = /^(\d+)(ms|s|m|h|d)?$/.exec(s)
  if (!m) return undefined
  const n = Number(m[1])
  const unit = m[2] ?? 's'
  const mul: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }
  return Date.now() - n * (mul[unit] ?? 1000)
}

export function auditCommand(): Command {
  const cmd = new Command('audit').description('Local CLI audit trail')

  cmd
    .command('tail')
    .description('Tail entries')
    .option('--since <duration>', 'e.g. 1h, 30m, 1d', '1d')
    .option('--cmd <regex>', 'filter by command regex')
    .option('--limit <n>', 'max rows')
    .option('--json', 'force JSON output')
    .action(
      async (
        rawOpts: { since?: string; cmd?: string; limit?: string; json?: boolean },
        cmd: Command,
      ) => {
        const mode =
          rawOpts.json || cmd.optsWithGlobals<{ json?: boolean }>().json
            ? 'json'
            : detectDefaultMode()
        const opts: Parameters<typeof tailEntries>[0] = {}
        if (rawOpts.since !== undefined) {
          const parsed = parseSince(rawOpts.since)
          if (parsed !== undefined) opts.sinceMs = parsed
        }
        if (rawOpts.cmd !== undefined) opts.cmdFilter = rawOpts.cmd
        if (rawOpts.limit !== undefined) opts.limit = Number(rawOpts.limit)
        const entries = await tailEntries(opts)
        if (mode === 'json') {
          for (const e of entries) {
            process.stdout.write(`${JSON.stringify(e)}\n`)
          }
          if (!entries.length) emitSuccess([])
          return
        }
        process.stdout.write(`${section(`audit (${entries.length})`)}\n`)
        for (const e of entries) {
          const stateColor =
            e.result === 'ok'
              ? color.success
              : e.result === 'error'
                ? color.error
                : e.result === 'blocked'
                  ? color.warn
                  : color.muted
          process.stdout.write(
            `  ${color.dim(e.ts)} ${stateColor(e.result.padEnd(7))} ${color.accent(e.tier ?? '--')} ${e.command}\n`,
          )
        }
      },
    )

  return cmd
}
