import type { BoxParams, Dieline, DimMark, Material, Panel, Segment, Vec2 } from '../types'
import { P, fmt, rect, obroundPts, obroundPath } from './shared'

// กล่องหูหิ้วทรงจั่ว (gable box) — ฐานตัน+ ผนัง 4 ด้านพับขึ้น + แผงจั่วสองด้าน (หน้า-หลัง)
// เอียงเข้าหากันมาชนที่สัน เกิดหลังคาทรงจั่ว มีรูหิ้วที่ยอดทั้งสองแผงตรงกัน = หูหิ้วในตัว
// W,D,H = ขนาดด้านใน (ฐาน W×D, ผนังสูง H)
//
// ผังแผ่นคลี่ (x ขวา y ลง) เป็นรูปกากบาท:
//   [จั่วหลัง] / [ผนังหลัง] / [ฐาน+ผนังซ้าย-ขวา] / [ผนังหน้า] / [จั่วหน้า]
//   ลิ้นมุม 4 อันงอกจากผนังซ้าย-ขวา พับเข้าล็อกมุมเหมือนกล่องถาด
export function generateGableBox(box: BoxParams, mat: Material): Dieline {
  const { W, D, H } = box
  const t = mat.thickness

  const Wp = W + 2 * t
  const Dp = D + 2 * t
  const Hp = H + t

  // ความยาวแผงจั่วเหนือขอบผนัง (ถึงสัน) — ต้อง ≥ Dp/2 เพื่อเอียงมาชนกันกลางได้
  const G = Math.max(Dp * 0.72, Dp / 2 + 12)
  // มุมเอียงจากแนวดิ่งที่ทำให้ปลายสองแผงมาชนที่กึ่งกลาง: sin(a) = (Dp/2)/G
  const lean = (Math.asin(Math.min(0.985, Dp / (2 * G))) * 180) / Math.PI

  // ลิ้นมุม (เหมือนกล่องถาด)
  const tabIn = Math.max(1.5, 2 * t + 0.5)
  const tabW = Math.max(8, Math.min(0.72 * Hp, Dp / 2 - 2))
  const tabSlant = Math.min(5, tabW * 0.45)
  const layer = t + 0.05

  const cx0 = Hp
  const cx1 = cx0 + Wp
  const width = cx1 + Hp
  const backRim = G
  const by0 = G + Hp // ขอบฐานบน (crease ฐาน|ผนังหลัง)
  const by1 = by0 + Dp // ขอบฐานล่าง (crease ฐาน|ผนังหน้า)
  const frontRim = by1 + Hp
  const height = frontRim + G

  // รูหิ้ว obround ที่ยอดแผงจั่วทั้งสอง (แนวนอน) — วางใกล้ขอบสัน ให้ตรงกันเมื่อพับชน
  const holeLen = Math.min(90, Wp * 0.5)
  const holeThick = Math.min(20, G * 0.3)
  const hasHandle = holeLen >= 40 && holeThick >= 8
  const holeCx = (cx0 + cx1) / 2
  const dHole = holeThick / 2 + Math.max(6, G * 0.16) // ระยะรูจากขอบสัน (ใกล้ยอด)
  const backHoleCy = dHole // จั่วหลัง ขอบสัน = y 0
  const frontHoleCy = height - dHole // จั่วหน้า ขอบสัน = y height

  // ลิ้นมุมทรงคางหมู (หดปลายกันชนตอนพับ)
  const tab = (xa: number, xb: number, y: number, dir: 1 | -1): Vec2[] => [
    P(xa + tabIn, y),
    P(xa + tabIn + tabSlant, y + dir * tabW),
    P(xb - tabIn - tabSlant, y + dir * tabW),
    P(xb - tabIn, y),
  ]

  // ลำดับพับ: ผนังข้าง(ปีก) ก่อน → ลิ้นมุมเก็บเข้า → ผนังหน้า-หลังปิดทับ → จั่วเอียงชนกัน
  const panels: Panel[] = [
    { id: 'base', parentId: null, outline: rect(cx0, by0, cx1, by1), stage: 0 },
    // ผนังข้าง (ปีก) — พับขึ้นก่อน (stage 0)
    {
      id: 'left', parentId: 'base', outline: rect(0, by0, cx0, by1),
      hingeA: P(cx0, by0), hingeB: P(cx0, by1), foldAngle: -90, stage: 0,
    },
    {
      id: 'right', parentId: 'base', outline: rect(cx1, by0, width, by1),
      hingeA: P(cx1, by0), hingeB: P(cx1, by1), foldAngle: 90, stage: 0,
    },
    // ผนังหน้า-หลัง — พับขึ้นทีหลัง (stage 2) ปิดทับลิ้นมุม
    {
      id: 'back', parentId: 'base', outline: rect(cx0, backRim, cx1, by0),
      hingeA: P(cx0, by0), hingeB: P(cx1, by0), foldAngle: 90, stage: 2,
    },
    {
      id: 'front', parentId: 'base', outline: rect(cx0, by1, cx1, frontRim),
      hingeA: P(cx0, by1), hingeB: P(cx1, by1), foldAngle: -90, stage: 2,
    },
    // ลิ้นมุม (stage 1) — พับเข้าหลังผนังหน้า-หลัง ล็อกมุม
    {
      id: 'tab-lb', parentId: 'left', outline: tab(0, cx0, by0, -1),
      hingeA: P(0, by0), hingeB: P(cx0, by0), foldAngle: 90, stage: 1, zOffset: layer,
    },
    {
      id: 'tab-lf', parentId: 'left', outline: tab(0, cx0, by1, 1),
      hingeA: P(0, by1), hingeB: P(cx0, by1), foldAngle: -90, stage: 1, zOffset: layer,
    },
    {
      id: 'tab-rb', parentId: 'right', outline: tab(cx1, width, by0, -1),
      hingeA: P(cx1, by0), hingeB: P(width, by0), foldAngle: 90, stage: 1, zOffset: layer,
    },
    {
      id: 'tab-rf', parentId: 'right', outline: tab(cx1, width, by1, 1),
      hingeA: P(cx1, by1), hingeB: P(width, by1), foldAngle: -90, stage: 1, zOffset: layer,
    },
    // แผงจั่ว (stage 3) — เอียงเข้าจากขอบผนังมาชนที่สัน + รูหิ้ว
    // foldAngle=0 = ต่อจากผนัง (ตั้งดิ่ง); เอียงเข้าหากึ่งกลาง = หมุนต่อในทิศเดียวกับผนัง
    // (ผนังหลังพับ +90 → จั่วหลัง +lean, ผนังหน้าพับ -90 → จั่วหน้า -lean)
    {
      id: 'gable-back', parentId: 'back', outline: rect(cx0, 0, cx1, backRim),
      holes: hasHandle ? [obroundPts(holeCx, backHoleCy, holeLen, holeThick)] : undefined,
      hingeA: P(cx0, backRim), hingeB: P(cx1, backRim), foldAngle: lean, stage: 3,
    },
    {
      id: 'gable-front', parentId: 'front', outline: rect(cx0, frontRim, cx1, height),
      holes: hasHandle ? [obroundPts(holeCx, frontHoleCy, holeLen, holeThick)] : undefined,
      hingeA: P(cx0, frontRim), hingeB: P(cx1, frontRim), foldAngle: -lean, stage: 3,
    },
  ]

  const cut = (d: string): Segment => ({ kind: 'cut', d })
  const crease = (d: string): Segment => ({ kind: 'crease', d })

  const tabCut = (xa: number, xb: number, y: number, dir: 1 | -1) =>
    `M ${xa} ${y} L ${xa + tabIn} ${y} L ${xa + tabIn + tabSlant} ${y + dir * tabW} ` +
    `L ${xb - tabIn - tabSlant} ${y + dir * tabW} L ${xb - tabIn} ${y} L ${xb} ${y}`

  const segments: Segment[] = [
    // จั่วหลัง (บนสุด)
    cut(`M ${cx0} 0 L ${cx1} 0`),
    cut(`M ${cx0} 0 L ${cx0} ${backRim}`),
    cut(`M ${cx1} 0 L ${cx1} ${backRim}`),
    // ผนังหลัง (ขอบข้าง)
    cut(`M ${cx0} ${backRim} L ${cx0} ${by0}`),
    cut(`M ${cx1} ${backRim} L ${cx1} ${by0}`),
    // ผนังซ้าย (ลิ้นบน + ขอบซ้าย + ลิ้นล่าง)
    cut(tabCut(0, cx0, by0, -1)),
    cut(`M 0 ${by0} L 0 ${by1}`),
    cut(tabCut(0, cx0, by1, 1)),
    // ผนังขวา
    cut(tabCut(cx1, width, by0, -1)),
    cut(`M ${width} ${by0} L ${width} ${by1}`),
    cut(tabCut(cx1, width, by1, 1)),
    // ผนังหน้า (ขอบข้าง)
    cut(`M ${cx0} ${by1} L ${cx0} ${frontRim}`),
    cut(`M ${cx1} ${by1} L ${cx1} ${frontRim}`),
    // จั่วหน้า (ล่างสุด)
    cut(`M ${cx0} ${frontRim} L ${cx0} ${height}`),
    cut(`M ${cx1} ${frontRim} L ${cx1} ${height}`),
    cut(`M ${cx0} ${height} L ${cx1} ${height}`),
    // รอยพับ
    crease(`M ${cx0} ${backRim} L ${cx1} ${backRim}`), // จั่วหลัง|ผนังหลัง
    crease(`M ${cx0} ${by0} L ${cx1} ${by0}`), // ฐาน|ผนังหลัง
    crease(`M ${cx0} ${by1} L ${cx1} ${by1}`), // ฐาน|ผนังหน้า
    crease(`M ${cx0} ${frontRim} L ${cx1} ${frontRim}`), // ผนังหน้า|จั่วหน้า
    crease(`M ${cx0} ${by0} L ${cx0} ${by1}`), // ฐาน|ผนังซ้าย
    crease(`M ${cx1} ${by0} L ${cx1} ${by1}`), // ฐาน|ผนังขวา
    crease(`M ${tabIn} ${by0} L ${cx0 - tabIn} ${by0}`), // ผนังซ้าย|ลิ้นหลัง
    crease(`M ${tabIn} ${by1} L ${cx0 - tabIn} ${by1}`), // ผนังซ้าย|ลิ้นหน้า
    crease(`M ${cx1 + tabIn} ${by0} L ${width - tabIn} ${by0}`), // ผนังขวา|ลิ้นหลัง
    crease(`M ${cx1 + tabIn} ${by1} L ${width - tabIn} ${by1}`), // ผนังขวา|ลิ้นหน้า
  ]
  if (hasHandle) {
    segments.push(cut(obroundPath(holeCx, backHoleCy, holeLen, holeThick)))
    segments.push(cut(obroundPath(holeCx, frontHoleCy, holeLen, holeThick)))
  }

  const dims: DimMark[] = [
    { a: P(cx0, height + 12), b: P(cx1, height + 12), label: `W ${fmt(Wp)}` },
    { a: P(width + 8, by0), b: P(width + 8, by1), label: `D ${fmt(Dp)}` },
    { a: P(-8, backRim), b: P(-8, by0), label: `H ${fmt(Hp)}` },
    { a: P(-8, 0), b: P(-8, backRim), label: `จั่ว ${fmt(G)}` },
    { a: P(0, -10), b: P(width, -10), label: fmt(width) },
    { a: P(width + 22, 0), b: P(width + 22, height), label: fmt(height) },
  ]

  return { width, height, segments, panels, dims }
}
