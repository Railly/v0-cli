import { color } from './color.ts'

const WHITE = '#FFFFFF'
const GRAY = '#6B7280'

const V0 = `
 ██╗   ██╗ ██████╗
 ██║   ██║██╔═████╗
 ██║   ██║██║██╔██║
 ╚██╗ ██╔╝████╔╝██║
  ╚████╔╝ ╚██████╔╝
   ╚═══╝   ╚═════╝`

const CLI = `
  ██████╗██╗     ██╗
 ██╔════╝██║     ██║
 ██║     ██║     ██║
 ██║     ██║     ██║
 ╚██████╗███████╗██║
  ╚═════╝╚══════╝╚═╝`

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex)
  if (!m?.[1]) return null
  const raw = m[1]
  return [
    Number.parseInt(raw.slice(0, 2), 16),
    Number.parseInt(raw.slice(2, 4), 16),
    Number.parseInt(raw.slice(4, 6), 16),
  ]
}

function useColor(): boolean {
  if (process.env.NO_COLOR) return false
  if (process.env.FORCE_COLOR) return true
  return !!process.stdout.isTTY
}

function rgbLine(
  line: string,
  [r, g, b]: [number, number, number],
): string {
  if (!useColor()) return line
  return `\x1b[38;2;${r};${g};${b}m${line}\x1b[0m`
}

function gradientV(from: string, to: string, block: string): string {
  const a = parseHex(from)
  const b = parseHex(to)
  if (!useColor() || !a || !b) return block
  const lines = block.split('\n')
  const n = lines.length
  return lines
    .map((line, i) => {
      const t = n === 1 ? 0 : i / (n - 1)
      const rgb: [number, number, number] = [
        Math.round(a[0] + (b[0] - a[0]) * t),
        Math.round(a[1] + (b[1] - a[1]) * t),
        Math.round(a[2] + (b[2] - a[2]) * t),
      ]
      return rgbLine(line, rgb)
    })
    .join('\n')
}

export function logo(): string {
  const left = gradientV(WHITE, GRAY, V0).split('\n')
  const right = gradientV(WHITE, GRAY, CLI).split('\n')
  const rows = Math.max(left.length, right.length)
  const out: string[] = []
  for (let i = 0; i < rows; i++) {
    out.push(`${left[i] ?? ''}   ${right[i] ?? ''}`)
  }
  return out.join('\n')
}

export function tagline(): string {
  return color.dim('  Agent-first CLI for the v0 Platform API · api.v0.dev/v1')
}
