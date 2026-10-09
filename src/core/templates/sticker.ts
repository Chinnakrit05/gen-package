import type { BoxParams, Dieline, DimMark, Panel, Segment, Vec2 } from '../types'
import { P, fmt, roundedRectPts, roundedRectPath } from './shared'
import { loopPath } from '../stickerContour'

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

// สติกเกอร์ไดคัทตามรูป: เส้นตัดจาก contourFromAlpha (loop ละชิ้น) บนแผ่นขนาด W×H เดิม
// ลายวางอยู่ที่ตำแหน่งเดิมบนแผ่น (พิกัดไม่ขยับ) — แผงหนึ่งต่อหนึ่งชิ้น ให้ 3D/ส่งออกใช้รูปทรงจริง
export function generateStickerContour(loops: Vec2[][], W: number, H: number): Dieline {
  const panels: Panel[] = loops.map((l, i) => ({
    id: i === 0 ? 'sticker' : `sticker-${i + 1}`,
    parentId: null,
    outline: l,
    stage: 0,
  }))
  const segments: Segment[] = loops.map((l) => ({ kind: 'cut', d: loopPath(l) }))
  const xs = loops.flat().map((p) => p.x)
  const ys = loops.flat().map((p) => p.y)
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  const dims: DimMark[] = [
    { a: P(x0, y1 + 8), b: P(x1, y1 + 8), label: `W ${fmt(x1 - x0)}` },
    { a: P(x0 - 8, y0), b: P(x0 - 8, y1), label: `H ${fmt(y1 - y0)}` },
  ]
  return { width: W, height: H, segments, panels, dims }
}
