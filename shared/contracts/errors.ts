export const API_ERROR_CODES = [
  'AI_CREDITS_EXHAUSTED', // 402 — ไม่มีเครดิต AI (Freemium หรือใช้หมด) ดู docs/billing-freemium-pro.md
  'AI_PROVIDER_UNAVAILABLE',
  'AI_RATE_LIMITED',
  'AI_REQUEST_IN_PROGRESS', // 409 — operationId เดิมยังจองเครดิตค้างอยู่
  'ALREADY_LICENSED', // 409 — สั่งซื้อแบบที่ได้สิทธิ์ดาวน์โหลดแล้ว
  'ASSET_NOT_READY',
  'ASSET_QUOTA_EXCEEDED',
  'AUTH_REQUIRED',
  'BODY_TOO_LARGE',
  'CONFIGURATION_ERROR',
  'DEPENDENCY_UNAVAILABLE',
  'IDEMPOTENCY_KEY_REUSED',
  'INVALID_REQUEST',
  'LEGACY_SOURCE_CHANGED',
  'METHOD_NOT_ALLOWED',
  'NOT_FOUND',
  'ORDER_NOT_FOUND',
  'ORDER_NOT_PAYABLE', // 409 — order ถูกยกเลิกแล้ว
  'PAYMENT_REQUIRED', // 402 — ดาวน์โหลดแบบนี้ต้องซื้อ 149 บาท หรือเป็น Pro
  'PRO_REQUIRED', // 402 — รูปแบบไฟล์นี้ (SVG/AI) เฉพาะสมาชิก Pro แม้ซื้อรายแบบแล้ว
  'PURCHASE_UNAVAILABLE', // 503 — ยังไม่เปิดขาย (ยังไม่มีผู้ให้บริการชำระเงิน) ดู Entitlements.purchasesEnabled
  'REVISION_CONFLICT',
  'SESSION_INVALID',
  'STORAGE_QUOTA_EXCEEDED', // 402 — พื้นที่เก็บงานบน cloud เต็มตามแพ็กเกจ (ยังไม่เปิดใช้) ดู docs/billing-freemium-pro.md
  'USER_NOT_ACTIVE',
  'UNSUPPORTED_MEDIA_TYPE',
  'VALIDATION_ERROR',
] as const

export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

export interface ApiErrorBody {
  code: ApiErrorCode
  message: string
  details?: Record<string, unknown>
}

export interface ApiFailure {
  error: ApiErrorBody
  requestId: string
}
