import { readFile } from 'node:fs/promises'
import { Command } from 'commander'
import { bullet, section, table } from '../lib/output/human.ts'
import { emitSuccess } from '../lib/output/json.ts'
import { runCommand } from '../lib/runner.ts'
import { color } from '../lib/ui/color.ts'
import { mergeParams, parseParamsJson } from '../lib/validation/params.ts'

export function versionCommand(): Command {
  const cmd = new Command('version').description('v0 chat versions (list, show, update).')

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

  cmd
    .command('update <chat-id> <version-id>')
    .description('Replace files in a version (T1). Pass --file <name>=<path> repeatably.')
    .option('--file <entry...>', 'name=local-path pair (repeatable)', collect, [] as string[])
    .option('--params <json>', 'raw JSON body')
    .action(
      runCommand(async ({ client, mode, cmd, recordResult }) => {
        const [chatId, versionId] = cmd.args as [string, string]
        const raw = cmd.opts<{ file?: string[]; params?: string }>()
        const files: Array<{ name: string; content: string }> = []
        for (const entry of raw.file ?? []) {
          const [name, ...rest] = entry.split('=')
          if (!name || !rest.length) continue
          const filePath = rest.join('=')
          const content = await readFile(filePath, 'utf8')
          files.push({ name, content })
        }
        const sugar: Record<string, unknown> = {}
        if (files.length) sugar.files = files
        const body = mergeParams(sugar, parseParamsJson(raw.params))
        const res = await client.chats.updateVersion({
          chatId,
          versionId,
          ...(body as { files: Array<{ name: string; content: string }> }),
        })
        recordResult(res)
        if (mode === 'json') return emitSuccess(res)
        process.stdout.write(`${bullet(`updated version ${color.accent(versionId)}`)}\n`)
      }),
    )

  return cmd
}

function collect(value: string, prev: string[]): string[] {
  return [...prev, value]
}
