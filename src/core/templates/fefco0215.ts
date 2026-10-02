import type { BoxParams, Dieline, DimMark, Material, Panel, Segment, Vec2 } from '../types'
import { P, arcPts, fmt } from './shared'

// FEFCO 0215 — กล่องฝาบนเสียบ (tuck top) + ก้นล็อกอัตโนมัติ (snap/crash-lock bottom)
// tube 4 ผนัง + ปีกทากาว; ปากบน = ฝาเสียบ+ลิ้น (เหมือน tuck-end); ก้น = ลิ้น 4 ชิ้นพับเข้าล็อกกันเอง
// ก้นประกอบเองไม่ต้องทากาวทีละใบ (ดีดขึ้นรูปตอนกางกล่อง) — W,D,H = ขนาดด้านใน (+2t ต่อแกน)
export function generateFefco0215(box: BoxParams, mat: Material): Dieline {
  const { W, D, H } = box
  const t = mat.thickness

  const Wp = W + 2 * t
  const Dp = D + 2 * t
  const Hp = H + 2 * t

  const glueW = Math.max(12, 10 + 2 * t)
  const taper = 4
  const cover = Math.max(6, Dp - t)
  const tongue = Math.min(22, Math.max(10, 0.6 * Dp))
  const dustIn = Math.max(1.5, 2 * t + 0.5)
  const tuckIn = Math.max(1, t + 0.5)
  const dustH = Math.max(8, Math.min(0.75 * Dp, Wp / 2 - dustIn - 2) - t)
  const slant = Math.min(5, dustH * 0.45)
  const layer = t + 0.05

  const x1 = glueW
  const x2 = x1 + Dp
  const x3 = x2 + Wp
  const x4 = x3 + Dp
  const x5 = x4 + Wp

  // ก้น auto-lock: ลิ้นข้าง (จาก side) พับก่อน ลิ้นหน้า-หลัง (ลึกกว่า) พับทับล็อก
  const baseLR = Dp * 0.5 // ลิ้นข้าง (ลึก ~ครึ่งลึกกล่อง)
  const baseFB = Dp * 0.62 // ลิ้นหน้า-หลัง (ลึกกว่า เกยทับกลาง = ล็อก)
  const lrSlant = Math.min(6, baseLR * 0.4)

  const top = cover + tongue // ขอบบนผนัง (เหนือขึ้นไปเป็นฝาเสียบ)
  const bot = top + Hp // ขอบล่างผนัง (ต่ำกว่าเป็นก้น)
  const width = x5
  const height = bot + baseFB + 4

  const tiTop = top - cover
  const r = Math.min(7, tongue * 0.45, (Wp - 2 * tuckIn) / 2)

  const rect = (xa: number, ya: number, xb: number, yb: number): Vec2[] => [
    P(xa, ya), P(xb, ya), P(xb, yb), P(xa, yb),
  ]
  const dust = (xa: number, xb: number, y: number, dir: 1 | -1): Vec2[] => [
    P(xa + dustIn, y),
    P(xa + dustIn + slant, y + dir * dustH),
    P(xb - dustIn - slant, y + dir * dustH),
    P(xb - dustIn, y),
  ]
  // ลิ้นก้น (คางหมูหดปลาย) พับเข้าใต้ท้องกล่อง
  const baseFlap = (xa: number, xb: number, depth: number): Vec2[] => [
    P(xa + dustIn, bot),
    P(xa + dustIn + lrSlant, bot + depth),
    P(xb - dustIn - lrSlant, bot + depth),
    P(xb - dustIn, bot),
  ]

  const tongueTopOutline: Vec2[] = [
    P(x4 + tuckIn, tiTop),
    ...arcPts(x4 + tuckIn + r, tiTop - tongue + r, r, Math.PI, Math.PI * 1.5),
    ...arcPts(x5 - tuckIn - r, tiTop - tongue + r, r, Math.PI * 1.5, Math.PI * 2),
    P(x5 - tuckIn, tiTop),
  ]

  const panels: Panel[] = [
    { id: 'front', parentId: null, outline: rect(x2, top, x3, bot), stage: 0 },
    {
      id: 'side-left', parentId: 'front', outline: rect(x1, top, x2, bot),
      hingeA: P(x2, top), hingeB: P(x2, bot), foldAngle: -90, stage: 0,
    },
    {
      id: 'glue', parentId: 'side-left',
      outline: [P(x1, top), P(0, top + taper), P(0, bot - taper), P(x1, bot)],
      hingeA: P(x1, top), hingeB: P(x1, bot), foldAngle: -90, stage: 0, zOffset: layer,
    },
    {
      id: 'side-right', parentId: 'front', outline: rect(x3, top, x4, bot),
      hingeA: P(x3, top), hingeB: P(x3, bot), foldAngle: 90, stage: 0,
    },
    {
      id: 'back', parentId: 'side-right', outline: rect(x4, top, x5, bot),
      hingeA: P(x4, top), hingeB: P(x4, bot), foldAngle: 90, stage: 0,
    },
    // --- ฝาเสียบบน ---
    {
      id: 'dust-tl', parentId: 'side-left', outline: dust(x1, x2, top, -1),
      hingeA: P(x1, top), hingeB: P(x2, top), foldAngle: 90, stage: 1, zOffset: layer,
    },
    {
      id: 'dust-tr', parentId: 'side-right', outline: dust(x3, x4, top, -1),
      hingeA: P(x3, top), hingeB: P(x4, top), foldAngle: 90, stage: 1, zOffset: layer,
    },
    {
      id: 'tuck-top', parentId: 'back', outline: rect(x4 + tuckIn, tiTop, x5 - tuckIn, top),
      hingeA: P(x4, top), hingeB: P(x5, top), foldAngle: 90, stage: 2,
    },
    {
      id: 'tongue-top', parentId: 'tuck-top', outline: tongueTopOutline,
      hingeA: P(x4 + tuckIn, tiTop), hingeB: P(x5 - tuckIn, tiTop), foldAngle: 90, stage: 3, zOffset: 0.15,
    },
    // --- ก้น auto-lock: ลิ้นข้างก่อน (stage 1) แล้วลิ้นหน้า-หลังทับ (stage 2) ---
    {
      id: 'base-left', parentId: 'side-left', outline: baseFlap(x1, x2, baseLR),
      hingeA: P(x1, bot), hingeB: P(x2, bot), foldAngle: -90, stage: 1, zOffset: layer,
    },
    {
      id: 'base-right', parentId: 'side-right', outline: baseFlap(x3, x4, baseLR),
      hingeA: P(x3, bot), hingeB: P(x4, bot), foldAngle: -90, stage: 1, zOffset: layer,
    },
    {
      id: 'base-front', parentId: 'front', outline: baseFlap(x2, x3, baseFB),
      hingeA: P(x2, bot), hingeB: P(x3, bot), foldAngle: -90, stage: 2, zOffset: 2 * layer,
    },
    {
      id: 'base-back', parentId: 'back', outline: baseFlap(x4, x5, baseFB),
      hingeA: P(x4, bot), hingeB: P(x5, bot), foldAngle: -90, stage: 2, zOffset: 2 * layer,
    },
  ]

  const cut = (d: string): Segment => ({ kind: 'cut', d })
  const crease = (d: string): Segment => ({ kind: 'crease', d })
  const dustCut = (xa: number, xb: number, y: number, dir: 1 | -1) =>
    `M ${xa} ${y} L ${xa + dustIn} ${y} L ${xa + dustIn + slant} ${y + dir * dustH} ` +
    `L ${xb - dustIn - slant} ${y + dir * dustH} L ${xb - dustIn} ${y} L ${xb} ${y}`
  const baseCut = (xa: number, xb: number, depth: number) =>
    `M ${xa} ${bot} L ${xa + dustIn} ${bot} L ${xa + dustIn + lrSlant} ${bot + depth} ` +
    `L ${xb - dustIn - lrSlant} ${bot + depth} L ${xb - dustIn} ${bot} L ${xb} ${bot}`
  const tuckCut = (y: number) => {
    const yi = y - cover
    const yt = yi - tongue
    return (
      `M ${x4} ${y} L ${x4 + tuckIn} ${y} L ${x4 + tuckIn} ${yi} L ${x4 + tuckIn} ${yt + r} ` +
      `Q ${x4 + tuckIn} ${yt} ${x4 + tuckIn + r} ${yt} L ${x5 - tuckIn - r} ${yt} ` +
      `Q ${x5 - tuckIn} ${yt} ${x5 - tuckIn} ${yt + r} L ${x5 - tuckIn} ${yi} ` +
      `L ${x5 - tuckIn} ${y} L ${x5} ${y}`
    )
  }

  const segments: Segment[] = [
    cut(`M ${x1} ${top} L 0 ${top + taper} L 0 ${bot - taper} L ${x1} ${bot}`),
    cut(`M ${x2} ${top} L ${x3} ${top}`),
    cut(`M ${x5} ${top} L ${x5} ${bot}`),
    cut(dustCut(x1, x2, top, -1)),
    cut(dustCut(x3, x4, top, -1)),
    cut(tuckCut(top)),
    cut(baseCut(x1, x2, baseLR)),
    cut(baseCut(x2, x3, baseFB)),
    cut(baseCut(x3, x4, baseLR)),
    cut(baseCut(x4, x5, baseFB)),
    crease(`M ${x1} ${top} L ${x1} ${bot}`),
    crease(`M ${x2} ${top} L ${x2} ${bot}`),
    crease(`M ${x3} ${top} L ${x3} ${bot}`),
    crease(`M ${x4} ${top} L ${x4} ${bot}`),
    crease(`M ${x1 + dustIn} ${top} L ${x2 - dustIn} ${top}`),
    crease(`M ${x3 + dustIn} ${top} L ${x4 - dustIn} ${top}`),
    crease(`M ${x4 + tuckIn} ${top} L ${x5 - tuckIn} ${top}`),
    crease(`M ${x4 + tuckIn} ${tiTop} L ${x5 - tuckIn} ${tiTop}`),
    crease(`M ${x1 + dustIn} ${bot} L ${x2 - dustIn} ${bot}`),
    crease(`M ${x2 + dustIn} ${bot} L ${x3 - dustIn} ${bot}`),
    crease(`M ${x3 + dustIn} ${bot} L ${x4 - dustIn} ${bot}`),
    crease(`M ${x4 + dustIn} ${bot} L ${x5 - dustIn} ${bot}`),
  ]

  const dims: DimMark[] = [
    { a: P(x2, bot + baseFB + 2), b: P(x3, bot + baseFB + 2), label: `W ${fmt(Wp)}` },
    { a: P(x1, top - dustH - 8), b: P(x2, top - dustH - 8), label: `D ${fmt(Dp)}` },
    { a: P(-8, top), b: P(-8, bot), label: `H ${fmt(Hp)}` },
  ]

  return { width, height, segments, panels, dims }
}
