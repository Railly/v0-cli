import type { Command } from 'commander'
import { color } from './color.ts'
import { logo, tagline } from './logo.ts'

export function renderHeader(): string {
  return `${logo()}\n${tagline()}\n`
}

export function mountHelp(program: Command): void {
  program.configureHelp({
    sortSubcommands: true,
    subcommandTerm: (cmd) =>
      cmd.name() + (cmd.aliases().length ? ` (${cmd.aliases().join(', ')})` : ''),
    formatHelp: (cmd, helper) => {
      const name = helper.commandUsage(cmd)
      const desc = cmd.description()
      const lines: string[] = []

      if (cmd === program) {
        lines.push(renderHeader())
      }

      lines.push(`${color.bold('USAGE')}`)
      lines.push(`  ${color.accent(name)}`)

      if (desc) {
        lines.push('')
        lines.push(`${color.bold('DESCRIPTION')}`)
        lines.push(`  ${desc}`)
      }

      const cmds = helper.visibleCommands(cmd)
      if (cmds.length) {
        const termWidth = cmds.reduce((m, c) => Math.max(m, helper.subcommandTerm(c).length), 0)
        lines.push('')
        lines.push(`${color.bold('COMMANDS')}`)
        for (const sub of cmds) {
          const term = helper.subcommandTerm(sub).padEnd(termWidth)
          const d = sub.description() || ''
          lines.push(`  ${color.accent(term)}  ${color.muted(d)}`)
        }
      }

      const opts = helper.visibleOptions(cmd)
      if (opts.length) {
        const termWidth = opts.reduce((m, o) => Math.max(m, helper.optionTerm(o).length), 0)
        lines.push('')
        lines.push(`${color.bold('OPTIONS')}`)
        for (const opt of opts) {
          const term = helper.optionTerm(opt).padEnd(termWidth)
          const d = helper.optionDescription(opt)
          lines.push(`  ${color.info(term)}  ${color.muted(d)}`)
        }
      }

      if (cmd === program) {
        lines.push('')
        lines.push(`${color.bold('EXAMPLES')}`)
        lines.push(`  ${color.muted('#')} ${color.dim('one-liner: create a chat')}`)
        lines.push(
          `  ${color.accent('v0')} ${color.info('"Build a terminal dashboard with CRT scanlines"')}`,
        )
        lines.push('')
        lines.push(`  ${color.muted('#')} ${color.dim('check account state')}`)
        lines.push(`  ${color.accent('v0')} ${color.info('auth whoami --json')}`)
        lines.push('')
        lines.push(`  ${color.muted('#')} ${color.dim('rate-limit preflight')}`)
        lines.push(`  ${color.accent('v0')} ${color.info('rate-limits --json')}`)
        lines.push('')
        lines.push(`  ${color.muted('#')} ${color.dim('introspect an endpoint')}`)
        lines.push(`  ${color.accent('v0')} ${color.info('schema chats.init')}`)
        lines.push('')
        lines.push(color.dim('Docs: https://github.com/Railly/v0-cli'))
      }

      return `${lines.join('\n')}\n`
    },
  })
}
