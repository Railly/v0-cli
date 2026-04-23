// Human renderer for v0 SSE streams. Thin adapter over the generic
// step-renderer: converts PhaseEvents (v0-specific) to StepEvents (generic)
// and lets the renderer own the spinner, timer, and transcript.
//
// Consumed by `chat create` and `msg send`. `deploy create --wait` uses the
// step-renderer directly via its own adapter in workflows/deploy-and-wait.

import type { StreamFrame } from '../api/streaming.ts'
import { color } from '../ui/color.ts'
import { extractPhases, type PhaseEvent } from './frames.ts'
import { renderSteps, type StepEvent } from './step-renderer.ts'

export type RenderResult = {
  chatId?: string
  versionId?: string
  files: Array<{ name: string; lang?: string; bytes: number }>
  webUrl?: string
  demo?: string
  title?: string
  error?: string
  raw: PhaseEvent[]
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${(n / (1024 * 1024)).toFixed(1)}MB`
}

/**
 * Live render for v0 SSE streams. Matches v0.app's transcript style:
 * only past-tense step lines printed, rolling `Thinking…` spinner between
 * them, then a summary with chat/version/files/preview/demo + next-step
 * hints.
 *
 * Implementation: consume PhaseEvents, emit StepEvents to the generic
 * renderSteps(). We collect the final state (chat id, files, etc) while
 * streaming so we can print the custom summary after renderSteps returns.
 */
export async function renderHumanStream(
  stream: AsyncIterable<StreamFrame>,
  opts: { prompt?: string; title?: string } = {},
): Promise<RenderResult> {
  const result: RenderResult = { files: [], raw: [] }

  // Track title state so we only emit `title` when it stabilizes. v0 sends
  // both chat.title and chat.name (same value in practice). chat.title wins;
  // if we got a chat.name first, a later chat.title replaces it.
  let titleSource: 'title' | 'name' | '' = ''

  // Dedupe task-complete labels across replay chunks.
  const seenComplete = new Set<string>()

  async function* stepEvents(): AsyncGenerator<StepEvent> {
    try {
      for await (const frame of stream) {
        for (const phase of extractPhases(frame)) {
          result.raw.push(phase)
          switch (phase.kind) {
            case 'chat-created':
              result.chatId = phase.chatId
              break
            case 'title':
              if (phase.source === 'title') {
                titleSource = 'title'
                yield { kind: 'title', title: phase.title, replace: true }
              } else if (titleSource !== 'title') {
                titleSource = 'name'
                yield { kind: 'title', title: phase.title, replace: true }
              }
              break
            case 'task-active':
              // Ignored: v0 emits both active + complete in the same frame
              // during state replay; past-tense-only gives the clean v0.app
              // transcript look.
              break
            case 'task-complete':
              if (seenComplete.has(phase.label)) break
              seenComplete.add(phase.label)
              yield { kind: 'step', label: phase.label }
              break
            case 'done':
              result.chatId = phase.chatId
              result.versionId = phase.versionId
              result.files = phase.files
              result.webUrl = phase.webUrl
              result.demo = phase.demo
              result.title = phase.title
              // Meta rows go into the renderer's summary block so the outro
              // flows cleanly: steps → meta → Done.
              if (phase.chatId) {
                yield { kind: 'meta', key: 'chat', value: phase.chatId }
                yield {
                  kind: 'meta',
                  key: 'url',
                  value: `https://v0.app/chat/${phase.chatId}`,
                  accent: true,
                }
              }
              if (phase.versionId) yield { kind: 'meta', key: 'version', value: phase.versionId }
              if (phase.files.length) {
                const bytes = phase.files.reduce((a, f) => a + f.bytes, 0)
                yield {
                  kind: 'meta',
                  key: 'files',
                  value: `${phase.files.length} (${fmtBytes(bytes)})`,
                }
              }
              if (phase.webUrl) {
                yield { kind: 'meta', key: 'preview', value: phase.webUrl, accent: true }
              }
              if (phase.demo && phase.demo !== phase.webUrl) {
                yield { kind: 'meta', key: 'demo', value: phase.demo, accent: true }
              }
              yield { kind: 'done' }
              return
            case 'error':
              result.error = phase.message
              yield { kind: 'error', message: phase.message }
              return
          }
        }
      }
      yield { kind: 'done' }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      result.error = msg
      yield { kind: 'error', message: msg }
    }
  }

  const renderResult = await renderSteps(stepEvents(), {
    intro: opts.title ?? 'v0 chat create',
    ...(opts.prompt !== undefined ? { subtitle: opts.prompt } : {}),
  })

  if (renderResult.title && !result.title) result.title = renderResult.title

  if (result.error) return result

  // File list + next-step hints print AFTER the renderer's outro so they live
  // below the summary block. Meta (chat/version/preview/demo) already landed
  // inside the outro via StepEvent `meta` events.
  if (result.files.length && result.files.length <= 10) {
    const list = result.files
      .map((f) => `  ${color.dim('•')} ${f.name} ${color.dim(`(${fmtBytes(f.bytes)})`)}`)
      .join('\n')
    process.stdout.write(`${list}\n`)
  }
  if (result.chatId) {
    // Chat URL lives inside the summary block (emitted as `url` meta above).
    // Next-step hints below give the canonical iterate + ship commands,
    // plus a pointer to any existing deploys without making an extra API
    // call on every run.
    process.stdout.write(
      `\n${color.dim('iterate:')} v0 msg send ${result.chatId} "<message>"\n`,
    )
    // `deploy create` auto-resolves the latest version when version-id is
    // omitted, so the shortest ship command is just `deploy create <chat>`.
    process.stdout.write(
      `${color.dim('ship:   ')} v0 deploy create ${result.chatId} --yes\n`,
    )
    process.stdout.write(
      `${color.dim('deploys:')} v0 deploy list --chat ${result.chatId}\n`,
    )
  }

  return result
}
