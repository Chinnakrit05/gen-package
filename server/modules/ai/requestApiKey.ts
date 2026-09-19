import type { IncomingHttpHeaders } from 'node:http'

export function readRequestApiKey(headers: IncomingHttpHeaders): string | undefined | null {
  const raw = headers['x-packit-anthropic-api-key']
  if (raw === undefined) return undefined
  if (Array.isArray(raw) || typeof raw !== 'string') return null
  const key = raw.trim()
  if (key.length < 10 || key.length > 512 || /\s/.test(key)) return null
  return key
}
