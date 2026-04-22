import type { StreamFrame } from '../api/streaming.ts'

export type PhaseEvent =
  | { kind: 'chat-created'; chatId: string; url?: string }
  // Title deltas are full replacements in most cases (v0 re-emits the
  // whole title on each chunk). The renderer MUST replace, not concatenate.
  // `source` lets the renderer prefer chat.title over chat.name when both
  // arrive for the same chat (they usually carry the same value).
  | { kind: 'title'; title: string; source: 'title' | 'name' }
  | { kind: 'task-active'; label: string }
  | { kind: 'task-complete'; label: string }
  | {
      kind: 'done'
      chatId: string
      versionId?: string
      files: Array<{ name: string; lang?: string; bytes: number }>
      webUrl?: string
      demo?: string
      title?: string
    }
  | { kind: 'error'; message: string }
  | { kind: 'raw'; frame: StreamFrame }

const ACTIVE_RE = /"taskNameActive"\s*:\s*"([^"]+)"/g
const COMPLETE_RE = /"taskNameComplete"\s*:\s*"([^"]+)"/g

export function* extractPhases(frame: StreamFrame): Generator<PhaseEvent> {
  const data = frame.data
  if (!data || typeof data !== 'object') {
    yield { kind: 'raw', frame }
    return
  }
  const obj = data as Record<string, unknown>
  const object = obj.object
  const id = typeof obj.id === 'string' ? obj.id : undefined

  if (object === 'chat' && id) {
    const files = Array.isArray(obj.files) ? (obj.files as Array<Record<string, unknown>>) : []
    const latestVersion = obj.latestVersion as { id?: string } | undefined
    const hasFullVersion =
      typeof latestVersion?.id === 'string' && latestVersion.id.length > 0 && files.length > 0
    if (hasFullVersion) {
      yield {
        kind: 'done',
        chatId: id,
        versionId: latestVersion?.id,
        files: files.map((f) => {
          const meta = (f.meta as Record<string, unknown>) ?? {}
          const name = typeof meta.file === 'string' ? meta.file : String(f.name ?? 'file')
          const src = typeof f.source === 'string' ? f.source : ''
          return {
            name,
            lang: typeof f.lang === 'string' ? f.lang : undefined,
            bytes: src.length,
          }
        }),
        webUrl: typeof obj.webUrl === 'string' ? obj.webUrl : undefined,
        demo: typeof obj.demo === 'string' ? obj.demo : undefined,
        title: typeof obj.title === 'string' ? obj.title : undefined,
      }
      return
    }
    yield {
      kind: 'chat-created',
      chatId: id,
      url: typeof obj.webUrl === 'string' ? obj.webUrl : undefined,
    }
    return
  }

  if (object === 'chat.title' && typeof obj.delta === 'string') {
    yield { kind: 'title', title: obj.delta, source: 'title' }
    return
  }
  if (object === 'chat.name' && typeof obj.delta === 'string') {
    yield { kind: 'title', title: obj.delta, source: 'name' }
    return
  }

  if (object === 'message.experimental_content.chunk') {
    const raw = frame.raw
    for (const m of raw.matchAll(ACTIVE_RE)) {
      const label = m[1]
      if (label) yield { kind: 'task-active', label }
    }
    for (const m of raw.matchAll(COMPLETE_RE)) {
      const label = m[1]
      if (label) yield { kind: 'task-complete', label }
    }
    return
  }

  if (object === 'error' || typeof obj.error === 'string') {
    const err = typeof obj.error === 'string' ? obj.error : JSON.stringify(obj)
    yield { kind: 'error', message: err }
  }
}
