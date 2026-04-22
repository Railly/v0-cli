// Anonymous file upload via catbox.moe — the simplest public host that
// still matters. No auth, no expiry, 200MB max. Returns a permanent URL
// on success. Used by `v0 upload` and `chat create --attachment <path>`.
//
// API: POST https://catbox.moe/user/api.php with multipart form fields
//   - reqtype=fileupload
//   - fileToUpload=@<file>
// Response body on success is the URL (single line, no JSON).
//
// Error modes we care about:
//   - Network failure                    → throw NetworkError
//   - HTTP non-2xx                       → throw UploadError(status, body)
//   - 200 but body isn't an https URL    → throw UploadError (host hiccup)
//   - File doesn't exist                 → throw ENOENT from fs.stat

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'

const CATBOX_ENDPOINT = 'https://catbox.moe/user/api.php'
const MAX_BYTES = 200 * 1024 * 1024 // 200 MB

export interface UploadResult {
  url: string
  host: 'catbox.moe'
  bytes: number
  file: string
}

export class UploadError extends Error {
  constructor(
    message: string,
    readonly details?: { status?: number; body?: string },
  ) {
    super(message)
    this.name = 'UploadError'
  }
}

/**
 * Upload a local file to catbox.moe and return the public URL.
 */
export async function uploadToCatbox(filePath: string): Promise<UploadResult> {
  const info = await stat(filePath)
  if (!info.isFile()) {
    throw new UploadError(`Not a regular file: ${filePath}`)
  }
  if (info.size > MAX_BYTES) {
    throw new UploadError(
      `File too large (${info.size} bytes, max ${MAX_BYTES}): ${filePath}`,
    )
  }

  const form = new FormData()
  form.append('reqtype', 'fileupload')
  // Read the whole file into a Blob — catbox doesn't support chunked
  // uploads and Node/Bun's fetch can't stream a body with Content-Length
  // unset. For 200MB max this is fine.
  const buf = await streamToBuffer(filePath)
  form.append('fileToUpload', new Blob([buf]), basename(filePath))

  let res: Response
  try {
    res = await fetch(CATBOX_ENDPOINT, { method: 'POST', body: form })
  } catch (err) {
    throw new UploadError(
      `Network error uploading to catbox: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const body = (await res.text()).trim()
  if (!res.ok) {
    throw new UploadError(`catbox returned HTTP ${res.status}`, {
      status: res.status,
      body,
    })
  }
  if (!/^https:\/\/files\.catbox\.moe\/[\w.-]+$/.test(body)) {
    throw new UploadError(`catbox returned an unexpected body: ${body.slice(0, 200)}`, {
      status: res.status,
      body,
    })
  }

  return {
    url: body,
    host: 'catbox.moe',
    bytes: info.size,
    file: filePath,
  }
}

/**
 * Heuristic: is the given string a URL rather than a local path?
 * Used by consumers that accept either and need to decide whether to upload.
 */
export function isHttpUrl(input: string): boolean {
  return /^https?:\/\//i.test(input.trim())
}

async function streamToBuffer(filePath: string): Promise<Buffer> {
  const chunks: Buffer[] = []
  const stream = createReadStream(filePath)
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}
