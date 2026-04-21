import { Command } from 'commander'
import { kv, section } from '../lib/output/human.ts'
import { emitSuccess } from '../lib/output/json.ts'
import { killswitchOff, killswitchOn, killswitchStatus } from '../lib/trust/killswitch.ts'
import { color } from '../lib/ui/color.ts'
import { detectDefaultMode } from '../lib/utils/tty.ts'

export function killswitchCommand(): Command {
  const cmd = new Command('killswitch').description('Local hard-stop for T2/T3 operations')

  const render = async (mode: 'human' | 'json', action: string) => {
    const on = await killswitchStatus()
    if (mode === 'json') return emitSuccess({ action, engaged: on })
    process.stdout.write(`${section('killswitch')}\n`)
    process.stdout.write(`${kv('state', on ? color.error('ENGAGED') : color.success('off'))}\n`)
    process.stdout.write(`${kv('action', action)}\n`)
  }

  cmd
    .command('on')
    .description('Engage the killswitch (blocks T2/T3)')
    .option('--json', 'force JSON output')
    .action(async (rawOpts: { json?: boolean }, cmd: Command) => {
      await killswitchOn()
      const mode =
        rawOpts.json || cmd.optsWithGlobals<{ json?: boolean }>().json
          ? 'json'
          : detectDefaultMode()
      await render(mode, 'engaged')
    })

  cmd
    .command('off')
    .description('Release the killswitch')
    .option('--json', 'force JSON output')
    .action(async (rawOpts: { json?: boolean }, cmd: Command) => {
      await killswitchOff()
      const mode =
        rawOpts.json || cmd.optsWithGlobals<{ json?: boolean }>().json
          ? 'json'
          : detectDefaultMode()
      await render(mode, 'released')
    })

  cmd
    .command('status')
    .description('Show current state')
    .option('--json', 'force JSON output')
    .action(async (rawOpts: { json?: boolean }, cmd: Command) => {
      const mode =
        rawOpts.json || cmd.optsWithGlobals<{ json?: boolean }>().json
          ? 'json'
          : detectDefaultMode()
      await render(mode, 'status')
    })

  return cmd
}
