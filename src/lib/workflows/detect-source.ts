// Heuristic source detector for `chat init`. Given a single argument, infer
// whether it's a local path, a git repo URL, a zip URL, a shadcn/v0 registry
// URL, or a template id. Returns a typed discriminated union.
//
// Rules (first match wins):
//   1. Starts with `template_` or `tpl_`                → template
//   2. `/`, `./`, `../`, `~/`, or an existing directory → files
//   3. HTTP URL ending in `.zip`                        → zip
//   4. HTTP URL under github.com / gitlab.com / bitbucket.org / ssh-like
//      `git@host:user/repo` / ends in `.git`            → repo
//   5. HTTP URL with a JSON path (shadcn registry)      → registry
//   6. Any other HTTP URL                               → repo (best guess)
//   7. Everything else                                  → files (let fs fail)
//
// The caller can always force a type with --type to bypass the heuristics.

import { existsSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'

export type SourceKind = 'files' | 'repo' | 'zip' | 'registry' | 'template'

export interface DetectedSource {
  kind: SourceKind
  source: string
}

/**
 * Extract a v0 template id from a template URL. v0.app publishes templates at
 *   https://v0.app/templates/<slug>-<templateId>
 * where the id is the segment after the last `-`. Returns null if the URL
 * doesn't match the expected shape.
 */
export function extractTemplateIdFromUrl(input: string): string | null {
  const s = input.trim()
  if (!/^https?:\/\//i.test(s)) return null
  let url: URL
  try {
    url = new URL(s)
  } catch {
    return null
  }
  if (!url.host.toLowerCase().endsWith('v0.app')) return null
  const match = url.pathname.match(/^\/templates\/(.+)$/)
  if (!match?.[1]) return null
  const slug = match[1].replace(/\/$/, '')
  const lastDash = slug.lastIndexOf('-')
  if (lastDash < 0) return null
  const id = slug.slice(lastDash + 1)
  return id.length > 0 ? id : null
}

export function detectSourceKind(input: string): SourceKind {
  const s = input.trim()
  if (!s) return 'files'

  // 1. Template id prefixes
  if (/^(template_|tpl_)/i.test(s)) return 'template'

  // 1b. v0.app template URL
  if (extractTemplateIdFromUrl(s)) return 'template'

  // 2. Obvious paths (dotted relative, absolute, home-relative, cwd literal)
  if (s === '.' || s === '..') return 'files'
  if (
    s.startsWith('./') ||
    s.startsWith('../') ||
    s.startsWith('~/') ||
    isAbsolute(s)
  ) {
    return 'files'
  }

  // 3. SSH-style git remotes (`git@github.com:foo/bar.git`)
  if (/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+:[^\s]+$/.test(s) && s.endsWith('.git')) {
    return 'repo'
  }

  // 4. HTTP(S) URLs
  if (/^https?:\/\//i.test(s)) {
    const url = parseUrl(s)
    if (!url) return 'repo'
    const host = url.host.toLowerCase()
    const path = url.pathname.toLowerCase()

    if (path.endsWith('.zip')) return 'zip'
    if (path.endsWith('.git')) return 'repo'

    // Common git hosts
    if (
      host === 'github.com' ||
      host === 'gitlab.com' ||
      host === 'bitbucket.org' ||
      host.endsWith('.github.com') ||
      host.startsWith('git.') ||
      host.endsWith('.githubusercontent.com')
    ) {
      return 'repo'
    }

    // Shadcn-style registry: JSON payload at the end.
    if (path.endsWith('.json')) return 'registry'

    return 'repo'
  }

  // 5. Bare name that exists on disk — treat as local
  try {
    if (existsSync(s) && statSync(s).isDirectory()) return 'files'
  } catch {
    // ignore, fall through
  }

  // 6. Fallback: assume the user meant a local path.
  return 'files'
}

function parseUrl(input: string): URL | null {
  try {
    return new URL(input)
  } catch {
    return null
  }
}

/**
 * Convenience: detect + return the parsed descriptor.
 */
export function detectSource(input: string): DetectedSource {
  return { kind: detectSourceKind(input), source: input }
}
