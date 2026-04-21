import { Command } from 'commander'
import { section, table } from '../lib/output/human.ts'
import { emitSuccess } from '../lib/output/json.ts'
import { runCommand } from '../lib/runner.ts'
import { color } from '../lib/ui/color.ts'

export function mcpServerCommand(): Command {
  const cmd = new Command('mcp-server').description(
    'Read v0-registered MCP servers. Mutations land in V3.',
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

  return cmd
}
