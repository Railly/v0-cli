// Terminal viz primitives — zero deps, pure string manipulation.
// Consumed by `v0 report usage` today; destined for extraction as a cligentic
// block once the shape stabilizes.
//
// Width model: every function assumes ANSI-free visible width. Callers wrap
// with color.* after rendering if they want tint. Never nest ANSI inside
// measured columns — use a plain-text scaffold and a separate color layer.

import { color } from '../ui/color.ts'

// ---------------------------------------------------------------------------
// Sparkline — unicode block chars, 8 levels.
// ---------------------------------------------------------------------------

const SPARK_CHARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

export function sparkline(values: number[]): string {
  if (!values.length) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  return values
    .map((v) => {
      const idx = Math.min(
        SPARK_CHARS.length - 1,
        Math.max(0, Math.floor(((v - min) / range) * SPARK_CHARS.length)),
      )
      return SPARK_CHARS[idx] ?? ' '
    })
    .join('')
}

// ---------------------------------------------------------------------------
// Horizontal bar — a single bar row with a value and % fill.
// Renders: `████████░░░░░░░░░░░░░░` (no label/value — caller composes).
// ---------------------------------------------------------------------------

export function hbar(ratio: number, width: number): string {
  const clamped = Math.min(1, Math.max(0, ratio))
  const filled = Math.round(clamped * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

// ---------------------------------------------------------------------------
// Stacked horizontal bar — two or more segments in one row.
// segments: [{ value, char }]. Uses ▓, ▒, ░ for visual distinction without
// color dependency.
// ---------------------------------------------------------------------------

export type StackedSegment = {
  value: number
  char?: string
  colorize?: (s: string) => string
}

export function stackedBar(segments: StackedSegment[], width: number): string {
  const total = segments.reduce((a, s) => a + Math.max(0, s.value), 0)
  if (total <= 0) return '░'.repeat(width)
  // Compute integer widths that sum to `width`, distributing remainder to the
  // largest fractional parts.
  const floatWidths = segments.map((s) => (Math.max(0, s.value) / total) * width)
  const intWidths = floatWidths.map((w) => Math.floor(w))
  let remainder = width - intWidths.reduce((a, w) => a + w, 0)
  const fracs = floatWidths.map((w, i) => ({ i, frac: w - Math.floor(w) }))
  fracs.sort((a, b) => b.frac - a.frac)
  for (const f of fracs) {
    if (remainder <= 0) break
    const cur = intWidths[f.i]
    if (cur === undefined) continue
    intWidths[f.i] = cur + 1
    remainder--
  }
  return segments
    .map((s, i) => {
      const ch = s.char ?? '█'
      const str = ch.repeat(intWidths[i] ?? 0)
      return s.colorize ? s.colorize(str) : str
    })
    .join('')
}

// ---------------------------------------------------------------------------
// Box — unicode-box-drawn container with a title.
// width is the total including borders (2 cols consumed by │).
// lines should already be plain-text with ANSI stripped for width math; caller
// passes `ansiWidth` hint if colors are embedded.
// ---------------------------------------------------------------------------

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

function visibleWidth(s: string): number {
  return stripAnsi(s).length
}

function padRightVisible(s: string, width: number): string {
  const w = visibleWidth(s)
  if (w >= width) return s
  return s + ' '.repeat(width - w)
}

export function box(title: string, lines: string[], width: number): string {
  const inner = Math.max(0, width - 2)
  const titleLine = ` ${title} `
  const dashes = '─'.repeat(Math.max(0, inner - visibleWidth(titleLine)))
  const top = `┌${color.dim(titleLine)}${color.dim(dashes)}┐`
  const bottom = `└${color.dim('─'.repeat(inner))}┘`
  const body = lines
    .map((l) => `${color.dim('│')}${padRightVisible(l, inner)}${color.dim('│')}`)
    .join('\n')
  return `${top}\n${body}\n${bottom}`
}

// ---------------------------------------------------------------------------
// Delta arrow — up/down/flat with +N% / -N% formatting.
// ---------------------------------------------------------------------------

export function trendArrow(
  prev: number,
  curr: number,
): { arrow: string; label: string; kind: 'up' | 'down' | 'flat' } {
  if (prev === 0 && curr === 0) return { arrow: '·', label: 'flat', kind: 'flat' }
  if (prev === 0) return { arrow: '▲', label: 'new', kind: 'up' }
  const pct = ((curr - prev) / prev) * 100
  const abs = Math.abs(pct)
  if (abs < 1) return { arrow: '·', label: 'flat', kind: 'flat' }
  const sign = pct > 0 ? '+' : '-'
  const arrow = pct > 0 ? '▲' : '▼'
  const kind: 'up' | 'down' = pct > 0 ? 'up' : 'down'
  return {
    arrow,
    label: `${sign}${abs.toFixed(abs < 10 ? 1 : 0)}%`,
    kind,
  }
}

// ---------------------------------------------------------------------------
// Currency + number formatting.
// ---------------------------------------------------------------------------

export function fmtCost(n: number): string {
  if (!Number.isFinite(n)) return '$0.00'
  if (n < 0.01) return `$${n.toFixed(4)}`
  if (n < 1) return `$${n.toFixed(3)}`
  return `$${n.toFixed(2)}`
}

export function fmtCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1000000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1000000).toFixed(1)}M`
}

// Re-export width helpers for consumers composing custom layouts.
export { padRightVisible, stripAnsi, visibleWidth }
