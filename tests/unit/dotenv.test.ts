import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  diffLocalVsRemote,
  parseDotEnv,
  readDotEnv,
  writeDotEnv,
} from '../../src/lib/workflows/dotenv.ts'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'v0cli-dotenv-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('parseDotEnv', () => {
  test('parses KEY=VALUE with quotes and export prefix', () => {
    const entries = parseDotEnv(
      [
        'FOO=bar',
        'export BAZ="qux"',
        "HOME='/tmp'",
        '# comment',
        '',
        'MULTI_WORD=hello world',
        'WITH_TAIL=value # trailing',
      ].join('\n'),
    )
    expect(entries).toEqual([
      { key: 'FOO', value: 'bar', line: 1 },
      { key: 'BAZ', value: 'qux', line: 2 },
      { key: 'HOME', value: '/tmp', line: 3 },
      { key: 'MULTI_WORD', value: 'hello world', line: 6 },
      { key: 'WITH_TAIL', value: 'value', line: 7 },
    ])
  })

  test('skips malformed lines', () => {
    expect(parseDotEnv('not a kv line\nOK=1').map((e) => e.key)).toEqual(['OK'])
  })
})

describe('readDotEnv', () => {
  test('returns [] on missing file', async () => {
    const entries = await readDotEnv(join(dir, 'missing.env'))
    expect(entries).toEqual([])
  })

  test('round-trips through writeDotEnv', async () => {
    const out = join(dir, 'out.env')
    await writeDotEnv(out, [
      { key: 'FOO', value: 'bar' },
      { key: 'WITH_SPACE', value: 'value with space' },
      { key: 'WITH_QUOTE', value: 'it\'s "fine"' },
    ])
    const entries = await readDotEnv(out)
    expect(entries.map((e) => ({ key: e.key, value: e.value }))).toEqual([
      { key: 'FOO', value: 'bar' },
      { key: 'WITH_SPACE', value: 'value with space' },
      { key: 'WITH_QUOTE', value: 'it\'s "fine"' },
    ])
  })
})

describe('diffLocalVsRemote', () => {
  test('identifies create / update / delete / unchanged', () => {
    const local = parseDotEnv(['KEPT=same', 'CHANGED=new', 'NEW_LOCAL=fresh'].join('\n'))
    const diff = diffLocalVsRemote(local, [
      { id: 'ev_1', key: 'KEPT', value: 'same' },
      { id: 'ev_2', key: 'CHANGED', value: 'old' },
      { id: 'ev_3', key: 'REMOTE_ONLY', value: 'remote' },
    ])
    expect(diff.toCreate).toEqual([{ key: 'NEW_LOCAL', value: 'fresh' }])
    expect(diff.toUpdate).toEqual([{ key: 'CHANGED', value: 'new', previous: 'old' }])
    expect(diff.toDelete).toEqual([{ key: 'REMOTE_ONLY' }])
    expect(diff.unchanged).toEqual(['KEPT'])
  })

  test('redacted remote values do not trigger spurious updates', () => {
    const local = parseDotEnv('SECRET=known_locally')
    const diff = diffLocalVsRemote(local, [{ id: 'ev_1', key: 'SECRET' }])
    expect(diff.toUpdate).toEqual([])
    expect(diff.unchanged).toEqual(['SECRET'])
  })
})
