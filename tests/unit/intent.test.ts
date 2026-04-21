import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Profile } from '../../src/lib/config/profiles.ts'
import {
  formatIntentToken,
  listIntents,
  mintIntentToken,
  parseIntentToken,
  purgeExpired,
  verifyAndConsumeIntent,
} from '../../src/lib/trust/intent.ts'

let tempDir: string

const profile: Profile = {
  profile: { name: 'test' },
  trust: { intent_ttl_minutes: 15 },
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'v0cli-intent-'))
  process.env.V0_CLI_CONFIG_DIR = tempDir
})

afterEach(() => {
  delete process.env.V0_CLI_CONFIG_DIR
  rmSync(tempDir, { recursive: true, force: true })
})

describe('mint + verify', () => {
  test('happy path', async () => {
    const { token } = await mintIntentToken({
      action: 'hook delete',
      params: { hookId: 'hk_1' },
      profile,
    })
    const payload = await verifyAndConsumeIntent({
      token,
      action: 'hook delete',
      params: { hookId: 'hk_1' },
    })
    expect(payload.action).toBe('hook delete')
  })

  test('single use — second verify fails', async () => {
    const { token } = await mintIntentToken({
      action: 'hook delete',
      params: { hookId: 'hk_1' },
      profile,
    })
    await verifyAndConsumeIntent({ token, action: 'hook delete', params: { hookId: 'hk_1' } })
    await expect(
      verifyAndConsumeIntent({ token, action: 'hook delete', params: { hookId: 'hk_1' } }),
    ).rejects.toThrow(/already used|consumed/i)
  })

  test('action mismatch rejected', async () => {
    const { token } = await mintIntentToken({
      action: 'hook delete',
      params: { hookId: 'hk_1' },
      profile,
    })
    await expect(
      verifyAndConsumeIntent({ token, action: 'env delete', params: { hookId: 'hk_1' } }),
    ).rejects.toThrow(/does not match/i)
  })

  test('params mismatch rejected', async () => {
    const { token } = await mintIntentToken({
      action: 'env delete',
      params: { ids: ['a'] },
      profile,
    })
    await expect(
      verifyAndConsumeIntent({ token, action: 'env delete', params: { ids: ['b'] } }),
    ).rejects.toThrow(/params/i)
  })

  test('expired rejected', async () => {
    const tight: Profile = { trust: { intent_ttl_minutes: 0 } }
    const { token } = await mintIntentToken({ action: 'hook delete', params: {}, profile: tight })
    // ensure expiry crossed
    await new Promise((r) => setTimeout(r, 10))
    await expect(
      verifyAndConsumeIntent({ token, action: 'hook delete', params: {} }),
    ).rejects.toThrow(/expired/i)
  })

  test('malformed token rejected', () => {
    expect(() => parseIntentToken('garbage')).toThrow()
  })

  test('format roundtrip', () => {
    const formatted = formatIntentToken({ id: 'intent_x', sig: 'abc', expiresAt: 123 })
    const parsed = parseIntentToken(formatted)
    expect(parsed.id).toBe('intent_x')
    expect(parsed.sig).toBe('abc')
  })
})

describe('listIntents + purgeExpired', () => {
  test('lists minted and purges consumed', async () => {
    const { token: t1 } = await mintIntentToken({
      action: 'hook delete',
      params: { hookId: 'hk_1' },
      profile,
    })
    await mintIntentToken({ action: 'hook delete', params: { hookId: 'hk_2' }, profile })
    expect((await listIntents()).length).toBe(2)
    await verifyAndConsumeIntent({ token: t1, action: 'hook delete', params: { hookId: 'hk_1' } })
    const purged = await purgeExpired()
    expect(purged).toBe(1)
    const remaining = await listIntents()
    expect(remaining.length).toBe(1)
  })
})
