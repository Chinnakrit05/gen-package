import type { BoxParams, Dieline, DimMark, Material, Panel, Vec2 } from '../types'
import { P, arcPts, autoSegments, fmt, obroundPts, rect } from './shared'

// กล่องหูหิ้ว (gable carry box) แบบ dieline มาตรฐาน — ท่อทากาวข้าง + ก้นล็อก + ฝาพับล็อกกลางพร้อมหูหิ้ว
// ผังแผ่นคลี่ซ้าย→ขวา: ลิ้นกาว | หน้า W | ข้างขวา D | หลัง W | ข้างซ้าย D
//  - หน้า/หลัง: ฝาแบน (ครึ่งความลึก ผ่าร่องกลางเป็นสองซีก) → หูหิ้วคางหมูเจาะรูจับ พับตั้งกลางกล่องสองชั้นแนบกัน
//  - ข้างซ้าย/ขวา: แผงปิดบนแยกสองซีก (เว้นช่องให้หูหิ้ว) ยาวถึงกลางกล่อง พับทับบนฝาแบนข้างละซีกของหูหิ้ว
//    ปลายมีรอยพับ → ลิ้นปลายพับลงเสียบร่องกลางของฝาแบน ล็อกสองข้างเข้าหากัน
//  - ก้นล็อก (snap lock): ลิ้นข้างมุมเฉียง → ลิ้นหน้าเว้ากลาง → ลิ้นหลังหกเหลี่ยมปิดนอกสุด
// ลำดับพับ (stage): ลำตัว 0 → ลิ้นก้นข้าง 1 → ลิ้นก้นหน้า 2 → ลิ้นก้นหลัง 3 → ฝาแบน+หูหิ้ว 4 → แผงปิดบน+ลิ้นปลาย 5
// W,D,H = ขนาดด้านใน (+2t ต่อแกน)
export function generateGableBox(box: BoxParams, mat: Material): Dieline {
  const { W, D, H } = box
  const t = mat.thickness

  const Wp = W + 2 * t
  const Dp = D + 2 * t
  const Hp = H + 2 * t
  const layer = t + 0.05

  const glueW = Math.max(12, 10 + 2 * t)
  const taper = 4
  const fin = Math.max(1.5, t + 0.5) // ลิ้นก้นหดจากรอยพับมุม

  // --- ฝาแบน + หูหิ้ว ---
  const gap = t + 0.01 // ระนาบหูหิ้วห่างกึ่งกลาง → สองชั้นแนบสนิท
  const lidLen = Dp / 2 - gap
  const finH = Math.max(28, 0.5 * Dp)
  const finVert = 0.12 * finH // ช่วงตั้งตรงที่โคนหูหิ้วก่อนเฉียง
  const finCh = Math.min(finH - finVert, 0.2 * Wp) // มุมเฉียงหูหิ้ว
  const holeThick = Math.min(24, 0.36 * finH)
  const holeLen = Math.min(110, 0.29 * Wp, Wp - 2 * finCh - 10)
  const hasHole = holeLen >= holeThick + 10
  const sw = 2 * t + 1 // ร่องกลางฝาแบน (รับลิ้นปลายสองแผ่น)

  // --- แผงปิดบน (ผนังข้าง) ---
  const half = Wp / 2
  const tipL = Math.max(8, Math.min(18, 0.12 * Dp)) // ลิ้นปลายลงร่อง
  const reach = half - sw / 2 // จากผนังข้างถึงขอบร่อง → รอยพับลิ้นปลาย
  const finGap = 2 * gap + 1 // ช่องให้หูหิ้วระหว่างสองซีก
  const ei = t + 0.3 // หดจากแนวผนังหน้า-หลัง
  const tipR = Math.min(6, (Dp / 2 - finGap / 2 - ei) * 0.25)

  // --- ก้นล็อก ---
  const bLen = 0.64 * Dp
  const nA = 0.22 * bLen // ส่วนเว้ากลางลิ้นหน้า
  const cS = Math.min(Dp / 2, bLen * 0.78) // มุมเฉียงลิ้นข้าง
  const cC = Math.min(0.25 * Wp, bLen * 0.78) // มุมเฉียงลิ้นหลัง
  const dr = 2 // ช่วงตั้งตรงสั้น ๆ ก่อนมุมเฉียง (กันมุมแหลมที่รอยพับ — ตัดง่าย, เส้นเผื่อตัดไม่แหลมพุ่ง)

  const X0 = 0
  const X1 = X0 + glueW // ลิ้นกาว | หน้า
  const X2 = X1 + Wp // หน้า | ข้างขวา
  const X3 = X2 + Dp // ข้างขวา | หลัง
  const X4 = X3 + Wp // หลัง | ข้างซ้าย
  const X5 = X4 + Dp
  const top = Math.max(lidLen + finH, reach + tipL) + 1 // ปากกล่อง
  const ridge = top - lidLen // ฝาแบน|หูหิ้ว
  const bot = top + Hp
  const width = X5
  const height = bot + bLen + 2

  // หูหิ้วคางหมู (xa..xb = กว้างแผง)
  const finOutline = (xa: number, xb: number): Vec2[] => [
    P(xa, ridge),
    P(xa, ridge - finVert),
    P(xa + finCh, ridge - finH),
    P(xb - finCh, ridge - finH),
    P(xb, ridge - finVert),
    P(xb, ridge),
  ]
  const holeCy = ridge - 0.56 * finH

  // แผงปิดบนหนึ่งซีก (xa..xb) + ลิ้นปลายมุมนอกมน
  const capOutline = (xa: number, xb: number): Vec2[] => [P(xa, top), P(xa, top - reach), P(xb, top - reach), P(xb, top)]
  const tipOutline = (xa: number, xb: number, outerLeft: boolean): Vec2[] => {
    const y0 = top - reach
    const y1 = y0 - tipL
    if (outerLeft) {
      return [P(xa, y0), ...arcPts(xa + tipR, y1 + tipR, tipR, Math.PI, Math.PI * 1.5, 4), P(xb, y1), P(xb, y0)]
    }
    return [P(xa, y0), P(xa, y1), ...arcPts(xb - tipR, y1 + tipR, tipR, Math.PI * 1.5, Math.PI * 2, 4), P(xb, y0)]
  }
  // แผงปิดบนของผนังข้าง (xa..xb กว้าง Dp): ซีกซ้าย/ขวาเว้นช่องหูหิ้วกลาง
  const caps = (side: string, xa: number, xb: number): Panel[] => {
    const cx = (xa + xb) / 2
    const halves: [string, number, number, boolean][] = [
      ['a', xa + ei, cx - finGap / 2, true],
      ['b', cx + finGap / 2, xb - ei, false],
    ]
    return halves.flatMap(([k, a, b, outerLeft]) => [
      {
        id: `cap-${side}-${k}`, parentId: `side-${side}`, outline: capOutline(a, b),
        // พับทับบนฝาแบน: zOffset ติดลบ = ลอยขึ้นเหนือฝา (แกน z ท้องถิ่นชี้เข้ากล่องหลังพับ)
        hingeA: P(a, top), hingeB: P(b, top), foldAngle: 90, stage: 5, zOffset: -layer,
      },
      {
        // ลิ้นปลายพับงอรอไว้ก่อน (stage 4 ตอนแผงปิดยังตั้ง) — แผงปิดพับลงมาแล้วลิ้นจึงลงร่องตรง ๆ
        // ถ้างอพร้อมแผงปิด ปลายลิ้นสองข้างกวาดสวนกันในร่อง
        id: `tip-${side}-${k}`, parentId: `cap-${side}-${k}`, outline: tipOutline(a, b, outerLeft),
        hingeA: P(a, top - reach), hingeB: P(b, top - reach), foldAngle: 90, stage: 4,
      },
    ])
  }
  // ฝาแบนสองซีก (ร่องกลาง) + หูหิ้ว
  const lidFin = (face: 'front' | 'back', x0: number, x1: number): Panel[] => {
    const cx = (x0 + x1) / 2
    // หดปลายฝาแบน/หูหิ้วจากแนวผนังข้าง ei: แผงปิดบนตั้งอยู่ตรงแนวผนังข้างตอนฝาแบนพับลง ไม่ให้ขอบเฉียดกัน
    const xa = x0 + ei
    const xb = x1 - ei
    return [
      {
        id: `lid-${face}-a`, parentId: face, outline: rect(xa, ridge, cx - sw / 2, top),
        hingeA: P(xa, top), hingeB: P(cx - sw / 2, top), foldAngle: 90, stage: 4,
      },
      {
        id: `lid-${face}-b`, parentId: face, outline: rect(cx + sw / 2, ridge, xb, top),
        hingeA: P(cx + sw / 2, top), hingeB: P(xb, top), foldAngle: 90, stage: 4,
      },
      {
        id: `fin-${face}`, parentId: `lid-${face}-a`, outline: finOutline(xa, xb),
        holes: hasHole ? [obroundPts(cx, holeCy, holeLen, holeThick)] : undefined,
        hingeA: P(xa, ridge), hingeB: P(xb, ridge), foldAngle: -90, stage: 4,
      },
    ]
  }

  const panels: Panel[] = [
    { id: 'front', parentId: null, outline: rect(X1, top, X2, bot), stage: 0 },
    {
      id: 'glue', parentId: 'front',
      outline: [P(X1, top), P(X0, top + taper), P(X0, bot - taper), P(X1, bot)],
      hingeA: P(X1, top), hingeB: P(X1, bot), foldAngle: -90, stage: 0, zOffset: layer,
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
      id: 'side-left', parentId: 'back', outline: rect(X4, top, X5, bot),
      hingeA: P(X4, top), hingeB: P(X4, bot), foldAngle: 90, stage: 0,
    },
    // ก้นล็อก — พับก่อนอยู่ลึกกว่า: ลิ้นข้าง (มุมเฉียงหันหาผนังหน้า) → ลิ้นหน้าเว้ากลาง → ลิ้นหลังหกเหลี่ยมนอกสุด
    {
      id: 'base-right', parentId: 'side-right',
      outline: [P(X2 + fin, bot), P(X2 + fin, bot + dr), P(X2 + cS, bot + cS), P(X2 + cS, bot + bLen), P(X3 - fin, bot + bLen), P(X3 - fin, bot)],
      hingeA: P(X2 + fin, bot), hingeB: P(X3 - fin, bot), foldAngle: -90, stage: 1, zOffset: 3 * layer,
    },
    {
      id: 'base-left', parentId: 'side-left',
      outline: [P(X4 + fin, bot), P(X4 + fin, bot + bLen), P(X5 - cS, bot + bLen), P(X5 - cS, bot + cS), P(X5 - fin, bot + dr), P(X5 - fin, bot)],
      hingeA: P(X4 + fin, bot), hingeB: P(X5 - fin, bot), foldAngle: -90, stage: 1, zOffset: 3 * layer,
    },
    {
      id: 'base-front', parentId: 'front',
      outline: [
        P(X1 + fin, bot), P(X1 + fin, bot + bLen), P(X1 + 0.25 * Wp, bot + bLen), P(X1 + 0.25 * Wp, bot + bLen - nA),
        P(X2 - 0.25 * Wp, bot + bLen - nA), P(X2 - 0.25 * Wp, bot + bLen), P(X2 - fin, bot + bLen), P(X2 - fin, bot),
      ],
      hingeA: P(X1 + fin, bot), hingeB: P(X2 - fin, bot), foldAngle: -90, stage: 2, zOffset: 2 * layer,
    },
    {
      id: 'base-back', parentId: 'back',
      outline: [
        P(X3 + fin, bot), P(X3 + fin, bot + dr), P(X3 + cC, bot + cC), P(X3 + cC, bot + bLen),
        P(X4 - cC, bot + bLen), P(X4 - cC, bot + cC), P(X4 - fin, bot + dr), P(X4 - fin, bot),
      ],
      hingeA: P(X3 + fin, bot), hingeB: P(X4 - fin, bot), foldAngle: -90, stage: 3, zOffset: layer,
    },
    ...lidFin('front', X1, X2),
    ...lidFin('back', X3, X4),
    ...caps('right', X2, X3),
    ...caps('left', X4, X5),
  ]

  const segments = autoSegments(panels)

  const dims: DimMark[] = [
    { a: P(X1, height + 6), b: P(X2, height + 6), label: `W ${fmt(Wp)}` },
    { a: P(X2, height + 6), b: P(X3, height + 6), label: `D ${fmt(Dp)}` },
    { a: P(-8, top), b: P(-8, bot), label: `H ${fmt(Hp)}` },
    { a: P(0, -10), b: P(width, -10), label: fmt(width) },
    { a: P(width + 10, 0), b: P(width + 10, height), label: fmt(height) },
  ]

  return { width, height, segments, panels, dims }
}
