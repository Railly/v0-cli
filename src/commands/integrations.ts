import { Command } from 'commander'
import { bullet, section, table } from '../lib/output/human.ts'
import { emitSuccess } from '../lib/output/json.ts'
import { runCommand } from '../lib/runner.ts'
import { color } from '../lib/ui/color.ts'

export function integrationsCommand(): Command {
  const cmd = new Command('integrations').description('Third-party integrations (Vercel)')

  const vercel = cmd.command('vercel').description('Vercel-linked projects')
  vercel
    .command('list')
    .description('List Vercel projects linked to this v0 workspace')
    .action(
      runCommand(async ({ client, mode }) => {
        const res = await client.integrations.vercel.projects.find()
        if (mode === 'json') return emitSuccess(res)
        const rows = (res as unknown as { data?: Array<Record<string, unknown>> }).data ?? []
        process.stdout.write(`${section(`vercel projects (${rows.length})`)}\n`)
        process.stdout.write(
          `${table(rows, [
            { key: 'id', header: 'id' },
            { key: 'name', header: 'name' },
          ])}\n`,
        )
      }),
    )

  vercel
    .command('link')
    .description('Link a Vercel project to this v0 workspace (T1)')
    .requiredOption('--vercel-project <id>', 'Vercel project id')
    .option('--name <n>', 'display name')
    .action(
      runCommand(async ({ client, mode, cmd, recordResult }) => {
        const raw = cmd.opts<{ vercelProject: string; name?: string }>()
        const params = {
          projectId: raw.vercelProject,
          ...(raw.name ? { name: raw.name } : {}),
        } as Parameters<typeof client.integrations.vercel.projects.create>[0]
        const res = await client.integrations.vercel.projects.create(params)
        recordResult(res)
        if (mode === 'json') return emitSuccess(res)
        const detail = res as unknown as { id?: string }
        process.stdout.write(
          `${bullet(`linked Vercel project → ${color.accent(detail.id ?? '?')}`)}\n`,
        )
      }),
    )

  return cmd
}
