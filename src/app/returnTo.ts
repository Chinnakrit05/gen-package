// ปลายทางหลัง login (ROUTES-PHASE-1.md §2.2–2.3) — pure ยกเว้นตัวเก็บ sessionStorage ท้ายไฟล์
// OAuth ยังกลับ origin เดิม (redirectTo = origin + PKCE) แล้วแอปอ่านปลายทางจาก sessionStorage ของแท็บ
// ไม่ใส่ token หรือ returnTo ลง redirect URL เอง

import { SUPPLIER_INVITE_PATH, isSupplierInvitePath } from './supplierInviteRoute'

export const DEFAULT_RETURN_TO = '/app/projects'
export const RETURN_TO_KEY = 'packit-return-to'
const MAX_LENGTH = 512
const ALLOWED_PREFIXES = ['/app/', '/editor/']
const UUID_PATH = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}'
const SUPPLIER_PATH = new RegExp(`^/factory/(?:onboarding|${UUID_PATH}/(?:profile|team|jobs(?:/${UUID_PATH})?))/?$`, 'i')

// คืน path ภายในที่อนุญาต หรือ null — กัน open redirect: `//host`, `/\host`, scheme, อักขระควบคุม,
// origin อื่นหลัง resolve และปลายทางที่วนกลับหน้า login/root
export function sanitizeReturnTo(value: unknown, origin: string): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_LENGTH) return null
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return null
  let url: URL
  try {
    url = new URL(value, origin)
  } catch {
    return null
  }
  if (url.origin !== new URL(origin).origin) return null
  if (isSupplierInvitePath(url.pathname)) return url.search || url.hash ? null : SUPPLIER_INVITE_PATH
  const supplierPath = SUPPLIER_PATH.test(url.pathname)
  const adminPath = /^\/admin\/suppliers\/?$/.test(url.pathname)
  if (!supplierPath && !adminPath && !ALLOWED_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return null
  return `${url.pathname}${url.search}${url.hash}`
}

export function returnToOrDefault(value: unknown, origin: string): string {
  return sanitizeReturnTo(value, origin) ?? DEFAULT_RETURN_TO
}

export function storeReturnTo(value: unknown, origin = window.location.origin): void {
  const safe = sanitizeReturnTo(value, origin)
  try {
    if (safe) sessionStorage.setItem(RETURN_TO_KEY, safe)
    else sessionStorage.removeItem(RETURN_TO_KEY)
  } catch {
    // sessionStorage ถูกปิด — หลัง login ไปหน้ารายการแทน
  }
}

// อ่านโดยไม่ลบ (StrictMode/effect ซ้ำต้องได้ค่าเดิม) และตรวจซ้ำเสมอ — ค่าใน storage อาจถูกแก้จากภายนอก
// ลบด้วย clearReturnTo เมื่อเข้าหน้าที่ต้อง login สำเร็จ หรือเมื่อผู้ใช้ออกจากระบบเอง
export function peekReturnTo(origin = window.location.origin): string {
  let stored: string | null = null
  try {
    stored = sessionStorage.getItem(RETURN_TO_KEY)
  } catch {
    stored = null
  }
  return returnToOrDefault(stored, origin)
}

export function clearReturnTo(): void {
  try {
    sessionStorage.removeItem(RETURN_TO_KEY)
  } catch {
    // ไม่มี storage ก็ไม่มีค่าให้ล้าง
  }
}
