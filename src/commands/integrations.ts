import { Command } from 'commander'
import { section, table } from '../lib/output/human.ts'
import { emitSuccess } from '../lib/output/json.ts'
import { runCommand } from '../lib/runner.ts'

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

  return cmd
}
