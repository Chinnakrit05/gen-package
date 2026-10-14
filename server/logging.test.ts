import { describe, expect, it } from 'vitest'
import { errorMessageForLog, formatServerLog, redactLogText } from './logging'

describe('server logging', () => {
  it('redacts keys, bearer tokens, JWTs and emails and keeps one line', () => {
    const text = redactLogText([
      'failed with sk-ant-api03-abcDEF_123',
      'secret sb_secret_AbC123-xyz',
      'authorization: Bearer abc.def.ghi',
      'jwt eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln',
      'user someone.name+tag@example.co.th',
    ].join('\n'))

    expect(text).not.toMatch(/sk-ant-|sb_secret_|abc\.def\.ghi|eyJhbGci|someone\.name/)
    expect(text).toContain('[redacted-key]')
    expect(text).toContain('Bearer [redacted]')
    expect(text).toContain('[redacted-jwt]')
    expect(text).toContain('[redacted-email]')
    expect(text).not.toContain('\n')
  })

  it('caps long messages', () => {
    expect(redactLogText('x'.repeat(2_000))).toHaveLength(500)
  })

  it('reads messages from errors, strings and error-like objects only', () => {
    expect(errorMessageForLog(new TypeError('fetch failed'))).toBe('TypeError: fetch failed')
    expect(errorMessageForLog('plain text')).toBe('plain text')
    expect(errorMessageForLog({ message: 'postgrest said no', details: 'secret-ish' })).toBe('postgrest said no')
    expect(errorMessageForLog(42)).toBe('unknown error')
    expect(errorMessageForLog(null)).toBe('unknown error')
  })

  it('formats a single JSON line and drops undefined fields', () => {
    const line = formatServerLog('error', 'api_error', { requestId: undefined, route: 'GET /x', code: 'NOT_FOUND' })
    expect(line).not.toContain('\n')
    expect(JSON.parse(line)).toEqual({ level: 'error', event: 'api_error', route: 'GET /x', code: 'NOT_FOUND' })
  })
})
