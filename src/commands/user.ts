import { Command } from 'commander'
import { bullet, kv, section } from '../lib/output/human.ts'
import { emitSuccess } from '../lib/output/json.ts'
import { runCommand } from '../lib/runner.ts'
import { color } from '../lib/ui/color.ts'

export function userCommand(): Command {
  const cmd = new Command('user').description('Account, plan, billing, scopes')

  cmd
    .command('get')
    .description('Raw user.get() response')
    .action(
      runCommand(async ({ client, mode }) => {
        const user = await client.user.get()
        if (mode === 'json') return emitSuccess(user)
        process.stdout.write(`${section('user')}\n`)
        for (const [k, v] of Object.entries(user as unknown as Record<string, unknown>)) {
          process.stdout.write(`${kv(k, v === undefined ? null : String(v))}\n`)
        }
      }),
    )

  cmd
    .command('plan')
    .description('Plan and credit balance')
    .action(
      runCommand(async ({ client, mode }) => {
        const plan = await client.user.getPlan()
        if (mode === 'json') return emitSuccess(plan)
        process.stdout.write(`${section('plan')}\n`)
        process.stdout.write(`${kv('plan', plan.plan ?? '—')}\n`)
        if (plan.balance) {
          process.stdout.write(`${kv('remaining', plan.balance.remaining)}\n`)
          process.stdout.write(`${kv('total', plan.balance.total)}\n`)
        }
      }),
    )

  cmd
    .command('billing')
    .description('Billing details (optional --scope)')
    .option('--scope <scope>', 'billing scope id')
    .action(
      runCommand(async ({ client, mode, cmd }) => {
        const opts = cmd.opts<{ scope?: string }>()
        const billing = opts.scope
          ? await client.user.getBilling({ scope: opts.scope })
          : await client.user.getBilling()
        if (mode === 'json') return emitSuccess(billing)
        process.stdout.write(`${section('billing')}\n`)
        process.stdout.write(`${JSON.stringify(billing, null, 2)}\n`)
      }),
    )

  cmd
    .command('scopes')
    .description('List available scopes (teams)')
    .action(
      runCommand(async ({ client, mode }) => {
        const res = await client.user.getScopes()
        if (mode === 'json') return emitSuccess(res)
        process.stdout.write(`${section('scopes')}\n`)
        const scopes = Array.isArray(res) ? res : ((res as { data?: unknown[] }).data ?? [])
        if (!scopes.length) {
          process.stdout.write(`${bullet(color.dim('(none)'))}\n`)
          return
        }
        for (const s of scopes as Array<Record<string, unknown>>) {
          process.stdout.write(
            bullet(`${color.accent(String(s.id ?? '?'))} — ${String(s.name ?? s.type ?? '—')}`) +
              '\n',
          )
        }
      }),
    )

  return cmd
}
