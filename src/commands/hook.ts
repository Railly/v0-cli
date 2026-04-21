import { Command } from 'commander'
import { bullet, section, table } from '../lib/output/human.ts'
import { emitSuccess } from '../lib/output/json.ts'
import { runCommand } from '../lib/runner.ts'
import { color } from '../lib/ui/color.ts'
import { mergeParams, parseParamsJson } from '../lib/validation/params.ts'

export function hookCommand(): Command {
  const cmd = new Command('hook').description(
    'Webhooks (list, show, create). Delete/update arrive later.',
  )

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

  cmd
    .command('create')
    .description('Create a webhook (T1)')
    .requiredOption('--name <n>', 'hook name')
    .requiredOption('--url <url>', 'delivery URL')
    .option('--events <list>', 'comma-separated event names', parseList)
    .option('--chat <id>', 'scope to a specific chat')
    .option('--params <json>', 'raw JSON body')
    .action(
      runCommand(async ({ client, mode, cmd, recordResult }) => {
        const raw = cmd.opts<{
          name: string
          url: string
          events?: string[]
          chat?: string
          params?: string
        }>()
        const sugar: Record<string, unknown> = { name: raw.name, url: raw.url }
        if (raw.events) sugar.events = raw.events
        if (raw.chat) sugar.chatId = raw.chat
        const body = mergeParams(sugar, parseParamsJson(raw.params))
        const res = await client.hooks.create(
          body as unknown as Parameters<typeof client.hooks.create>[0],
        )
        recordResult(res)
        if (mode === 'json') return emitSuccess(res)
        const detail = res as unknown as { id?: string }
        process.stdout.write(`${bullet(`hook created → ${color.accent(detail.id ?? '?')}`)}\n`)
      }),
    )

  return cmd
}

function parseList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}
