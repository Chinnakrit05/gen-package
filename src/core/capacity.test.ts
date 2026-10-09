import { describe, expect, it } from 'vitest'
import { boxVolumeMl, pouchVolumeMl, vesselVolumeMl, tubeVolumeMl, formatCapacity } from './capacity'
import type { Vec2 } from './types'

describe('capacity: กล่อง', () => {
  it('W×D×H → มล. (หักเล็กน้อย)', () => {
    // 100×50×40 มม. = 200,000 มม.³ = 200 มล. × 0.95
    expect(boxVolumeMl(100, 50, 40)).toBeCloseTo(190, 0)
  })
  it('ใหญ่ขึ้นตามขนาด', () => {
    expect(boxVolumeMl(200, 100, 80)).toBeGreaterThan(boxVolumeMl(100, 50, 40))
  })
})

describe('capacity: ถุงฟิล์ม', () => {
  it('คืนค่าบวกและเพิ่มตามขนาด (brick)', () => {
    const small = pouchVolumeMl(80, 120, 20, 'gusset')
    const big = pouchVolumeMl(120, 180, 30, 'gusset')
    expect(small).toBeGreaterThan(0)
    expect(big).toBeGreaterThan(small)
  })
  it('ซองแบน: ความจุตอนบรรจุเต็มตามสูตรซองแบน — ไม่ขึ้นกับความหนาที่แสดงใน 3D', () => {
    // 80×120 (ในแนวซีล 74×120): สูตรซองแบน ≈ 153 มล. × 0.8 ≈ 122 มล.
    expect(pouchVolumeMl(80, 120, 3.6, 'flat')).toBeGreaterThan(115)
    expect(pouchVolumeMl(80, 120, 3.6, 'flat')).toBeLessThan(130)
    expect(pouchVolumeMl(80, 120, 3.6, 'flat')).toBe(pouchVolumeMl(80, 120, 20, 'flat'))
  })

  it('box (ก้นแบน) จุมากกว่า flat (ซองแบน) ที่ขนาดเท่ากัน', () => {
    expect(pouchVolumeMl(100, 150, 25, 'box')).toBeGreaterThan(pouchVolumeMl(100, 150, 25, 'flat'))
  })
})

describe('capacity: ภาชนะหมุน (โปรไฟล์)', () => {
  it('ทรงกระบอก r=25 สูง 100 ≈ π r² h × 0.8 /1000', () => {
    // โปรไฟล์กระบอกตรง: (0,0)→(25,0)→(25,100)→(0,100)
    const cyl: Vec2[] = [
      { x: 0, y: 0 },
      { x: 25, y: 0 },
      { x: 25, y: 100 },
      { x: 0, y: 100 },
    ]
    const expected = ((Math.PI * 25 * 25 * 100) / 1000) * 0.8
    expect(vesselVolumeMl(cyl)).toBeCloseTo(expected, 0)
  })
})

describe('capacity: หลอดครีม', () => {
  it('คืนค่าบวกและเพิ่มตามความสูง/ความกว้าง', () => {
    const a = tubeVolumeMl(40, 150, 8, 18)
    const b = tubeVolumeMl(50, 180, 10, 18)
    expect(a).toBeGreaterThan(0)
    expect(b).toBeGreaterThan(a)
  })
})

describe('capacity: รูปแบบข้อความ', () => {
  it('มล. ต่ำกว่าพัน, ลิตร ตั้งแต่พันขึ้นไป', () => {
    expect(formatCapacity(48)).toContain('มล.')
    expect(formatCapacity(250)).toContain('มล.')
    expect(formatCapacity(1500)).toContain('ลิตร')
    expect(formatCapacity(0)).toBe('—')
  })

  it('imperial = fl oz / แกลลอน', () => {
    expect(formatCapacity(295.735, true)).toContain('fl oz') // ~10 fl oz
    expect(formatCapacity(295.735, true)).toContain('10')
    expect(formatCapacity(8000, true)).toContain('gal') // > 128 fl oz
  })
})
