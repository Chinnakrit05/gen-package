import type { BoxParams, Dieline, DimMark, Material, Panel, Segment } from '../types'
import { P, arcPts, fmt, rect } from './shared'

// Rollover hinged lid mailer — กล่องไปรษณีย์ฝาพับ ผนังข้าง "ม้วนสองชั้น" (rollover) ขอบเรียบแข็งแรง
// ฐาน + ผนังหน้า/หลัง/ข้างพับขึ้น; ผนังข้างมีแผ่นในพับทบ 180° เป็นผนังสองชั้น
// ผนังหลังต่อเป็นฝาพับคลุม + ลิ้นหน้าเสียบลง — W,D,H = ขนาดด้านใน
export function generateRolloverMailer(box: BoxParams, mat: Material): Dieline {
  const { W, D, H } = box
  const t = mat.thickness

  const Wp = W + 2 * t
  const Dp = D + 2 * t
  const Hp = H + t
  const layer = t + 0.05

  const tuckIn = Math.max(1, t + 0.5)
  const lipH = Math.max(10, Math.min(0.7 * Hp, 0.8 * Dp)) // ลิ้นหน้าเสียบ
  const r = Math.min(7, lipH * 0.45, (Wp - 2 * tuckIn) / 2)

  const cx0 = 2 * Hp // เว้นซ้ายให้ผนังข้าง (Hp) + แผ่นม้วน (Hp)
  const cx1 = cx0 + Wp
  const ly0 = 0
  const ly1 = ly0 + lipH // ลิ้นหน้า | ฝา
  const ky1 = ly1 + Dp // ฝา | ผนังหลัง
  const by0 = ky1 + Hp // ผนังหลัง | ฐาน
  const by1 = by0 + Dp // ฐาน | ผนังหน้า
  const fy1 = by1 + Hp // ขอบล่างผนังหน้า
  const width = cx1 + 2 * Hp
  const height = fy1

  const lipOutline = [
    P(cx0 + tuckIn, ly1),
    ...arcPts(cx0 + tuckIn + r, ly0 + r, r, Math.PI, Math.PI * 1.5),
    ...arcPts(cx1 - tuckIn - r, ly0 + r, r, Math.PI * 1.5, Math.PI * 2),
    P(cx1 - tuckIn, ly1),
  ]

  const panels: Panel[] = [
    { id: 'base', parentId: null, outline: rect(cx0, by0, cx1, by1), stage: 0 },
    {
      id: 'back', parentId: 'base', outline: rect(cx0, ky1, cx1, by0),
      hingeA: P(cx0, by0), hingeB: P(cx1, by0), foldAngle: 90, stage: 0,
    },
    {
      id: 'front', parentId: 'base', outline: rect(cx0, by1, cx1, fy1),
      hingeA: P(cx0, by1), hingeB: P(cx1, by1), foldAngle: -90, stage: 0,
    },
    {
      id: 'side-left', parentId: 'base', outline: rect(cx0 - Hp, by0, cx0, by1),
      hingeA: P(cx0, by0), hingeB: P(cx0, by1), foldAngle: -90, stage: 0,
    },
    {
      id: 'side-right', parentId: 'base', outline: rect(cx1, by0, cx1 + Hp, by1),
      hingeA: P(cx1, by0), hingeB: P(cx1, by1), foldAngle: 90, stage: 0,
    },
    // แผ่นม้วน 180° (double wall) — พับทบกลับเข้าด้านในแนบผนังข้าง
    {
      id: 'roll-left', parentId: 'side-left', outline: rect(cx0 - 2 * Hp, by0, cx0 - Hp, by1),
      hingeA: P(cx0 - Hp, by0), hingeB: P(cx0 - Hp, by1), foldAngle: -180, stage: 1, zOffset: layer,
    },
    {
      id: 'roll-right', parentId: 'side-right', outline: rect(cx1 + Hp, by0, cx1 + 2 * Hp, by1),
      hingeA: P(cx1 + Hp, by0), hingeB: P(cx1 + Hp, by1), foldAngle: 180, stage: 1, zOffset: layer,
    },
    // ฝาพับคลุม (ต่อจากผนังหลัง)
    {
      id: 'lid', parentId: 'back', outline: rect(cx0, ly1, cx1, ky1),
      hingeA: P(cx0, ky1), hingeB: P(cx1, ky1), foldAngle: 90, stage: 2,
    },
    {
      id: 'lip', parentId: 'lid', outline: lipOutline,
      hingeA: P(cx0 + tuckIn, ly1), hingeB: P(cx1 - tuckIn, ly1), foldAngle: 90, stage: 3, zOffset: layer, tuck: true,
    },
  ]

  const cut = (d: string): Segment => ({ kind: 'cut', d })
  const crease = (d: string): Segment => ({ kind: 'crease', d })

  const segments: Segment[] = [
    // ลิ้นหน้า (มุมโค้ง)
    cut(
      `M ${cx0 + tuckIn} ${ly1} L ${cx0 + tuckIn} ${ly0 + r} Q ${cx0 + tuckIn} ${ly0} ${cx0 + tuckIn + r} ${ly0} ` +
        `L ${cx1 - tuckIn - r} ${ly0} Q ${cx1 - tuckIn} ${ly0} ${cx1 - tuckIn} ${ly0 + r} L ${cx1 - tuckIn} ${ly1}`,
    ),
    cut(`M ${cx0} ${ly1} L ${cx0 + tuckIn} ${ly1}`),
    cut(`M ${cx1 - tuckIn} ${ly1} L ${cx1} ${ly1}`),
    // ขอบซ้าย-ขวาของฝา
    cut(`M ${cx0} ${ly1} L ${cx0} ${ky1}`),
    cut(`M ${cx1} ${ly1} L ${cx1} ${ky1}`),
    // แผ่นม้วนซ้าย-ขวา (ขอบนอก)
    cut(`M ${cx0 - Hp} ${by0} L ${cx0 - 2 * Hp} ${by0} L ${cx0 - 2 * Hp} ${by1} L ${cx0 - Hp} ${by1}`),
    cut(`M ${cx1 + Hp} ${by0} L ${cx1 + 2 * Hp} ${by0} L ${cx1 + 2 * Hp} ${by1} L ${cx1 + Hp} ${by1}`),
    // ผนังหน้า
    cut(`M ${cx0} ${by1} L ${cx0} ${fy1} L ${cx1} ${fy1} L ${cx1} ${by1}`),
    // รอยพับ
    crease(`M ${cx0 + tuckIn} ${ly1} L ${cx1 - tuckIn} ${ly1}`), // ลิ้นหน้า|ฝา
    crease(`M ${cx0} ${ky1} L ${cx1} ${ky1}`), // ฝา|ผนังหลัง
    crease(`M ${cx0} ${by0} L ${cx1} ${by0}`), // ผนังหลัง|ฐาน
    crease(`M ${cx0} ${by1} L ${cx1} ${by1}`), // ฐาน|ผนังหน้า
    crease(`M ${cx0} ${by0} L ${cx0} ${by1}`), // ฐาน|ผนังซ้าย
    crease(`M ${cx1} ${by0} L ${cx1} ${by1}`), // ฐาน|ผนังขวา
    crease(`M ${cx0 - Hp} ${by0} L ${cx0 - Hp} ${by1}`), // ผนังซ้าย|แผ่นม้วน (180°)
    crease(`M ${cx1 + Hp} ${by0} L ${cx1 + Hp} ${by1}`), // ผนังขวา|แผ่นม้วน (180°)
  ]

  const dims: DimMark[] = [
    { a: P(cx0, fy1 + 10), b: P(cx1, fy1 + 10), label: `W ${fmt(Wp)}` },
    { a: P(cx1 + 2 * Hp + 8, by0), b: P(cx1 + 2 * Hp + 8, by1), label: `D ${fmt(Dp)}` },
    { a: P(cx0 - 2 * Hp - 8, by1), b: P(cx0 - 2 * Hp - 8, fy1), label: `H ${fmt(Hp)}` },
  ]

  return { width, height, segments, panels, dims }
}
