import { Command } from 'commander'
import { section, table } from '../lib/output/human.ts'
import { emitSuccess } from '../lib/output/json.ts'
import { runCommand } from '../lib/runner.ts'
import { color } from '../lib/ui/color.ts'

export function hookCommand(): Command {
  const cmd = new Command('hook').description('Read webhooks (list, show). Mutations land in V3.')

  cmd
    .command('list')
    .description('List hooks')
    .action(
      runCommand(async ({ client, mode }) => {
        const res = await client.hooks.find()
        if (mode === 'json') return emitSuccess(res)
        const rows = (res as unknown as { data?: Array<Record<string, unknown>> }).data ?? []
        process.stdout.write(`${section(`hooks (${rows.length})`)}\n`)
        process.stdout.write(
          `${table(rows, [
            { key: 'id', header: 'id' },
            { key: 'name', header: 'name' },
            { key: 'url', header: 'url' },
          ])}\n`,
        )
      }),
    )

  cmd
    .command('show <hook-id>')
    .description('Show one hook')
    .action(
      runCommand(async ({ client, mode, cmd }) => {
        const [hookId] = cmd.args as [string]
        const res = await client.hooks.getById({ hookId })
        if (mode === 'json') return emitSuccess(res)
        process.stdout.write(`${section(`hook ${hookId}`)}\n`)
        process.stdout.write(`${color.dim(JSON.stringify(res, null, 2))}\n`)
      }),
    )

  return cmd
}
