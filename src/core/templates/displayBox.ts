import type { BoxParams, Dieline, DimMark, Material, Panel, Segment } from '../types'
import { P, fmt, rect } from './shared'

// กล่องฝาข้าง / กล่องหน้าต่าง (display / window box) — กล่องปิด 5 ด้าน + ฝาหน้าเปิดได้ มีหน้าต่างโชว์สินค้า
// ฐาน + ผนังหลัง + ผนังซ้าย/ขวา + ฝาบน (พับคลุม) + ฝาหน้า (พับขึ้นปิด เจาะหน้าต่าง)
// W = กว้าง, D = ลึก, H = สูง
export function generateDisplayBox(box: BoxParams, _mat: Material): Dieline {
  const { W, D, H } = box

  const cx0 = H // ผนังซ้ายกว้าง = H
  const cx1 = cx0 + W
  // เรียงแนวตั้ง: ฝาบน(D) / ผนังหลัง(H) / ฐาน(D) / ฝาหน้า(H)
  const ty0 = 0
  const ty1 = ty0 + D // ฝาบน
  const ky1 = ty1 + H // ผนังหลัง (ty1..ky1)
  const by0 = ky1 // ฐานเริ่ม (= ขอบล่างผนังหลัง)
  const by1 = by0 + D // ฐานจบ
  const dy1 = by1 + H // ฝาหน้าจบ
  const width = cx1 + H
  const height = dy1

  // หน้าต่างบนฝาหน้า — สี่เหลี่ยมเจาะกลางฝา เว้นขอบ margin
  const m = Math.max(8, Math.min(W, H) * 0.2)
  const win: Panel['outline'] = [
    P(cx0 + m, by1 + m),
    P(cx1 - m, by1 + m),
    P(cx1 - m, dy1 - m),
    P(cx0 + m, dy1 - m),
  ]

  const panels: Panel[] = [
    { id: 'base', parentId: null, outline: rect(cx0, by0, cx1, by1), stage: 0 },
    {
      id: 'back', parentId: 'base', outline: rect(cx0, ty1, cx1, by0),
      hingeA: P(cx0, by0), hingeB: P(cx1, by0), foldAngle: 90, stage: 0,
    },
    {
      id: 'top', parentId: 'back', outline: rect(cx0, ty0, cx1, ty1),
      hingeA: P(cx0, ty1), hingeB: P(cx1, ty1), foldAngle: 90, stage: 1,
    },
    {
      id: 'left', parentId: 'base', outline: rect(0, by0, cx0, by1),
      hingeA: P(cx0, by0), hingeB: P(cx0, by1), foldAngle: -90, stage: 0,
    },
    {
      id: 'right', parentId: 'base', outline: rect(cx1, by0, cx1 + H, by1),
      hingeA: P(cx1, by0), hingeB: P(cx1, by1), foldAngle: 90, stage: 0,
    },
    {
      id: 'door', parentId: 'base', outline: rect(cx0, by1, cx1, dy1), holes: [win],
      hingeA: P(cx0, by1), hingeB: P(cx1, by1), foldAngle: -90, stage: 1,
    },
  ]

  const cut = (d: string): Segment => ({ kind: 'cut', d })
  const crease = (d: string): Segment => ({ kind: 'crease', d })
  const segments: Segment[] = [
    // ขอบนอกไล่รอบ
    cut(`M ${cx0} ${ty0} L ${cx1} ${ty0} L ${cx1} ${by0} L ${cx1 + H} ${by0} L ${cx1 + H} ${by1} L ${cx1} ${by1} L ${cx1} ${dy1} L ${cx0} ${dy1} L ${cx0} ${by1} L 0 ${by1} L 0 ${by0} L ${cx0} ${by0} Z`),
    // หน้าต่าง (เจาะ)
    cut(`M ${cx0 + m} ${by1 + m} L ${cx1 - m} ${by1 + m} L ${cx1 - m} ${dy1 - m} L ${cx0 + m} ${dy1 - m} Z`),
    // รอยพับ
    crease(`M ${cx0} ${ty1} L ${cx1} ${ty1}`), // ผนังหลัง|ฝาบน
    crease(`M ${cx0} ${by0} L ${cx1} ${by0}`), // ฐาน|ผนังหลัง
    crease(`M ${cx0} ${by1} L ${cx1} ${by1}`), // ฐาน|ฝาหน้า
    crease(`M ${cx0} ${by0} L ${cx0} ${by1}`), // ฐาน|ผนังซ้าย
    crease(`M ${cx1} ${by0} L ${cx1} ${by1}`), // ฐาน|ผนังขวา
  ]

  const dims: DimMark[] = [
    { a: P(cx0, dy1 + 4), b: P(cx1, dy1 + 4), label: `W ${fmt(W)}` },
    { a: P(width + 6, by0), b: P(width + 6, by1), label: `D ${fmt(D)}` },
    { a: P(-6, ty1), b: P(-6, by0), label: `H ${fmt(H)}` },
  ]

  return { width, height, segments, panels, dims }
}
