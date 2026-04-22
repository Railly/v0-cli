import { Command } from 'commander'
import { bullet, kv, section } from '../lib/output/human.ts'
import { emitSuccess } from '../lib/output/json.ts'
import { runCommand } from '../lib/runner.ts'
import { color } from '../lib/ui/color.ts'
import { uploadToCatbox } from '../lib/uploads/catbox.ts'

export function uploadCommand(): Command {
  return new Command('upload')
    .description(
      'Upload a local file to catbox.moe (anonymous, no auth) and print the public URL. T0. Used by `chat create --attachment <path>`.',
    )
    .argument('<file>', 'local file path')
    .option(
      '--host <name>',
      'upload host (currently: catbox — more to come)',
      'catbox',
    )
    .action(
      runCommand(async ({ mode, cmd, recordResult }) => {
        const [filePath] = cmd.args as [string]
        const raw = cmd.opts<{ host?: string }>()
        const host = raw.host ?? 'catbox'
        if (host !== 'catbox') {
          throw new Error(`Unsupported --host: ${host} (only 'catbox' for now)`)
        }

        const result = await uploadToCatbox(filePath)
        recordResult(result)

        if (mode === 'json') return emitSuccess(result)
        process.stdout.write(`${section('uploaded')}\n`)
        process.stdout.write(`${kv('url', color.accent(result.url))}\n`)
        process.stdout.write(`${kv('bytes', result.bytes)}\n`)
        process.stdout.write(`${kv('host', result.host)}\n`)
        process.stdout.write(
          `${bullet(color.dim(`copy that URL into --attachment, or pipe: URL=$(v0 upload ${filePath} --json | jq -r '.data.url')`))}\n`,
        )
      }),
    )
}
