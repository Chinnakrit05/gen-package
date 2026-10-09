import type { Vec2 } from './types'
import { distanceTo, gaussianBlur, marchingSquares, simplifyLoop, type AlphaMask } from './stickerContour'

// หมึกขาวรอง (white underbase) สำหรับสติกเกอร์ฟิล์มใส — เส้นขอบพื้นที่ที่ต้องพิมพ์ขาวใต้ลาย (pure)
// ต่างจากไดคัทตามรูป: เก็บ "รูใน" ไว้ (ช่องในตัวอักษรต้องใส) ไม่ขยาย/ลบมุม และหดเข้าเล็กน้อย (choke)
// ให้ขาวซ่อนใต้สี ไม่โผล่ขอบเมื่อแท่นพิมพ์ลงทะเบียนเหลื่อม — เติมแบบ even-odd

export const WHITE_CHOKE = 0.1 // มม.
export const WHITE_SPOT = 'White' // ชื่อสี spot ที่โรงพิมพ์ดิจิทัลส่วนใหญ่ใช้แยกเพลตหมึกขาว

export function traceWhiteInk(m: AlphaMask, choke = WHITE_CHOKE): Vec2[][] {
  const { w, h, pxPerMm: s } = m
  let mask = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) mask[i] = m.data[i] >= 128 ? 1 : 0
  const r = choke * s
  if (r >= 0.5) {
    // หดเข้า: ระยะวัดศูนย์กลางพิกเซลถึงศูนย์กลางพิกเซลพื้นหลัง — ขอบจริงใกล้กว่าครึ่งพิกเซล
    // จึงเก็บเฉพาะพิกเซลที่ (d − 0.5) > r
    const bg = Uint8Array.from(mask, (v) => (v ? 0 : 1))
    const d = distanceTo(bg, w, h)
    mask = Uint8Array.from(d, (v) => (v - 0.5 > r ? 1 : 0))
  }
  const field = gaussianBlur(mask, w, h, 0.7)
  return marchingSquares(field, w, h, 0.5)
    .filter((l) => l.length >= 4)
    .map((l) =>
      simplifyLoop(l, 0.25).map((p) => ({ x: m.origin.x + (p.x + 0.5) / s, y: m.origin.y + (p.y + 0.5) / s })),
    )
}

// path SVG สำหรับเติม even-odd (รูในตัวอักษรเว้นใส)
export const whiteInkPath = (loops: Vec2[][]) =>
  loops
    .map((l) => `M ${l.map((p) => `${Math.round(p.x * 1000) / 1000} ${Math.round(p.y * 1000) / 1000}`).join(' L ')} Z`)
    .join(' ')
