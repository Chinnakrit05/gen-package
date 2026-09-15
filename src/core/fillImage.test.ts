import { describe, it, expect } from 'vitest'
import { panelsBBox, fillImageRect, fillImageSVGLayer, parseFillImage, type FillImage } from './artwork'
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

describe('รูปพื้น: หมุน + ความทึบ', () => {
  it('parseFillImage เก็บ rot/opacity เฉพาะเมื่อไม่ใช่ค่าเริ่มต้น + clamp', () => {
    expect(parseFillImage({ src: 'x', aspect: 1, rot: 30, opacity: 0.5 })).toMatchObject({ rot: 30, opacity: 0.5 })
    // ค่าเริ่มต้น (rot 0, opacity 1) ไม่ถูกเก็บ
    const base = parseFillImage({ src: 'x', aspect: 1, rot: 0, opacity: 1 })
    expect(base && 'rot' in base).toBe(false)
    expect(base && 'opacity' in base).toBe(false)
    // clamp เกินช่วง
    expect(parseFillImage({ src: 'x', aspect: 1, rot: 999, opacity: 5 })).toMatchObject({ rot: 180 })
    expect(parseFillImage({ src: 'x', aspect: 1, opacity: -2 })).toMatchObject({ opacity: 0 })
  })

  it('fillImageSVGLayer ใส่ rotate รอบกึ่งกลางกรอบ + opacity บนเลเยอร์ (clip ไม่หมุนตาม)', () => {
    const svg = fillImageSVGLayer(d, { src: 'x', aspect: 1, rot: 45, opacity: 0.4 })
    expect(svg).toContain('opacity="0.4"')
    expect(svg).toContain('transform="rotate(45 50 50)"') // กึ่งกลางกรอบ 100×100
    // clip อยู่บน <g> ครอบ image (ไม่ได้อยู่บน image ที่หมุน)
    expect(svg).toContain('<g clip-path="url(#fillclip)">')
  })

  it('ไม่มี rot/opacity → ไม่ใส่ transform/opacity', () => {
    const svg = fillImageSVGLayer(d, { src: 'x', aspect: 1 })
    expect(svg).not.toContain('transform="rotate')
    expect(svg).not.toContain('opacity=')
  })
})
