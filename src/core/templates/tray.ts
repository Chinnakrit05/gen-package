import type { BoxParams, Dieline, DimMark, Material, Panel, Segment } from '../types'
import { P, fmt, rect } from './shared'

// กล่องถาด (open tray) — ถาดเปิดบน ผนัง 4 ด้านพับขึ้น มุมมีลิ้นพับเข้าล็อกด้านใน
// ใช้เป็นถาดอาหาร/ดิสเพลย์ หรือเป็น "ลิ้นชัก" คู่กับ sleeve ก็ได้ — W,D,H = ขนาดด้านใน
//
// ผังแผ่นคลี่ (x ขวา y ลง):
//   แถว:  ผนังหลัง / ฐาน / ผนังหน้า   คอลัมน์: ผนังซ้าย | ฐาน | ผนังขวา
//   ลิ้นมุม 4 อันงอกจากปลายผนังซ้าย-ขวา พับเข้าแนบผนังหน้า-หลังด้านใน (ยึดมุม)
export function generateTrayBox(box: BoxParams, mat: Material): Dieline {
  const { W, D, H } = box
  const t = mat.thickness

  const Wp = W + 2 * t
  const Dp = D + 2 * t
  const Hp = H + t
  const layer = t + 0.05

  const cx0 = Hp
  const cx1 = cx0 + Wp
  const by0 = Hp
  const by1 = by0 + Dp
  const width = cx1 + Hp
  const height = by1 + Hp

  // ลิ้นมุม (glue/lock flap) — สี่เหลี่ยมคางหมูหดปลายให้มีระยะหลบตอนพับ
  const tabIn = Math.max(1.5, 2 * t + 0.5)
  const tabW = Math.max(8, Math.min(0.72 * Hp, Dp / 2 - 2))
  const tabSlant = Math.min(5, tabW * 0.45)

  // ลิ้นที่ขอบ y ของผนังข้าง กิน x[xa,xb] ยื่น dir*tabW ตามแกน y
  const tab = (xa: number, xb: number, y: number, dir: 1 | -1): Panel['outline'] => [
    P(xa + tabIn, y),
    P(xa + tabIn + tabSlant, y + dir * tabW),
    P(xb - tabIn - tabSlant, y + dir * tabW),
    P(xb - tabIn, y),
  ]

  const panels: Panel[] = [
    { id: 'base', parentId: null, outline: rect(cx0, by0, cx1, by1), stage: 0 },
    {
      id: 'back', parentId: 'base', outline: rect(cx0, 0, cx1, by0),
      hingeA: P(cx0, by0), hingeB: P(cx1, by0), foldAngle: 90, stage: 0,
    },
    {
      id: 'front', parentId: 'base', outline: rect(cx0, by1, cx1, height),
      hingeA: P(cx0, by1), hingeB: P(cx1, by1), foldAngle: -90, stage: 0,
    },
    {
      id: 'left', parentId: 'base', outline: rect(0, by0, cx0, by1),
      hingeA: P(cx0, by0), hingeB: P(cx0, by1), foldAngle: -90, stage: 0,
    },
    {
      id: 'right', parentId: 'base', outline: rect(cx1, by0, width, by1),
      hingeA: P(cx1, by0), hingeB: P(cx1, by1), foldAngle: 90, stage: 0,
    },
    // ลิ้นมุม (stage 1) — รอผนังพับขึ้นก่อน แล้วพับเข้าแนบผนังหน้า-หลังด้านใน
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
  ]

  const cut = (d: string): Segment => ({ kind: 'cut', d })
  const crease = (d: string): Segment => ({ kind: 'crease', d })

  // ขอบลิ้น (รวมช่องหลบสองข้างที่ระดับเส้นพับ) — เหมือนลิ้นกันฝุ่นของ mailer
  const tabCut = (xa: number, xb: number, y: number, dir: 1 | -1) =>
    `M ${xa} ${y} L ${xa + tabIn} ${y} L ${xa + tabIn + tabSlant} ${y + dir * tabW} ` +
    `L ${xb - tabIn - tabSlant} ${y + dir * tabW} L ${xb - tabIn} ${y} L ${xb} ${y}`

  const segments: Segment[] = [
    // ขอบนอก (cut) ไล่รอบรูป
    cut(`M ${cx0} 0 L ${cx1} 0`), // ขอบบนผนังหลัง
    cut(`M ${cx1} 0 L ${cx1} ${by0}`), // ขอบขวาผนังหลัง
    cut(tabCut(cx1, width, by0, -1)), // ลิ้นมุมขวา-หลัง
    cut(`M ${width} ${by0} L ${width} ${by1}`), // ขอบขวาผนังขวา
    cut(tabCut(cx1, width, by1, 1)), // ลิ้นมุมขวา-หน้า
    cut(`M ${cx1} ${by1} L ${cx1} ${height}`), // ขอบขวาผนังหน้า
    cut(`M ${cx1} ${height} L ${cx0} ${height}`), // ขอบล่างผนังหน้า
    cut(`M ${cx0} ${by1} L ${cx0} ${height}`), // ขอบซ้ายผนังหน้า
    cut(tabCut(0, cx0, by1, 1)), // ลิ้นมุมซ้าย-หน้า
    cut(`M 0 ${by0} L 0 ${by1}`), // ขอบซ้ายผนังซ้าย
    cut(tabCut(0, cx0, by0, -1)), // ลิ้นมุมซ้าย-หลัง
    cut(`M ${cx0} 0 L ${cx0} ${by0}`), // ขอบซ้ายผนังหลัง
    // รอยพับ (crease)
    crease(`M ${cx0} ${by0} L ${cx1} ${by0}`), // ฐาน|ผนังหลัง
    crease(`M ${cx0} ${by1} L ${cx1} ${by1}`), // ฐาน|ผนังหน้า
    crease(`M ${cx0} ${by0} L ${cx0} ${by1}`), // ฐาน|ผนังซ้าย
    crease(`M ${cx1} ${by0} L ${cx1} ${by1}`), // ฐาน|ผนังขวา
    crease(`M ${tabIn} ${by0} L ${cx0 - tabIn} ${by0}`), // ผนังซ้าย|ลิ้นหลัง
    crease(`M ${tabIn} ${by1} L ${cx0 - tabIn} ${by1}`), // ผนังซ้าย|ลิ้นหน้า
    crease(`M ${cx1 + tabIn} ${by0} L ${width - tabIn} ${by0}`), // ผนังขวา|ลิ้นหลัง
    crease(`M ${cx1 + tabIn} ${by1} L ${width - tabIn} ${by1}`), // ผนังขวา|ลิ้นหน้า
  ]

  const dims: DimMark[] = [
    { a: P(cx0, height + 12), b: P(cx1, height + 12), label: `W ${fmt(Wp)}` },
    { a: P(width + 8, by0), b: P(width + 8, by1), label: `D ${fmt(Dp)}` },
    { a: P(-8, by1), b: P(-8, height), label: `H ${fmt(Hp)}` },
    { a: P(0, -10), b: P(width, -10), label: fmt(width) },
    { a: P(width + 22, 0), b: P(width + 22, height), label: fmt(height) },
  ]

  return { width, height, segments, panels, dims }
}
