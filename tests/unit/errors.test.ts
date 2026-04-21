import { describe, expect, test } from 'bun:test'
import { CliError, ExitCodes, exitCodeFor, normalizeError } from '../../src/lib/utils/errors.ts'

describe('normalizeError', () => {
  test('parses HTTP error with v0 envelope', () => {
    const err = new Error(
      'HTTP 404: {"error":{"code":"project_not_found","type":"not_found_error","message":"Project not found","userMessage":"not here"}}',
    )
    const n = normalizeError(err)
    expect(n.code).toBe('project_not_found')
    expect(n.type).toBe('not_found_error')
    expect(n.userMessage).toBe('not here')
    expect(n.status).toBe(404)
  })

  test('handles non-JSON HTTP error bodies', () => {
    const n = normalizeError(new Error('HTTP 502: bad gateway'))
    expect(n.status).toBe(502)
    expect(n.type).toBe('http_error')
    expect(n.message).toBe('bad gateway')
  })

  test('passes CliError through', () => {
    const cli = new CliError(
      {
        code: 'killswitch_engaged',
        type: 'killswitch',
        message: 'off',
      },
      ExitCodes.Killswitch,
    )
    const n = normalizeError(cli)
    expect(n.type).toBe('killswitch')
  })
})

describe('exitCodeFor', () => {
  test('429 → 3 (rate limited)', () => {
    expect(exitCodeFor({ code: 'x', type: 'x', message: '', status: 429 })).toBe(
      ExitCodes.RateLimited,
    )
  })
  test('killswitch → 4', () => {
    expect(exitCodeFor({ code: 'x', type: 'killswitch', message: '' })).toBe(ExitCodes.Killswitch)
  })
  test('validation → 2', () => {
    expect(exitCodeFor({ code: 'validation_error', type: 'validation_error', message: '' })).toBe(
      ExitCodes.ValidationError,
    )
  })
})
