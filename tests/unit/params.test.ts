import { describe, expect, test } from 'bun:test'
import { mergeParams, parseParamsJson } from '../../src/lib/validation/params.ts'

describe('parseParamsJson', () => {
  test('returns empty object for undefined', () => {
    expect(parseParamsJson(undefined)).toEqual({})
  })

  test('parses valid JSON object', () => {
    expect(parseParamsJson('{"message":"hi"}')).toEqual({ message: 'hi' })
  })

  test('rejects non-object JSON', () => {
    expect(() => parseParamsJson('[]')).toThrow(/must be a JSON object/)
    expect(() => parseParamsJson('"hi"')).toThrow(/must be a JSON object/)
    expect(() => parseParamsJson('null')).toThrow(/must be a JSON object/)
  })

  test('rejects malformed JSON', () => {
    expect(() => parseParamsJson('{not valid')).toThrow(/invalid JSON/)
  })
})

describe('mergeParams', () => {
  test('params override sugar', () => {
    const out = mergeParams({ message: 'sugar' }, { message: 'params' })
    expect(out.message).toBe('params')
  })

  test('sugar-only passes through', () => {
    const out = mergeParams({ message: 'hi', projectId: 'prj' }, {})
    expect(out).toEqual({ message: 'hi', projectId: 'prj' })
  })

  test('reports conflict only when both sides differ', () => {
    const conflicts: string[] = []
    mergeParams({ a: 1 }, { a: 1 }, (k) => conflicts.push(k))
    expect(conflicts).toEqual([])
    mergeParams({ a: 1 }, { a: 2 }, (k) => conflicts.push(k))
    expect(conflicts).toEqual(['a'])
  })

  test('sugar with undefined does not trigger conflict warning', () => {
    const conflicts: string[] = []
    mergeParams({ a: undefined }, { a: 2 }, (k) => conflicts.push(k))
    expect(conflicts).toEqual([])
  })
})
