import { createReadStream } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { Command } from 'commander'
import { extractPhases } from '../lib/streaming/frames.ts'
import { renderHumanStream } from '../lib/streaming/human-render.ts'
import {
  type PendingRecord,
  isProcessAlive,
  listPending,
  loadPending,
  streamLogPath,
} from '../lib/background/registry.ts'
import { bullet, section, table } from '../lib/output/human.ts'
import { emitSuccess } from '../lib/output/json.ts'
import { emitNdjsonEvent } from '../lib/output/ndjson.ts'
import { runCommand } from '../lib/runner.ts'
import { color } from '../lib/ui/color.ts'

async function* tailNdjson(
  path: string,
  opts: { follow: boolean; pollMs?: number; stopWhen?: () => Promise<boolean> },
): AsyncGenerator<{ event: string; data: unknown; raw: string }> {
  const pollMs = opts.pollMs ?? 400
  let offset = 0
  while (true) {
    let fileSize = 0
    try {
      fileSize = (await stat(path)).size
    } catch {
      if (!opts.follow) return
      await new Promise((r) => setTimeout(r, pollMs))
      continue
    }

    if (fileSize > offset) {
      const stream = createReadStream(path, { start: offset, end: fileSize - 1 })
      const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY })
      for await (const line of rl) {
        if (!line.trim()) continue
        try {
          const obj = JSON.parse(line) as { event: string; data: unknown }
          yield { event: obj.event, data: obj.data, raw: line }
        } catch {
          // skip malformed line
        }
      }
      offset = fileSize
    }

    if (!opts.follow) return
    if (opts.stopWhen && (await opts.stopWhen())) return
    await new Promise((r) => setTimeout(r, pollMs))
  }
}

function recordStatus(rec: PendingRecord): string {
  if (rec.status === 'done') return color.success('done')
  if (rec.status === 'failed') return color.error('failed')
  if (!isProcessAlive(rec.pid)) return color.warn('stalled')
  return color.warn('running')
}

