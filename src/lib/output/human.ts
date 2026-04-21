import { color } from '../ui/color.ts'

export function kv(label: string, value: string | number | undefined | null): string {
  const v = value === undefined || value === null ? color.dim('—') : String(value)
  return `${color.muted(label.padEnd(18))} ${v}`
}

export function section(title: string): string {
  return color.bold(title.toUpperCase())
}

export function table<T extends Record<string, unknown>>(
  rows: T[],
  cols: { key: keyof T; header: string; format?: (v: unknown) => string }[],
): string {
  if (!rows.length) return color.dim('(empty)')
  const widths = cols.map((c) =>
    Math.max(
      c.header.length,
      ...rows.map((r) => {
        const raw = r[c.key]
        const formatted = c.format
          ? c.format(raw)
          : raw === undefined || raw === null
            ? '—'
            : String(raw)
        return formatted.length
      }),
    ),
  )
  const header = cols.map((c, i) => color.bold(c.header.padEnd(widths[i]!))).join('  ')
  const lines = [header]
  for (const r of rows) {
    const line = cols
      .map((c, i) => {
        const raw = r[c.key]
        const formatted = c.format
          ? c.format(raw)
          : raw === undefined || raw === null
            ? color.dim('—')
            : String(raw)
        return formatted.padEnd(widths[i]!)
      })
      .join('  ')
    lines.push(line)
  }
  return lines.join('\n')
}

export function bullet(text: string): string {
  return `  ${color.accent('›')} ${text}`
}
