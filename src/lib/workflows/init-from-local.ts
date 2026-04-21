import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { CliError } from '../utils/errors.ts'

export interface FileEntry {
  name: string
  content: string
  locked?: boolean
}

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  '.turbo',
  '.cache',
  '.vercel',
])
const MAX_FILE_BYTES = 3 * 1024 * 1024 // 3 MB per v0 limits
const MAX_FILES = 1000

export interface ReadSourceOpts {
  root: string
  lockAll?: boolean
  include?: string[]
  exclude?: string[]
}

export async function readSource(opts: ReadSourceOpts): Promise<FileEntry[]> {
  const rootStat = await stat(opts.root).catch((err) => {
    throw new CliError(
      {
        code: 'source_not_found',
        type: 'validation_error',
        message: (err as Error).message,
        userMessage: `Source path does not exist: ${opts.root}`,
      },
      2,
    )
  })

  const files: FileEntry[] = []

  if (rootStat.isFile()) {
    const content = await readFile(opts.root, 'utf8')
    const name = opts.root.split('/').pop() ?? 'file'
    files.push({ name, content, ...(opts.lockAll ? { locked: true } : {}) })
    return files
  }

  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        await walk(abs)
      } else if (entry.isFile()) {
        const info = await stat(abs)
        if (info.size > MAX_FILE_BYTES) continue
        const content = await readFile(abs, 'utf8').catch(() => null)
        if (content === null) continue
        const name = relative(opts.root, abs)
        files.push({ name, content, ...(opts.lockAll ? { locked: true } : {}) })
      }
    }
  }

  await walk(opts.root)

  if (!files.length) {
    throw new CliError(
      {
        code: 'source_empty',
        type: 'validation_error',
        message: 'no readable files found in source',
        userMessage: `No text files found under ${opts.root} (respects 3MB/file cap; skips node_modules, .git, dist).`,
      },
      2,
    )
  }

  return files
}

export function buildFilesInitBody(params: {
  files: FileEntry[]
  name?: string
  projectId?: string
  chatPrivacy?: string
  lockAll?: boolean
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    type: 'files',
    files: params.files,
  }
  if (params.name) body.name = params.name
  if (params.projectId) body.projectId = params.projectId
  if (params.chatPrivacy) body.chatPrivacy = params.chatPrivacy
  return body
}
