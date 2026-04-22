// Generic step renderer. Consumes a stream of StepEvents and prints a
// past-tense-step transcript with a rolling `Thinking…` spinner in between.
//
// Used by:
//   - chat create / msg send  → SSE frames → PhaseEvents → StepEvents
//   - deploy create --wait    → HTTP polling → status transitions → StepEvents
//
// The renderer itself knows nothing about SSE or HTTP. It consumes an async
// iterable of StepEvents and owns the spinner + timer + transcript.

import * as p from '@clack/prompts'
import { color } from '../ui/color.ts'

export type StepEvent =
  /** The operation's name landed. Prints once as a bold info line under the intro. */
  | { kind: 'title'; title: string; replace?: boolean }
  /** A step finished. Rotates the spinner: closes current with `label · Ns`, opens a new `Thinking…`. */
  | { kind: 'step'; label: string }
  /** Update the current spinner's idle label (defaults to `Thinking…`). Does NOT add a step. */
  | { kind: 'idle'; label: string }
  /** A metadata field to surface in the end-of-run summary. Accumulates. */
  | { kind: 'meta'; key: string; value: string; accent?: boolean }
  /** Terminal success. Prints the outro. */
  | { kind: 'done'; summary?: string }
  /** Terminal failure. Prints an error outro and sets exit-hint. */
  | { kind: 'error'; message: string }

export interface StepRenderOpts {
  intro: string
  subtitle?: string
  idleLabel?: string
}

export interface StepRenderResult {
  steps: string[]
  meta: Array<{ key: string; value: string; accent?: boolean }>
  title?: string
  error?: string
  durationMs: number
}

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}m${r.toString().padStart(2, '0')}s`
}

export async function renderSteps(
  events: AsyncIterable<StepEvent>,
  opts: StepRenderOpts,
): Promise<StepRenderResult> {
  const startedAt = Date.now()
  const idleLabel = opts.idleLabel ?? 'Thinking…'

  p.intro(color.bold(opts.intro))
  if (opts.subtitle) {
    const short = opts.subtitle.length > 72 ? `${opts.subtitle.slice(0, 69)}…` : opts.subtitle
    p.log.message(color.dim(short))
  }

  let titleValue = ''
  let titlePrinted = false
  const maybePrintTitle = () => {
    if (titlePrinted || !titleValue) return
    p.log.info(color.bold(titleValue))
    titlePrinted = true
  }

  const steps: string[] = []
  const seen = new Set<string>()
  const meta: Array<{ key: string; value: string; accent?: boolean }> = []

  type Spinner = ReturnType<typeof p.spinner>
  let spin: Spinner | null = null
  let tick: ReturnType<typeof setInterval> | null = null
  let stepStartedAt = 0
  let currentIdleLabel = idleLabel

  const startSpinner = () => {
    if (spin) return
    stepStartedAt = Date.now()
    spin = p.spinner()
    spin.start(`${color.dim(currentIdleLabel)} ${color.dim('· 0s')}`)
    tick = setInterval(() => {
      if (!spin) return
      spin.message(
        `${color.dim(currentIdleLabel)} ${color.dim(`· ${fmtElapsed(Date.now() - stepStartedAt)}`)}`,
      )
    }, 1000)
  }

  const rotate = (doneLabel: string) => {
    const d = fmtElapsed(Date.now() - stepStartedAt)
    if (tick) {
      clearInterval(tick)
      tick = null
    }
    if (!spin) {
      // No prior spinner — print as a one-liner and start the idle.
      p.log.step(`${doneLabel} ${color.dim(`· ${d}`)}`)
      startSpinner()
      return
    }
    spin.stop(`${doneLabel} ${color.dim(`· ${d}`)}`)
    spin = null
    startSpinner()
  }

  let errorMessage: string | undefined
  let ended = false

  try {
    for await (const ev of events) {
      switch (ev.kind) {
        case 'title': {
          if (ev.replace || !titleValue) titleValue = ev.title
          maybePrintTitle()
          // Ensure the idle spinner is running AFTER the title is printed,
          // not before — otherwise 'Thinking… · 0s' tattoos itself above the
          // title line.
          startSpinner()
          break
        }
        case 'step': {
          if (seen.has(ev.label)) break
          seen.add(ev.label)
          steps.push(ev.label)
          maybePrintTitle()
          rotate(ev.label)
          break
        }
        case 'idle': {
          currentIdleLabel = ev.label
          if (!spin) startSpinner()
          // Re-render so the label flips immediately, not on the next tick.
          ;(spin as Spinner | null)?.message(
            `${color.dim(currentIdleLabel)} ${color.dim(`· ${fmtElapsed(Date.now() - stepStartedAt)}`)}`,
          )
          break
        }
        case 'meta': {
          meta.push({
            key: ev.key,
            value: ev.value,
            ...(ev.accent !== undefined ? { accent: ev.accent } : {}),
          })
          break
        }
        case 'done': {
          ended = true
          break
        }
        case 'error': {
          errorMessage = ev.message
          ended = true
          break
        }
      }
      if (ended) break
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err)
  }

  if (tick) clearInterval(tick)
  ;(spin as Spinner | null)?.stop()
  spin = null

  const totalElapsed = fmtElapsed(Date.now() - startedAt)

  if (errorMessage) {
    p.log.error(errorMessage)
    p.outro(color.error(`Failed after ${totalElapsed}.`))
    return {
      steps,
      meta,
      ...(titleValue ? { title: titleValue } : {}),
      error: errorMessage,
      durationMs: Date.now() - startedAt,
    }
  }

  // Emit meta as a single info block.
  if (meta.length > 0) {
    const widest = meta.reduce((m, row) => Math.max(m, row.key.length), 0)
    const rows = meta.map((row) => {
      const label = color.muted(row.key.padEnd(widest))
      const value = row.accent ? color.accent(row.value) : row.value
      return `${label}  ${value}`
    })
    p.log.info(rows.join('\n'))
  }

  p.outro(
    `${color.success('Done')} ${color.dim(`· ${totalElapsed}`)} ${
      steps.length > 0
        ? color.dim(`(${steps.length} step${steps.length === 1 ? '' : 's'})`)
        : ''
    }`.trimEnd(),
  )

  return {
    steps,
    meta,
    ...(titleValue ? { title: titleValue } : {}),
    durationMs: Date.now() - startedAt,
  }
}
