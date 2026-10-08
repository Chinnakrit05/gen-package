import type { BoxParams, Dieline, DimMark, Material, Panel, Segment, Vec2 } from '../types'
import { P, arcPts, fmt, obroundPath, obroundPts, rect } from './shared'

// FEFCO 0217 — กล่องหูหิ้วทรงจั่ว + ก้นล็อก (gable carry box)
// ผังแผ่นคลี่ซ้าย→ขวา: ข้าง D | หน้า W | ข้าง D | หลัง W | ปีกกาว
//  - ผนังข้างยื่นขึ้นเป็น "หน้าจั่ว" สามเหลี่ยม (ระนาบเดียวกับผนัง) มีร่องล็อกกลาง
//  - ผนังหน้า-หลังต่อเป็นแผงหลังคา: พับเอียงตามขอบจั่วมาชนที่สัน แล้วพับตั้งขึ้นเป็นหูหิ้วสองชั้นแนบกัน
//    หูหลังเจาะรูจับ, หูหน้าเป็นลิ้นดันเข้า (ตัดรูปตัว U + เส้นพับบน) ดันทะลุรูหลังให้จับไม่บาดมือ
//    มุมบนหูหิ้วเป็นหูมน (ear) แยกจากแผงกลางด้วยร่องบาก
//  - ก้นล็อก: ลิ้นข้างครึ่งแผงฝั่งหน้า → ลิ้นหน้ามุมเฉียง → ลิ้นหลังเว้ากลางปิดทับ
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

  // --- หลังคา/หูหิ้ว ---
  const g = 0.57 * Dp // ความสูงยอดจั่วเหนือปากกล่อง
  const a = Math.atan2(Dp / 2, g) // มุมเอียงหลังคาจากแนวตั้ง
  const gap = layer // ระยะเว้นจากกึ่งกลาง: หูหิ้วสองแผ่น (หนา t ชี้เข้าหากัน) แนบกันไม่ทับเนื้อ
  const slant = (Dp / 2 - gap) / Math.sin(a) // ความยาวแผงหลังคาจากปากถึงสัน
  const finH = Math.min(70, Math.max(35, 0.36 * Dp)) // ความสูงหูหิ้วเหนือสัน
  const earW = Math.min(24, Math.max(10, 0.07 * Wp))
  const earR = earW / 2
  const earTop = 0.28 * finH // ยอดหูมนต่ำกว่ายอดหูหิ้ว
  const notchW = earW * 0.5
  const notchY = 0.55 * finH // ก้นร่องบากระหว่างหูมนกับแผงกลาง
  const holeThick = Math.min(22, 0.4 * finH)
  // รูหูหลังใหญ่กว่าลิ้นดันรอบตัว — ลิ้น (ขนาดเท่ารูหน้า) ทะลุผ่านได้โดยไม่ครูดขอบมนของรูหลัง
  const backGrow = Math.max(3, 0.225 * holeThick)
  const holeLen = Math.min(100, 0.35 * Wp, Wp - 2 * (earW + notchW + backGrow) - 8)
  const hasHole = holeLen >= holeThick + 10

  // --- ก้นล็อก ---
  const bS = Math.min(0.77 * Dp, Wp / 2 - 2) // ลิ้นข้าง (ครึ่งแผงฝั่งหน้า)
  const bF = 0.8 * Dp // ลิ้นหน้า
  const cF = Math.min(0.25 * Wp, 0.5 * Dp, bF) // มุมเฉียง/ช่วงเว้นของลิ้นหน้า
  const bB = 0.83 * Dp // ลิ้นหลัง
  const cB = 0.24 * Wp // ช่วงขาลิ้นหลังสองข้าง
  const nB = 0.2 * Dp // ความลึกส่วนเว้ากลางลิ้นหลัง

  const X0 = 0
  const X1 = X0 + Dp // ข้างซ้าย | หน้า
  const X2 = X1 + Wp // หน้า | ข้างขวา
  const X3 = X2 + Dp // ข้างขวา | หลัง
  const X4 = X3 + Wp // หลัง | ปีกกาว
  const top = slant + finH // ปากกล่อง
  const ridge = top - slant // แนวสัน (บนแผ่นคลี่)
  const bot = top + Hp
  const width = X4 + glueW
  const height = bot + Math.max(bS, bF, bB) + 4

  const holeCy = finH * 0.5
  const holeHalf = Math.max(0, holeLen / 2 - holeThick / 2)
  const holeR = holeThick / 2
  const backLen = holeLen + 2 * backGrow
  const backThick = holeThick + 2 * backGrow

  // ร่องล็อกกลางหน้าจั่ว
  const slotW = Math.max(0.8, 0.6 * t)
  const slotY0 = top - 0.76 * g
  const slotY1 = top - 0.1 * g
  const slot = (cx: number): Vec2[] => rect(cx - slotW, slotY0, cx + slotW, slotY1)

  // ผนังข้าง + หน้าจั่ว (แผงเดียว ไม่มีรอยพับที่ปาก)
  const sideOutline = (xa: number, xb: number): Vec2[] => [
    P(xa, bot), P(xa, top), P((xa + xb) / 2, top - g), P(xb, top), P(xb, bot),
  ]
  // หูหิ้วเหนือสัน: หูมนสองมุม + ร่องบาก + แผงกลาง
  const finOutline = (xa: number, xb: number): Vec2[] => [
    P(xa, ridge),
    ...arcPts(xa + earR, earTop + earR, earR, Math.PI, Math.PI * 2, 6),
    P(xa + earW, notchY),
    P(xa + earW + notchW, 0),
    P(xb - earW - notchW, 0),
    P(xb - earW, notchY),
    ...arcPts(xb - earR, earTop + earR, earR, Math.PI, Math.PI * 2, 6),
    P(xb, ridge),
  ]
  const finCut = (xa: number, xb: number) =>
    `M ${xa} ${top} L ${xa} ${earTop + earR} A ${earR} ${earR} 0 0 1 ${xa + earW} ${earTop + earR} ` +
    `L ${xa + earW} ${notchY} L ${xa + earW + notchW} 0 L ${xb - earW - notchW} 0 L ${xb - earW} ${notchY} ` +
    `L ${xb - earW} ${earTop + earR} A ${earR} ${earR} 0 0 1 ${xb} ${earTop + earR} L ${xb} ${top}`

  const fcx = (X1 + X2) / 2
  const bcx = (X3 + X4) / 2
  const roofDeg = (a * 180) / Math.PI

  const panels: Panel[] = [
    { id: 'front', parentId: null, outline: rect(X1, top, X2, bot), stage: 0 },
    {
      id: 'side-left', parentId: 'front', outline: sideOutline(X0, X1), holes: [slot((X0 + X1) / 2)],
      hingeA: P(X1, top), hingeB: P(X1, bot), foldAngle: -90, stage: 0,
    },
    {
      id: 'side-right', parentId: 'front', outline: sideOutline(X2, X3), holes: [slot((X2 + X3) / 2)],
      hingeA: P(X2, top), hingeB: P(X2, bot), foldAngle: 90, stage: 0,
    },
    {
      id: 'back', parentId: 'side-right', outline: rect(X3, top, X4, bot),
      hingeA: P(X3, top), hingeB: P(X3, bot), foldAngle: 90, stage: 0,
    },
    {
      id: 'glue', parentId: 'back',
      outline: [P(X4, top), P(X4 + glueW, top + taper), P(X4 + glueW, bot - taper), P(X4, bot)],
      hingeA: P(X4, top), hingeB: P(X4, bot), foldAngle: 90, stage: 0, zOffset: layer,
    },
    // ก้นล็อก — พับก่อนอยู่ลึกกว่า (zOffset มากกว่า): ลิ้นข้าง → ลิ้นหน้า → ลิ้นหลังปิดนอกสุด
    {
      id: 'base-left', parentId: 'side-left', outline: rect(X0 + Dp / 2, bot, X1 - fin, bot + bS),
      hingeA: P(X0 + Dp / 2, bot), hingeB: P(X1 - fin, bot), foldAngle: -90, stage: 1, zOffset: 3 * layer,
    },
    {
      id: 'base-right', parentId: 'side-right', outline: rect(X2 + fin, bot, X2 + Dp / 2, bot + bS),
      hingeA: P(X2 + fin, bot), hingeB: P(X2 + Dp / 2, bot), foldAngle: -90, stage: 1, zOffset: 3 * layer,
    },
    {
      id: 'base-front', parentId: 'front',
      outline: [
        P(X1 + fin, bot), P(X1 + fin + cF, bot + cF), P(X1 + fin + cF, bot + bF),
        P(X2 - cF, bot + bF), P(X2 - cF, bot),
      ],
      hingeA: P(X1 + fin, bot), hingeB: P(X2 - cF, bot), foldAngle: -90, stage: 2, zOffset: 2 * layer,
    },
    {
      id: 'base-back', parentId: 'back',
      outline: [
        P(X3 + fin, bot), P(X3 + fin, bot + bB), P(X3 + cB, bot + bB), P(X3 + cB, bot + bB - nB),
        P(X4 - cB, bot + bB - nB), P(X4 - cB, bot + bB), P(X4 - fin, bot + bB), P(X4 - fin, bot),
      ],
      hingeA: P(X3 + fin, bot), hingeB: P(X4 - fin, bot), foldAngle: -90, stage: 3, zOffset: layer,
    },
    // หลังคาเอียงตามขอบจั่ว → หูหิ้วตั้งตรง (หมุนกลับเท่ามุมหลังคา จึงตั้งดิ่งตลอดการพับ)
    {
      id: 'roof-front', parentId: 'front', outline: rect(X1, ridge, X2, top),
      hingeA: P(X1, top), hingeB: P(X2, top), foldAngle: roofDeg, stage: 4,
    },
    {
      id: 'fin-front', parentId: 'roof-front', outline: finOutline(X1, X2),
      holes: hasHole ? [obroundPts(fcx, holeCy, holeLen, holeThick)] : undefined,
      hingeA: P(X1, ridge), hingeB: P(X2, ridge), foldAngle: -roofDeg, stage: 4,
    },
    {
      id: 'roof-back', parentId: 'back', outline: rect(X3, ridge, X4, top),
      hingeA: P(X3, top), hingeB: P(X4, top), foldAngle: roofDeg, stage: 4,
    },
    {
      id: 'fin-back', parentId: 'roof-back', outline: finOutline(X3, X4),
      holes: hasHole ? [obroundPts(bcx, holeCy, backLen, backThick)] : undefined,
      hingeA: P(X3, ridge), hingeB: P(X4, ridge), foldAngle: -roofDeg, stage: 4,
    },
  ]
  // ลิ้นดันของหูหน้า: พับเข้าทะลุรูจับของหูหลัง
  if (hasHole) {
    panels.push({
      id: 'grip-flap', parentId: 'fin-front', outline: obroundPts(fcx, holeCy, holeLen, holeThick),
      hingeA: P(fcx - holeHalf, holeCy - holeR), hingeB: P(fcx + holeHalf, holeCy - holeR),
      foldAngle: -60, stage: 4,
    })
  }

  const cut = (d: string): Segment => ({ kind: 'cut', d })
  const crease = (d: string): Segment => ({ kind: 'crease', d })
  const gableCut = (xa: number, xb: number) => `M ${xa} ${top} L ${(xa + xb) / 2} ${top - g} L ${xb} ${top}`
  const slotCut = (cx: number) =>
    `M ${cx - slotW} ${slotY0} L ${cx + slotW} ${slotY0} L ${cx + slotW} ${slotY1} L ${cx - slotW} ${slotY1} Z`

  const segments: Segment[] = [
    // ขอบนอก (ตามเข็มนาฬิกา เริ่มมุมล่างซ้าย)
    cut(`M ${X0} ${bot} L ${X0} ${top}`),
    cut(gableCut(X0, X1)),
    cut(finCut(X1, X2)),
    cut(gableCut(X2, X3)),
    cut(finCut(X3, X4)),
    cut(`M ${X4} ${top} L ${X4 + glueW} ${top + taper} L ${X4 + glueW} ${bot - taper} L ${X4} ${bot}`),
    cut(
      `M ${X4} ${bot} L ${X4 - fin} ${bot} L ${X4 - fin} ${bot + bB} L ${X4 - cB} ${bot + bB} ` +
        `L ${X4 - cB} ${bot + bB - nB} L ${X3 + cB} ${bot + bB - nB} L ${X3 + cB} ${bot + bB} ` +
        `L ${X3 + fin} ${bot + bB} L ${X3 + fin} ${bot} L ${X3} ${bot}`,
    ),
    cut(
      `M ${X3} ${bot} L ${X2 + Dp / 2} ${bot} L ${X2 + Dp / 2} ${bot + bS} L ${X2 + fin} ${bot + bS} ` +
        `L ${X2 + fin} ${bot} L ${X2 - cF} ${bot} L ${X2 - cF} ${bot + bF} L ${X1 + fin + cF} ${bot + bF} ` +
        `L ${X1 + fin + cF} ${bot + cF} L ${X1 + fin} ${bot} L ${X1 - fin} ${bot} L ${X1 - fin} ${bot + bS} ` +
        `L ${X0 + Dp / 2} ${bot + bS} L ${X0 + Dp / 2} ${bot} L ${X0} ${bot}`,
    ),
    cut(slotCut((X0 + X1) / 2)),
    cut(slotCut((X2 + X3) / 2)),
    crease(`M ${X1} ${top} L ${X1} ${bot}`),
    crease(`M ${X2} ${top} L ${X2} ${bot}`),
    crease(`M ${X3} ${top} L ${X3} ${bot}`),
    crease(`M ${X4} ${top} L ${X4} ${bot}`),
    crease(`M ${X1} ${top} L ${X2} ${top}`),
    crease(`M ${X3} ${top} L ${X4} ${top}`),
    crease(`M ${X1} ${ridge} L ${X2} ${ridge}`),
    crease(`M ${X3} ${ridge} L ${X4} ${ridge}`),
    crease(`M ${X0 + Dp / 2} ${bot} L ${X1 - fin} ${bot}`),
    crease(`M ${X1 + fin} ${bot} L ${X2 - cF} ${bot}`),
    crease(`M ${X2 + fin} ${bot} L ${X2 + Dp / 2} ${bot}`),
    crease(`M ${X3 + fin} ${bot} L ${X4 - fin} ${bot}`),
  ]
  if (hasHole) {
    segments.push(cut(obroundPath(bcx, holeCy, backLen, backThick)))
    // หูหน้า: ตัดรูปตัว U ใต้เส้นพับบน → ลิ้นดันเข้า
    segments.push(
      cut(
        `M ${fcx + holeHalf} ${holeCy - holeR} A ${holeR} ${holeR} 0 0 1 ${fcx + holeHalf} ${holeCy + holeR} ` +
          `L ${fcx - holeHalf} ${holeCy + holeR} A ${holeR} ${holeR} 0 0 1 ${fcx - holeHalf} ${holeCy - holeR}`,
      ),
      crease(`M ${fcx - holeHalf} ${holeCy - holeR} L ${fcx + holeHalf} ${holeCy - holeR}`),
    )
  }

  const dims: DimMark[] = [
    { a: P(X1, bot + Math.max(bS, bF, bB) + 2), b: P(X2, bot + Math.max(bS, bF, bB) + 2), label: `W ${fmt(Wp)}` },
    { a: P(X0, bot + bS + 10), b: P(X1, bot + bS + 10), label: `D ${fmt(Dp)}` },
    { a: P(-8, top), b: P(-8, bot), label: `H ${fmt(Hp)}` },
    { a: P(0, -10), b: P(width, -10), label: fmt(width) },
    { a: P(width + 10, 0), b: P(width + 10, height), label: fmt(height) },
  ]

  return { width, height, segments, panels, dims }
}
