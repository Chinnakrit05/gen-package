import type { BoxParams, Dieline, DimMark, Material, Panel, Segment } from '../types'
import { P, fmt, rect } from './shared'

// FEFCO 0202 — Overlap Slotted Container (OSC)
// เหมือน RSC (0201) แต่ลิ้นหน้า-หลัง (outer) ยาว "เต็มความลึก" จึงพับเกยทับกันเต็มแผ่น
// (แทนที่จะชนกลางแบบ RSC) → ก้น/ฝาสองชั้นทั้งแผ่น แข็งแรงกว่า เหมาะของหนัก/ของแคบ
// W,D,H = ขนาดด้านใน (+2t ต่อแกน)
export function generateFefco0202(box: BoxParams, mat: Material): Dieline {
  const { W, D, H } = box
  const t = mat.thickness

  const Wp = W + 2 * t
  const Dp = D + 2 * t
  const Hp = H + 2 * t

  const glueW = Math.max(12, 10 + 2 * t)
  const taper = 4
  const fin = Math.max(1.5, t + 0.5)
  const layer = t + 0.05

  const outerLen = Dp // ลิ้นหน้า-หลังยาวเต็มความลึก → เกยทับกันเต็ม (ต่างจาก RSC ที่ = Dp/2)
  const innerLen = Math.max(6, Math.min(Dp / 2, Wp / 2 - fin))

  const x1 = glueW
  const x2 = x1 + Dp
  const x3 = x2 + Wp
  const x4 = x3 + Dp
  const x5 = x4 + Wp
  const top = outerLen
  const bot = top + Hp
  const width = x5
  const height = bot + outerLen

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
    // ลิ้นข้าง (inner) พับก่อน
    {
      id: 'flap-t-sl', parentId: 'side-left', outline: rect(x1 + fin, top - innerLen, x2 - fin, top),
      hingeA: P(x1, top), hingeB: P(x2, top), foldAngle: 90, stage: 1, zOffset: layer,
    },
    {
      id: 'flap-t-sr', parentId: 'side-right', outline: rect(x3 + fin, top - innerLen, x4 - fin, top),
      hingeA: P(x3, top), hingeB: P(x4, top), foldAngle: 90, stage: 1, zOffset: layer,
    },
    {
      id: 'flap-b-sl', parentId: 'side-left', outline: rect(x1 + fin, bot, x2 - fin, bot + innerLen),
      hingeA: P(x1, bot), hingeB: P(x2, bot), foldAngle: -90, stage: 1, zOffset: layer,
    },
    {
      id: 'flap-b-sr', parentId: 'side-right', outline: rect(x3 + fin, bot, x4 - fin, bot + innerLen),
      hingeA: P(x3, bot), hingeB: P(x4, bot), foldAngle: -90, stage: 1, zOffset: layer,
    },
    // ลิ้นหน้า (outer เต็มลึก) พับก่อน แล้วลิ้นหลังพับทับบนสุด (เกยเต็ม)
    {
      id: 'flap-t-front', parentId: 'front', outline: rect(x2 + fin, top - outerLen, x3 - fin, top),
      hingeA: P(x2, top), hingeB: P(x3, top), foldAngle: 90, stage: 2, zOffset: 2 * layer,
    },
    {
      id: 'flap-t-back', parentId: 'back', outline: rect(x4 + fin, top - outerLen, x5 - fin, top),
      hingeA: P(x4, top), hingeB: P(x5, top), foldAngle: 90, stage: 3, zOffset: 3 * layer,
    },
    {
      id: 'flap-b-front', parentId: 'front', outline: rect(x2 + fin, bot, x3 - fin, bot + outerLen),
      hingeA: P(x2, bot), hingeB: P(x3, bot), foldAngle: -90, stage: 2, zOffset: 2 * layer,
    },
    {
      id: 'flap-b-back', parentId: 'back', outline: rect(x4 + fin, bot, x5 - fin, bot + outerLen),
      hingeA: P(x4, bot), hingeB: P(x5, bot), foldAngle: -90, stage: 3, zOffset: 3 * layer,
    },
  ]

  const cut = (d: string): Segment => ({ kind: 'cut', d })
  const crease = (d: string): Segment => ({ kind: 'crease', d })
  const topFlapCut = (xa: number, xb: number, len: number) =>
    `M ${xa} ${top} L ${xa + fin} ${top} L ${xa + fin} ${top - len} ` +
    `L ${xb - fin} ${top - len} L ${xb - fin} ${top} L ${xb} ${top}`
  const botFlapCut = (xa: number, xb: number, len: number) =>
    `M ${xa} ${bot} L ${xa + fin} ${bot} L ${xa + fin} ${bot + len} ` +
    `L ${xb - fin} ${bot + len} L ${xb - fin} ${bot} L ${xb} ${bot}`

  const segments: Segment[] = [
    cut(`M ${x1} ${top} L 0 ${top + taper} L 0 ${bot - taper} L ${x1} ${bot}`),
    cut(topFlapCut(x1, x2, innerLen)),
    cut(topFlapCut(x2, x3, outerLen)),
    cut(topFlapCut(x3, x4, innerLen)),
    cut(topFlapCut(x4, x5, outerLen)),
    cut(botFlapCut(x1, x2, innerLen)),
    cut(botFlapCut(x2, x3, outerLen)),
    cut(botFlapCut(x3, x4, innerLen)),
    cut(botFlapCut(x4, x5, outerLen)),
    cut(`M ${x5} ${top} L ${x5} ${bot}`),
    crease(`M ${x1} ${top} L ${x1} ${bot}`),
    crease(`M ${x2} ${top} L ${x2} ${bot}`),
    crease(`M ${x3} ${top} L ${x3} ${bot}`),
    crease(`M ${x4} ${top} L ${x4} ${bot}`),
    crease(`M ${x1 + fin} ${top} L ${x2 - fin} ${top}`),
    crease(`M ${x2 + fin} ${top} L ${x3 - fin} ${top}`),
    crease(`M ${x3 + fin} ${top} L ${x4 - fin} ${top}`),
    crease(`M ${x4 + fin} ${top} L ${x5 - fin} ${top}`),
    crease(`M ${x1 + fin} ${bot} L ${x2 - fin} ${bot}`),
    crease(`M ${x2 + fin} ${bot} L ${x3 - fin} ${bot}`),
    crease(`M ${x3 + fin} ${bot} L ${x4 - fin} ${bot}`),
    crease(`M ${x4 + fin} ${bot} L ${x5 - fin} ${bot}`),
  ]

  const dims: DimMark[] = [
    { a: P(x2, height + 12), b: P(x3, height + 12), label: `W ${fmt(Wp)}` },
    { a: P(x1, height + 12), b: P(x2, height + 12), label: `D ${fmt(Dp)}` },
    { a: P(-10, top), b: P(-10, bot), label: `H ${fmt(Hp)}` },
  ]

  return { width, height, segments, panels, dims }
}
