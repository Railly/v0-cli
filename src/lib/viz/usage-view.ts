// Human-friendly rendering for `v0 report usage`. Aggregates raw events into
// totals + splits + per-chat + per-day histogram, then prints a Vercel-style
// dashboard in the terminal.

import { color } from '../ui/color.ts'
import {
  box,
  fmtCost,
  fmtCount,
  hbar,
  padRightVisible,
  sparkline,
  stackedBar,
  stripAnsi,
  trendArrow,
  visibleWidth,
} from './primitives.ts'

export interface UsageEvent {
  id: string
  type?: string
  promptCost?: string | number
  completionCost?: string | number
  totalCost?: string | number
  chatId?: string
  messageId?: string
  userId?: string
  createdAt: string
}

export interface UsageAggregate {
  eventCount: number
  totalCost: number
  promptCost: number
  completionCost: number
  firstEventAt: number
  lastEventAt: number
  byChat: Map<string, { chatId: string; cost: number; events: number }>
  dailyBuckets: number[] // cost per day over the window, oldest → newest
  dailyLabels: string[] // YYYY-MM-DD per bucket
  windowStart: number
  windowEnd: number
}

function toNum(v: string | number | undefined): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') {
    const n = Number.parseFloat(v)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

export function aggregateUsage(
  events: UsageEvent[],
  opts: { start?: Date; end?: Date; buckets?: number } = {},
): UsageAggregate {
  const now = Date.now()
  const end = opts.end ? opts.end.getTime() : now
  const buckets = opts.buckets ?? 7

  // Default window: 7 days ending today (UTC day boundaries) unless explicit.
  let start: number
  if (opts.start) {
    start = opts.start.getTime()
  } else if (events.length > 0) {
    const oldest = Math.min(...events.map((e) => Date.parse(e.createdAt) || now))
    const delta = end - oldest
    start = Math.min(oldest, end - Math.max(delta, 7 * 24 * 60 * 60 * 1000))
  } else {
    start = end - 7 * 24 * 60 * 60 * 1000
  }

  const agg: UsageAggregate = {
    eventCount: events.length,
    totalCost: 0,
    promptCost: 0,
    completionCost: 0,
    firstEventAt: Number.POSITIVE_INFINITY,
    lastEventAt: 0,
    byChat: new Map(),
    dailyBuckets: new Array(buckets).fill(0),
    dailyLabels: [],
    windowStart: start,
    windowEnd: end,
  }

  const span = end - start
  const bucketSize = span / buckets

  // Label per bucket
  for (let i = 0; i < buckets; i++) {
    const t = start + i * bucketSize
    agg.dailyLabels.push(new Date(t).toISOString().slice(0, 10))
  }

  for (const e of events) {
    const ts = Date.parse(e.createdAt)
    if (!Number.isFinite(ts)) continue
    const total = toNum(e.totalCost)
    const prompt = toNum(e.promptCost)
    const completion = toNum(e.completionCost)

    agg.totalCost += total
    agg.promptCost += prompt
    agg.completionCost += completion
    agg.firstEventAt = Math.min(agg.firstEventAt, ts)
    agg.lastEventAt = Math.max(agg.lastEventAt, ts)

    if (e.chatId) {
      const row = agg.byChat.get(e.chatId) ?? {
        chatId: e.chatId,
        cost: 0,
        events: 0,
      }
      row.cost += total
      row.events += 1
      agg.byChat.set(e.chatId, row)
    }

    // Bucket
    if (ts >= start && ts <= end) {
      const idx = Math.min(buckets - 1, Math.max(0, Math.floor((ts - start) / bucketSize)))
      agg.dailyBuckets[idx] = (agg.dailyBuckets[idx] ?? 0) + total
    }
  }

  if (!Number.isFinite(agg.firstEventAt)) agg.firstEventAt = agg.windowStart
  return agg
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const WIDTH = 60

function header(title: string, subtitle?: string): string {
  const t = color.bold(color.accent(title.toUpperCase()))
  const s = subtitle ? ` ${color.dim(`· ${subtitle}`)}` : ''
  return `${t}${s}`
}

function formatWindow(start: number, end: number): string {
  const ms = end - start
  const days = Math.round(ms / (24 * 60 * 60 * 1000))
  if (days <= 0) {
    const hours = Math.round(ms / (60 * 60 * 1000))
    return `last ${hours}h`
  }
  return `last ${days}d`
}

function row(label: string, value: string, width = WIDTH): string {
  const left = color.muted(label)
  const leftWidth = visibleWidth(left)
  const valueWidth = visibleWidth(value)
  const pad = Math.max(1, width - leftWidth - valueWidth)
  return `${left}${' '.repeat(pad)}${value}`
}

/**
 * Render the whole usage dashboard to stdout. Caller decides when to call.
 */
export function renderUsage(
  agg: UsageAggregate,
  chatNames: Map<string, string> = new Map(),
  opts: { prevTotal?: number } = {},
): string {
  const lines: string[] = []

  lines.push(header('Usage', `${formatWindow(agg.windowStart, agg.windowEnd)} · ${agg.eventCount} events`))
  lines.push('')

  // ---- TOTAL + trend -----------------------------------------------------
  lines.push(row(' Total spend', color.bold(fmtCost(agg.totalCost))))
  if (opts.prevTotal !== undefined) {
    const t = trendArrow(opts.prevTotal, agg.totalCost)
    const tintFn =
      t.kind === 'up' ? color.warn : t.kind === 'down' ? color.success : color.dim
    lines.push(
      row(
        ' vs previous',
        `${tintFn(`${t.arrow} ${t.label}`)} ${color.dim(`(${fmtCost(opts.prevTotal)})`)}`,
      ),
    )
  }
  lines.push('')

  // ---- Prompt vs completion split ---------------------------------------
  if (agg.totalCost > 0) {
    const barWidth = 36
    const split = stackedBar(
      [
        { value: agg.promptCost, colorize: (s) => color.accent(s) },
        { value: agg.completionCost, colorize: (s) => color.warn(s) },
      ],
      barWidth,
    )
    // Round prompt % normally; derive completion = 100 - prompt so the two
    // always sum to 100 (no more 88/20 shenanigans).
    const pPct = Math.round((agg.promptCost / agg.totalCost) * 100)
    const cPct = 100 - pPct
    lines.push(` ${split}  ${color.dim(`${pPct}/${cPct}%`)}`)
    lines.push(
      ` ${color.accent('▌')} ${color.muted('prompt')}     ${fmtCost(agg.promptCost)}   ${color.warn('▌')} ${color.muted('completion')} ${fmtCost(agg.completionCost)}`,
    )
    lines.push('')
  }

  // ---- Daily activity sparkline -----------------------------------------
  if (agg.dailyBuckets.length && agg.dailyBuckets.some((v) => v > 0)) {
    const spark = sparkline(agg.dailyBuckets)
    const peak = Math.max(...agg.dailyBuckets)
    const peakIdx = agg.dailyBuckets.indexOf(peak)
    const peakDate = agg.dailyLabels[peakIdx] ?? '?'
    lines.push(
      box(
        'daily spend',
        [
          ` ${color.accent(spark)}`,
          ` ${color.muted(agg.dailyLabels[0] ?? '')} ${color.dim('→')} ${color.muted(agg.dailyLabels[agg.dailyLabels.length - 1] ?? '')}`,
          ` ${color.dim(`peak: ${fmtCost(peak)} on ${peakDate}`)}`,
        ],
        WIDTH,
      ),
    )
    lines.push('')
  }

  // ---- Top chats by cost -------------------------------------------------
  // Inner content width of a 60-col box = 58 cols. Layout:
  //   ` id(12) sp name(18) sp bar(12) sp cost(8) sp Ne ` = 1+12+1+18+1+12+1+8+1+3+1 = 59
  // Tight but deliberate.
  const topChats = [...agg.byChat.values()].sort((a, b) => b.cost - a.cost).slice(0, 5)
  if (topChats.length) {
    const maxCost = topChats[0]?.cost ?? 1
    const chatLines: string[] = []
    for (const c of topChats) {
      const rawName = chatNames.get(c.chatId) ?? ''
      const nameDisplay = rawName ? rawName.slice(0, 18) : color.dim('(unnamed)')
      const id = color.muted(c.chatId.padEnd(12).slice(0, 12))
      const bar = color.accent(hbar(c.cost / maxCost, 12))
      const cost = padRightVisible(color.bold(fmtCost(c.cost)), 8)
      const events = color.dim(`${c.events}e`)
      const nameStr = padRightVisible(nameDisplay, 18)
      chatLines.push(` ${id} ${nameStr} ${bar} ${cost} ${events}`)
    }
    lines.push(box('top chats', chatLines, WIDTH))
    lines.push('')
  }

  // ---- Averages ----------------------------------------------------------
  if (agg.eventCount > 0) {
    const avg = agg.totalCost / agg.eventCount
    const days = Math.max(1, (agg.windowEnd - agg.windowStart) / (24 * 60 * 60 * 1000))
    const perDay = agg.eventCount / days
    const perDayStr = perDay >= 10 ? perDay.toFixed(0) : perDay.toFixed(1)
    lines.push(
      `  ${color.muted('avg per event')} ${color.bold(fmtCost(avg))}   ${color.muted('events/day')} ${color.bold(perDayStr)}`,
    )
    lines.push('')
  }

  return lines.join('\n')
}

// Re-exports for consumers
export { stripAnsi }
