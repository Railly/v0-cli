import { Command } from 'commander'
import { section, table } from '../lib/output/human.ts'
import { emitSuccess } from '../lib/output/json.ts'
import { runCommand } from '../lib/runner.ts'
import { color } from '../lib/ui/color.ts'

export function msgCommand(): Command {
  const cmd = new Command('msg').description('Read chat messages (list, show). Send lands in V2.')

  cmd
    .command('list <chat-id>')
    .description('List messages')
    .option('--limit <n>', 'max results', '20')
    .option('--cursor <c>', 'pagination cursor')
    .action(
      runCommand(async ({ client, mode, cmd }) => {
        const [chatId] = cmd.args as [string]
        const raw = cmd.opts<{ limit?: string; cursor?: string }>()
        const params: { chatId: string; limit?: number; cursor?: string } = { chatId }
        if (raw.limit) params.limit = Number(raw.limit)
        if (raw.cursor) params.cursor = raw.cursor
        const res = await client.chats.findMessages(params)
        if (mode === 'json') return emitSuccess(res)
        const rows = ((res as { data?: Array<Record<string, unknown>> }).data ?? []) as Array<
          Record<string, unknown>
        >
        process.stdout.write(`${section(`messages of ${chatId} (${rows.length})`)}\n`)
        process.stdout.write(
          `${table(rows, [
            { key: 'id', header: 'id' },
            { key: 'role', header: 'role' },
            { key: 'createdAt', header: 'created' },
          ])}\n`,
        )
      }),
    )

  cmd
    .command('show <chat-id> <message-id>')
    .description('Show one message')
    .action(
      runCommand(async ({ client, mode, cmd }) => {
        const [chatId, messageId] = cmd.args as [string, string]
        const res = await client.chats.getMessage({ chatId, messageId })
        if (mode === 'json') return emitSuccess(res)
        process.stdout.write(`${section(`message ${messageId}`)}\n`)
        process.stdout.write(`${color.dim(JSON.stringify(res, null, 2))}\n`)
      }),
    )

  return cmd
}
