import { Command } from 'commander'
import { bullet, section, table } from '../lib/output/human.ts'
import { emitSuccess } from '../lib/output/json.ts'
import { runCommand } from '../lib/runner.ts'
import { color } from '../lib/ui/color.ts'
import { mergeParams, parseParamsJson } from '../lib/validation/params.ts'

export function projectCommand(): Command {
  const cmd = new Command('project').description(
    'Manage v0 projects (list, show, show-by-chat, create, update, assign).',
  )

  cmd
    .command('list')
    .description('List projects')
    .action(
      runCommand(async ({ client, mode }) => {
        const res = await client.projects.find()
        if (mode === 'json') return emitSuccess(res)
        const rows = ((res as unknown as { data?: Array<Record<string, unknown>> }).data ??
          []) as Array<Record<string, unknown>>
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

  cmd
    .command('create <name>')
    .description('Create a new project (T1)')
    .option('--description <d>', 'description')
    .option('--icon <i>', 'icon id')
    .option('--instructions <i>', 'system instructions for all chats in this project')
    .option('--vercel-project <id>', 'link to existing Vercel project')
    .option('--privacy <p>', 'private|team (default: private)')
    .option('--params <json>', 'raw JSON body')
    .action(
      runCommand(async ({ client, mode, cmd, recordResult }) => {
        const [name] = cmd.args as [string]
        const raw = cmd.opts<{
          description?: string
          icon?: string
          instructions?: string
          vercelProject?: string
          privacy?: string
          params?: string
        }>()
        const sugar: Record<string, unknown> = { name }
        if (raw.description) sugar.description = raw.description
        if (raw.icon) sugar.icon = raw.icon
        if (raw.instructions) sugar.instructions = raw.instructions
        if (raw.vercelProject) sugar.vercelProjectId = raw.vercelProject
        if (raw.privacy) sugar.privacy = raw.privacy
        const body = mergeParams(sugar, parseParamsJson(raw.params))
        const res = await client.projects.create(
          body as unknown as Parameters<typeof client.projects.create>[0],
        )
        recordResult(res)
        if (mode === 'json') return emitSuccess(res)
        const detail = res as unknown as { id?: string }
        process.stdout.write(`${bullet(`project created → ${color.accent(detail.id ?? '?')}`)}\n`)
      }),
    )

  cmd
    .command('update <project-id>')
    .description('Update project name / description / instructions / privacy (T1)')
    .option('--name <n>', 'new name')
    .option('--description <d>', 'new description')
    .option('--instructions <i>', 'new system instructions')
    .option('--privacy <p>', 'private|team')
    .option('--params <json>', 'raw JSON body')
    .action(
      runCommand(async ({ client, mode, cmd, recordResult }) => {
        const [projectId] = cmd.args as [string]
        const raw = cmd.opts<{
          name?: string
          description?: string
          instructions?: string
          privacy?: string
          params?: string
        }>()
        const sugar: Record<string, unknown> = {}
        if (raw.name) sugar.name = raw.name
        if (raw.description) sugar.description = raw.description
        if (raw.instructions) sugar.instructions = raw.instructions
        if (raw.privacy) sugar.privacy = raw.privacy
        const body = mergeParams(sugar, parseParamsJson(raw.params))
        const res = await client.projects.update({
          projectId,
          ...(body as Record<string, unknown>),
        })
        recordResult(res)
        if (mode === 'json') return emitSuccess(res)
        process.stdout.write(`${bullet(`updated project ${color.accent(projectId)}`)}\n`)
      }),
    )

  cmd
    .command('assign <project-id> <chat-id>')
    .description('Attach an existing chat to this project (T1)')
    .action(
      runCommand(async ({ client, mode, cmd, recordResult }) => {
        const [projectId, chatId] = cmd.args as [string, string]
        const res = await client.projects.assign({ projectId, chatId })
        recordResult(res)
        if (mode === 'json') return emitSuccess(res)
        process.stdout.write(
          `${bullet(`assigned chat ${color.accent(chatId)} → project ${color.accent(projectId)}`)}\n`,
        )
      }),
    )

  return cmd
}
