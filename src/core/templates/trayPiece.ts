import type { DimMark, Panel, Segment } from '../types'
import { P, rect } from './shared'

// ชิ้นส่วน "ถาด" ที่นำไปประกอบในกล่องหลายชิ้น (ฝาครอบ/ฝาสไลด์) — วางที่ออฟเซ็ต (ox,oy) พร้อม prefix id
// wallDir: +1 = ผนังพับขึ้น (ฐาน), -1 = ผนังพับลง (ฝาครอบคว่ำ) ให้ดูเป็นฝาครอบ
// คืน panels/segments ในพิกัดแผ่นคลี่สัมบูรณ์ (บวก ox,oy แล้ว) + กรอบ bbox ของชิ้น
export interface TrayPiece {
  panels: Panel[]
  segments: Segment[]
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

export function buildTrayPiece(
  prefix: string,
  ox: number,
  oy: number,
  W: number,
  D: number,
  H: number,
  t: number,
  wallDir: 1 | -1 = 1,
): TrayPiece {
  const Wp = W + 2 * t
  const Dp = D + 2 * t
  const Hp = H + t
  const layer = t + 0.05

  // พิกัดภายในชิ้น (ยังไม่บวกออฟเซ็ต)
  const cx0 = Hp
  const cx1 = cx0 + Wp
  const by0 = Hp
  const by1 = by0 + Dp
  const w = cx1 + Hp
  const h = by1 + Hp

  const dir = wallDir // พับขึ้น/ลง
  const a = (x: number, y: number) => P(ox + x, oy + y) // แปลงเป็นพิกัดสัมบูรณ์

  const tabIn = Math.max(1.5, 2 * t + 0.5)
  const tabW = Math.max(8, Math.min(0.72 * Hp, Dp / 2 - 2))
  const tabSlant = Math.min(5, tabW * 0.45)
  const tab = (xa: number, xb: number, y: number, d: 1 | -1): Panel['outline'] => [
    a(xa + tabIn, y),
    a(xa + tabIn + tabSlant, y + d * tabW),
    a(xb - tabIn - tabSlant, y + d * tabW),
    a(xb - tabIn, y),
  ]
  const r = (xa: number, ya: number, xb: number, yb: number) =>
    rect(ox + xa, oy + ya, ox + xb, oy + yb)

  const panels: Panel[] = [
    { id: `${prefix}base`, parentId: null, outline: r(cx0, by0, cx1, by1), stage: 0 },
    {
      id: `${prefix}back`, parentId: `${prefix}base`, outline: r(cx0, 0, cx1, by0),
      hingeA: a(cx0, by0), hingeB: a(cx1, by0), foldAngle: 90 * dir, stage: 0,
    },
    {
      id: `${prefix}front`, parentId: `${prefix}base`, outline: r(cx0, by1, cx1, h),
      hingeA: a(cx0, by1), hingeB: a(cx1, by1), foldAngle: -90 * dir, stage: 0,
    },
    {
      id: `${prefix}left`, parentId: `${prefix}base`, outline: r(0, by0, cx0, by1),
      hingeA: a(cx0, by0), hingeB: a(cx0, by1), foldAngle: -90 * dir, stage: 0,
    },
    {
      id: `${prefix}right`, parentId: `${prefix}base`, outline: r(cx1, by0, w, by1),
      hingeA: a(cx1, by0), hingeB: a(cx1, by1), foldAngle: 90 * dir, stage: 0,
    },
    {
      id: `${prefix}tab-lb`, parentId: `${prefix}left`, outline: tab(0, cx0, by0, -1),
      hingeA: a(0, by0), hingeB: a(cx0, by0), foldAngle: 90 * dir, stage: 1, zOffset: layer,
    },
    {
      id: `${prefix}tab-lf`, parentId: `${prefix}left`, outline: tab(0, cx0, by1, 1),
      hingeA: a(0, by1), hingeB: a(cx0, by1), foldAngle: -90 * dir, stage: 1, zOffset: layer,
    },
    {
      id: `${prefix}tab-rb`, parentId: `${prefix}right`, outline: tab(cx1, w, by0, -1),
      hingeA: a(cx1, by0), hingeB: a(w, by0), foldAngle: 90 * dir, stage: 1, zOffset: layer,
    },
    {
      id: `${prefix}tab-rf`, parentId: `${prefix}right`, outline: tab(cx1, w, by1, 1),
      hingeA: a(cx1, by1), hingeB: a(w, by1), foldAngle: -90 * dir, stage: 1, zOffset: layer,
    },
  ]

  const cut = (d: string): Segment => ({ kind: 'cut', d })
  const crease = (d: string): Segment => ({ kind: 'crease', d })
  const L = (x: number, y: number) => `${ox + x} ${oy + y}`
  const tabCut = (xa: number, xb: number, y: number, d: 1 | -1) =>
    `M ${L(xa, y)} L ${L(xa + tabIn, y)} L ${L(xa + tabIn + tabSlant, y + d * tabW)} ` +
    `L ${L(xb - tabIn - tabSlant, y + d * tabW)} L ${L(xb - tabIn, y)} L ${L(xb, y)}`

  const segments: Segment[] = [
    cut(`M ${L(cx0, 0)} L ${L(cx1, 0)}`),
    cut(`M ${L(cx1, 0)} L ${L(cx1, by0)}`),
    cut(tabCut(cx1, w, by0, -1)),
    cut(`M ${L(w, by0)} L ${L(w, by1)}`),
    cut(tabCut(cx1, w, by1, 1)),
    cut(`M ${L(cx1, by1)} L ${L(cx1, h)}`),
    cut(`M ${L(cx1, h)} L ${L(cx0, h)}`),
    cut(`M ${L(cx0, by1)} L ${L(cx0, h)}`),
    cut(tabCut(0, cx0, by1, 1)),
    cut(`M ${L(0, by0)} L ${L(0, by1)}`),
    cut(tabCut(0, cx0, by0, -1)),
    cut(`M ${L(cx0, 0)} L ${L(cx0, by0)}`),
    crease(`M ${L(cx0, by0)} L ${L(cx1, by0)}`),
    crease(`M ${L(cx0, by1)} L ${L(cx1, by1)}`),
    crease(`M ${L(cx0, by0)} L ${L(cx0, by1)}`),
    crease(`M ${L(cx1, by0)} L ${L(cx1, by1)}`),
    crease(`M ${L(tabIn, by0)} L ${L(cx0 - tabIn, by0)}`),
    crease(`M ${L(tabIn, by1)} L ${L(cx0 - tabIn, by1)}`),
    crease(`M ${L(cx1 + tabIn, by0)} L ${L(w - tabIn, by0)}`),
    crease(`M ${L(cx1 + tabIn, by1)} L ${L(w - tabIn, by1)}`),
  ]

  return { panels, segments, bbox: { x0: ox, y0: oy, x1: ox + w, y1: oy + h } }
}

// ขนาดกรอบของชิ้นถาด (ใช้วางเลย์เอาต์ก่อนสร้าง)
export function trayPieceSize(W: number, D: number, H: number, t: number) {
  const Wp = W + 2 * t
  const Dp = D + 2 * t
  const Hp = H + t
  return { w: Wp + 2 * Hp, h: Dp + 2 * Hp }
}

export function trayDims(): DimMark[] {
  return []
}
