import { Command } from 'commander'
import { section, table } from '../lib/output/human.ts'
import { emitSuccess } from '../lib/output/json.ts'
import { runCommand } from '../lib/runner.ts'
import { color } from '../lib/ui/color.ts'

export function projectCommand(): Command {
  const cmd = new Command('project').description(
    'Read v0 projects (list, show). Mutations come in V2.',
  )

  cmd
    .command('list')
    .description('List projects')
    .action(
      runCommand(async ({ client, mode }) => {
        const res = await client.projects.find()
        if (mode === 'json') return emitSuccess(res)
        const rows = ((res as { data?: Array<Record<string, unknown>> }).data ?? []) as Array<
          Record<string, unknown>
        >
        process.stdout.write(`${section(`projects (${rows.length})`)}\n`)
        process.stdout.write(
          `${table(rows, [
            { key: 'id', header: 'id' },
            { key: 'name', header: 'name' },
            { key: 'privacy', header: 'privacy' },
            { key: 'vercelProjectId', header: 'vercel' },
          ])}\n`,
        )
      }),
    )

  cmd
    .command('show <project-id>')
    .description('Show one project')
    .action(
      runCommand(async ({ client, mode, cmd }) => {
        const [projectId] = cmd.args as [string]
        const res = await client.projects.getById({ projectId })
        if (mode === 'json') return emitSuccess(res)
        process.stdout.write(`${section(`project ${projectId}`)}\n`)
        process.stdout.write(`${color.dim(JSON.stringify(res, null, 2))}\n`)
      }),
    )

  cmd
    .command('show-by-chat <chat-id>')
    .description('Reverse lookup: which project owns this chat')
    .action(
      runCommand(async ({ client, mode, cmd }) => {
        const [chatId] = cmd.args as [string]
        const res = await client.projects.getByChatId({ chatId })
        if (mode === 'json') return emitSuccess(res)
        process.stdout.write(`${section(`project for chat ${chatId}`)}\n`)
        process.stdout.write(`${color.dim(JSON.stringify(res, null, 2))}\n`)
      }),
    )

  return cmd
}
