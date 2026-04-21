import { describe, expect, test } from 'bun:test'
import {
  classifyCommand,
  classifyEnvDelete,
  classifyEnvSet,
  classifyProjectDelete,
} from '../../src/lib/trust/ladder.ts'

describe('classifyCommand', () => {
  test('reads are T0', () => {
    expect(classifyCommand(['project', 'list'])).toBe('T0')
    expect(classifyCommand(['auth', 'whoami'])).toBe('T0')
    expect(classifyCommand(['rate-limits'])).toBe('T0')
    expect(classifyCommand(['deploy', 'logs'])).toBe('T0')
  })

  test('cheap writes are T1', () => {
    expect(classifyCommand(['chat', 'init'])).toBe('T1')
    expect(classifyCommand(['msg', 'send'])).toBe('T1')
    expect(classifyCommand(['project', 'create'])).toBe('T1')
  })

  test('confirm-required writes are T2', () => {
    expect(classifyCommand(['deploy', 'create'])).toBe('T2')
    expect(classifyCommand(['chat', 'delete'])).toBe('T2')
    expect(classifyCommand(['hook', 'update'])).toBe('T2')
    expect(classifyCommand(['version', 'files-delete'])).toBe('T2')
  })

  test('destructive ops are T3', () => {
    expect(classifyCommand(['deploy', 'delete'])).toBe('T3')
    expect(classifyCommand(['hook', 'delete'])).toBe('T3')
    expect(classifyCommand(['mcp-server', 'delete'])).toBe('T3')
  })

  test('unknown commands default to T1 (forces explicit decision)', () => {
    expect(classifyCommand(['made-up', 'verb'])).toBe('T1')
  })
})

describe('classifyEnvSet (by key name)', () => {
  const patterns = ['*SECRET*', '*KEY*', '*TOKEN*', '*_SK_*', '*PRIVATE*']

  test('non-secret keys are T1', () => {
    expect(classifyEnvSet(['API_DOCS_URL', 'PUBLIC_HOST'], patterns)).toBe('T1')
  })

  test('secret keys are T2', () => {
    expect(classifyEnvSet(['STRIPE_SECRET_KEY'], patterns)).toBe('T2')
    expect(classifyEnvSet(['SOMETHING_TOKEN'], patterns)).toBe('T2')
    expect(classifyEnvSet(['MY_SK_PROD'], patterns)).toBe('T2')
    expect(classifyEnvSet(['PRIVATE_CERT'], patterns)).toBe('T2')
  })

  test('mixed → T2 (any secret contaminates)', () => {
    expect(classifyEnvSet(['API_DOCS_URL', 'STRIPE_SECRET_KEY'], patterns)).toBe('T2')
  })
})

describe('classifyProjectDelete', () => {
  test('no cascade → T2', () => {
    expect(classifyProjectDelete(false)).toBe('T2')
  })
  test('cascade → T3', () => {
    expect(classifyProjectDelete(true)).toBe('T3')
  })
})

describe('classifyEnvDelete', () => {
  test('single → T2', () => {
    expect(classifyEnvDelete(1)).toBe('T2')
  })
  test('bulk → T3', () => {
    expect(classifyEnvDelete(3)).toBe('T3')
  })
})
