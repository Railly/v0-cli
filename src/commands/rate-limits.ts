import { Command } from 'commander'
import { kv, section } from '../lib/output/human.ts'
import { emitSuccess } from '../lib/output/json.ts'
import { fetchAndCache } from '../lib/rate-limits/preflight.ts'
import { runCommand } from '../lib/runner.ts'
import { color } from '../lib/ui/color.ts'

export function rateLimitsCommand(): Command {
  return new Command('rate-limits')
    .description('Refresh and print the current rate-limit window')
    .option('--scope <scope>', 'scope id (from `v0 user scopes`)')
    .action(
      runCommand(async ({ client, mode, cmd }) => {
        const opts = cmd.opts<{ scope?: string }>()
        const snap = await fetchAndCache(client, opts.scope)
        if (mode === 'json') return emitSuccess(snap)
        process.stdout.write(`${section('rate limits')}\n`)
        process.stdout.write(`${kv('scope', snap.scope ?? color.dim('(account)'))}\n`)
        process.stdout.write(`${kv('limit', snap.limit)}\n`)
        if (snap.remaining !== undefined)
          process.stdout.write(`${kv('remaining', snap.remaining)}\n`)
        if (snap.reset !== undefined)
          process.stdout.write(`${kv('reset', new Date(snap.reset).toISOString())}\n`)
        if (snap.dailyLimit) {
          process.stdout.write(`\n${section('daily limit')}\n`)
          process.stdout.write(
            `${kv('remaining', `${snap.dailyLimit.remaining}/${snap.dailyLimit.limit}`)}\n`,
          )
          process.stdout.write(`${kv('reset', new Date(snap.dailyLimit.reset).toISOString())}\n`)
          if (snap.dailyLimit.isWithinGracePeriod) {
            process.stdout.write(`${kv('grace period', color.warn('yes (first 48h)'))}\n`)
          }
        }
      }),
    )
}
