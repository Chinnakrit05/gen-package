import { HttpError } from './errors'
import type { HttpRequest } from './router'

export const MAX_JSON_BODY_BYTES = 1024 * 1024

function parseJson(raw: string): unknown {
  try {
    return raw ? JSON.parse(raw) : {}
  } catch {
    throw new HttpError(400, 'INVALID_REQUEST', 'JSON body ไม่ถูกต้อง')
  }
}

function ensureSize(raw: string | Buffer, maxBytes: number): void {
  const size = typeof raw === 'string' ? Buffer.byteLength(raw, 'utf8') : raw.byteLength
  if (size > maxBytes) {
    throw new HttpError(413, 'BODY_TOO_LARGE', `JSON body ใหญ่เกิน ${Math.ceil(maxBytes / 1024 / 1024)} MiB`)
  }
}

export async function readJsonBody(req: HttpRequest, maxBytes = MAX_JSON_BODY_BYTES): Promise<unknown> {
  if (typeof req.body === 'string') {
    ensureSize(req.body, maxBytes)
    return parseJson(req.body)
  }
  if (Buffer.isBuffer(req.body)) {
    ensureSize(req.body, maxBytes)
    return parseJson(req.body.toString('utf8'))
  }
  if (req.body !== undefined) {
    let raw: string
    try {
      raw = JSON.stringify(req.body)
    } catch {
      throw new HttpError(400, 'INVALID_REQUEST', 'JSON body ไม่ถูกต้อง')
    }
    ensureSize(raw, maxBytes)
    return req.body
  }

  if (!req.raw) return {}
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req.raw) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += buffer.byteLength
    if (size > maxBytes) {
      throw new HttpError(413, 'BODY_TOO_LARGE', `JSON body ใหญ่เกิน ${Math.ceil(maxBytes / 1024 / 1024)} MiB`)
    }
    chunks.push(buffer)
  }
  return parseJson(Buffer.concat(chunks).toString('utf8'))
}
