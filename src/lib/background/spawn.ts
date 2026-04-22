import { spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import {
  type PendingRecord,
  ensurePendingDir,
  pendingPath,
  savePending,
  streamLogPath,
} from './registry.ts'

const WORKER_ENV_FLAG = 'V0CLI_BACKGROUND_WORKER'

function detectEntry(): { cmd: string; args: string[] } {
  // Prefer Bun.argv[0] (the invoked binary). If we're running under `bun run`,
  // it's the bun binary + the script path. If running a compiled dist, it's
  // node + dist/index.js. Either way, pass the env flag + all the create args
  // the caller already parsed.
  const cmd = process.argv[0] ?? 'node'
  const script = process.argv[1]
  const args: string[] = []
  if (script && existsSync(script)) args.push(script)
  return { cmd, args }
}

export interface DetachArgs {
  prompt: string
  body: Record<string, unknown>
  apiKey: string
  baseUrl?: string
  profile?: string
}

export interface DetachResult {
  chatId: string
  pid: number
  streamLog: string
  pendingPath: string
  startedAt: string
  status: 'running'
}

export async function detachBackground(args: DetachArgs): Promise<DetachResult> {
  await ensurePendingDir()

  const startedAt = new Date().toISOString()
  // We need the chat_id up-front so the pending record is keyed correctly and
  // the caller can return it immediately. The chat_id is assigned by v0 on
  // the first SSE frame, so we create the chat synchronously in the worker
  // and only detach after the first frame. But we want the caller to return
  // in <1s, so the pattern is: the *worker* handles create+stream; we just
  // spawn it with a payload JSON on stdin and wait for the worker to print
  // the chat_id on its own stdout once known. That first line is our handshake.

  const entry = detectEntry()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    [WORKER_ENV_FLAG]: '1',
  }
  if (args.apiKey) env.V0_API_KEY = args.apiKey
  if (args.baseUrl) env.V0_BASE_URL = args.baseUrl
  if (args.profile) env.V0_PROFILE = args.profile

  const child = spawn(entry.cmd, [...entry.args, '__bg-worker'], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
  })

  // Send the body via stdin so the worker doesn't expose it in argv.
  child.stdin.write(
    `${JSON.stringify({ prompt: args.prompt, body: args.body, startedAt })}\n`,
  )
  child.stdin.end()

  // Wait for the worker's handshake line: `{"chat_id":"..."}`
  const chatId = await new Promise<string>((resolve, reject) => {
    let buf = ''
    const timeout = setTimeout(() => {
      child.stdout.removeAllListeners('data')
      reject(new Error('Background worker handshake timed out (30s)'))
    }, 30_000)
    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString()
      const nl = buf.indexOf('\n')
      if (nl === -1) return
      const firstLine = buf.slice(0, nl)
      try {
        const parsed = JSON.parse(firstLine) as { chat_id?: string; error?: string }
        clearTimeout(timeout)
        child.stdout.removeAllListeners('data')
        if (parsed.error) return reject(new Error(parsed.error))
        if (parsed.chat_id) return resolve(parsed.chat_id)
        reject(new Error(`Invalid handshake: ${firstLine}`))
      } catch (err) {
        clearTimeout(timeout)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
    child.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
    child.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout)
        reject(new Error(`Background worker exited with code ${code} before handshake`))
      }
    })
  })

  // Hand over: the worker keeps running, we unref and forget. It writes its
  // own stdout frames to the stream log after the handshake line.
  child.unref()
  // Drain child stdio so it doesn't block on a full pipe once we unref.
  child.stdout.resume()
  child.stderr.resume()

  return {
    chatId,
    pid: child.pid ?? 0,
    streamLog: streamLogPath(chatId),
    pendingPath: pendingPath(chatId),
    startedAt,
    status: 'running',
  }
}

// ---------------------------------------------------------------------------
// Worker entrypoint — runs in the spawned child. Handled by src/index.ts via
// an early short-circuit when V0CLI_BACKGROUND_WORKER=1 is present.
// ---------------------------------------------------------------------------

export function isBackgroundWorker(): boolean {
  return process.env[WORKER_ENV_FLAG] === '1'
}

interface WorkerPayload {
  prompt: string
  body: Record<string, unknown>
  startedAt: string
}

async function readStdinJson(): Promise<WorkerPayload> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin as AsyncIterable<Buffer>) {
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) throw new Error('No stdin payload for background worker')
  return JSON.parse(raw) as WorkerPayload
}

