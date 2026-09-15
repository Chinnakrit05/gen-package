import { describe, expect, it } from 'vitest'
import { fitGrid, computeImposition, sheetsNeeded, SHEET_PRESETS, type Sheet } from './imposition'

describe('fitGrid', () => {
  it('นับคอลัมน์/แถวถูกเมื่อมีร่องระหว่างชิ้น', () => {
    // avail = 100 - 2*0 = 100; ชิ้นกว้าง 30 ร่อง 5: 30,35,70,75,110... → 3 คอลัมน์
    // n*30 + (n-1)*5 ≤ 100 → n=3 (100) พอดี, n=4 (135) เกิน
    const g = fitGrid(30, 30, 100, 100, 0, 5)
    expect(g.cols).toBe(3)
    expect(g.rows).toBe(3)
    expect(g.count).toBe(9)
  })

  it('หักระยะขอบทั้งสองด้าน', () => {
    // avail = 100 - 2*10 = 80; ชิ้น 40 ร่อง 0 → 2 พอดี
    const g = fitGrid(40, 40, 100, 100, 10, 0)
    expect(g.cols).toBe(2)
    expect(g.count).toBe(4)
  })

  it('ชิ้นใหญ่กว่าพื้นที่ว่าง → 0', () => {
    expect(fitGrid(200, 50, 100, 100, 10, 0).count).toBe(0)
    expect(fitGrid(50, 200, 100, 100, 10, 0).count).toBe(0)
  })

  it('ชิ้นขนาดไม่ถูกต้อง → 0', () => {
    expect(fitGrid(0, 50, 100, 100, 0, 0).count).toBe(0)
    expect(fitGrid(-5, 50, 100, 100, 0, 0).count).toBe(0)
  })

  it('ไม่มีร่อง/ขอบ → floor(sheet/piece)', () => {
    const g = fitGrid(33, 33, 100, 100, 0, 0)
    expect(g.cols).toBe(3) // floor(100/33)=3
    expect(g.count).toBe(9)
  })
})

describe('computeImposition', () => {
  const sheet: Sheet = { id: 't', nameTh: 'ทดสอบ', w: 100, h: 200 }

  it('เลือกทิศที่ได้จำนวนมากกว่า (หมุน 90°)', () => {
    // ชิ้น 90×40 บนแผ่น 100×200 ขอบ 0 ร่อง 0:
    // ตั้ง: cols=floor(100/90)=1, rows=floor(200/40)=5 → 5
    // หมุน (40×90): cols=floor(100/40)=2, rows=floor(200/90)=2 → 4
    // ควรเลือกตั้ง (5) ไม่หมุน
    const L = computeImposition(90, 40, sheet, { margin: 0, gutter: 0 })
    expect(L.count).toBe(5)
    expect(L.rotated).toBe(false)
  })

  it('หมุนแล้วดีกว่า → rotated=true', () => {
    // ชิ้น 40×90: ตั้ง 4, หมุน(90×40) 5 → เลือกหมุน
    const L = computeImposition(40, 90, sheet, { margin: 0, gutter: 0 })
    expect(L.count).toBe(5)
    expect(L.rotated).toBe(true)
  })

  it('usedFrac = พื้นที่ชิ้นรวม / พื้นที่แผ่น', () => {
    // ชิ้น 50×50 บน 100×200 ขอบ/ร่อง 0 → 2×4=8 ชิ้น
    // used = 8*2500 / 20000 = 1.0 (เต็มพอดี)
    const L = computeImposition(50, 50, sheet, { margin: 0, gutter: 0 })
    expect(L.count).toBe(8)
    expect(L.usedFrac).toBeCloseTo(1)
  })

  it('วางไม่ได้ → count 0, usedFrac 0', () => {
    const L = computeImposition(500, 500, sheet, { margin: 0, gutter: 0 })
    expect(L.count).toBe(0)
    expect(L.usedFrac).toBe(0)
  })

  it('ใช้ได้กับแผ่นมาตรฐานจริง', () => {
    const s = SHEET_PRESETS.find((x) => x.id === '31x43in')!
    // กล่องแผ่นคลี่ ~275×266 บนแผ่น 787×1092 ขอบ10 ร่อง3
    const L = computeImposition(275, 266, s)
    expect(L.count).toBeGreaterThanOrEqual(4)
    expect(L.usedFrac).toBeGreaterThan(0)
    expect(L.usedFrac).toBeLessThanOrEqual(1)
  })
})

describe('sheetsNeeded', () => {
  it('ปัดขึ้นเสมอ', () => {
    expect(sheetsNeeded(500, 8)).toBe(63) // 500/8 = 62.5 → 63
    expect(sheetsNeeded(16, 8)).toBe(2)
    expect(sheetsNeeded(1, 8)).toBe(1)
  })
  it('วางไม่ได้ (perSheet 0) → 0', () => {
    expect(sheetsNeeded(500, 0)).toBe(0)
  })
})

describe('SHEET_PRESETS', () => {
  it('ทุกแผ่นมีขนาดบวกและ id ไม่ซ้ำ', () => {
    const ids = SHEET_PRESETS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of SHEET_PRESETS) {
      expect(s.w).toBeGreaterThan(0)
      expect(s.h).toBeGreaterThan(0)
      expect(s.nameTh.length).toBeGreaterThan(0)
    }
  })
})
