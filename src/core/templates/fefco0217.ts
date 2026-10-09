import type { BoxParams, Dieline, DimMark, Material, Panel, Segment, Vec2 } from '../types'
import { P, arcPts, fmt, obroundPath, obroundPts, rect } from './shared'

// FEFCO 0217 — กล่องหูหิ้วทรงจั่ว + ก้นล็อก (gable carry box)
// ผังแผ่นคลี่ซ้าย→ขวา: ข้าง D | หน้า W | ข้าง D | หลัง W | ปีกกาว
//  - ผนังหน้า-หลังต่อเป็น "ฝาแบน" (พับ 90° ปิดปากครึ่งความลึก) + "หูหิ้ว" (พับตั้งขึ้นกลางกล่อง สองชั้นแนบสนิท)
//    หูหลังเจาะรูจับ, หูหน้าเป็นลิ้นดันเข้า (ตัดรูปตัว U + เส้นพับบน) ดันทะลุรูหลังให้จับไม่บาดมือ
//  - ผนังข้างต่อเป็น "หน้าจั่ว" สามเหลี่ยมยอดมน (รอยพับที่ปาก) มีร่องกลาง — พับสุดท้าย: หน้าจั่วเอนเข้า
//    ปลายหูหิ้วสอดผ่านร่อง หูมน (ear) ที่มุมบนหูหิ้วจึงโผล่อยู่นอกหน้าจั่ว ล็อกไม่ให้หูหิ้วแยก
//    ยอดหน้าจั่วอยู่เหนือหูมน แทรกในร่องบากระหว่างหูมนกับแผงหูหิ้ว (ขอบร่องเอียงตามมุมเอน)
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

  // --- ฝาแบน + หูหิ้ว ---
  // ระยะระนาบหูหิ้วจากกึ่งกลาง = t (+เศษกัน z-fight): สองแผ่นหนา t ชี้เข้าหากัน → ผิวในแนบสนิท
  const gap = t + 0.01
  const lidLen = Dp / 2 - gap // ฝาแบนจากปากถึงกลาง
  const finH = Math.max(30, 0.57 * Dp) // ความสูงหูหิ้วเหนือปาก (3D) = ยาวต่อจากฝาบนแผ่นคลี่
  const rIn = t + 0.5 // ฝา/หูหิ้วหดจากแนวผนังข้าง ให้พอดีระหว่างหน้าจั่วสองข้าง
  const earW = Math.min(22, Math.max(10, 0.07 * Wp))
  const earR = earW / 2
  const earTopH = 0.82 * finH // ความสูงยอดหูมน
  const notchH = 0.62 * finH // ก้นร่องบาก — ใต้ระดับนี้หูหิ้วเป็นแผ่นเดียวกัน (สอดผ่านร่องหน้าจั่ว)
  const c = 0.5 // ระยะเผื่อรอบเนื้อหน้าจั่ว
  // มุมเอนหน้าจั่ว: ที่ก้นร่องบาก ผิวนอกหน้าจั่วต้องเลยหูมนเข้าไปแล้ว → หูมนอยู่นอกหน้าจั่ว
  const tanB = (rIn + earW + c) / notchH
  const beta = Math.atan(tanB)
  const cosB = Math.cos(beta)
  // ขอบร่องบากฝั่งแผงหูหิ้ว: ขนานผิวในหน้าจั่ว (เอียงตามมุมเอน) + ระยะเผื่อ — x วัดจากแนวผนังข้าง
  const shoulderX = (h: number) => h * tanB + t / cosB + c
  const apexH = 0.93 * finH // ยอดหน้าจั่ว (3D) — เหนือยอดหูมน แต่ต่ำกว่ายอดหูหิ้ว
  const gL = apexH / cosB // ความสูงหน้าจั่วบนแผ่นคลี่ (วัดในระนาบที่เอน)
  const holeThick = Math.min(22, 0.38 * finH)
  // รูหูหลังใหญ่กว่าลิ้นดันรอบตัว — ลิ้น (ขนาดเท่ารูหน้า) ทะลุผ่านได้โดยไม่ครูดขอบมนของรูหลัง
  const backGrow = Math.max(3, 0.225 * holeThick)
  const holeLen = Math.min(100, 0.35 * Wp, Wp - 2 * (shoulderX(finH) + backGrow) - 8)
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
  const top = lidLen + finH // ปากกล่อง
  const ridge = finH // แนวพับฝา→หูหิ้ว (บนแผ่นคลี่; หูหิ้วอยู่ y 0..ridge)
  const bot = top + Hp
  const width = X4 + glueW
  const height = bot + Math.max(bS, bF, bB) + 4
  const yOf = (h: number) => ridge - h // ความสูงหูหิ้ว (3D) → y บนแผ่นคลี่

  const holeCy = yOf(0.55 * finH)
  const holeHalf = Math.max(0, holeLen / 2 - holeThick / 2)
  const holeR = holeThick / 2
  const backLen = holeLen + 2 * backGrow
  const backThick = holeThick + 2 * backGrow

  // ร่องหน้าจั่ว: แนวกลาง จากปากขึ้นไปเลยยอดหูมน (หูหิ้วทุกระดับใต้ยอดหูมนสอดผ่านได้ตลอดการเอน)
  // กว้าง = หูหิ้วสองชั้น (2·gap) + เผื่อ; ปลายบนมน
  const slotHalf = gap + Math.max(1, t)
  const slotTop = (earTopH + 1.5) / cosB
  const slot = (cx: number): Vec2[] => [
    P(cx - slotHalf, top),
    ...arcPts(cx, top - slotTop + slotHalf, slotHalf, Math.PI, Math.PI * 2, 6),
    P(cx + slotHalf, top),
  ]
  const slotCut = (cx: number) =>
    `M ${cx - slotHalf} ${top} L ${cx - slotHalf} ${top - slotTop + slotHalf} ` +
    `A ${slotHalf} ${slotHalf} 0 0 1 ${cx + slotHalf} ${top - slotTop + slotHalf} L ${cx + slotHalf} ${top}`

  // หน้าจั่วสามเหลี่ยมยอดมน
  const apexR = Math.min(8, Dp * 0.07)
  const half = Math.atan2(Dp / 2, gL) // ครึ่งมุมยอด
  const gableOutline = (xa: number, xb: number): Vec2[] => {
    const cx = (xa + xb) / 2
    const cy = top - gL + apexR / Math.sin(half) // ศูนย์วงยอดมนที่แนบสองขอบเอียง
    return [P(xa, top), ...arcPts(cx, cy, apexR, Math.PI + half, Math.PI * 2 - half, 6), P(xb, top)]
  }
  const gableCut = (xa: number, xb: number) =>
    'M ' + gableOutline(xa, xb).map((q) => `${q.x} ${q.y}`).join(' L ')

  // หูหิ้ว (xa,xb = แนวผนังข้างซ้าย/ขวาของแผง): หูมนที่มุม + ร่องบาก (ขอบในเอียงตามหน้าจั่ว) + แผงกลาง
  const finOutline = (xa: number, xb: number): Vec2[] => [
    P(xa + rIn, ridge),
    ...arcPts(xa + rIn + earR, yOf(earTopH) + earR, earR, Math.PI, Math.PI * 2, 6),
    P(xa + rIn + earW, yOf(notchH)),
    P(xa + shoulderX(notchH), yOf(notchH)),
    P(xa + shoulderX(finH), 0),
    P(xb - shoulderX(finH), 0),
    P(xb - shoulderX(notchH), yOf(notchH)),
    P(xb - rIn - earW, yOf(notchH)),
    ...arcPts(xb - rIn - earR, yOf(earTopH) + earR, earR, Math.PI, Math.PI * 2, 6),
    P(xb - rIn, ridge),
  ]
  const finCut = (xa: number, xb: number) =>
    `M ${xa} ${top} L ${xa + rIn} ${top} L ${xa + rIn} ${yOf(earTopH) + earR} ` +
    `A ${earR} ${earR} 0 0 1 ${xa + rIn + earW} ${yOf(earTopH) + earR} ` +
    `L ${xa + rIn + earW} ${yOf(notchH)} L ${xa + shoulderX(notchH)} ${yOf(notchH)} L ${xa + shoulderX(finH)} 0 ` +
    `L ${xb - shoulderX(finH)} 0 L ${xb - shoulderX(notchH)} ${yOf(notchH)} L ${xb - rIn - earW} ${yOf(notchH)} ` +
    `L ${xb - rIn - earW} ${yOf(earTopH) + earR} A ${earR} ${earR} 0 0 1 ${xb - rIn} ${yOf(earTopH) + earR} ` +
    `L ${xb - rIn} ${top} L ${xb} ${top}`

  const fcx = (X1 + X2) / 2
  const bcx = (X3 + X4) / 2
  const betaDeg = (beta * 180) / Math.PI

  const panels: Panel[] = [
    { id: 'front', parentId: null, outline: rect(X1, top, X2, bot), stage: 0 },
    {
      id: 'side-left', parentId: 'front', outline: rect(X0, top, X1, bot),
      hingeA: P(X1, top), hingeB: P(X1, bot), foldAngle: -90, stage: 0,
    },
    {
      id: 'side-right', parentId: 'front', outline: rect(X2, top, X3, bot),
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
    // ฝาแบน 90° → หูหิ้วพับกลับ -90° (จึงตั้งดิ่งตลอดการพับ เลื่อนจากขอบปากมาชนกันกลาง)
    {
      id: 'lid-front', parentId: 'front', outline: rect(X1 + rIn, ridge, X2 - rIn, top),
      hingeA: P(X1 + rIn, top), hingeB: P(X2 - rIn, top), foldAngle: 90, stage: 4,
    },
    {
      id: 'fin-front', parentId: 'lid-front', outline: finOutline(X1, X2),
      holes: hasHole ? [obroundPts(fcx, holeCy, holeLen, holeThick)] : undefined,
      hingeA: P(X1 + rIn, ridge), hingeB: P(X2 - rIn, ridge), foldAngle: -90, stage: 4,
    },
    {
      id: 'lid-back', parentId: 'back', outline: rect(X3 + rIn, ridge, X4 - rIn, top),
      hingeA: P(X3 + rIn, top), hingeB: P(X4 - rIn, top), foldAngle: 90, stage: 4,
    },
    {
      id: 'fin-back', parentId: 'lid-back', outline: finOutline(X3, X4),
      holes: hasHole ? [obroundPts(bcx, holeCy, backLen, backThick)] : undefined,
      hingeA: P(X3 + rIn, ridge), hingeB: P(X4 - rIn, ridge), foldAngle: -90, stage: 4,
    },
    // หน้าจั่วเอนเข้าเป็นจังหวะสุดท้าย — หูหิ้วสอดผ่านร่อง หูมนโผล่นอก
    {
      id: 'gable-left', parentId: 'side-left', outline: gableOutline(X0, X1), holes: [slot((X0 + X1) / 2)],
      hingeA: P(X0, top), hingeB: P(X1, top), foldAngle: betaDeg, stage: 5,
    },
    {
      id: 'gable-right', parentId: 'side-right', outline: gableOutline(X2, X3), holes: [slot((X2 + X3) / 2)],
      hingeA: P(X2, top), hingeB: P(X3, top), foldAngle: betaDeg, stage: 5,
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
    // รอยพับหน้าจั่ว (เว้นช่วงร่อง)
    crease(`M ${X0} ${top} L ${(X0 + X1) / 2 - slotHalf} ${top}`),
    crease(`M ${(X0 + X1) / 2 + slotHalf} ${top} L ${X1} ${top}`),
    crease(`M ${X2} ${top} L ${(X2 + X3) / 2 - slotHalf} ${top}`),
    crease(`M ${(X2 + X3) / 2 + slotHalf} ${top} L ${X3} ${top}`),
    crease(`M ${X1 + rIn} ${top} L ${X2 - rIn} ${top}`),
    crease(`M ${X3 + rIn} ${top} L ${X4 - rIn} ${top}`),
    crease(`M ${X1 + rIn} ${ridge} L ${X2 - rIn} ${ridge}`),
    crease(`M ${X3 + rIn} ${ridge} L ${X4 - rIn} ${ridge}`),
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
