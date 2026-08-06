import { describe, it, expect } from 'vitest'
import { panelsBBox, fillImageRect, type FillImage } from './artwork'
import type { Dieline } from './types'

// dieline จำลอง: สองแผงต่อกันเป็นกรอบ 0..100 × 0..100
const d: Dieline = {
  width: 100,
  height: 100,
  segments: [],
  dims: [],
  panels: [
    {
      id: 'a',
      parentId: null,
      stage: 0,
      outline: [
        { x: 0, y: 0 },
        { x: 60, y: 0 },
        { x: 60, y: 100 },
        { x: 0, y: 100 },
      ],
    },
    {
      id: 'b',
      parentId: 'a',
      stage: 0,
      outline: [
        { x: 60, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 60, y: 100 },
      ],
    },
  ],
}

const box = { x0: 0, y0: 0, x1: 100, y1: 100 }

describe('panelsBBox', () => {
  it('ครอบทุกแผงจริง', () => {
    expect(panelsBBox(d)).toEqual({ x0: 0, y0: 0, x1: 100, y1: 100 })
  })
})

describe('fillImageRect', () => {
  it('cover: รูปกว้าง (aspect 2) ล้นซ้าย-ขวา สูงพอดี', () => {
    const fi: FillImage = { src: 'x', aspect: 2, fit: 'cover' }
    expect(fillImageRect(box, fi)).toEqual({ x: -50, y: 0, w: 200, h: 100 })
  })

  it('cover: รูปสูง (aspect 0.5) ล้นบน-ล่าง กว้างพอดี', () => {
    const fi: FillImage = { src: 'x', aspect: 0.5, fit: 'cover' }
    expect(fillImageRect(box, fi)).toEqual({ x: 0, y: -50, w: 100, h: 200 })
  })

  it('contain: รูปกว้าง (aspect 2) พอดีแนวกว้าง เหลือบน-ล่าง', () => {
    const fi: FillImage = { src: 'x', aspect: 2, fit: 'contain' }
    expect(fillImageRect(box, fi)).toEqual({ x: 0, y: 25, w: 100, h: 50 })
  })

  it('stretch: เต็มกรอบพอดี ไม่สนใจ aspect', () => {
    const fi: FillImage = { src: 'x', aspect: 2, fit: 'stretch' }
    expect(fillImageRect(box, fi)).toEqual({ x: 0, y: 0, w: 100, h: 100 })
  })

  it('zoom 2 บน cover ขยายรอบจุดกึ่งกลาง', () => {
    const fi: FillImage = { src: 'x', aspect: 1, fit: 'cover', zoom: 2 }
    expect(fillImageRect(box, fi)).toEqual({ x: -50, y: -50, w: 200, h: 200 })
  })

  it('pan ox/oy เลื่อนกรอบเป็นสัดส่วนครึ่งกรอบ', () => {
    const fi: FillImage = { src: 'x', aspect: 1, fit: 'cover', ox: 1, oy: -1 }
    // aspect=1, box 100 → w=h=100; cx=50+50=100, cy=50-50=0
    expect(fillImageRect(box, fi)).toEqual({ x: 50, y: -50, w: 100, h: 100 })
  })

  it('rect อัตราส่วน = aspect เสมอ (cover/contain) จึงไม่บิดรูป', () => {
    for (const fit of ['cover', 'contain'] as const) {
      const r = fillImageRect(box, { src: 'x', aspect: 1.6, fit })
      expect(r.w / r.h).toBeCloseTo(1.6, 6)
    }
  })
})
