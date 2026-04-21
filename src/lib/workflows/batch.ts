import { emitNdjsonEvent } from '../output/ndjson.ts'

export interface BatchItem<I> {
  idx: number
  item: I
}

export interface BatchResult {
  total: number
  ok: number
  errors: number
  skipped: number
}

export interface BatchOpts<I, R> {
  items: I[]
  label: string
  run: (ctx: BatchItem<I>) => Promise<R>
  ndjson?: boolean
  onError?: 'continue' | 'stop'
}

export async function runBatch<I, R>(
  opts: BatchOpts<I, R>,
): Promise<{
  summary: BatchResult
  entries: Array<{
    idx: number
    item: I
    status: 'ok' | 'error' | 'skipped'
    result?: R
    error?: unknown
  }>
}> {
  const entries: Array<{
    idx: number
    item: I
    status: 'ok' | 'error' | 'skipped'
    result?: R
    error?: unknown
  }> = []
  const summary: BatchResult = {
    total: opts.items.length,
    ok: 0,
    errors: 0,
    skipped: 0,
  }

  for (let idx = 0; idx < opts.items.length; idx++) {
    const item = opts.items[idx]!
    if (opts.ndjson) emitNdjsonEvent(`${opts.label}.start`, { idx, item })
    try {
      const result = await opts.run({ idx, item })
      summary.ok += 1
      entries.push({ idx, item, status: 'ok', result })
      if (opts.ndjson) emitNdjsonEvent(`${opts.label}.ok`, { idx, result })
    } catch (err) {
      summary.errors += 1
      entries.push({ idx, item, status: 'error', error: err })
      if (opts.ndjson)
        emitNdjsonEvent(`${opts.label}.error`, {
          idx,
          error: err instanceof Error ? err.message : String(err),
        })
      if (opts.onError === 'stop') {
        summary.skipped = opts.items.length - idx - 1
        break
      }
    }
  }

  return { summary, entries }
}

export async function readBatchItems<I>(source: 'stdin' | string): Promise<I[]> {
  if (source === 'stdin') {
    const chunks: Uint8Array[] = []
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Uint8Array)
    }
    const text = Buffer.concat(chunks).toString('utf8').trim()
    return parseBatch(text)
  }
  const file = await Bun.file(source).text()
  return parseBatch(file)
}

function parseBatch<I>(text: string): I[] {
  if (!text) return []
  // Accept both NDJSON and a top-level JSON array.
  if (text.startsWith('[')) return JSON.parse(text) as I[]
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as I)
}
