import type { BoxParams, Dieline, DimMark, Material, Panel, Segment, Vec2 } from '../types'
import { P, fmt, obroundPath, obroundPts } from './shared'

// FEFCO 0217 — กล่องหูหิ้วบน + ก้นล็อกอัตโนมัติ (carrying handle top, snap-lock bottom)
// tube 4 ผนัง + ก้น auto-lock (เหมือน 0215); ปากบน: ฝาข้าง (sl/sr) ปิดบน + ลิ้นหน้า-หลังพับขึ้น
// เอียงมาชนกันเป็นหูหิ้วทรงเต็นท์ เจาะรูจับ (obround) ตรงกลางให้ทะลุทั้งสองแผ่น
// W,D,H = ขนาดด้านใน (+2t ต่อแกน)
export function generateFefco0217(box: BoxParams, mat: Material): Dieline {
  const { W, D, H } = box
  const t = mat.thickness

  const Wp = W + 2 * t
  const Dp = D + 2 * t
  const Hp = H + 2 * t

  const glueW = Math.max(12, 10 + 2 * t)
  const taper = 4
  const fin = Math.max(1.5, t + 0.5)
  const layer = t + 0.05

  const handleH = Math.max(55, Math.min(140, Dp)) // ความยาวแผ่นหูหิ้ว (ยอดยื่นเหนือปากกล่อง)
  // เอียงให้ยอดเลื่อนแนวลึกมาชนกลาง: ระยะเลื่อน = handleH·sinθ = Dp/2 → θ = asin(Dp/2 / handleH)
  const lean = (Math.asin(Math.min(0.98, Dp / 2 / handleH)) * 180) / Math.PI
  const closeLen = Math.max(6, Wp / 2 - fin) // ฝาข้างปิดบน (ชนกลางแกน W)
  const baseLR = Dp * 0.5
  const baseFB = Dp * 0.62
  const lrSlant = Math.min(6, baseLR * 0.4)

  const x1 = glueW
  const x2 = x1 + Dp
  const x3 = x2 + Wp
  const x4 = x3 + Dp
  const x5 = x4 + Wp
  const top = handleH
  const bot = top + Hp
  const width = x5
  const height = bot + baseFB + 4

  // รูจับหูหิ้ว — obround แนวนอน กลางแผ่นหูหิ้ว (หน้า/หลัง) ที่ระดับใกล้ยอด
  const holeLen = Math.min(90, Wp * 0.55)
  const holeThick = Math.min(24, handleH * 0.32)
  const holeCyF = top - handleH * 0.5 // กลางแผ่นหูหิ้วหน้า (ก่อนพับ ที่ y นี้)
  const holeF = obroundPts((x2 + x3) / 2, holeCyF, holeLen, holeThick)
  const holeB = obroundPts((x4 + x5) / 2, holeCyF, holeLen, holeThick)

  const rect = (xa: number, ya: number, xb: number, yb: number): Vec2[] => [
    P(xa, ya), P(xb, ya), P(xb, yb), P(xa, yb),
  ]
  const closeFlap = (xa: number, xb: number): Vec2[] => rect(xa + fin, top - closeLen, xb - fin, top)
  const baseFlap = (xa: number, xb: number, depth: number): Vec2[] => [
    P(xa + fin, bot), P(xa + fin + lrSlant, bot + depth),
    P(xb - fin - lrSlant, bot + depth), P(xb - fin, bot),
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
    // ฝาข้างปิดบน (พับเข้าชนกลาง)
    {
      id: 'close-l', parentId: 'side-left', outline: closeFlap(x1, x2),
      hingeA: P(x1, top), hingeB: P(x2, top), foldAngle: 90, stage: 1, zOffset: layer,
    },
    {
      id: 'close-r', parentId: 'side-right', outline: closeFlap(x3, x4),
      hingeA: P(x3, top), hingeB: P(x4, top), foldAngle: 90, stage: 1, zOffset: layer,
    },
    // หูหิ้ว: ลิ้นหน้า-หลังพับขึ้นเอียงมาชนกลาง เจาะรูจับ
    {
      id: 'handle-front', parentId: 'front', outline: rect(x2, 0, x3, top), holes: [holeF],
      hingeA: P(x2, top), hingeB: P(x3, top), foldAngle: lean, stage: 2,
    },
    {
      id: 'handle-back', parentId: 'back', outline: rect(x4, 0, x5, top), holes: [holeB],
      hingeA: P(x4, top), hingeB: P(x5, top), foldAngle: lean, stage: 2,
    },
    // ก้น auto-lock
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
  const closeCut = (xa: number, xb: number) =>
    `M ${xa} ${top} L ${xa + fin} ${top} L ${xa + fin} ${top - closeLen} ` +
    `L ${xb - fin} ${top - closeLen} L ${xb - fin} ${top} L ${xb} ${top}`
  const handleCut = (xa: number, xb: number) =>
    `M ${xa} ${top} L ${xa} 0 L ${xb} 0 L ${xb} ${top}`
  const baseCut = (xa: number, xb: number, depth: number) =>
    `M ${xa} ${bot} L ${xa + fin} ${bot} L ${xa + fin + lrSlant} ${bot + depth} ` +
    `L ${xb - fin - lrSlant} ${bot + depth} L ${xb - fin} ${bot} L ${xb} ${bot}`

  const segments: Segment[] = [
    cut(`M ${x1} ${top} L 0 ${top + taper} L 0 ${bot - taper} L ${x1} ${bot}`),
    cut(closeCut(x1, x2)),
    cut(handleCut(x2, x3)),
    cut(closeCut(x3, x4)),
    cut(handleCut(x4, x5)),
    cut(`M ${x5} ${top} L ${x5} ${bot}`),
    cut(baseCut(x1, x2, baseLR)),
    cut(baseCut(x2, x3, baseFB)),
    cut(baseCut(x3, x4, baseLR)),
    cut(baseCut(x4, x5, baseFB)),
    cut(obroundPath((x2 + x3) / 2, holeCyF, holeLen, holeThick)),
    cut(obroundPath((x4 + x5) / 2, holeCyF, holeLen, holeThick)),
    crease(`M ${x1} ${top} L ${x1} ${bot}`),
    crease(`M ${x2} ${top} L ${x2} ${bot}`),
    crease(`M ${x3} ${top} L ${x3} ${bot}`),
    crease(`M ${x4} ${top} L ${x4} ${bot}`),
    crease(`M ${x2} ${top} L ${x3} ${top}`), // ฐานหูหิ้วหน้า
    crease(`M ${x4} ${top} L ${x5} ${top}`), // ฐานหูหิ้วหลัง
    crease(`M ${x1 + fin} ${top} L ${x2 - fin} ${top}`),
    crease(`M ${x3 + fin} ${top} L ${x4 - fin} ${top}`),
    crease(`M ${x1 + fin} ${bot} L ${x2 - fin} ${bot}`),
    crease(`M ${x2 + fin} ${bot} L ${x3 - fin} ${bot}`),
    crease(`M ${x3 + fin} ${bot} L ${x4 - fin} ${bot}`),
    crease(`M ${x4 + fin} ${bot} L ${x5 - fin} ${bot}`),
  ]

  const dims: DimMark[] = [
    { a: P(x2, bot + baseFB + 2), b: P(x3, bot + baseFB + 2), label: `W ${fmt(Wp)}` },
    { a: P(x1, top + 8), b: P(x2, top + 8), label: `D ${fmt(Dp)}` },
    { a: P(-8, top), b: P(-8, bot), label: `H ${fmt(Hp)}` },
  ]

  return { width, height, segments, panels, dims }
}
