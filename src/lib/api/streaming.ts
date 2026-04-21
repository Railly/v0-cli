import { parseStreamingResponse, type StreamEvent } from 'v0-sdk'

export interface StreamFrame {
  event: string
  data: unknown
  raw: string
}

export async function* readSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamFrame> {
  for await (const ev of parseStreamingResponse(stream) as AsyncGenerator<StreamEvent>) {
    const raw = ev.data
    let parsed: unknown = raw
    if (raw && raw !== '[DONE]') {
      try {
        parsed = JSON.parse(raw)
      } catch {
        parsed = raw
      }
    }
    yield { event: ev.event ?? 'message', data: parsed, raw }
  }
}
