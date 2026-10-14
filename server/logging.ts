// log ฝั่ง server แบบหนึ่งบรรทัด (JSON) ให้ค้นใน log ของ Vercel/terminal ได้ตาม requestId/code
// ห้ามใส่คีย์ API, token, อีเมล หรือ body ของคำขอ — ข้อความ error จากต้นทาง (provider/DB/fetch)
// ต้องผ่าน errorMessageForLog ก่อนเสมอ เผื่อมีค่าลับติดมาในข้อความ

const MAX_LOG_TEXT = 500

// แทนค่าที่หน้าตาเหมือนความลับด้วยป้าย แล้วยุบให้เหลือบรรทัดเดียวและจำกัดความยาว
export function redactLogText(text: string): string {
  return text
    .replace(/\bsk-ant-[A-Za-z0-9_-]+/g, '[redacted-key]')
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, '[redacted-key]')
    .replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)?/g, '[redacted-jwt]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted-email]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LOG_TEXT)
}

// ข้อความของ error ที่ปลอดภัยพอจะ log (ไม่เอา stack/cause/object ทั้งก้อน)
export function errorMessageForLog(error: unknown): string {
  if (error instanceof Error) return redactLogText(`${error.name}: ${error.message}`)
  if (typeof error === 'string') return redactLogText(error)
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return redactLogText(message)
  }
  return 'unknown error'
}

export type LogLevel = 'error' | 'warn' | 'info'
export type LogFieldValue = string | number | boolean | null | undefined

// field ที่เป็น undefined ถูกตัดทิ้งโดย JSON.stringify — ส่ง requestId: undefined ได้เมื่อไม่มี
export function formatServerLog(level: LogLevel, event: string, fields: Record<string, LogFieldValue> = {}): string {
  return JSON.stringify({ level, event, ...fields })
}

export function logServerEvent(level: LogLevel, event: string, fields: Record<string, LogFieldValue> = {}): void {
  const line = formatServerLog(level, event, fields)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.info(line)
}
