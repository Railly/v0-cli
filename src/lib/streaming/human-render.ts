import * as p from '@clack/prompts'
import type { StreamFrame } from '../api/streaming.ts'
import { color } from '../ui/color.ts'
import { extractPhases, type PhaseEvent } from './frames.ts'

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

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}m${r.toString().padStart(2, '0')}s`
}

/**
 * Live render for v0 SSE streams. Matches v0.app's transcript style:
 * only past-tense step lines are printed, one per step, with a rolling
 * `Thinking…` spinner between them.
 *
 * v0 emits both `taskNameActive` (present continuous: "Reading globals")
 * and `taskNameComplete` (past tense: "Read globals") — often in the same
 * frame as state replay. We ignore active labels entirely and render each
 * unique complete label as a one-liner. The spinner between lines shows
 * the elapsed since the last completion.
 */
export async function renderHumanStream(
  stream: AsyncIterable<StreamFrame>,
  opts: { prompt?: string } = {},
): Promise<RenderResult> {
  const startedAt = Date.now()
  const result: RenderResult = { files: [], raw: [] }

  p.intro(color.bold('v0 chat create'))
  if (opts.prompt) {
    const short = opts.prompt.length > 72 ? `${opts.prompt.slice(0, 69)}…` : opts.prompt
    p.log.message(color.dim(short))
  }

  // Title: prefer chat.title over chat.name. Print once, early.
  let titleValue = ''
  let titleSource: 'title' | 'name' | '' = ''
  let titlePrinted = false
  const maybePrintTitle = () => {
    if (titlePrinted || !titleValue) return
    p.log.info(color.bold(titleValue))
    titlePrinted = true
    startSpinner()
  }

  const seenComplete = new Set<string>()
  let stepCount = 0
  let lastStepAt = Date.now()

  // Single rolling spinner. Lazily started — we hold off until the title has
  // been printed so the transcript reads `prompt → title → Thinking… → steps`
  // instead of showing a premature `Thinking…` line before v0 has even
  // replied.
  let spin: ReturnType<typeof p.spinner> | null = null
  let tick: ReturnType<typeof setInterval> | null = null

  const startSpinner = () => {
    if (spin) return
    lastStepAt = Date.now()
    spin = p.spinner()
    spin.start(`${color.dim('Thinking…')} ${color.dim('· 0s')}`)
    tick = setInterval(() => {
      if (!spin) return
      spin.message(
        `${color.dim('Thinking…')} ${color.dim(`· ${fmtElapsed(Date.now() - lastStepAt)}`)}`,
      )
    }, 1000)
  }

  const rotateSpinner = (doneLabel: string) => {
    // No spinner yet? The first step is landing before any title frame —
    // print the step as a one-liner and start the idle spinner after it.
    if (!spin) {
      p.log.step(`${doneLabel} ${color.dim(`· ${fmtElapsed(Date.now() - lastStepAt)}`)}`)
      startSpinner()
      return
    }
    const d = fmtElapsed(Date.now() - lastStepAt)
    if (tick) clearInterval(tick)
    // Stop the current spinner with the finished-step line — that becomes
    // the permanent entry in the transcript.
    spin.stop(`${doneLabel} ${color.dim(`· ${d}`)}`)
    lastStepAt = Date.now()
    spin = null
    tick = null
    // Start the next "Thinking…" spinner for the gap until the next step.
    startSpinner()
  }

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
              titleValue = phase.title
              titleSource = 'title'
              maybePrintTitle()
            } else if (titleSource !== 'title') {
              titleValue = phase.title
              titleSource = 'name'
            }
            break
          case 'task-active':
            // We deliberately ignore these — v0 emits both active + complete
            // on the same frame, and showing only the past-tense line per
            // step gives the clean v0.app-style transcript.
            break
          case 'task-complete':
            if (seenComplete.has(phase.label)) break
            seenComplete.add(phase.label)
            stepCount++
            maybePrintTitle()
            rotateSpinner(phase.label)
            break
          case 'done':
            result.chatId = phase.chatId
            result.versionId = phase.versionId
            result.files = phase.files
            result.webUrl = phase.webUrl
            result.demo = phase.demo
            result.title = phase.title ?? titleValue
            break
          case 'error':
            result.error = phase.message
            break
        }
      }
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
  }

  if (tick) clearInterval(tick)
  if (spin) {
    // Close the trailing spinner silently (no label) — the summary block
    // below carries the final state.
    spin.stop()
    spin = null
  }

  const elapsed = fmtElapsed(Date.now() - startedAt)

  if (result.error) {
    p.log.error(result.error)
    p.outro(color.error(`Failed after ${elapsed}.`))
    return result
  }

  if (!titlePrinted && result.title) {
    p.log.info(color.bold(result.title))
  }

  const rows: string[] = []
  if (result.chatId) rows.push(`${color.muted('chat    ')} ${result.chatId}`)
  if (result.versionId) rows.push(`${color.muted('version ')} ${result.versionId}`)
  if (result.files.length) {
    const totalBytes = result.files.reduce((a, f) => a + f.bytes, 0)
    rows.push(`${color.muted('files   ')} ${result.files.length} (${fmtBytes(totalBytes)})`)
  }
  if (result.webUrl) rows.push(`${color.muted('preview ')} ${color.accent(result.webUrl)}`)
  if (result.demo && result.demo !== result.webUrl) {
    rows.push(`${color.muted('demo    ')} ${color.accent(result.demo)}`)
  }
  if (rows.length) p.log.info(rows.join('\n'))

  if (result.files.length && result.files.length <= 10) {
    const list = result.files
      .map((f) => `  ${color.dim('•')} ${f.name} ${color.dim(`(${fmtBytes(f.bytes)})`)}`)
      .join('\n')
    p.log.message(list)
  }

  const next: string[] = []
  if (result.chatId) {
    next.push(`${color.dim('iterate:')} v0 msg send ${result.chatId} "<message>"`)
    next.push(`${color.dim('ship:   ')} v0 deploy create ${result.chatId}`)
  }
  if (next.length) p.log.message(next.join('\n'))

  p.outro(`${color.success('Done')} ${color.dim(`· ${elapsed}`)} ${color.dim(`(${stepCount} step${stepCount === 1 ? '' : 's'})`)}`)
  return result
}
