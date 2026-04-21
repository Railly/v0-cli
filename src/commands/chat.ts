import { Command } from 'commander'
import { section, table } from '../lib/output/human.ts'
import { emitSuccess } from '../lib/output/json.ts'
import { runCommand } from '../lib/runner.ts'
import { color } from '../lib/ui/color.ts'

export function chatCommand(): Command {
  const cmd = new Command('chat').description(
    'Read v0 chats (list, show). Create/init/delete land in V2.',
  )

  cmd
    .command('list')
    .description('List chats')
    .option('--limit <n>', 'max results', '20')
    .option('--offset <n>', 'pagination offset')
    .option('--favorite', 'only favorites')
    .option('--vercel-project <id>', 'filter by linked Vercel project id')
    .option('--branch <name>', 'filter by branch')
    .action(
      runCommand(async ({ client, mode, cmd }) => {
        const raw = cmd.opts<{
          limit?: string
          offset?: string
          favorite?: boolean
          vercelProject?: string
          branch?: string
        }>()
        const params: Record<string, unknown> = {}
        if (raw.limit) params.limit = Number(raw.limit)
        if (raw.offset) params.offset = Number(raw.offset)
        if (raw.favorite) params.isFavorite = true
        if (raw.vercelProject) params.vercelProjectId = raw.vercelProject
        if (raw.branch) params.branch = raw.branch
        const res = await client.chats.find(params)
        if (mode === 'json') return emitSuccess(res)
        const rows = ((res as { data?: Array<Record<string, unknown>> }).data ?? []) as Array<
          Record<string, unknown>
        >
        process.stdout.write(`${section(`chats (${rows.length})`)}\n`)
        process.stdout.write(
          `${table(rows, [
            { key: 'id', header: 'id' },
            { key: 'name', header: 'name' },
            { key: 'privacy', header: 'privacy' },
            { key: 'updatedAt', header: 'updated' },
          ])}\n`,
        )
      }),
    )

  cmd
    .command('show <chat-id>')
    .description('Show one chat (full detail)')
    .action(
      runCommand(async ({ client, mode, cmd }) => {
        const [chatId] = cmd.args as [string]
        const res = await client.chats.getById({ chatId })
        if (mode === 'json') return emitSuccess(res)
        process.stdout.write(`${section(`chat ${chatId}`)}\n`)
        process.stdout.write(`${color.dim(JSON.stringify(res, null, 2))}\n`)
      }),
    )

  return cmd
}
