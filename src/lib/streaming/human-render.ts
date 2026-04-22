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

  const spin = p.spinner()
  spin.start('Connecting to v0…')

  // Title: prefer `chat.title` stream over `chat.name` (they usually carry the
  // same value but v0 emits both, so we replace — never concat). Titles arrive
  // as full replacement deltas in practice.
  let titleValue = ''
  let titleSource: 'title' | 'name' | '' = ''

  // Current active label. Reset when task-complete arrives.
  let currentTask = ''

  // Completed steps in first-seen order. v0 re-emits task-complete frames
  // for the same labels as the content chunk replays state; we only want
  // to show each label once.
  const completedSteps: string[] = []
  const completedSet = new Set<string>()

  const setLabel = () => {
    const elapsed = fmtElapsed(Date.now() - startedAt)
    const parts: string[] = []
    if (titleValue) parts.push(color.bold(titleValue))
    if (currentTask) {
      parts.push(color.dim(currentTask))
    } else if (completedSteps.length > 0) {
      parts.push(color.dim(`${completedSteps.length} steps`))
    }
    parts.push(color.dim(`· ${elapsed}`))
    spin.message(parts.join(' '))
  }

  // Live elapsed timer — refresh even when no frames are arriving.
  const tick = setInterval(setLabel, 1000)

  const pushStepIfNew = (label: string) => {
    if (completedSet.has(label)) return
    completedSet.add(label)
    completedSteps.push(label)
    // Print above the spinner so the final transcript shows the step trail.
    p.log.step(color.dim(label))
  }

  try {
    for await (const frame of stream) {
      for (const phase of extractPhases(frame)) {
        result.raw.push(phase)
        switch (phase.kind) {
          case 'chat-created':
            result.chatId = phase.chatId
            setLabel()
            break
          case 'title':
            // `chat.title` outranks `chat.name` once either has been seen.
            // After a `chat.title` lands we ignore future `chat.name` deltas.
            if (phase.source === 'title') {
              titleValue = phase.title
              titleSource = 'title'
            } else if (titleSource !== 'title') {
              titleValue = phase.title
              titleSource = 'name'
            }
            setLabel()
            break
          case 'task-active':
            currentTask = phase.label
            setLabel()
            break
          case 'task-complete':
            pushStepIfNew(phase.label)
            currentTask = ''
            setLabel()
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

  clearInterval(tick)
  const elapsed = fmtElapsed(Date.now() - startedAt)

  if (result.error) {
    spin.stop(color.error(`Failed after ${elapsed}`))
    p.log.error(result.error)
    p.outro(color.error('Chat not created.'))
    return result
  }

  spin.stop(
    `${color.success('✓')} Generated in ${color.bold(elapsed)} ${color.dim(`(${completedSteps.length} step${completedSteps.length === 1 ? '' : 's'})`)}`,
  )

  if (result.title) {
    p.log.step(color.bold(result.title))
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

  p.outro(color.success('Done.'))
  return result
}
