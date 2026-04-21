const ESC = '['
const RESET = `${ESC}0m`

const useColor = (): boolean => {
  if (process.env.NO_COLOR) return false
  if (process.env.FORCE_COLOR) return true
  return !!process.stdout.isTTY
}

const wrap =
  (open: string) =>
  (text: string | number): string => {
    if (!useColor()) return String(text)
    return `${ESC}${open}m${text}${RESET}`
  }

export const color = {
  brand: wrap('38;5;213'),
  accent: wrap('38;5;117'),
  success: wrap('38;5;114'),
  warn: wrap('38;5;215'),
  error: wrap('38;5;203'),
  info: wrap('38;5;117'),
  muted: wrap('38;5;246'),
  dim: wrap('2'),
  bold: wrap('1'),
  underline: wrap('4'),
  inverse: wrap('7'),
}

export function badge(label: string, hue: keyof typeof color = 'accent'): string {
  const fn = color[hue]
  return `${fn(` ${label} `)}`
}
