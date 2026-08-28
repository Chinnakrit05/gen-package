import type { IncomingMessage, ServerResponse } from 'node:http'
import Anthropic from '@anthropic-ai/sdk'
import { askClaude, mockSpec, parseCurrent, parseImage } from './boxSpec'

// ต้นทาง (source) ของ serverless function /api/box-spec บน Vercel
// ถูก esbuild bundle เป็นไฟล์เดียว → api/box-spec.js (ดู scripts/build-api.mjs) เพราะ Vercel รัน
// ฟังก์ชันแบบ native ESM และ "ไม่ bundle" import ข้ามโฟลเดอร์ให้ (../src, ../server) — ถ้าปล่อยให้
// Node resolve เองจะ ERR_MODULE_NOT_FOUND ตอนรัน จึง bundle รวมทุก import ไว้ล่วงหน้า
// บน serverless ไม่มี `claude` CLI จึงรองรับแค่ backend: api (ANTHROPIC_API_KEY) หรือ mock
//
// ใช้ชนิด node:http (ไม่พึ่ง @vercel/node) — Vercel Node runtime แปลง body ให้ที่ระดับแพลตฟอร์มอยู่แล้ว

type Req = IncomingMessage & { body?: unknown }

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

// อ่าน body: ใช้ที่ Vercel แปลงให้ก่อน ถ้าไม่มีค่อยอ่านจาก stream เอง (กันกรณี runtime ไม่ parse)
async function readJsonBody(req: Req): Promise<Record<string, unknown>> {
  const b = req.body
  if (b && typeof b === 'object') return b as Record<string, unknown>
  if (typeof b === 'string') {
    try {
      return JSON.parse(b) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > 6 * 1024 * 1024) throw new Error('คำขอใหญ่เกินไป')
    chunks.push(chunk as Buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  try {
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export default async function handler(req: Req, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    send(res, 405, { error: 'ต้องเป็น POST เท่านั้น' })
    return
  }

  // กัน drive-by cross-site POST มาเผาโควต้า API: อนุญาตเฉพาะ same-origin (อิงจาก Host)
  const host = req.headers.host
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined
  const sameOrigin = !origin || origin === `https://${host}` || origin === `http://${host}`
  if (req.headers['sec-fetch-site'] === 'cross-site' || !sameOrigin) {
    send(res, 403, { error: 'ต้องเรียกจากหน้าเว็บของแอปเท่านั้น' })
    return
  }

  let body: Record<string, unknown>
  try {
    body = await readJsonBody(req)
  } catch {
    send(res, 400, { error: 'รูปแบบคำขอไม่ถูกต้อง' })
    return
  }
  if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 2000) {
    send(res, 400, { error: 'prompt ต้องเป็นข้อความ 1-2000 ตัวอักษร' })
    return
  }
  const prompt = body.prompt.trim()
  const current = parseCurrent(body.current)
  const image = parseImage(body.image)

  const backend = process.env.BOX_SPEC_BACKEND
  const apiKey = process.env.ANTHROPIC_API_KEY
  const model = process.env.BOX_SPEC_MODEL

  try {
    // ไม่มี API key (และไม่ได้บังคับ api) → โหมดจำลอง เพื่อให้เว็บใช้งานได้แม้ยังไม่ตั้งคีย์
    if (backend === 'mock' || (!apiKey && backend !== 'api')) {
      send(res, 200, mockSpec(prompt, current, image))
      return
    }
    if (!apiKey) {
      send(res, 500, { error: 'ยังไม่ได้ตั้ง ANTHROPIC_API_KEY ใน Vercel' })
      return
    }
    send(res, 200, await askClaude(apiKey, model || 'claude-opus-4-8', prompt, current, image))
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      send(res, 401, { error: 'ANTHROPIC_API_KEY ไม่ถูกต้อง — ตรวจค่าใน Vercel' })
    } else if (err instanceof Anthropic.RateLimitError) {
      send(res, 429, { error: 'เรียกถี่เกินไป รอสักครู่แล้วลองใหม่' })
    } else if (err instanceof Anthropic.APIError) {
      send(res, 502, { error: `Claude API ขัดข้อง (${err.status ?? '?'}) ลองใหม่อีกครั้ง` })
    } else {
      send(res, 500, { error: 'เกิดข้อผิดพลาดภายใน ลองใหม่อีกครั้ง' })
    }
  }
}
