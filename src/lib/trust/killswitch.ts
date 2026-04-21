import { stat, unlink, writeFile } from 'node:fs/promises'
import { CliError } from '../utils/errors.ts'
import { ensureConfigDir, killswitchPath } from '../utils/path.ts'

export async function killswitchStatus(): Promise<boolean> {
  try {
    await stat(killswitchPath())
    return true
  } catch {
    return false
  }
}

export async function killswitchOn(): Promise<void> {
  await ensureConfigDir()
  await writeFile(
    killswitchPath(),
    JSON.stringify({ engagedAt: new Date().toISOString() }, null, 2),
    { mode: 0o600 },
  )
}

export async function killswitchOff(): Promise<void> {
  try {
    await unlink(killswitchPath())
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}

export async function assertKillswitchOff(context: string): Promise<void> {
  if (await killswitchStatus()) {
    throw new CliError(
      {
        code: 'killswitch_engaged',
        type: 'killswitch',
        message: 'Killswitch is ON',
        userMessage: `Killswitch is engaged; ${context} blocked. Run \`v0 killswitch off\` to release.`,
      },
      4,
    )
  }
}
