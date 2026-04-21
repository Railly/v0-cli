export function emitNdjsonLine(obj: unknown): void {
  process.stdout.write(`${JSON.stringify(obj)}\n`)
}

export function emitNdjsonEvent(event: string, data: unknown): void {
  emitNdjsonLine({ event, data, ts: new Date().toISOString() })
}
