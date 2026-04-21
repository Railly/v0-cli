import { describe, expect, test } from 'bun:test'
import { runBatch } from '../../src/lib/workflows/batch.ts'

describe('runBatch', () => {
  test('runs all items, counts ok/errors', async () => {
    const { summary, entries } = await runBatch<number, number>({
      items: [1, 2, 3],
      label: 'test',
      run: async ({ item }) => item * 2,
    })
    expect(summary).toEqual({ total: 3, ok: 3, errors: 0, skipped: 0 })
    expect(entries.map((e) => e.result)).toEqual([2, 4, 6])
  })

  test('onError=continue keeps going after failure', async () => {
    const { summary, entries } = await runBatch<number, number>({
      items: [1, 2, 3],
      label: 'test',
      onError: 'continue',
      run: async ({ item }) => {
        if (item === 2) throw new Error('boom')
        return item
      },
    })
    expect(summary.ok).toBe(2)
    expect(summary.errors).toBe(1)
    expect(summary.skipped).toBe(0)
    expect(entries[1]?.status).toBe('error')
  })

  test('onError=stop halts and counts skipped', async () => {
    const { summary } = await runBatch<number, number>({
      items: [1, 2, 3, 4],
      label: 'test',
      onError: 'stop',
      run: async ({ item }) => {
        if (item === 2) throw new Error('boom')
        return item
      },
    })
    expect(summary.ok).toBe(1)
    expect(summary.errors).toBe(1)
    expect(summary.skipped).toBe(2)
  })
})
