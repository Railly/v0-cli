// Thin wrapper around cligentic/safety/killswitch. All callers use this
// module so we can map cligentic's generic Error into our CliError + exit 4.

import {
  assertKillswitchOff as cligenticAssert,
  turnKillswitchOff as cligenticOff,
  turnKillswitchOn as cligenticOn,
  getKillswitchState,
  isKillswitchOn,
} from '../../cli/safety/killswitch.ts'
import { CliError } from '../utils/errors.ts'
import { paths } from '../utils/path.ts'

function appHome(): string {
  return paths().state
}

export async function killswitchStatus(): Promise<boolean> {
  return isKillswitchOn(appHome())
}

export async function killswitchOn(reason = 'manual'): Promise<void> {
  cligenticOn(appHome(), reason)
}

export async function killswitchOff(): Promise<void> {
  cligenticOff(appHome())
}

export async function assertKillswitchOff(context: string): Promise<void> {
  try {
    cligenticAssert(appHome())
  } catch (err) {
    const state = getKillswitchState(appHome())
    throw new CliError(
      {
        code: 'killswitch_engaged',
        type: 'killswitch',
        message: 'Killswitch is ON',
        userMessage: `Killswitch is engaged; ${context} blocked${
          state.reason ? ` (${state.reason})` : ''
        }. Run \`v0 killswitch off\` to release.`,
      },
      4,
    )
  }
}
