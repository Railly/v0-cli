import { Command } from 'commander'
import { bullet, section, table } from '../lib/output/human.ts'
import { emitSuccess } from '../lib/output/json.ts'
import { runCommand } from '../lib/runner.ts'
import { color } from '../lib/ui/color.ts'
import { mergeParams, parseParamsJson } from '../lib/validation/params.ts'

export function mcpServerCommand(): Command {
  const cmd = new Command('mcp-server').description(
    'v0-registered MCP servers (list, show, create).',
  )

  cmd
    .command('list')
    .description('List MCP servers')
    .action(
      runCommand(async ({ client, mode }) => {
        const res = await client.mcpServers.find()
        if (mode === 'json') return emitSuccess(res)
        const rows = ((res as { data?: Array<Record<string, unknown>> }).data ?? []) as Array<
          Record<string, unknown>
        >
        process.stdout.write(`${section(`mcp servers (${rows.length})`)}\n`)
        process.stdout.write(
          `${table(rows, [
            { key: 'id', header: 'id' },
            { key: 'name', header: 'name' },
            { key: 'url', header: 'url' },
            { key: 'enabled', header: 'enabled' },
          ])}\n`,
        )
      }),
    )

  cmd
    .command('show <mcp-server-id>')
    .description('Show one MCP server')
    .action(
      runCommand(async ({ client, mode, cmd }) => {
        const [mcpServerId] = cmd.args as [string]
        const res = await client.mcpServers.getById({ mcpServerId })
        if (mode === 'json') return emitSuccess(res)
        process.stdout.write(`${section(`mcp server ${mcpServerId}`)}\n`)
        process.stdout.write(`${color.dim(JSON.stringify(res, null, 2))}\n`)
      }),
    )

  cmd
    .command('create')
    .description('Register a new MCP server (T1)')
    .requiredOption('--name <n>', 'display name')
    .requiredOption('--url <url>', 'MCP server URL')
    .option('--description <d>', 'description')
    .option('--enabled', 'enabled by default', true)
    .option('--auth <json>', 'auth config as JSON')
    .option('--scope <s>', 'scope id')
    .option('--params <json>', 'raw JSON body')
    .action(
      runCommand(async ({ client, mode, cmd, recordResult }) => {
        const raw = cmd.opts<{
          name: string
          url: string
          description?: string
          enabled?: boolean
          auth?: string
          scope?: string
          params?: string
        }>()
        const sugar: Record<string, unknown> = { name: raw.name, url: raw.url }
        if (raw.description) sugar.description = raw.description
        if (raw.enabled !== undefined) sugar.enabled = raw.enabled
        if (raw.auth) sugar.auth = JSON.parse(raw.auth)
        if (raw.scope) sugar.scope = raw.scope
        const body = mergeParams(sugar, parseParamsJson(raw.params))
        const res = await client.mcpServers.create(
          body as unknown as Parameters<typeof client.mcpServers.create>[0],
        )
        recordResult(res)
        if (mode === 'json') return emitSuccess(res)
        const detail = res as unknown as { id?: string }
        process.stdout.write(
          `${bullet(`mcp server created → ${color.accent(detail.id ?? '?')}`)}\n`,
        )
      }),
    )

  return cmd
}