export function attachBackgroundSubcommands(cmd: Command): void {
  cmd
    .command('pending')
    .description('List background chats (running, done, failed). T0.')
    .option('--clean', 'remove finished entries older than 1h')
    .action(
      runCommand(async ({ mode, cmd }) => {
        const raw = cmd.opts<{ clean?: boolean }>()
        if (raw.clean) {
          const { cleanPending } = await import('../lib/background/registry.ts')
          const n = await cleanPending()
          if (mode === 'json') return emitSuccess({ removed: n })
          process.stdout.write(`${color.dim(`removed ${n} finished entr${n === 1 ? 'y' : 'ies'}`)}\n`)
        }
        const rows = await listPending()
        if (mode === 'json') return emitSuccess(rows)
        if (!rows.length) {
          process.stdout.write(`${color.dim('(no background chats)')}\n`)
          return
        }
        process.stdout.write(`${section(`pending (${rows.length})`)}\n`)
        process.stdout.write(
          `${table(
            rows.map((r) => ({
              chat: r.chatId,
              status: recordStatus(r),
              files: r.result?.files ?? '—',
              started: r.startedAt.slice(11, 19),
              prompt: r.prompt.length > 44 ? `${r.prompt.slice(0, 41)}…` : r.prompt,
            })) as unknown as Array<Record<string, unknown>>,
            [
              { key: 'chat', header: 'chat' },
              { key: 'status', header: 'status' },
              { key: 'files', header: 'files' },
              { key: 'started', header: 'started' },
              { key: 'prompt', header: 'prompt' },
            ],
          )}\n`,
        )
      }),
    )

  cmd
    .command('status <chat-id>')
    .description('Show status of a single background chat. T0.')
    .action(
      runCommand(async ({ mode, cmd }) => {
        const [chatId] = cmd.args as [string]
        const rec = await loadPending(chatId)
        if (!rec) {
          if (mode === 'json') return emitSuccess({ chat_id: chatId, status: 'unknown' })
          process.stdout.write(`${color.warn('unknown')} no background entry for ${chatId}\n`)
          process.exit(2)
        }
        if (mode === 'json') return emitSuccess(rec)
        process.stdout.write(`${section(`chat ${chatId}`)}\n`)
        process.stdout.write(`  ${color.accent('status ')} ${recordStatus(rec)}\n`)
        if (rec.finishedAt) process.stdout.write(`  ${color.accent('finished')} ${rec.finishedAt}\n`)
        else process.stdout.write(`  ${color.accent('started')} ${rec.startedAt}\n`)
        if (rec.result?.files !== undefined) {
          process.stdout.write(`  ${color.accent('files  ')} ${rec.result.files}\n`)
        }
        if (rec.result?.webUrl) {
          process.stdout.write(`  ${color.accent('preview')} ${color.accent(rec.result.webUrl)}\n`)
        }
        if (rec.error) process.stdout.write(`  ${color.error('error  ')} ${rec.error}\n`)
        process.stdout.write(`${bullet(color.dim(`log: ${streamLogPath(chatId)}`))}\n`)
      }),
    )

  cmd
    .command('watch <chat-id>')
    .description('Attach to a background chat — replay + live tail. T0.')
    .option('--from-now', 'skip past frames, only show new ones')
    .option('--no-follow', 'replay current log then exit (snapshot mode)')
    .action(
      runCommand(async ({ mode, cmd }) => {
        const [chatId] = cmd.args as [string]
        const raw = cmd.opts<{ fromNow?: boolean; follow?: boolean }>()
        const rec = await loadPending(chatId)
        if (!rec) throw new Error(`No background entry for ${chatId}`)
        const logPath = streamLogPath(chatId)
        try {
          await access(logPath)
        } catch {
          throw new Error(`No stream log yet: ${logPath}`)
        }

        const follow = raw.follow !== false && rec.status === 'running'
        const stopWhen = async () => {
          const latest = await loadPending(chatId)
          return !latest || latest.status !== 'running'
        }

        if (raw.fromNow) {
          const size = (await stat(logPath)).size
          // fast-forward to end by seeking
          const gen = tailNdjson(logPath, {
            follow,
            stopWhen,
          })
          // consume-and-discard until we've passed `size`
          let consumed = 0
          for await (const frame of gen) {
            consumed += `${JSON.stringify(frame)}\n`.length
            if (consumed >= size) {
              if (mode === 'human') {
                // Once fast-forwarded, fall into live render via renderHumanStream
                // by continuing to consume the same generator.
                await renderHumanStream(
                  (async function* () {
                    for await (const f of gen) yield f
                  })(),
                  { prompt: rec.prompt },
                )
              } else {
                for await (const f of gen) emitNdjsonEvent(f.event, f.data)
              }
              return
            }
          }
          return
        }

        if (mode === 'human') {
          await renderHumanStream(tailNdjson(logPath, { follow, stopWhen }), { prompt: rec.prompt })
          return
        }
        for await (const frame of tailNdjson(logPath, { follow, stopWhen })) {
          emitNdjsonEvent(frame.event, frame.data)
        }
      }),
    )

  cmd
    .command('wait <chat-id>')
    .description('Block until the chat finishes, then emit the final envelope. T0.')
    .option('--timeout <sec>', 'max seconds to wait (default: no limit)')
    .option('--interval <ms>', 'poll interval (default 500)')
    .action(
      runCommand(async ({ mode, cmd }) => {
        const [chatId] = cmd.args as [string]
        const raw = cmd.opts<{ timeout?: string; interval?: string }>()
        const intervalMs = Number.parseInt(raw.interval ?? '500', 10)
        const timeoutMs = raw.timeout ? Number.parseInt(raw.timeout, 10) * 1000 : undefined
        const startedAt = Date.now()

        let rec = await loadPending(chatId)
        if (!rec) throw new Error(`No background entry for ${chatId}`)

        while (rec.status === 'running') {
          if (timeoutMs && Date.now() - startedAt >= timeoutMs) {
            if (mode === 'json') return emitSuccess({ ...rec, timed_out: true })
            process.stdout.write(`${color.warn('timeout')} chat still running after ${raw.timeout}s\n`)
            process.exit(124)
          }
          // If pid is dead but status still 'running', bail — registry is stale.
          if (rec.pid && !isProcessAlive(rec.pid)) {
            if (mode === 'json') return emitSuccess({ ...rec, stalled: true })
            process.stdout.write(`${color.error('stalled')} worker pid ${rec.pid} is gone\n`)
            process.exit(1)
          }
          await new Promise((r) => setTimeout(r, intervalMs))
          const next = await loadPending(chatId)
          if (!next) throw new Error(`Record vanished for ${chatId}`)
          rec = next
        }

        if (mode === 'json') return emitSuccess(rec)
        if (rec.status === 'failed') {
          process.stdout.write(`${color.error('failed')} ${rec.error ?? 'unknown error'}\n`)
          process.exit(1)
        }
        process.stdout.write(`${section('chat ready')}\n`)
        process.stdout.write(`  ${color.accent('chat   ')} ${rec.chatId}\n`)
        if (rec.result?.versionId) {
          process.stdout.write(`  ${color.accent('version')} ${rec.result.versionId}\n`)
        }
        if (rec.result?.files !== undefined) {
          process.stdout.write(`  ${color.accent('files  ')} ${rec.result.files}\n`)
        }
        if (rec.result?.webUrl) {
          process.stdout.write(
            `  ${color.accent('preview')} ${color.accent(rec.result.webUrl)}\n`,
          )
        }
      }),
    )
}
