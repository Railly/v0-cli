import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertKillswitchOff,
  killswitchOff,
  killswitchOn,
  killswitchStatus,
} from '../../src/lib/trust/killswitch.ts'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'v0cli-'))
  process.env.V0CLI_HOME = tempDir
})

afterEach(() => {
  delete process.env.V0CLI_HOME
  rmSync(tempDir, { recursive: true, force: true })
})

describe('killswitch', () => {
  test('is off by default', async () => {
    expect(await killswitchStatus()).toBe(false)
  })

  test('on/off round trip', async () => {
    await killswitchOn()
    expect(await killswitchStatus()).toBe(true)
    await killswitchOff()
    expect(await killswitchStatus()).toBe(false)
  })

  test('assertKillswitchOff throws when engaged', async () => {
    await killswitchOn()
    await expect(assertKillswitchOff('test op')).rejects.toThrow(/Killswitch is ON/)
  })

  test('off-off is idempotent', async () => {
    await killswitchOff()
    await killswitchOff()
    expect(await killswitchStatus()).toBe(false)
  })
})
