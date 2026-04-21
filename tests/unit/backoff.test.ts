import { describe, expect, test } from 'bun:test'
import { withBackoff } from '../../src/lib/utils/backoff.ts'

describe('withBackoff', () => {
  test('returns result on first success', async () => {
    const result = await withBackoff(async () => 42)
    expect(result).toBe(42)
  })

  test('retries 429 up to maxRetries, then throws', async () => {
    let attempts = 0
    await expect(
      withBackoff(
        async () => {
          attempts += 1
          throw new Error('HTTP 429: Too Many Requests')
        },
        { maxRetries: 2, baseMs: 1, maxMs: 2 },
      ),
    ).rejects.toThrow('HTTP 429')
    expect(attempts).toBe(3) // 1 initial + 2 retries
  })

  test('does not retry 4xx (non-429)', async () => {
    let attempts = 0
    await expect(
      withBackoff(
        async () => {
          attempts += 1
          throw new Error('HTTP 404: Not Found')
        },
        { maxRetries: 3, baseMs: 1 },
      ),
    ).rejects.toThrow('HTTP 404')
    expect(attempts).toBe(1)
  })

  test('retries 5xx', async () => {
    let attempts = 0
    await expect(
      withBackoff(
        async () => {
          attempts += 1
          throw new Error('HTTP 503: Service Unavailable')
        },
        { maxRetries: 1, baseMs: 1 },
      ),
    ).rejects.toThrow('HTTP 503')
    expect(attempts).toBe(2)
  })
})
