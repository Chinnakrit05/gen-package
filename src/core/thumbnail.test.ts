import { describe, expect, it } from 'vitest'
import { THUMB_H, THUMB_W, alphaBounds, thumbIsFresh, thumbNeedsFetch, thumbPlacement } from './thumbnail'

// ภาพย่อ 3D ของแกลเลอรีงาน: ตัดขอบตามโมเดล, วางกึ่งกลาง, ตัดสินว่าต้องถ่ายใหม่/โหลดจาก cloud ไหม
describe('alphaBounds / thumbPlacement', () => {
  const img = (w: number, h: number, on: (x: number, y: number) => boolean) => {
    const d = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (on(x, y)) d[(y * w + x) * 4 + 3] = 255
    return d
  }

  it('กรอบพิกเซลทึบ (exclusive ขวา/ล่าง); ภาพว่าง = null', () => {
    expect(alphaBounds(img(20, 10, (x, y) => x >= 4 && x < 9 && y >= 2 && y < 7), 20, 10)).toEqual({ x0: 4, y0: 2, x1: 9, y1: 7 })
    expect(alphaBounds(img(5, 5, () => false), 5, 5)).toBeNull()
  })

  it('โมเดลสูงเต็มความสูงหลังเว้นขอบ คงสัดส่วน และอยู่กึ่งกลาง', () => {
    const p = thumbPlacement({ x0: 100, y0: 50, x1: 200, y1: 450 }, THUMB_W, THUMB_H)
    expect(p.dw / p.dh).toBeCloseTo(100 / 400, 9)
    expect(p.dy).toBeCloseTo(THUMB_H - p.dy - p.dh, 9)
    expect(p.dx).toBeCloseTo(THUMB_W - p.dx - p.dw, 9)
    expect(p.dy).toBeGreaterThan(0)
    expect(p.dh).toBeLessThan(THUMB_H)
  })
})

describe('thumbIsFresh / thumbNeedsFetch', () => {
  it('ถ่ายจากสถานะงานล่าสุดแล้ว (แคชเครื่องนี้หรือ cloud หลังแก้ล่าสุด) = ไม่ต้องถ่ายใหม่', () => {
    expect(thumbIsFresh(1000, { sourceUpdatedAt: 1000 })).toBe(true)
    expect(thumbIsFresh(1001, { sourceUpdatedAt: 1000 })).toBe(false)
    expect(thumbIsFresh(Date.parse('2026-10-24T08:00:00Z'), null, '2026-10-24T08:00:01.000Z')).toBe(true)
    expect(thumbIsFresh(Date.parse('2026-10-24T08:00:02Z'), null, '2026-10-24T08:00:01.000Z')).toBe(false)
    expect(thumbIsFresh(5, undefined, undefined)).toBe(false)
  })

  it('โหลดจาก cloud เมื่อไม่มี/version ไม่ตรง — แต่ไม่ทับรูปที่เครื่องนี้ถ่ายหลังรูปบน server', () => {
    const v = '2026-10-24T08:00:00.000Z'
    expect(thumbNeedsFetch(v, null)).toBe(true)
    expect(thumbNeedsFetch(v, { version: v })).toBe(false)
    expect(thumbNeedsFetch(v, { version: 'old' })).toBe(true)
    expect(thumbNeedsFetch(v, { version: 'local', sourceUpdatedAt: Date.parse(v) + 5000 })).toBe(false)
    expect(thumbNeedsFetch(v, { version: 'local', sourceUpdatedAt: Date.parse(v) - 5000 })).toBe(true)
  })
})
