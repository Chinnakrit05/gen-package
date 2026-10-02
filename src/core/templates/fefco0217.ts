import type { BoxParams, Dieline, DimMark, Material, Panel, Segment, Vec2 } from '../types'
import { P, fmt, obroundPath, obroundPts } from './shared'

// FEFCO 0217 — กล่องหูหิ้วบน + ก้นล็อกอัตโนมัติ (carrying handle top, snap/crash-lock bottom)
// tube 4 ผนัง [ปีกกาว | ข้าง D | หน้า W | ข้าง D | หลัง W]
// ปากบน: ผนังหน้า-หลัง (W) = แผ่นหูหิ้วเจาะรูจับ พับขึ้นชนกลาง; ผนังข้าง (D) = ลิ้นทรงจั่ว+ร่องล็อก
// ก้น: crash-lock 4 ลิ้น (ลิ้นหน้า-หลังลึกมีมุมเฉียง, ลิ้นข้างสอบ) พับเข้าล็อกกันเอง
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

  const handleH = Math.max(55, Math.min(150, Dp)) // ความยาวแผ่นหูหิ้ว
  const lean = (Math.asin(Math.min(0.98, Dp / 2 / handleH)) * 180) / Math.PI // เอียงให้ยอดชนกลาง
  // ลิ้นข้างทรงจั่ว (ต่ำกว่าหูหิ้วเล็กน้อย) + ร่องล็อกกลาง
  const sideH = handleH * 0.72
  const peakInset = Dp * 0.22
  // ก้น crash-lock: ลิ้นหน้า-หลังลึก (มุมเฉียง), ลิ้นข้างสอบ
  const baseFB = Dp * 0.6
  const baseLR = Dp * 0.46
  const angFB = Math.min(14, Wp * 0.1)
  const angLR = Math.min(14, Dp * 0.18)

  const x1 = glueW
  const x2 = x1 + Dp // ข้างซ้าย
  const x3 = x2 + Wp // หน้า (หูหิ้ว)
  const x4 = x3 + Dp // ข้างขวา
  const x5 = x4 + Wp // หลัง (หูหิ้ว)
  const top = handleH
  const bot = top + Hp
  const width = x5
  const height = bot + baseFB + 4

  // รูจับหูหิ้ว — obround แนวนอน กลางแผ่นหูหิ้ว (หน้า/หลัง) ใกล้ยอด
  const holeLen = Math.min(100, Wp * 0.5)
  const holeThick = Math.min(26, handleH * 0.3)
  const holeCy = top - handleH * 0.55
  const holeF = obroundPts((x2 + x3) / 2, holeCy, holeLen, holeThick)
  const holeB = obroundPts((x4 + x5) / 2, holeCy, holeLen, holeThick)
  // ร่องล็อกกลางลิ้นข้าง (hole บาง ๆ แนวตั้งที่ยอดจั่ว)
  const slotW = Math.max(1.6, Dp * 0.035)
  const slot = (cx: number): Vec2[] => {
    const yTop = top - sideH + 2
    const yBot = top - sideH * 0.42
    return [P(cx - slotW, yTop), P(cx + slotW, yTop), P(cx + slotW, yBot), P(cx - slotW, yBot)]
  }

  const rect = (xa: number, ya: number, xb: number, yb: number): Vec2[] => [
    P(xa, ya), P(xb, ya), P(xb, yb), P(xa, yb),
  ]
  // ลิ้นข้างทรงจั่ว (base ตรง → ไหล่ → ยอดสอบ) + ร่องล็อกกลาง
  const gableFlap = (xa: number, xb: number): Vec2[] => [
    P(xa + fin, top),
    P(xa + fin, top - sideH * 0.5),
    P(xa + peakInset, top - sideH),
    P(xb - peakInset, top - sideH),
    P(xb - fin, top - sideH * 0.5),
    P(xb - fin, top),
  ]
  // ลิ้นก้นหน้า-หลัง (ลึก มุมเฉียง = crash-lock)
  const baseFBFlap = (xa: number, xb: number): Vec2[] => [
    P(xa + fin, bot),
    P(xa + fin + angFB, bot + baseFB),
    P(xb - fin - angFB, bot + baseFB),
    P(xb - fin, bot),
  ]
  // ลิ้นก้นข้าง (สอบ มุมเฉียงฝั่งเดียว = ลิ้นล็อก)
  const baseLRFlap = (xa: number, xb: number): Vec2[] => [
    P(xa + fin, bot),
    P(xa + fin, bot + baseLR),
    P(xb - fin - angLR, bot + baseLR),
    P(xb - fin, bot),
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
    // ลิ้นข้างทรงจั่ว+ร่องล็อก (พับเข้าก่อน)
    {
      id: 'gable-l', parentId: 'side-left', outline: gableFlap(x1, x2), holes: [slot((x1 + x2) / 2)],
      hingeA: P(x1, top), hingeB: P(x2, top), foldAngle: 90, stage: 1, zOffset: layer,
    },
    {
      id: 'gable-r', parentId: 'side-right', outline: gableFlap(x3, x4), holes: [slot((x3 + x4) / 2)],
      hingeA: P(x3, top), hingeB: P(x4, top), foldAngle: 90, stage: 1, zOffset: layer,
    },
    // หูหิ้วหน้า-หลัง เจาะรูจับ พับขึ้นชนกลาง
    {
      id: 'handle-front', parentId: 'front', outline: rect(x2, 0, x3, top), holes: [holeF],
      hingeA: P(x2, top), hingeB: P(x3, top), foldAngle: lean, stage: 2,
    },
    {
      id: 'handle-back', parentId: 'back', outline: rect(x4, 0, x5, top), holes: [holeB],
      hingeA: P(x4, top), hingeB: P(x5, top), foldAngle: lean, stage: 2,
    },
    // ก้น crash-lock
    {
      id: 'base-left', parentId: 'side-left', outline: baseLRFlap(x1, x2),
      hingeA: P(x1, bot), hingeB: P(x2, bot), foldAngle: -90, stage: 1, zOffset: layer,
    },
    {
      id: 'base-right', parentId: 'side-right', outline: baseLRFlap(x3, x4),
      hingeA: P(x3, bot), hingeB: P(x4, bot), foldAngle: -90, stage: 1, zOffset: layer,
    },
    {
      id: 'base-front', parentId: 'front', outline: baseFBFlap(x2, x3),
      hingeA: P(x2, bot), hingeB: P(x3, bot), foldAngle: -90, stage: 2, zOffset: 2 * layer,
    },
    {
      id: 'base-back', parentId: 'back', outline: baseFBFlap(x4, x5),
      hingeA: P(x4, bot), hingeB: P(x5, bot), foldAngle: -90, stage: 2, zOffset: 2 * layer,
    },
  ]

  const cut = (d: string): Segment => ({ kind: 'cut', d })
  const crease = (d: string): Segment => ({ kind: 'crease', d })
  const gableCut = (xa: number, xb: number) =>
    `M ${xa} ${top} L ${xa + fin} ${top} L ${xa + fin} ${top - sideH * 0.5} ` +
    `L ${xa + peakInset} ${top - sideH} L ${xb - peakInset} ${top - sideH} ` +
    `L ${xb - fin} ${top - sideH * 0.5} L ${xb - fin} ${top} L ${xb} ${top}`
  const handleCut = (xa: number, xb: number) => `M ${xa} ${top} L ${xa} 0 L ${xb} 0 L ${xb} ${top}`
  const slotCut = (cx: number) => {
    const yTop = top - sideH + 2
    const yBot = top - sideH * 0.42
    return `M ${cx - slotW} ${yTop} L ${cx + slotW} ${yTop} L ${cx + slotW} ${yBot} L ${cx - slotW} ${yBot} Z`
  }
  const baseFBCut = (xa: number, xb: number) =>
    `M ${xa} ${bot} L ${xa + fin} ${bot} L ${xa + fin + angFB} ${bot + baseFB} ` +
    `L ${xb - fin - angFB} ${bot + baseFB} L ${xb - fin} ${bot} L ${xb} ${bot}`
  const baseLRCut = (xa: number, xb: number) =>
    `M ${xa} ${bot} L ${xa + fin} ${bot} L ${xa + fin} ${bot + baseLR} ` +
    `L ${xb - fin - angLR} ${bot + baseLR} L ${xb - fin} ${bot} L ${xb} ${bot}`

  const segments: Segment[] = [
    cut(`M ${x1} ${top} L 0 ${top + taper} L 0 ${bot - taper} L ${x1} ${bot}`),
    cut(gableCut(x1, x2)),
    cut(handleCut(x2, x3)),
    cut(gableCut(x3, x4)),
    cut(handleCut(x4, x5)),
    cut(`M ${x5} ${top} L ${x5} ${bot}`),
    cut(slotCut((x1 + x2) / 2)),
    cut(slotCut((x3 + x4) / 2)),
    cut(baseLRCut(x1, x2)),
    cut(baseFBCut(x2, x3)),
    cut(baseLRCut(x3, x4)),
    cut(baseFBCut(x4, x5)),
    cut(obroundPath((x2 + x3) / 2, holeCy, holeLen, holeThick)),
    cut(obroundPath((x4 + x5) / 2, holeCy, holeLen, holeThick)),
    crease(`M ${x1} ${top} L ${x1} ${bot}`),
    crease(`M ${x2} ${top} L ${x2} ${bot}`),
    crease(`M ${x3} ${top} L ${x3} ${bot}`),
    crease(`M ${x4} ${top} L ${x4} ${bot}`),
    crease(`M ${x2} ${top} L ${x3} ${top}`),
    crease(`M ${x4} ${top} L ${x5} ${top}`),
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
