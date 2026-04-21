import * as p from '@clack/prompts'
import { color } from '../ui/color.ts'
import { CliError } from '../utils/errors.ts'
import { isStdinTTY } from '../utils/tty.ts'

export interface ConfirmOpts {
  title: string
  preview: Record<string, string>
  question?: string
  yes?: boolean
  mode: 'human' | 'json'
}

function renderPreviewText(title: string, preview: Record<string, string>): void {
  process.stderr.write(`\n${color.bold('›')} ${color.brand(title)}\n`)
  const termWidth = Math.max(...Object.keys(preview).map((k) => k.length))
  for (const [k, v] of Object.entries(preview)) {
    process.stderr.write(`  ${color.muted(k.padEnd(termWidth))}  ${v}\n`)
  }
  process.stderr.write('\n')
}

export async function confirmOrAbort(opts: ConfirmOpts): Promise<void> {
  if (opts.yes) return

  if (opts.mode === 'json') {
    throw new CliError(
      {
        code: 'confirmation_required',
        type: 'validation_error',
        message: 'T2 operation requires --yes in non-interactive / JSON mode',
        userMessage:
          'This command requires confirmation. Re-run with --yes, or inspect with --dry-run first.',
      },
      2,
    )
  }

  if (!isStdinTTY()) {
    throw new CliError(
      {
        code: 'no_tty',
        type: 'validation_error',
        message: 'T2 operation requires a TTY for interactive confirm (or pass --yes)',
        userMessage: 'No TTY detected. Pipe output, or pass --yes to bypass the confirm.',
      },
      2,
    )
  }

  renderPreviewText(opts.title, opts.preview)
  const answer = await p.confirm({
    message: opts.question ?? 'Continue?',
    initialValue: false,
  })
  if (p.isCancel(answer) || !answer) {
    throw new CliError(
      {
        code: 'user_cancelled',
        type: 'cancelled',
        message: 'user cancelled',
        userMessage: 'Cancelled.',
      },
      130,
    )
  }
}
