import type { BoxParams, Dieline, DimMark, Material, Panel, Segment } from '../types'
import { P, fmt, rect } from './shared'

// กล่องแซนวิช (wedge / triangular) — ปริซึมสามเหลี่ยมมุมฉาก (หน้าตัดข้าง = สามเหลี่ยม)
// ฐาน W×D, ผนังหลังสูง H, ฝาเฉียง (hypotenuse) ลาดจากยอดหลังมาชนขอบหน้า, ผนังข้างเป็นสามเหลี่ยม
// W = กว้าง, D = ลึกฐาน, H = สูงหลัง — เหมาะใส่แซนวิช/ขนมชิ้นสามเหลี่ยม
//
// ผังแผ่นคลี่ (x ขวา y ลง): [ฝาเฉียง] / [ผนังหลัง] / [ฐาน] เรียงบน→ล่าง, สามเหลี่ยมข้างงอกซ้าย-ขวาของฐาน
export function generateWedgeBox(box: BoxParams, _mat: Material): Dieline {
  const { W, D, H } = box
  const slant = Math.hypot(D, H) // ความยาวฝาเฉียง
  const topFold = 90 + (Math.atan2(D, H) * 180) / Math.PI // มุมพับฝาเฉียง (จากผนังหลังมาชนหน้า)

  const PAD = 7 // เผื่อขอบทุกด้าน กันมุมแหลมสามเหลี่ยมข้างทำ bleed miter ล้นขอบแผ่น
  const cx0 = H + PAD // เว้นซ้ายให้สามเหลี่ยมข้าง
  const cx1 = cx0 + W
  const ty = PAD // ขอบบนฝา
  const fy = ty + slant // ฝา|ผนังหลัง
  const by0 = fy + H // ผนังหลัง|ฐาน (ขอบบนฐาน)
  const by1 = by0 + D // ขอบล่างฐาน
  const width = cx1 + H + PAD
  const height = by1 + PAD

  const panels: Panel[] = [
    { id: 'base', parentId: null, outline: rect(cx0, by0, cx1, by1), stage: 0 },
    {
      id: 'back', parentId: 'base', outline: rect(cx0, fy, cx1, by0),
      hingeA: P(cx0, by0), hingeB: P(cx1, by0), foldAngle: 90, stage: 0,
    },
    {
      id: 'top', parentId: 'back', outline: rect(cx0, ty, cx1, fy),
      hingeA: P(cx0, fy), hingeB: P(cx1, fy), foldAngle: topFold, stage: 1,
    },
    {
      id: 'side-left', parentId: 'base',
      outline: [P(cx0, by0), P(cx0, by1), P(cx0 - H, by0)],
      hingeA: P(cx0, by0), hingeB: P(cx0, by1), foldAngle: 90, stage: 0,
    },
    {
      id: 'side-right', parentId: 'base',
      outline: [P(cx1, by0), P(cx1, by1), P(cx1 + H, by0)],
      hingeA: P(cx1, by0), hingeB: P(cx1, by1), foldAngle: -90, stage: 0,
    },
  ]

  const cut = (d: string): Segment => ({ kind: 'cut', d })
  const crease = (d: string): Segment => ({ kind: 'crease', d })
  const segments: Segment[] = [
    cut(`M ${cx0} ${ty} L ${cx1} ${ty}`), // ขอบบนฝา
    cut(`M ${cx1} ${ty} L ${cx1} ${fy}`), // ขอบขวาฝา
    cut(`M ${cx1} ${fy} L ${cx1 + H} ${by0} L ${cx1} ${by1}`), // สามเหลี่ยมขวา (ผ่านยอด)
    cut(`M ${cx1} ${by1} L ${cx0} ${by1}`), // ขอบล่างฐาน
    cut(`M ${cx0} ${by1} L ${cx0 - H} ${by0} L ${cx0} ${fy}`), // สามเหลี่ยมซ้าย
    cut(`M ${cx0} ${fy} L ${cx0} ${ty}`), // ขอบซ้ายฝา
    crease(`M ${cx0} ${fy} L ${cx1} ${fy}`), // ผนังหลัง|ฝา
    crease(`M ${cx0} ${by0} L ${cx1} ${by0}`), // ฐาน|ผนังหลัง
    crease(`M ${cx0} ${by0} L ${cx0} ${by1}`), // ฐาน|สามเหลี่ยมซ้าย
    crease(`M ${cx1} ${by0} L ${cx1} ${by1}`), // ฐาน|สามเหลี่ยมขวา
  ]

  const dims: DimMark[] = [
    { a: P(cx0, by1 + 4), b: P(cx1, by1 + 4), label: `W ${fmt(W)}` },
    { a: P(width - 2, by0), b: P(width - 2, by1), label: `D ${fmt(D)}` },
    { a: P(cx0 - H - 2, fy), b: P(cx0 - H - 2, by0), label: `H ${fmt(H)}` },
  ]

  return { width, height, segments, panels, dims }
}
