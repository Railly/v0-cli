import { Command } from 'commander'
import { readSseStream } from '../lib/api/streaming.ts'
import { attachBackgroundSubcommands } from './chat-background.ts'
import { bullet, section, table } from '../lib/output/human.ts'
import { emitSuccess } from '../lib/output/json.ts'
import { emitNdjsonEvent } from '../lib/output/ndjson.ts'
import { runCommand } from '../lib/runner.ts'
import { renderHumanStream } from '../lib/streaming/human-render.ts'
import { confirmOrAbort } from '../lib/trust/confirm.ts'
import { color } from '../lib/ui/color.ts'
import { mergeParams, parseParamsJson, validateBody } from '../lib/validation/params.ts'
import { buildFilesInitBody, readSource } from '../lib/workflows/init-from-local.ts'

function collect(value: string, prev: string[]): string[] {
  return [...prev, value]
}

export function chatCommand(): Command {
  const cmd = new Command('chat').description(
    'Manage v0 chats (list, show, create, init, update, fork, favorite, delete).',
  )

  cmd
    .command('list')
    .description('List chats')
    .option('--limit <n>', 'max results', '20')
    .option('--offset <n>', 'pagination offset')
    .option('--favorite', 'only favorites')
    .option('--vercel-project <id>', 'filter by linked Vercel project id')
    .option('--branch <name>', 'filter by branch')
    .action(
      runCommand(async ({ client, mode, cmd }) => {
        const raw = cmd.opts<{
          limit?: string
          offset?: string
          favorite?: boolean
          vercelProject?: string
          branch?: string
        }>()
        const params: Record<string, unknown> = {}
        if (raw.limit) params.limit = Number(raw.limit)
        if (raw.offset) params.offset = Number(raw.offset)
        if (raw.favorite) params.isFavorite = true
        if (raw.vercelProject) params.vercelProjectId = raw.vercelProject
        if (raw.branch) params.branch = raw.branch
        const res = await client.chats.find(params)
        if (mode === 'json') return emitSuccess(res)
        const rows = ((res as unknown as { data?: Array<Record<string, unknown>> }).data ??
          []) as Array<Record<string, unknown>>
        process.stdout.write(`${section(`chats (${rows.length})`)}\n`)
        process.stdout.write(
          `${table(rows, [
            { key: 'id', header: 'id' },
            { key: 'name', header: 'name' },
            { key: 'privacy', header: 'privacy' },
            { key: 'updatedAt', header: 'updated' },
          ])}\n`,
        )
      }),
    )

  cmd
    .command('show <chat-id>')
    .description('Show one chat (full detail)')
    .action(
      runCommand(async ({ client, mode, cmd }) => {
        const [chatId] = cmd.args as [string]
        const res = await client.chats.getById({ chatId })
        if (mode === 'json') return emitSuccess(res)
        process.stdout.write(`${section(`chat ${chatId}`)}\n`)
        process.stdout.write(`${color.dim(JSON.stringify(res, null, 2))}\n`)
      }),
    )

  cmd
    .command('create [message...]')
    .description(
      'Create a new chat from a prompt (T1). Human mode streams by default; --json blocks unless --stream.',
    )
    .option('--message <msg>', 'user prompt (alternative to positional)')
    .option('--system <msg>', 'system prompt')
    .option('--project <id>', 'project id')
    .option('--privacy <p>', 'public|private|team|team-edit|unlisted')
    .option('--model <id>', 'modelConfiguration.modelId (default: v0-auto)')
    .option('--thinking', 'enable modelConfiguration.thinking')
    .option('--stream', 'force SSE streaming (human render or --json NDJSON)')
    .option('--no-stream', 'disable streaming, block until the chat returns')
    .option(
      '--background',
      'spawn a detached worker, return chat_id immediately; watch/wait later',
    )
    .option('--params <json>', 'raw JSON body, merged with sugar flags (--params wins on conflict)')
    .action(
      runCommand(async ({ client, mode, profile, opts, cmd, recordResult }) => {
        const args = cmd.args as string[]
        const raw = cmd.opts<{
          message?: string
          system?: string
          project?: string
          privacy?: string
          model?: string
          thinking?: boolean
          stream?: boolean
          background?: boolean
          params?: string
        }>()

        const positional = args.join(' ').trim()
        const message = raw.message ?? (positional || undefined)
        const sugar: Record<string, unknown> = {}
        if (message) sugar.message = message
        if (raw.system) sugar.system = raw.system
        if (raw.project) sugar.projectId = raw.project
        if (raw.privacy) sugar.chatPrivacy = raw.privacy
        if (raw.model || raw.thinking) {
          sugar.modelConfiguration = {
            ...(raw.model !== undefined
              ? { modelId: raw.model }
              : profile.defaults?.model_id
                ? { modelId: profile.defaults.model_id }
                : {}),
            ...(raw.thinking ? { thinking: true } : {}),
          }
        }

        const body = mergeParams(sugar, parseParamsJson(raw.params), (key) => {
          if (mode === 'human') {
            process.stderr.write(`${color.warn('[merge]')} --params overrode sugar flag "${key}"\n`)
          }
        })

        await validateBody({ operationId: 'chats.create', body })

        if (raw.background) {
          const { detachBackground } = await import('../lib/background/spawn.ts')
          const { resolveApiKey } = await import('../lib/config/profiles.ts')
          const apiKey = resolveApiKey(profile, opts.apiKey)
          if (!apiKey) throw new Error('V0_API_KEY missing — cannot spawn background worker')
          const detached = await detachBackground({
            prompt: message ?? '',
            body: body as Record<string, unknown>,
            apiKey,
            ...(opts.baseUrl !== undefined ? { baseUrl: opts.baseUrl } : {}),
            profile: profile ? undefined : undefined,
          })
          recordResult({
            background: true,
            chatId: detached.chatId,
            pid: detached.pid,
            status: detached.status,
          })
          if (mode === 'json') {
            return emitSuccess({
              chat_id: detached.chatId,
              status: detached.status,
              pid: detached.pid,
              started_at: detached.startedAt,
              stream_log: detached.streamLog,
            })
          }
          process.stdout.write(`${section('chat queued (background)')}\n`)
          process.stdout.write(`  ${color.accent('chat   ')} ${detached.chatId}\n`)
          process.stdout.write(`  ${color.accent('pid    ')} ${detached.pid}\n`)
          process.stdout.write(`  ${color.accent('status ')} ${color.warn('running')}\n`)
          process.stdout.write(
            `\n  ${color.dim('watch:')}  v0 chat watch ${detached.chatId}\n`,
          )
          process.stdout.write(
            `  ${color.dim('wait:')}   v0 chat wait ${detached.chatId}\n`,
          )
          return
        }

        // Default: stream in human mode, block in json mode. --stream/--no-stream overrides.
        const wantStream = raw.stream === true || (raw.stream !== false && mode === 'human')

        if (wantStream) {
          const stream = (await client.chats.create({
            ...(body as unknown as Parameters<typeof client.chats.create>[0]),
            responseMode: 'experimental_stream',
          })) as unknown as ReadableStream<Uint8Array>

          if (mode === 'human') {
            const result = await renderHumanStream(readSseStream(stream), { prompt: message })
            recordResult({
              streamed: true,
              chatId: result.chatId,
              versionId: result.versionId,
              files: result.files.length,
              webUrl: result.webUrl,
            })
            if (result.error) process.exit(1)
            return
          }

          // --json --stream: emit each frame as NDJSON on stdout
          let lastFrame: unknown = null
          for await (const frame of readSseStream(stream)) {
            lastFrame = frame.data
            emitNdjsonEvent(frame.event, frame.data)
          }
          recordResult({ streamed: true, lastFrame })
          return
        }

        const res = await client.chats.create(
          body as unknown as Parameters<typeof client.chats.create>[0],
        )
        recordResult(res)
        if (mode === 'json') return emitSuccess(res)
        const detail = res as unknown as {
          id?: string
          latestVersion?: { id?: string; files?: unknown[] }
        }
        process.stdout.write(`${section('chat created')}\n`)
        process.stdout.write(`  ${color.accent('chat')}    ${detail.id ?? '—'}\n`)
        process.stdout.write(`  ${color.accent('version')} ${detail.latestVersion?.id ?? '—'}\n`)
        if (detail.latestVersion?.files?.length) {
          process.stdout.write(
            `  ${color.accent('files')}   ${detail.latestVersion.files.length}\n`,
          )
        }
      }),
    )

  cmd
    .command('init')
    .description(
      'Init chat from existing source (files|repo|registry|zip|template). Zero token cost.',
    )
    .option('--type <t>', 'files|repo|registry|zip|template', 'files')
    .option(
      '--source <path-or-url>',
      'local dir/file (files), url (repo|registry|zip), or templateId',
    )
    .option('--project <id>', 'project id')
    .option('--name <n>', 'chat name')
    .option('--privacy <p>', 'public|private|team|team-edit|unlisted')
    .option('--lock-all', 'lock all files to prevent AI overwrite')
    .option('--branch <name>', 'git branch (repo type only)')
    .option('--params <json>', 'raw JSON body, merged with sugar flags')
    .action(
      runCommand(async ({ client, mode, cmd, recordResult }) => {
        const raw = cmd.opts<{
          type?: string
          source?: string
          project?: string
          name?: string
          privacy?: string
          lockAll?: boolean
          branch?: string
          params?: string
        }>()

        const type = (raw.type ?? 'files') as 'files' | 'repo' | 'registry' | 'zip' | 'template'
        let sugar: Record<string, unknown> = {}

        if (type === 'files') {
          if (!raw.source && !raw.params) {
            throw new Error('chat init --type files requires --source <path> or --params')
          }
          if (raw.source) {
            const files = await readSource({
              root: raw.source,
              ...(raw.lockAll !== undefined ? { lockAll: raw.lockAll } : {}),
            })
            sugar = buildFilesInitBody({
              files,
              ...(raw.name !== undefined ? { name: raw.name } : {}),
              ...(raw.project !== undefined ? { projectId: raw.project } : {}),
              ...(raw.privacy !== undefined ? { chatPrivacy: raw.privacy } : {}),
            })
          }
        } else if (type === 'repo') {
          if (!raw.source && !raw.params)
            throw new Error('chat init --type repo requires --source <git-url>')
          if (raw.source) {
            sugar = {
              type: 'repo',
              repo: {
                url: raw.source,
                ...(raw.branch ? { branch: raw.branch } : {}),
              },
              ...(raw.lockAll ? { lockAllFiles: true } : {}),
            }
          }
        } else if (type === 'registry') {
          if (!raw.source && !raw.params)
            throw new Error('chat init --type registry requires --source <url>')
          if (raw.source) {
            sugar = {
              type: 'registry',
              registry: { url: raw.source },
              ...(raw.lockAll ? { lockAllFiles: true } : {}),
            }
          }
        } else if (type === 'zip') {
          if (!raw.source && !raw.params)
            throw new Error('chat init --type zip requires --source <url>')
          if (raw.source) {
            sugar = {
              type: 'zip',
              zip: { url: raw.source },
              ...(raw.lockAll ? { lockAllFiles: true } : {}),
            }
          }
        } else if (type === 'template') {
          if (!raw.source && !raw.params)
            throw new Error('chat init --type template requires --source <templateId>')
          if (raw.source) sugar = { type: 'template', templateId: raw.source }
        }

        if (raw.name && !sugar.name) sugar.name = raw.name
        if (raw.project && !sugar.projectId) sugar.projectId = raw.project
        if (raw.privacy && !sugar.chatPrivacy) sugar.chatPrivacy = raw.privacy

        const body = mergeParams(sugar, parseParamsJson(raw.params), (key) => {
          if (mode === 'human') {
            process.stderr.write(`${color.warn('[merge]')} --params overrode sugar flag "${key}"\n`)
          }
        })

        await validateBody({ operationId: 'chats.init', body })

        const res = await client.chats.init(
          body as unknown as Parameters<typeof client.chats.init>[0],
        )
        recordResult(res)
        if (mode === 'json') return emitSuccess(res)
        const detail = res as unknown as {
          id?: string
          latestVersion?: { id?: string; files?: unknown[] }
        }
        process.stdout.write(`${section('chat initialized')}\n`)
        process.stdout.write(`  ${color.accent('chat')}    ${detail.id ?? '—'}\n`)
        process.stdout.write(`  ${color.accent('version')} ${detail.latestVersion?.id ?? '—'}\n`)
        if (Array.isArray((sugar as { files?: unknown[] }).files)) {
          process.stdout.write(
            `  ${color.accent('source')}  ${(sugar as { files: unknown[] }).files.length} local file(s)\n`,
          )
        }
      }),
    )

  cmd
    .command('update <chat-id>')
    .description('Update chat name / privacy / metadata')
    .option('--name <n>', 'new name')
    .option('--privacy <p>', 'public|private|team|team-edit|unlisted')
    .option('--meta <k=v...>', 'key=value metadata (repeatable)', collect, [] as string[])
    .option('--params <json>', 'raw JSON body')
    .action(
      runCommand(async ({ client, mode, cmd, recordResult }) => {
        const [chatId] = cmd.args as [string]
        const raw = cmd.opts<{
          name?: string
          privacy?: string
          meta?: string[]
          params?: string
        }>()
        const sugar: Record<string, unknown> = {}
        if (raw.name) sugar.name = raw.name
        if (raw.privacy) sugar.privacy = raw.privacy
        if (raw.meta?.length) {
          const meta: Record<string, string> = {}
          for (const entry of raw.meta) {
            const [k, ...rest] = entry.split('=')
            if (k && rest.length) meta[k] = rest.join('=')
          }
          sugar.metadata = meta
        }
        const body = mergeParams(sugar, parseParamsJson(raw.params))
        const res = await client.chats.update({ chatId, ...(body as Record<string, unknown>) })
        recordResult(res)
        if (mode === 'json') return emitSuccess(res)
        process.stdout.write(`${bullet(`updated ${color.accent(chatId)}`)}\n`)
      }),
    )

  cmd
    .command('favorite <chat-id>')
    .description('Favorite or unfavorite a chat (--off to remove)')
    .option('--off', 'set isFavorite=false')
    .action(
      runCommand(async ({ client, mode, cmd, recordResult }) => {
        const [chatId] = cmd.args as [string]
        const raw = cmd.opts<{ off?: boolean }>()
        const res = await client.chats.favorite({ chatId, isFavorite: !raw.off })
        recordResult(res)
        if (mode === 'json') return emitSuccess(res)
        process.stdout.write(`${bullet(`${chatId} isFavorite=${!raw.off}`)}\n`)
      }),
    )

  cmd
    .command('fork <chat-id>')
    .description('Fork a chat version into a new chat')
    .option('--version <id>', 'source version id')
    .option('--privacy <p>', 'public|private|team|team-edit|unlisted')
    .action(
      runCommand(async ({ client, mode, cmd, recordResult }) => {
        const [chatId] = cmd.args as [string]
        const raw = cmd.opts<{ version?: string; privacy?: string }>()
        const body: Record<string, unknown> = { chatId }
        if (raw.version) body.versionId = raw.version
        if (raw.privacy) body.privacy = raw.privacy
        const res = await client.chats.fork(
          body as unknown as Parameters<typeof client.chats.fork>[0],
        )
        recordResult(res)
        if (mode === 'json') return emitSuccess(res)
        const detail = res as unknown as { id?: string }
        process.stdout.write(`${bullet(`forked → ${color.accent(detail.id ?? '?')}`)}\n`)
      }),
    )

  cmd
    .command('delete <chat-id>')
    .description('Delete a chat (T2 — interactive confirm in TTY, --yes for agents).')
    .action(
      runCommand(async ({ client, mode, opts, cmd, recordResult }) => {
        const [chatId] = cmd.args as [string]
        await confirmOrAbort({
          title: 'Delete chat',
          preview: { chat: chatId },
          question: `Really delete chat ${chatId}?`,
          yes: !!opts.yes,
          mode,
        })
        const res = await client.chats.delete({ chatId })
        recordResult(res)
        if (mode === 'json') return emitSuccess(res)
        process.stdout.write(`${bullet(`deleted ${color.accent(chatId)}`)}\n`)
      }),
    )

  attachBackgroundSubcommands(cmd)

  return cmd
}
