import { Command } from 'commander'
import { readSseStream } from '../lib/api/streaming.ts'
import { bullet, section, table } from '../lib/output/human.ts'
import { emitSuccess } from '../lib/output/json.ts'
import { emitNdjsonEvent } from '../lib/output/ndjson.ts'
import { runCommand } from '../lib/runner.ts'
import { renderHumanStream } from '../lib/streaming/human-render.ts'
import { color } from '../lib/ui/color.ts'
import { mergeParams, parseParamsJson, validateBody } from '../lib/validation/params.ts'

export function msgCommand(): Command {
  const cmd = new Command('msg').description('Chat messages (list, show, send, resume, stop).')

  cmd
    .command('list <chat-id>')
    .description('List messages')
    .option('--limit <n>', 'max results', '20')
    .option('--cursor <c>', 'pagination cursor')
    .action(
      runCommand(async ({ client, mode, cmd }) => {
        const [chatId] = cmd.args as [string]
        const raw = cmd.opts<{ limit?: string; cursor?: string }>()
        const params: { chatId: string; limit?: number; cursor?: string } = { chatId }
        if (raw.limit) params.limit = Number(raw.limit)
        if (raw.cursor) params.cursor = raw.cursor
        const res = await client.chats.findMessages(params)
        if (mode === 'json') return emitSuccess(res)
        const rows = ((res as unknown as { data?: Array<Record<string, unknown>> }).data ??
          []) as Array<Record<string, unknown>>
        process.stdout.write(`${section(`messages of ${chatId} (${rows.length})`)}\n`)
        process.stdout.write(
          `${table(rows, [
            { key: 'id', header: 'id' },
            { key: 'role', header: 'role' },
            { key: 'createdAt', header: 'created' },
          ])}\n`,
        )
      }),
    )

  cmd
    .command('show <chat-id> <message-id>')
    .description('Show one message')
    .action(
      runCommand(async ({ client, mode, cmd }) => {
        const [chatId, messageId] = cmd.args as [string, string]
        const res = await client.chats.getMessage({ chatId, messageId })
        if (mode === 'json') return emitSuccess(res)
        process.stdout.write(`${section(`message ${messageId}`)}\n`)
        process.stdout.write(`${color.dim(JSON.stringify(res, null, 2))}\n`)
      }),
    )

  cmd
    .command('send <chat-id> [message...]')
    .description(
      'Send a follow-up message (T1). Human mode streams by default; --json blocks unless --stream.',
    )
    .option('--message <msg>', 'user prompt (alternative to positional)')
    .option('--system <msg>', 'system prompt')
    .option('--model <id>', 'modelConfiguration.modelId')
    .option('--thinking', 'enable modelConfiguration.thinking')
    .option('--stream', 'force SSE streaming (human render or --json NDJSON)')
    .option('--no-stream', 'disable streaming, block until the message returns')
    .option('--params <json>', 'raw JSON body, merged with sugar flags')
    .action(
      runCommand(async ({ client, mode, profile, cmd, recordResult }) => {
        const [chatId, ...rest] = cmd.args as string[]
        if (!chatId) throw new Error('chat id required')
        const raw = cmd.opts<{
          message?: string
          system?: string
          model?: string
          thinking?: boolean
          stream?: boolean
          params?: string
        }>()

        const positional = rest.join(' ').trim()
        const message = raw.message ?? (positional || undefined)
        const sugar: Record<string, unknown> = {}
        if (message) sugar.message = message
        if (raw.system) sugar.system = raw.system
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

        await validateBody({ operationId: 'chats.sendMessage', body })

        // Stream defaults: mirror chat create (human TTY always streams;
        // --json non-TTY streams NDJSON to sidestep the 60s HTTP timeout;
        // --json TTY blocks for `v0 … | jq` ergonomics). Override with
        // --stream / --no-stream.
        const wantStream =
          raw.stream === true ||
          (raw.stream !== false &&
            (mode === 'human' || (mode === 'json' && !process.stdout.isTTY)))

        if (wantStream) {
          const stream = (await client.chats.sendMessage({
            chatId,
            ...(body as Omit<Parameters<typeof client.chats.sendMessage>[0], 'chatId'>),
            responseMode: 'experimental_stream',
          })) as unknown as ReadableStream<Uint8Array>

          if (mode === 'human') {
            const result = await renderHumanStream(readSseStream(stream), {
              prompt: message,
              title: 'v0 msg send',
            })
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

          // --json streaming: emit each frame as NDJSON, then a terminal
          // {event:"envelope", data:{…}} line carrying the final chat
          // snapshot so agents can `jq 'select(.event=="envelope") | .data'`.
          let envelope: Record<string, unknown> | null = null
          for await (const frame of readSseStream(stream)) {
            emitNdjsonEvent(frame.event, frame.data)
            if (
              frame.event === 'message' &&
              frame.data &&
              typeof frame.data === 'object' &&
              (frame.data as Record<string, unknown>).object === 'chat'
            ) {
              envelope = frame.data as Record<string, unknown>
            }
          }
          if (envelope) emitNdjsonEvent('envelope', envelope)
          recordResult({ streamed: true, envelope })
          return
        }

        const res = await client.chats.sendMessage({
          chatId,
          ...(body as Omit<Parameters<typeof client.chats.sendMessage>[0], 'chatId'>),
        })
        recordResult(res)
        if (mode === 'json') return emitSuccess(res)
        const detail = res as unknown as { id?: string; role?: string }
        process.stdout.write(
          `${bullet(`sent → ${color.accent(detail.id ?? '?')} (${detail.role ?? '—'})`)}\n`,
        )
      }),
    )

  cmd
    .command('resume <chat-id> <message-id>')
    .description('Resume a stopped or in-progress message')
    .action(
      runCommand(async ({ client, mode, cmd, recordResult }) => {
        const [chatId, messageId] = cmd.args as [string, string]
        const res = await client.chats.resume({ chatId, messageId })
        recordResult(res)
        if (mode === 'json') return emitSuccess(res)
        process.stdout.write(`${bullet(`resumed ${color.accent(messageId)}`)}\n`)
      }),
    )

  cmd
    .command('stop <chat-id> <message-id>')
    .description('Stop message generation')
    .action(
      runCommand(async ({ client, mode, cmd, recordResult }) => {
        const [chatId, messageId] = cmd.args as [string, string]
        const res = await client.chats.stop({ chatId, messageId })
        recordResult(res)
        if (mode === 'json') return emitSuccess(res)
        process.stdout.write(`${bullet(`stopped ${color.accent(messageId)}`)}\n`)
      }),
    )

  return cmd
}
