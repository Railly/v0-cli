import { Command } from 'commander'
import { section, table } from '../lib/output/human.ts'
import { emitSuccess } from '../lib/output/json.ts'
import { runCommand } from '../lib/runner.ts'
import { color } from '../lib/ui/color.ts'

export function versionCommand(): Command {
  const cmd = new Command('version').description(
    'Read v0 chat versions (list, show). Downloads land in V2.',
  )

  cmd
    .command('list <chat-id>')
    .description('List versions for a chat')
    .option('--limit <n>', 'max results', '20')
    .option('--cursor <c>', 'pagination cursor')
    .action(
      runCommand(async ({ client, mode, cmd }) => {
        const [chatId] = cmd.args as [string]
        const raw = cmd.opts<{ limit?: string; cursor?: string }>()
        const params: { chatId: string; limit?: number; cursor?: string } = { chatId }
        if (raw.limit) params.limit = Number(raw.limit)
        if (raw.cursor) params.cursor = raw.cursor
        const res = await client.chats.findVersions(params)
        if (mode === 'json') return emitSuccess(res)
        const rows = ((res as { data?: Array<Record<string, unknown>> }).data ?? []) as Array<
          Record<string, unknown>
        >
        process.stdout.write(`${section(`versions of ${chatId} (${rows.length})`)}\n`)
        process.stdout.write(
          `${table(rows, [
            { key: 'id', header: 'id' },
            { key: 'createdAt', header: 'created' },
          ])}\n`,
        )
      }),
    )

  cmd
    .command('show <chat-id> <version-id>')
    .description('Show one version')
    .option('--include-default-files', 'include scaffolding files')
    .action(
      runCommand(async ({ client, mode, cmd }) => {
        const [chatId, versionId] = cmd.args as [string, string]
        const raw = cmd.opts<{ includeDefaultFiles?: boolean }>()
        const params: { chatId: string; versionId: string; includeDefaultFiles?: boolean } = {
          chatId,
          versionId,
        }
        if (raw.includeDefaultFiles) params.includeDefaultFiles = true
        const res = await client.chats.getVersion(params)
        if (mode === 'json') return emitSuccess(res)
        process.stdout.write(`${section(`version ${versionId}`)}\n`)
        process.stdout.write(`${color.dim(JSON.stringify(res, null, 2))}\n`)
      }),
    )

  return cmd
}
