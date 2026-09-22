import { createHash } from 'node:crypto'

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalValue(child)]),
    )
  }
  return value
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value))
}

export function requestHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

export function encodeProjectCursor(cursor: { updatedAt: string; id: string }): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export function decodeProjectCursor(value: string): { updatedAt: string; id: string } {
  const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
  if (!parsed || typeof parsed !== 'object') throw new Error('invalid cursor')
  const cursor = parsed as Record<string, unknown>
  if (typeof cursor.updatedAt !== 'string' || Number.isNaN(Date.parse(cursor.updatedAt))) {
    throw new Error('invalid cursor timestamp')
  }
  if (typeof cursor.id !== 'string' || !zUuid.test(cursor.id)) throw new Error('invalid cursor id')
  return { updatedAt: cursor.updatedAt, id: cursor.id }
}

const zUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
