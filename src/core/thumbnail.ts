// ภาพย่อ 3D ของงานในแกลเลอรี (pure) — ตัดขอบโปร่งใสรอบโมเดลแล้ววางกึ่งกลางกรอบการ์ด + ตัดสินว่าภาพย่อยังทันงานไหม
// ตัวถ่าย (canvas/WebGL) อยู่ที่ components/ThumbnailCapture.tsx

export const THUMB_W = 480 // ~2 เท่าของช่องภาพบนการ์ดแกลเลอรี (≈240×150 px)
export const THUMB_H = 300
export const THUMB_PAD = 0.08 // เว้นขอบรอบโมเดล (สัดส่วนของด้านสั้น)

export interface Bounds {
  x0: number
  y0: number
  x1: number // ไม่รวม (exclusive)
  y1: number
}

// กรอบของพิกเซลที่ทึบกว่า threshold (RGBA เรียงแถว) — null = ภาพว่าง
export function alphaBounds(data: Uint8ClampedArray, w: number, h: number, threshold = 8): Bounds | null {
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    const row = y * w * 4
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3] > threshold) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 }
}

// วางกรอบโมเดลลงกรอบผลลัพธ์ outW×outH: ย่อ/ขยายคงสัดส่วนให้พอดีหลังเว้นขอบ แล้วจัดกึ่งกลาง
export function thumbPlacement(b: Bounds, outW: number, outH: number, pad = THUMB_PAD) {
  const m = pad * Math.min(outW, outH)
  const sw = b.x1 - b.x0
  const sh = b.y1 - b.y0
  const k = Math.min((outW - 2 * m) / sw, (outH - 2 * m) / sh)
  const dw = sw * k
  const dh = sh * k
  return { sx: b.x0, sy: b.y0, sw, sh, dx: (outW - dw) / 2, dy: (outH - dh) / 2, dw, dh }
}

// ภาพย่อทันงานแล้วไหม: ถ่ายจากสถานะงานที่ updatedAt ≥ งานตอนนี้ (บันทึกไว้ในแคชเครื่องนี้)
// หรือ cloud มีภาพย่อที่บันทึกหลังงานแก้ล่าสุด (เปิดจากเครื่องอื่น — ไม่ต้องถ่ายซ้ำ)
export function thumbIsFresh(
  projectUpdatedAt: number,
  cached?: { sourceUpdatedAt?: number } | null,
  cloudVersion?: string | null,
): boolean {
  if (cached?.sourceUpdatedAt !== undefined && cached.sourceUpdatedAt >= projectUpdatedAt) return true
  if (cloudVersion) {
    const t = Date.parse(cloudVersion)
    if (Number.isFinite(t) && t >= projectUpdatedAt) return true
  }
  return false
}

// cloud: ต้องโหลดรูปจาก server ไหม — ไม่มีในแคช หรือ version ไม่ตรง ยกเว้นรูปในแคชถ่ายบนเครื่องนี้หลังรูปบน server
// (อัปโหลดยังไม่ผ่าน — ของเครื่องนี้ใหม่กว่า ห้ามเอารูปเก่าจาก server มาทับ)
export function thumbNeedsFetch(
  serverVersion: string,
  cached?: { version: string; sourceUpdatedAt?: number } | null,
): boolean {
  if (!cached) return true
  if (cached.version === serverVersion) return false
  return !(cached.sourceUpdatedAt !== undefined && cached.sourceUpdatedAt >= Date.parse(serverVersion))
}
