import type { BoxParams, Dieline, DimMark, Material, Panel, Segment } from '../types'
import { P, fmt } from './shared'
import { buildTrayPiece, trayPieceSize } from './trayPiece'

// กล่องฝาครอบ (telescoping lid box) — ฐานถาดลึก + ฝาครอบถาดตื้นสวมทับ (2 ชิ้น)
// แผ่นคลี่วางสองชิ้นเคียงกัน: ซ้าย = ฐาน (ผนังพับขึ้น), ขวา = ฝา (ผนังพับลง ดูเป็นฝาครอบ)
// W,D,H = ขนาดด้านในของฐาน; ฝากว้าง/ลึกกว่าเล็กน้อยเพื่อสวมพอดี สูง ~40% ของฐาน
export function generateLidBox(box: BoxParams, mat: Material): Dieline {
  const { W, D, H } = box
  const t = mat.thickness
  const clear = 0.8 // ระยะเผื่อให้ฝาสวมฐานได้

  // ฝาสวมภายนอกฐาน: ด้านในฝา = ด้านนอกฐาน + เผื่อ
  const lidW = W + 2 * t + clear
  const lidD = D + 2 * t + clear
  const lidH = Math.max(10, H * 0.4)

  const GAP = 14
  const base = trayPieceSize(W, D, H, t)
  const bx = base.w + GAP // จุดเริ่มชิ้นฝาตามแกน x

  const basePiece = buildTrayPiece('b-', 0, 0, W, D, H, t, 1)
  const lidPiece = buildTrayPiece('l-', bx, 0, lidW, lidD, lidH, t, -1)

  const panels: Panel[] = [...basePiece.panels, ...lidPiece.panels]
  const segments: Segment[] = [...basePiece.segments, ...lidPiece.segments]

  const width = lidPiece.bbox.x1
  const height = Math.max(basePiece.bbox.y1, lidPiece.bbox.y1)

  const dims: DimMark[] = [
    { a: P(basePiece.bbox.x0, height + 12), b: P(basePiece.bbox.x1, height + 12), label: `ฐาน ${fmt(W)}×${fmt(D)}×${fmt(H)}` },
    { a: P(lidPiece.bbox.x0, height + 12), b: P(lidPiece.bbox.x1, height + 12), label: `ฝา ${fmt(lidW)}×${fmt(lidD)}×${fmt(lidH)}` },
  ]

  return { width, height, segments, panels, dims }
}
