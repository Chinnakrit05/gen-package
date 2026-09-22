import { describe, expect, it } from 'vitest'
import { canonicalJson, decodeProjectCursor, encodeProjectCursor, requestHash } from './canonical'

describe('project canonicalization', () => {
  it('produces the same JSON and hash regardless of object key insertion order', () => {
    const left = { z: 1, nested: { b: 2, a: 1 }, list: [{ y: 2, x: 1 }] }
    const right = { list: [{ x: 1, y: 2 }], nested: { a: 1, b: 2 }, z: 1 }
    expect(canonicalJson(left)).toBe(canonicalJson(right))
    expect(requestHash(left)).toBe(requestHash(right))
    expect(requestHash(left)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('round-trips an opaque project cursor and rejects malformed cursors', () => {
    const cursor = { updatedAt: '2026-09-18T00:00:00.000Z', id: crypto.randomUUID() }
    expect(decodeProjectCursor(encodeProjectCursor(cursor))).toEqual(cursor)
    expect(() => decodeProjectCursor('not-a-cursor')).toThrow()
  })
})
