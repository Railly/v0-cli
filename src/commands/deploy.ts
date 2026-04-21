import { Command } from 'commander'
import { section, table } from '../lib/output/human.ts'
import { emitSuccess } from '../lib/output/json.ts'
import { runCommand } from '../lib/runner.ts'
import { color } from '../lib/ui/color.ts'

export function deployCommand(): Command {
  const cmd = new Command('deploy').description(
    'Read deployments (list, show, logs, errors). Create/delete land in V3.',
  )

  cmd
    .command('list')
    .description('Find deployments by projectId + chatId + versionId')
    .requiredOption('--project <id>', 'project id')
    .requiredOption('--chat <id>', 'chat id')
    .requiredOption('--version <id>', 'version id')
    .action(
      runCommand(async ({ client, mode, cmd }) => {
        const raw = cmd.opts<{ project: string; chat: string; version: string }>()
        const res = await client.deployments.find({
          projectId: raw.project,
          chatId: raw.chat,
          versionId: raw.version,
        })
        if (mode === 'json') return emitSuccess(res)
        const rows = (res as unknown as { data?: Array<Record<string, unknown>> }).data ?? []
        process.stdout.write(`${section(`deployments (${rows.length})`)}\n`)
        process.stdout.write(
          `${table(rows, [
            { key: 'id', header: 'id' },
            { key: 'status', header: 'status' },
            { key: 'url', header: 'url' },
            { key: 'createdAt', header: 'created' },
          ])}\n`,
        )
      }),
    )

  cmd
    .command('show <deployment-id>')
    .description('Show one deployment')
    .action(
      runCommand(async ({ client, mode, cmd }) => {
        const [deploymentId] = cmd.args as [string]
        const res = await client.deployments.getById({ deploymentId })
        if (mode === 'json') return emitSuccess(res)
        process.stdout.write(`${section(`deployment ${deploymentId}`)}\n`)
        process.stdout.write(`${color.dim(JSON.stringify(res, null, 2))}\n`)
      }),
    )

  cmd
    .command('logs <deployment-id>')
    .description('Logs for a deployment')
    .option('--since <unix-ms>', 'only logs newer than this timestamp')
    .action(
      runCommand(async ({ client, mode, cmd }) => {
        const [deploymentId] = cmd.args as [string]
        const raw = cmd.opts<{ since?: string }>()
        const params: { deploymentId: string; since?: number } = { deploymentId }
        if (raw.since) params.since = Number(raw.since)
        const res = await client.deployments.findLogs(params)
        if (mode === 'json') return emitSuccess(res)
        process.stdout.write(`${section(`logs ${deploymentId}`)}\n`)
        process.stdout.write(`${color.dim(JSON.stringify(res, null, 2))}\n`)
      }),
    )

  cmd
    .command('errors <deployment-id>')
    .description('Errors for a deployment')
    .action(
      runCommand(async ({ client, mode, cmd }) => {
        const [deploymentId] = cmd.args as [string]
        const res = await client.deployments.findErrors({ deploymentId })
        if (mode === 'json') return emitSuccess(res)
        process.stdout.write(`${section(`errors ${deploymentId}`)}\n`)
        process.stdout.write(`${color.dim(JSON.stringify(res, null, 2))}\n`)
      }),
    )

  return cmd
}
