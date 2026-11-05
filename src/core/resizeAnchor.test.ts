import { describe, expect, it } from 'vitest'
import { reanchorBox } from './resizeAnchor'

// มุมของกรอบบนจอ (หมุนรอบกึ่งกลาง) — ใช้ตรวจว่ามุมตรึงไม่ขยับ
function corner(box: { x: number; y: number; w: number; h: number }, rotDeg: number, sx: number, sy: number) {
  const rad = (rotDeg * Math.PI) / 180
  const lx = (sx * box.w) / 2
  const ly = (sy * box.h) / 2
  return {
    x: box.x + box.w / 2 + Math.cos(rad) * lx - Math.sin(rad) * ly,
    y: box.y + box.h / 2 + Math.sin(rad) * lx + Math.cos(rad) * ly,
  }
}

describe('reanchorBox', () => {
  it('ลากมุมซ้ายบน: ข้อความกว้างจริงต่างจากที่ขอ มุมขวาล่างยังอยู่ที่เดิม', () => {
    const requested = { x: 40, y: 20, w: 60, h: 12 }
    const actual = { w: 57.3, h: 11.5 }
    const pos = reanchorBox(requested, actual, 0, { sx: 1, sy: 1 })
    expect(pos.x + actual.w).toBeCloseTo(requested.x + requested.w, 9)
    expect(pos.y + actual.h).toBeCloseTo(requested.y + requested.h, 9)
  })

  it('ลากมุมซ้ายล่าง: ขอบขวาและขอบบนคงที่', () => {
    const requested = { x: 10, y: 30, w: 80, h: 16 }
    const actual = { w: 83, h: 16.6 }
    const pos = reanchorBox(requested, actual, 0, { sx: 1, sy: -1 })
    expect(pos.x + actual.w).toBeCloseTo(90, 9)
    expect(pos.y).toBeCloseTo(30, 9)
  })

  it('ลากมุมขวาล่าง (มุมตรึงซ้ายบน) ไม่ขยับตำแหน่ง', () => {
    const pos = reanchorBox({ x: 5, y: 7, w: 50, h: 10 }, { w: 48, h: 9.6 }, 0, { sx: -1, sy: -1 })
    expect(pos.x).toBeCloseTo(5, 9)
    expect(pos.y).toBeCloseTo(7, 9)
  })

  it('ชิ้นที่หมุนอยู่: มุมตรึงบนจอตรงเดิม', () => {
    const requested = { x: 30, y: 40, w: 70, h: 14 }
    const actual = { w: 66.2, h: 13.2 }
    for (const rot of [30, 90, -135]) {
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1]]) {
        const pos = reanchorBox(requested, actual, rot, { sx, sy })
        const before = corner(requested, rot, sx, sy)
        const after = corner({ ...pos, ...actual }, rot, sx, sy)
        expect(after.x).toBeCloseTo(before.x, 9)
        expect(after.y).toBeCloseTo(before.y, 9)
      }
    }
  })
})
