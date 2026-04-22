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
        const example = (comment: string, cmdText: string): void => {
          lines.push(`  ${color.muted('#')} ${color.dim(comment)}`)
          lines.push(`  ${color.accent('v0')} ${color.info(cmdText)}`)
          lines.push('')
        }

        lines.push('')
        lines.push(`${color.bold('EXAMPLES')}`)
        lines.push(
          `  ${color.dim('Shorthand: v0 <arg> routes by shape — path/URL/template → chat init, else chat create.')}`,
        )
        lines.push('')

        example('prompt → chat create', '"landing page with hero and pricing"')
        example('local dir → chat init (files, zero tokens)', './my-project')
        example('cwd → chat init (files)', '.')
        example(
          'github repo → chat init (repo)',
          'https://github.com/vercel/next.js',
        )
        example(
          'v0 template URL → chat init (template, extracts id)',
          'https://v0.app/templates/optimus-...-LHv4frpA7Us',
        )
        example('bare template id → chat init (template)', 'template_abc123')
        example('zip archive → chat init (zip)', 'https://example.com/dist.zip')
        example(
          'shadcn registry → chat init (registry)',
          'https://ui.shadcn.com/registry/button.json',
        )

        lines.push(`  ${color.dim('Core workflow:')}`)
        lines.push('')
        example('preflight health check', 'doctor')
        example('check account + plan + rate limits', 'auth whoami --json')
        example('iterate on an existing chat', 'msg send <chat-id> "add dark mode"')
        example('download a version as a zip', 'version download <chat> <ver>')
        example('ship a deployment (auto-resolves latest version)', 'deploy create <chat> --yes --wait')
        example('parallel: fire 3 chats, collect later', '"hero" --background --json')
        example('introspect any of the 55 operations', 'schema chats.init')

        lines.push(color.dim('Docs: https://v0-cli.crafter.run/docs'))
      }

      return `${lines.join('\n')}\n`
    },
  })
}
