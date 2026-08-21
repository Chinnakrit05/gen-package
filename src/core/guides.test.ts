import { describe, expect, it } from 'vitest'
import { BLEED_MM, computeGuides, offsetPolygon } from './guides'
import { TEMPLATES } from './templates'
import { getMaterial } from './materials'
import type { Panel, Vec2 } from './types'

const bb = (p: Vec2[]) => {
  const xs = p.map((q) => q.x)
  const ys = p.map((q) => q.y)
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
}

describe('offsetPolygon: ทิศทางและระยะ (จุดที่เคยพลาดเครื่องหมาย)', () => {
  const sq: Vec2[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]

  it('d>0 = inset เข้าด้านใน 3 มม. เป๊ะ', () => {
    const b = bb(offsetPolygon(sq, 3))
    expect(b.x0).toBeCloseTo(3)
    expect(b.y0).toBeCloseTo(3)
    expect(b.x1).toBeCloseTo(7)
    expect(b.y1).toBeCloseTo(7)
  })

  it('d<0 = outset ออกด้านนอก 3 มม. เป๊ะ', () => {
    const b = bb(offsetPolygon(sq, -3))
    expect(b.x0).toBeCloseTo(-3)
    expect(b.x1).toBeCloseTo(13)
  })
})

describe('computeGuides: ขอบร่วมสองแผง = รอยพับ ไม่มี bleed', () => {
  // สองสี่เหลี่ยมแชร์ขอบ x=20 — bleed ต้องขึ้นเฉพาะขอบนอก
  const panels: Panel[] = [
    { id: 'A', parentId: null, outline: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 30 }, { x: 0, y: 30 }], stage: 0 },
    { id: 'B', parentId: 'A', outline: [{ x: 20, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 20, y: 30 }], stage: 0 },
  ]
  const g = computeGuides(panels)

  it('มี safe ทั้งสองแผง', () => {
    expect(g.safe).toHaveLength(2)
  })

  it('ขอบร่วมที่ x=20 ไม่มีเส้น bleed', () => {
    const shared = g.bleed.filter(
      ([a, b]) => Math.abs(a.x - b.x) < 0.01 && Math.abs((a.x + b.x) / 2 - 20) < BLEED_MM + 0.5,
    )
    expect(shared).toHaveLength(0)
  })

  it('ขอบนอกซ้ายมีเส้น bleed ที่ x=-3', () => {
    const left = g.bleed.filter(
      ([a, b]) => Math.abs(a.x - b.x) < 0.01 && Math.abs((a.x + b.x) / 2 - -BLEED_MM) < 0.5,
    )
    expect(left.length).toBeGreaterThanOrEqual(1)
  })
})

describe.each(TEMPLATES.map((t) => [t.id, t] as const))('guides: template %s', (_id, t) => {
  const d = t.generate({ ...t.defaults, handle: t.supportsHandle }, getMaterial('carton-300'))
  const g = computeGuides(d.panels)

  it('มี safe/bleed และทุกจุด finite ในช่วง [−bleed, ขนาด+bleed]', () => {
    expect(g.safe.length).toBeGreaterThanOrEqual(1)
    expect(g.bleed.length).toBeGreaterThanOrEqual(1)
    const pts = [...g.safe.flat(), ...g.bleed.flat()]
    expect(pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
    expect(
      pts.every(
        (p) =>
          p.x >= -BLEED_MM - 1 &&
          p.x <= d.width + BLEED_MM + 1 &&
          p.y >= -BLEED_MM - 1 &&
          p.y <= d.height + BLEED_MM + 1,
      ),
    ).toBe(true)
  })
})
