import type { BoxParams, Dieline, DimMark, Material, Panel, Segment } from '../types'
import { P, fmt, rect } from './shared'

// กล่องลูกฟูกมาตรฐาน RSC (FEFCO 0201 — Regular Slotted Container)
// ผังแผ่นคลี่เรียงซ้าย→ขวา: ปีกทากาว | ข้างซ้าย | หน้า | ข้างขวา | หลัง (ผนังต่อกันเป็นท่อ)
// บน-ล่างของผนังทุกด้านมี "ลิ้น" (flap): ลิ้นข้าง (inner) พับก่อน, ลิ้นหน้า-หลัง (outer)
// พับทับมาชนกันกลางฝา — ลิ้นหน้า-หลังยาว Dp/2 จึงชนพอดี ลิ้นข้างสั้นกว่าเพื่อไม่ชนกันเอง
// W,D,H = ขนาด "ด้านใน" แปลงเป็นระยะ score โดยบวก 2t ต่อแกน (ผนังหนา t ทุกด้าน)
export function generateRSCBox(box: BoxParams, mat: Material): Dieline {
  const { W, D, H } = box
  const t = mat.thickness

  const Wp = W + 2 * t
  const Dp = D + 2 * t
  const Hp = H + 2 * t

  const glueW = Math.max(12, 10 + 2 * t)
  const taper = 4
  const fin = Math.max(1.5, t + 0.5) // ระยะหลบข้าง/ร่องสล็อตครึ่งหนึ่งของลิ้น
  const layer = t + 0.05

  // ลิ้นหน้า-หลัง (outer) ยาวครึ่งความลึกจึงชนกันกลาง; ลิ้นข้าง (inner) สั้นกว่าเพื่อไม่พับชนกันเอง
  const outerLen = Dp / 2
  const innerLen = Math.max(6, Math.min(outerLen, Wp / 2 - fin))

  const x1 = glueW
  const x2 = x1 + Dp
  const x3 = x2 + Wp
  const x4 = x3 + Dp
  const x5 = x4 + Wp
  const top = outerLen
  const bot = top + Hp

  const width = x5
  const height = bot + outerLen

  // --- panels สำหรับ 3D ---
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
    // ลิ้นข้าง (inner) พับก่อน — stage 1
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
    // ลิ้นหน้า-หลัง (outer) พับทับมาชนกลาง — stage 2, ยกสูงกว่าลิ้นข้างหนึ่งชั้น
    {
      id: 'flap-t-front', parentId: 'front', outline: rect(x2 + fin, top - outerLen, x3 - fin, top),
      hingeA: P(x2, top), hingeB: P(x3, top), foldAngle: 90, stage: 2, zOffset: 2 * layer,
    },
    {
      id: 'flap-t-back', parentId: 'back', outline: rect(x4 + fin, top - outerLen, x5 - fin, top),
      hingeA: P(x4, top), hingeB: P(x5, top), foldAngle: 90, stage: 2, zOffset: 2 * layer,
    },
    {
      id: 'flap-b-front', parentId: 'front', outline: rect(x2 + fin, bot, x3 - fin, bot + outerLen),
      hingeA: P(x2, bot), hingeB: P(x3, bot), foldAngle: -90, stage: 2, zOffset: 2 * layer,
    },
    {
      id: 'flap-b-back', parentId: 'back', outline: rect(x4 + fin, bot, x5 - fin, bot + outerLen),
      hingeA: P(x4, bot), hingeB: P(x5, bot), foldAngle: -90, stage: 2, zOffset: 2 * layer,
    },
  ]

  // --- เส้นสำหรับ blueprint ---
  const cut = (d: string): Segment => ({ kind: 'cut', d })
  const crease = (d: string): Segment => ({ kind: 'crease', d })

  // เส้นตัดของลิ้นบน: จากมุมผนัง → ไหล่หลบ (สล็อต) → ขึ้นข้างลิ้น → ยอดลิ้น → ลง → ไหล่อีกข้าง
  const topFlapCut = (xa: number, xb: number, len: number) =>
    `M ${xa} ${top} L ${xa + fin} ${top} L ${xa + fin} ${top - len} ` +
    `L ${xb - fin} ${top - len} L ${xb - fin} ${top} L ${xb} ${top}`
  const botFlapCut = (xa: number, xb: number, len: number) =>
    `M ${xa} ${bot} L ${xa + fin} ${bot} L ${xa + fin} ${bot + len} ` +
    `L ${xb - fin} ${bot + len} L ${xb - fin} ${bot} L ${xb} ${bot}`

  const segments: Segment[] = [
    // ปีกทากาว (trapezoid) — ขอบขวา x1 เป็นเส้นพับ
    cut(`M ${x1} ${top} L 0 ${top + taper} L 0 ${bot - taper} L ${x1} ${bot}`),
    // ลิ้นบน 4 ผนัง (ข้าง=inner สั้น, หน้า-หลัง=outer ยาว)
    cut(topFlapCut(x1, x2, innerLen)),
    cut(topFlapCut(x2, x3, outerLen)),
    cut(topFlapCut(x3, x4, innerLen)),
    cut(topFlapCut(x4, x5, outerLen)),
    // ลิ้นล่าง 4 ผนัง
    cut(botFlapCut(x1, x2, innerLen)),
    cut(botFlapCut(x2, x3, outerLen)),
    cut(botFlapCut(x3, x4, innerLen)),
    cut(botFlapCut(x4, x5, outerLen)),
    // ขอบขวาสุด (ผนังหลัง) เป็นเส้นตัดอิสระ
    cut(`M ${x5} ${top} L ${x5} ${bot}`),
    // เส้นพับตั้ง (ผนัง)
    crease(`M ${x1} ${top} L ${x1} ${bot}`),
    crease(`M ${x2} ${top} L ${x2} ${bot}`),
    crease(`M ${x3} ${top} L ${x3} ${bot}`),
    crease(`M ${x4} ${top} L ${x4} ${bot}`),
    // เส้นพับลิ้นบน (เท่าช่วงที่ลิ้นเกาะจริง)
    crease(`M ${x1 + fin} ${top} L ${x2 - fin} ${top}`),
    crease(`M ${x2 + fin} ${top} L ${x3 - fin} ${top}`),
    crease(`M ${x3 + fin} ${top} L ${x4 - fin} ${top}`),
    crease(`M ${x4 + fin} ${top} L ${x5 - fin} ${top}`),
    // เส้นพับลิ้นล่าง
    crease(`M ${x1 + fin} ${bot} L ${x2 - fin} ${bot}`),
    crease(`M ${x2 + fin} ${bot} L ${x3 - fin} ${bot}`),
    crease(`M ${x3 + fin} ${bot} L ${x4 - fin} ${bot}`),
    crease(`M ${x4 + fin} ${bot} L ${x5 - fin} ${bot}`),
  ]

  const dims: DimMark[] = [
    { a: P(x2, height + 12), b: P(x3, height + 12), label: `W ${fmt(Wp)}` },
    { a: P(x1, height + 12), b: P(x2, height + 12), label: `D ${fmt(Dp)}` },
    { a: P(-10, top), b: P(-10, bot), label: `H ${fmt(Hp)}` },
    { a: P(0, -12), b: P(x5, -12), label: fmt(width) },
    { a: P(x5 + 12, 0), b: P(x5 + 12, height), label: fmt(height) },
  ]

  return { width, height, segments, panels, dims }
}
