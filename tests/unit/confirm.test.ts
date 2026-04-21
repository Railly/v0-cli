import { describe, expect, test } from 'bun:test'
import { confirmOrAbort } from '../../src/lib/trust/confirm.ts'

describe('confirmOrAbort', () => {
  test('passes through when --yes is set', async () => {
    await expect(
      confirmOrAbort({
        title: 'ok',
        preview: { chat: 'x' },
        yes: true,
        mode: 'human',
      }),
    ).resolves.toBeUndefined()
  })

  test('rejects in JSON mode without --yes', async () => {
    await expect(
      confirmOrAbort({
        title: 'no',
        preview: { chat: 'x' },
        yes: false,
        mode: 'json',
      }),
    ).rejects.toThrow(/requires --yes/i)
  })

  test('rejects in human mode when stdin is not a TTY and --yes missing', async () => {
    // bun:test runs without a TTY on stdin, so this path exercises the guard.
    await expect(
      confirmOrAbort({
        title: 'no-tty',
        preview: { chat: 'x' },
        yes: false,
        mode: 'human',
      }),
    ).rejects.toThrow(/TTY|--yes/i)
  })
})
