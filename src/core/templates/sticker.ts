import type { BoxParams, Dieline, DimMark, Panel, Segment } from '../types'
import { P, fmt, roundedRectPts, roundedRectPath } from './shared'

// สติกเกอร์ไดคัท (die-cut sticker): แผ่นพิมพ์แบนชิ้นเดียว ไม่มีรอยพับ
// เส้นตัดเป็นสี่เหลี่ยมมุมมน (ไดคัทตามรูป) — ใช้เป็นฉลากสินค้า/โลโก้
// W = กว้าง, H = สูง (แบน จึงไม่ใช้ค่า D)
export function generateSticker(box: BoxParams): Dieline {
  const { W: w, H: h } = box
  // รัศมีมุมมน ~12% ของด้านสั้น (อย่างน้อย 2 มม.) และไม่เกินครึ่งด้านสั้น
  const r = Math.min(Math.max(Math.min(w, h) * 0.12, 2), Math.min(w, h) / 2)

  const panels: Panel[] = [
    { id: 'sticker', parentId: null, outline: roundedRectPts(0, 0, w, h, r), stage: 0 },
  ]

  const segments: Segment[] = [{ kind: 'cut', d: roundedRectPath(0, 0, w, h, r) }]

  const dims: DimMark[] = [
    { a: P(0, h + 12), b: P(w, h + 12), label: `W ${fmt(w)}` },
    { a: P(-10, 0), b: P(-10, h), label: `H ${fmt(h)}` },
  ]

  return { width: w, height: h, segments, panels, dims }
}