export async function runBackgroundWorker(): Promise<void> {
  // Isolate everything. Any unhandled error becomes a handshake error or,
  // after handshake, a `status: failed` registry entry. The worker never
  // throws to its parent.
  const emitHandshakeError = (msg: string): void => {
    process.stdout.write(`${JSON.stringify({ error: msg })}\n`)
    process.exit(1)
  }

  let payload: WorkerPayload
  try {
    payload = await readStdinJson()
  } catch (err) {
    emitHandshakeError(err instanceof Error ? err.message : String(err))
    return
  }

  const { buildClient } = await import('../api/client.ts')
  const { readSseStream } = await import('../api/streaming.ts')
  const { loadProfile, activeProfileName, resolveApiKey } = await import('../config/profiles.ts')
  const { extractPhases } = await import('../streaming/frames.ts')

  const profileName = activeProfileName()
  const profile = await loadProfile(profileName)
  const apiKey = process.env.V0_API_KEY ?? resolveApiKey(profile)
  if (!apiKey) emitHandshakeError('V0_API_KEY missing')

  const client = buildClient({
    profile,
    ...(process.env.V0_API_KEY !== undefined ? { apiKey: process.env.V0_API_KEY } : {}),
    ...(process.env.V0_BASE_URL !== undefined ? { baseUrl: process.env.V0_BASE_URL } : {}),
  })

  let stream: ReadableStream<Uint8Array>
  try {
    stream = (await client.chats.create({
      ...(payload.body as unknown as Parameters<typeof client.chats.create>[0]),
      responseMode: 'experimental_stream',
    })) as unknown as ReadableStream<Uint8Array>
  } catch (err) {
    emitHandshakeError(err instanceof Error ? err.message : String(err))
    return
  }

  // We need chatId before the first NDJSON log line so we can pick the path.
  // Read the first frame ourselves (should be the `chat` snapshot), then
  // fall through to the main loop.
  const reader = readSseStream(stream)
  let chatId: string | undefined
  let firstFrame: { event: string; data: unknown; raw: string } | undefined
  try {
    const it = await reader.next()
    if (it.done || !it.value) throw new Error('Stream closed before first frame')
    firstFrame = it.value
    const d = firstFrame.data as Record<string, unknown> | undefined
    if (d && typeof d.id === 'string' && d.object === 'chat') chatId = d.id
  } catch (err) {
    emitHandshakeError(err instanceof Error ? err.message : String(err))
    return
  }
  if (!chatId) return emitHandshakeError('No chat_id in first frame')

  // Handshake — let the parent return immediately.
  process.stdout.write(`${JSON.stringify({ chat_id: chatId })}\n`)

  const { saveRec, finishRec, failRec, logFrame } = await setupWorker(chatId, payload)
  await saveRec()
  if (firstFrame) await logFrame(firstFrame)

  let sawDone = false
  try {
    for await (const frame of reader) {
      await logFrame(frame)
      for (const phase of extractPhases(frame)) {
        if (phase.kind === 'done') {
          await finishRec({
            versionId: phase.versionId,
            files: phase.files.length,
            webUrl: phase.webUrl,
            demo: phase.demo,
            title: phase.title,
          })
          sawDone = true
        } else if (phase.kind === 'error') {
          await failRec(phase.message)
          sawDone = true
        }
      }
    }
    if (!sawDone) {
      // Stream closed without an explicit done/error frame. Mark finished so
      // the wait command doesn't hang; files=0 is an honest signal.
      await finishRec({ files: 0 })
    }
  } catch (err) {
    await failRec(err instanceof Error ? err.message : String(err))
  }
  process.exit(0)
}

async function setupWorker(
  chatId: string,
  payload: WorkerPayload,
): Promise<{
  saveRec: () => Promise<void>
  finishRec: (result: NonNullable<PendingRecord['result']>) => Promise<void>
  failRec: (error: string) => Promise<void>
  logFrame: (frame: { event: string; data: unknown }) => Promise<void>
}> {
  const base: PendingRecord = {
    chatId,
    prompt: payload.prompt,
    startedAt: payload.startedAt,
    pid: process.pid,
    streamLog: streamLogPath(chatId),
    status: 'running',
  }
  let saved = false
  const logStream = createWriteStream(streamLogPath(chatId), { flags: 'a', mode: 0o600 })

  return {
    saveRec: async () => {
      await savePending(base)
      saved = true
    },
    finishRec: async (result) => {
      if (!saved) return
      const current = (await loadPendingInternal(chatId)) ?? base
      current.status = 'done'
      current.finishedAt = new Date().toISOString()
      current.result = result
      await savePending(current)
    },
    failRec: async (error) => {
      if (!saved) return
      const current = (await loadPendingInternal(chatId)) ?? base
      current.status = 'failed'
      current.finishedAt = new Date().toISOString()
      current.error = error
      await savePending(current)
    },
    logFrame: (frame) =>
      new Promise<void>((resolve) => {
        logStream.write(`${JSON.stringify({ event: frame.event, data: frame.data })}\n`, () =>
          resolve(),
        )
      }),
  }
}

async function loadPendingInternal(chatId: string): Promise<PendingRecord | null> {
  try {
    const raw = await readFile(pendingPath(chatId), 'utf8')
    return JSON.parse(raw) as PendingRecord
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

