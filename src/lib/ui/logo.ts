import { color } from './color.ts'

const ascii = `
       ▌ ▛▀▖  ▞▀▖▌  ▜▘
▌ ▌ ▞▀▖▌ ▙▄▘  ▌  ▌  ▐
▐▐  ▌ ▌▌ ▌    ▌ ▖▌  ▐
 ▘  ▝▀ ▘ ▘    ▝▀ ▀▀▘▀▘`

export function logo(): string {
  return ascii
    .split('\n')
    .map((line, idx) =>
      idx === 0 || idx === ascii.split('\n').length - 1 ? line : color.brand(line),
    )
    .join('\n')
}

export function tagline(): string {
  return color.dim('Agent-first CLI for the v0 Platform API · api.v0.dev/v1')
}
