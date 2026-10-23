// โควตาพื้นที่เก็บงานบน cloud — ฝั่ง client แค่แปลง error STORAGE_QUOTA_EXCEEDED เป็นข้อความ (pure)
// เพดานและการนับอยู่ฝั่งฐานข้อมูล (Freemium 20 MB / Pro 1 GB) และ **ยังไม่เปิดใช้** — ดู docs/billing-freemium-pro.md §1
// (ระหว่างปิด server ไม่เคยตอบรหัสนี้ ข้อความทั้งหมดในไฟล์นี้จึงยังไม่ขึ้นที่ไหน)

export const STORAGE_QUOTA_EXCEEDED = 'STORAGE_QUOTA_EXCEEDED'

export interface StorageQuotaDetails {
  plan: 'free' | 'pro'
  limitBytes: number
  usedBytes: number
}

const KB = 1024
const MB = 1024 * KB
const GB = 1024 * MB

// error ที่ server ตอบเพราะพื้นที่เต็ม (ApiClientError มี code/details) — ไม่ผูกกับคลาสเพื่อให้ core ไม่ต้องพึ่ง services
export function isStorageQuotaError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === STORAGE_QUOTA_EXCEEDED
}

// details ของ error (ไม่ตรงรูป = null → ข้อความทั่วไปที่ไม่มีตัวเลข)
export function storageQuotaDetails(error: unknown): StorageQuotaDetails | null {
  if (!isStorageQuotaError(error)) return null
  const details = (error as { details?: unknown }).details
  if (typeof details !== 'object' || details === null) return null
  const { plan, limitBytes, usedBytes } = details as Record<string, unknown>
  const bytes = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
  if ((plan !== 'free' && plan !== 'pro') || !bytes(limitBytes) || !bytes(usedBytes)) return null
  return { plan, limitBytes, usedBytes }
}

// หน่วยฐาน 1024 เหมือนตัวเลขโควตาใน DB: 20971520 → "20 MB", 1073741824 → "1 GB"; ทศนิยม 1 ตำแหน่ง ตัด .0 ทิ้ง
export function formatStorageBytes(bytes: number): string {
  const one = (value: number) => String(Math.round(value * 10) / 10)
  if (bytes >= GB) return `${one(bytes / GB)} GB`
  if (bytes >= MB) return `${one(bytes / MB)} MB`
  return `${Math.max(1, Math.round(bytes / KB))} KB`
}

// คำอธิบายใต้ป้าย "พื้นที่เก็บงานเต็ม": ใช้ไปเท่าไรจากเท่าไร + ทางออก (ลบงาน/รูป, Freemium สมัคร Pro ได้)
export function storageQuotaHint(details: StorageQuotaDetails | null): string {
  if (!details) return 'พื้นที่เก็บงานเต็ม — ลบงานหรือรูปที่ไม่ใช้แล้วเพื่อบันทึกต่อ'
  const usage = `ใช้ไป ${formatStorageBytes(details.usedBytes)} จาก ${formatStorageBytes(details.limitBytes)}`
  return details.plan === 'pro'
    ? `${usage} — ลบงานหรือรูปที่ไม่ใช้แล้วเพื่อบันทึกต่อ`
    : `${usage} — ลบงานหรือรูปที่ไม่ใช้แล้ว หรือสมัคร Pro เพื่อพื้นที่มากขึ้น`
}
