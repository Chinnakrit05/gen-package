import type { BoxParams, Dieline, DimMark, Material, Panel, Segment } from '../types'
import { P, fmt, rect } from './shared'
import { buildTrayPiece, trayPieceSize } from './trayPiece'

// ชิ้นปลอกสวม (sleeve tube) ที่ออฟเซ็ต (ox,oy) + prefix — ท่อสี่เหลี่ยมเปิดหัว-ท้าย
// Wc×Dc = หน้าตัดด้านใน, len = ความยาวปลอก
function buildSleevePiece(prefix: string, ox: number, oy: number, Wc: number, Dc: number, len: number, t: number) {
  const Wp = Wc + 2 * t
  const Dp = Dc + 2 * t
  const glueW = Math.max(12, 10 + 2 * t)
  const taper = 4
  const layer = t + 0.05
  const x1 = glueW
  const x2 = x1 + Dp
  const x3 = x2 + Wp
  const x4 = x3 + Dp
  const x5 = x4 + Wp
  const top = 0
  const bot = len
  const a = (x: number, y: number) => P(ox + x, oy + y)
  const r = (xa: number, ya: number, xb: number, yb: number) => rect(ox + xa, oy + ya, ox + xb, oy + yb)

  const panels: Panel[] = [
    { id: `${prefix}front`, parentId: null, outline: r(x2, top, x3, bot), stage: 0 },
    {
      id: `${prefix}side-left`, parentId: `${prefix}front`, outline: r(x1, top, x2, bot),
      hingeA: a(x2, top), hingeB: a(x2, bot), foldAngle: -90, stage: 0,
    },
    {
      id: `${prefix}glue`, parentId: `${prefix}side-left`,
      outline: [a(x1, top), a(0, top + taper), a(0, bot - taper), a(x1, bot)],
      hingeA: a(x1, top), hingeB: a(x1, bot), foldAngle: -90, stage: 0, zOffset: layer,
    },
    {
      id: `${prefix}side-right`, parentId: `${prefix}front`, outline: r(x3, top, x4, bot),
      hingeA: a(x3, top), hingeB: a(x3, bot), foldAngle: 90, stage: 0,
    },
    {
      id: `${prefix}back`, parentId: `${prefix}side-right`, outline: r(x4, top, x5, bot),
      hingeA: a(x4, top), hingeB: a(x4, bot), foldAngle: 90, stage: 0,
    },
  ]

  const cut = (d: string): Segment => ({ kind: 'cut', d })
  const crease = (d: string): Segment => ({ kind: 'crease', d })
  const L = (x: number, y: number) => `${ox + x} ${oy + y}`
  const segments: Segment[] = [
    cut(`M ${L(x1, top)} L ${L(0, top + taper)} L ${L(0, bot - taper)} L ${L(x1, bot)}`),
    cut(`M ${L(x1, top)} L ${L(x5, top)}`),
    cut(`M ${L(x1, bot)} L ${L(x5, bot)}`),
    cut(`M ${L(x5, top)} L ${L(x5, bot)}`),
    crease(`M ${L(x1, top)} L ${L(x1, bot)}`),
    crease(`M ${L(x2, top)} L ${L(x2, bot)}`),
    crease(`M ${L(x3, top)} L ${L(x3, bot)}`),
    crease(`M ${L(x4, top)} L ${L(x4, bot)}`),
  ]
  return { panels, segments, bbox: { x0: ox, y0: oy, x1: ox + x5, y1: oy + bot } }
}

// กล่องฝาสไลด์ (matchbox / slide box) — ลิ้นชัก (ถาด) + ปลอกสวมภายนอก (2 ชิ้น)
// W,D,H = ขนาดด้านในของลิ้นชัก; ปลอกสวมหุ้มรอบหน้าตัด W×H ยาวเท่าลิ้นชัก (D)
export function generateSlideBox(box: BoxParams, mat: Material): Dieline {
  const { W, D, H } = box
  const t = mat.thickness
  const clear = 0.7

  // ลิ้นชัก (ถาด) ด้านใน W×D×H
  const drawer = buildTrayPiece('d-', 0, 0, W, D, H, t, 1)
  const drawerSize = trayPieceSize(W, D, H, t)

  // ปลอกสวม: หน้าตัดหุ้มลิ้นชัก (กว้าง = W นอก, สูง = H นอก) ยาว = D นอก
  const sleeveWc = W + 2 * t + clear
  const sleeveDc = H + t + clear
  const sleeveLen = D + 2 * t

  const GAP = 14
  const bx = drawerSize.w + GAP
  const sleeve = buildSleevePiece('s-', bx, 0, sleeveWc, sleeveDc, sleeveLen, t)

  const panels: Panel[] = [...drawer.panels, ...sleeve.panels]
  const segments: Segment[] = [...drawer.segments, ...sleeve.segments]
  const width = sleeve.bbox.x1
  const height = Math.max(drawer.bbox.y1, sleeve.bbox.y1)

  const dims: DimMark[] = [
    { a: P(drawer.bbox.x0, height + 12), b: P(drawer.bbox.x1, height + 12), label: `ลิ้นชัก ${fmt(W)}×${fmt(D)}×${fmt(H)}` },
    { a: P(sleeve.bbox.x0, height + 12), b: P(sleeve.bbox.x1, height + 12), label: `ปลอกสวม` },
  ]

  return { width, height, segments, panels, dims }
}
