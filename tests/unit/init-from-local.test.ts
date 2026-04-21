import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildFilesInitBody, readSource } from '../../src/lib/workflows/init-from-local.ts'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'v0cli-init-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('readSource', () => {
  test('reads nested files and skips common vendor dirs', async () => {
    writeFileSync(join(dir, 'index.ts'), 'console.log("hi")')
    mkdirSync(join(dir, 'app'))
    writeFileSync(join(dir, 'app', 'page.tsx'), 'export default function Page() {}')
    mkdirSync(join(dir, 'node_modules'))
    writeFileSync(join(dir, 'node_modules', 'ignored.js'), 'ignore me')
    mkdirSync(join(dir, '.git'))
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref')

    const files = await readSource({ root: dir })
    const names = files.map((f) => f.name).sort()
    expect(names).toEqual(['app/page.tsx', 'index.ts'])
  })

  test('applies lockAll', async () => {
    writeFileSync(join(dir, 'a.ts'), 'a')
    const files = await readSource({ root: dir, lockAll: true })
    expect(files[0]?.locked).toBe(true)
  })

  test('rejects missing path', async () => {
    await expect(readSource({ root: '/nonexistent/nowhere' })).rejects.toThrow()
  })

  test('rejects empty directories', async () => {
    await expect(readSource({ root: dir })).rejects.toThrow(/no readable files/i)
  })
})

describe('buildFilesInitBody', () => {
  test('wraps into type=files payload', () => {
    const body = buildFilesInitBody({
      files: [{ name: 'a.ts', content: 'hi' }],
      projectId: 'prj_x',
    })
    expect(body.type).toBe('files')
    expect(body.projectId).toBe('prj_x')
    expect((body.files as unknown[]).length).toBe(1)
  })
})
