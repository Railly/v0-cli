import { color } from '../ui/color.ts'

export function kv(label: string, value: string | number | undefined | null): string {
  const v = value === undefined || value === null ? color.dim('—') : String(value)
  return `${color.muted(label.padEnd(18))} ${v}`
}

export function section(title: string): string {
  // Two-part heading: accent-bold kicker + muted count if present.
  // "CHATS (20)" → `CHATS` in accent bold, `(20)` in dim.
  const m = title.match(/^(.+?)\s*(\([^)]+\))\s*$/)
  if (m?.[1] && m[2]) {
    return `${color.bold(color.accent(m[1].toUpperCase()))} ${color.dim(m[2])}`
  }
  return color.bold(color.accent(title.toUpperCase()))
}

// ---------------------------------------------------------------------------
// Auto-colorized table rendering.
//
// The table() helper used to print every cell in plain text, which made lists
// of 20+ rows read as a wall of undifferentiated gray. Now we detect column
// semantics from the `key` string and apply discreet, utilitarian colors:
//
//   - id columns        → muted (dimmed gray, monospace-like)
//   - name / title      → primary foreground (stands out)
//   - privacy / status  → tinted by value (private=muted, public=success,
//                         unlisted=warn, archived=dim, running=warn, done=success,
//                         failed/error=error)
//   - timestamps        → formatted relative + dimmed
//   - url columns       → accent (makes them scannable)
//   - numeric counts    → dim
//
// Each cell keeps its visual width but gets ANSI colors. Headers stay bold.
// ---------------------------------------------------------------------------

type ColumnType =
  | 'id'
  | 'name'
  | 'title'
  | 'privacy'
  | 'status'
  | 'timestamp'
  | 'url'
  | 'prompt'
  | 'count'
  | 'default'

function inferColumnType(key: string): ColumnType {
  const k = key.toLowerCase()
  if (k === 'id' || k.endsWith('id') || k === 'chat' || k === 'pid') return 'id'
  if (k === 'name') return 'name'
  if (k === 'title') return 'title'
  if (k === 'privacy') return 'privacy'
  if (k === 'status') return 'status'
  if (k === 'prompt' || k === 'message') return 'prompt'
  if (
    k === 'updated' ||
    k === 'created' ||
    k === 'started' ||
    k === 'finished' ||
    k === 'ts' ||
    k.endsWith('at')
  )
    return 'timestamp'
  if (k === 'url' || k === 'preview' || k === 'demo' || k === 'webhook') return 'url'
  if (k === 'files' || k === 'count' || k === 'n' || k === 'size' || k === 'bytes') return 'count'
  return 'default'
}

function stripAnsi(s: string): string {
  // Strip ANSI escapes so we can measure visible width regardless of coloring.
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

function formatTimestamp(raw: string): string {
  // Accept ISO 8601 / epoch millis. Fall back to raw if unparseable.
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw
  const now = Date.now()
  const diff = now - d.getTime()
  if (diff < 0) return raw
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days}d ago`
  // Older: show the date.
  return d.toISOString().slice(0, 10)
}

function colorizeCell(type: ColumnType, raw: string): string {
  if (raw === '—' || raw === '') return color.dim(raw || '—')
  switch (type) {
    case 'id':
      return color.muted(raw)
    case 'name':
      return raw // primary foreground — default
    case 'title':
      return color.bold(raw)
    case 'privacy':
      if (raw === 'private') return color.muted(raw)
      if (raw === 'public') return color.success(raw)
      if (raw === 'unlisted') return color.warn(raw)
      if (raw === 'team' || raw === 'team-edit') return color.accent(raw)
      return raw
    case 'status':
      if (/ok|ready|done|success|active|completed|deployed/i.test(raw)) return color.success(raw)
      if (/fail|error|stalled|cancell?ed/i.test(raw)) return color.error(raw)
      if (/pending|running|building|queued|progress|warn/i.test(raw)) return color.warn(raw)
      if (/archived|stopped|off|idle/i.test(raw)) return color.dim(raw)
      return raw
    case 'timestamp':
      return color.dim(formatTimestamp(raw))
    case 'url':
      return color.accent(raw)
    case 'prompt':
      return color.dim(raw)
    case 'count':
      return color.dim(raw)
    default:
      return raw
  }
}

export function table<T extends Record<string, unknown>>(
  rows: T[],
  cols: { key: keyof T; header: string; format?: (v: unknown) => string }[],
): string {
  if (!rows.length) return color.dim('(empty)')
  const types = cols.map((c) => inferColumnType(String(c.key)))
  // Render each cell twice: once formatted (display with color) and once raw
  // (for width measurement). We compute column widths off the VISIBLE width
  // so padding stays aligned regardless of ANSI escapes.
  const cellMatrix = rows.map((r) =>
    cols.map((c, i) => {
      const raw = r[c.key]
      const base = c.format
        ? c.format(raw)
        : raw === undefined || raw === null
          ? '—'
          : String(raw)
      const colored = colorizeCell(types[i] ?? 'default', base)
      return { raw: stripAnsi(colored), colored }
    }),
  )
  const widths = cols.map((c, i) =>
    Math.max(
      c.header.length,
      ...cellMatrix.map((row) => row[i]?.raw.length ?? 0),
    ),
  )
  const header = cols
    .map((c, i) => color.bold(color.muted(c.header.padEnd(widths[i] ?? 0))))
    .join('  ')
  const lines = [header]
  for (const row of cellMatrix) {
    lines.push(
      row
        .map((cell, i) => padRightVisible(cell.colored, widths[i] ?? 0))
        .join('  '),
    )
  }
  return lines.join('\n')
}

export function bullet(text: string): string {
  return `  ${color.accent('›')} ${text}`
}
