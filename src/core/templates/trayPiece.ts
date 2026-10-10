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
  // squareCorners: ลิ้นมุมเป็นสี่เหลี่ยมเต็ม (สูงเท่าผนัง) เว้นร่องหลบสั้น ๆ ข้างผนังหน้า-หลัง — แบบ dieline กล่องฝาครอบมาตรฐาน
  opts: { squareCorners?: boolean } = {},
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
  // ลิ้นมุมสี่เหลี่ยม: เต็มความสูงผนัง (ปลายนอกถึงขอบผนัง) เว้นร่องหลบ slot ฝั่งติดฐาน, ยื่นเกือบเท่าผนัง
  const sq = !!opts.squareCorners
  const slot = Math.max(1, t + 0.3)
  const sqW = Math.max(6, Hp - t - 0.5) // ระยะยื่นตามผนังหน้า-หลัง (ไม่ชนลิ้นฝั่งตรงข้าม)
  const tab = (xa: number, xb: number, y: number, d: 1 | -1): Panel['outline'] => {
    if (sq) {
      // ปลายนอก (ขอบผนังข้าง) = xa ฝั่งซ้าย / xb ฝั่งขวา; ร่องหลบอยู่ฝั่งติดฐาน
      const left = xa === 0
      const x0 = left ? xa : xa + slot
      const x1 = left ? xb - slot : xb
      return [a(x0, y), a(x0, y + d * sqW), a(x1, y + d * sqW), a(x1, y)]
    }
    return [
      a(xa + tabIn, y),
      a(xa + tabIn + tabSlant, y + d * tabW),
      a(xb - tabIn - tabSlant, y + d * tabW),
      a(xb - tabIn, y),
    ]
  }
  const r = (xa: number, ya: number, xb: number, yb: number) =>
    rect(ox + xa, oy + ya, ox + xb, oy + yb)

  // ลำดับพับแบบกล่องจริง: ผนังซ้าย-ขวา (0) → ลิ้นมุมพับเข้า (1) → ผนังหน้า-หลังตั้งขึ้นปิดทับลิ้น (2)
  // ถ้าหน้า-หลังตั้งก่อน ลิ้นมุมจะกวาดอยู่นอกผนังแล้วทะลุเข้าไปตอนท้าย
  const panels: Panel[] = [
    { id: `${prefix}base`, parentId: null, outline: r(cx0, by0, cx1, by1), stage: 0 },
    {
      id: `${prefix}back`, parentId: `${prefix}base`, outline: r(cx0, 0, cx1, by0),
      hingeA: a(cx0, by0), hingeB: a(cx1, by0), foldAngle: 90 * dir, stage: 2,
    },
    {
      id: `${prefix}front`, parentId: `${prefix}base`, outline: r(cx0, by1, cx1, h),
      hingeA: a(cx0, by1), hingeB: a(cx1, by1), foldAngle: -90 * dir, stage: 2,
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
  const tabCut = (xa: number, xb: number, y: number, d: 1 | -1) => {
    if (sq) {
      const pts = tab(xa, xb, y, d).map((q) => `${q.x} ${q.y}`)
      // ขอบผนังข้าง → รอบลิ้น → ร่องหลบกลับมาที่มุมฐาน
      return `M ${L(xa, y)} L ${pts[0]} L ${pts[1]} L ${pts[2]} L ${pts[3]} L ${L(xb, y)}`
    }
    return (
      `M ${L(xa, y)} L ${L(xa + tabIn, y)} L ${L(xa + tabIn + tabSlant, y + d * tabW)} ` +
      `L ${L(xb - tabIn - tabSlant, y + d * tabW)} L ${L(xb - tabIn, y)} L ${L(xb, y)}`
    )
  }
  const tabCrease = (xa: number, xb: number, y: number) => {
    const o = tab(xa, xb, y, 1)
    return crease(`M ${o[0].x} ${o[0].y} L ${o[3].x} ${o[3].y}`)
  }

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
    tabCrease(0, cx0, by0),
    tabCrease(0, cx0, by1),
    tabCrease(cx1, w, by0),
    tabCrease(cx1, w, by1),
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
