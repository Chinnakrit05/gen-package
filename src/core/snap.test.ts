import { describe, expect, it } from 'vitest'
import { snapTargets, applySnap } from './snap'
import type { Panel } from './types'
import type { Deco } from './artwork'

const rectPanel = (id: string, x: number, y: number, w: number, h: number): Panel => ({
  id,
  parentId: null,
  stage: 0,
  outline: [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ],
})

const textDeco = (id: string, x: number, y: number, w: number): Deco => ({
  id,
  type: 'text',
  text: 'x',
  color: '#000',
  size: 10,
  w,
  x,
  y,
  rot: 0,
})

describe('snapTargets', () => {
  it('รวมกึ่งกลางแผ่น + ขอบ/กึ่งกลางของแผง', () => {
    const t = snapTargets([rectPanel('p', 0, 0, 100, 60)], [], '', 200, 120)
    expect(t.xs).toContain(100) // กึ่งกลางแผ่น (200/2)
    expect(t.ys).toContain(60) // กึ่งกลางแผ่น (120/2)
    expect(t.xs).toContain(0) // ขอบซ้ายแผง
    expect(t.xs).toContain(50) // กึ่งกลางแผง
    expect(t.ys).toContain(30) // กึ่งกลางแผง (แนวตั้ง)
  })

  it('รวมขอบ/กึ่งกลางของชิ้นอื่น แต่ไม่รวมชิ้นที่กำลังลาก', () => {
    const decos = [textDeco('other', 10, 20, 40), textDeco('dragged', 90, 90, 20)]
    const t = snapTargets([], decos, 'dragged', 300, 300)
    expect(t.xs).toContain(10) // ขอบซ้ายชิ้นอื่น
    expect(t.xs).toContain(30) // กึ่งกลางชิ้นอื่น (10 + 40/2)
    expect(t.xs).toContain(50) // ขอบขวาชิ้นอื่น (10 + 40)
    expect(t.xs).not.toContain(90) // ขอบชิ้นที่ลากต้องไม่อยู่ในเป้าหมาย
    expect(t.xs).not.toContain(100)
  })

  it('ตัดค่าซ้ำ (ปัด 0.1)', () => {
    const t = snapTargets([rectPanel('a', 0, 0, 100, 100), rectPanel('b', 0, 0, 100, 100)], [], '', 200, 200)
    // สองแผงทับกัน → เส้นเป้าหมายไม่ควรมีค่าซ้ำ
    expect(new Set(t.xs).size).toBe(t.xs.length)
  })
})

describe('applySnap', () => {
  const targets = { xs: [100], ys: [60] }

  it('กึ่งกลางชิ้นเข้าใกล้เส้น → ดูดให้กึ่งกลางตรงเส้นพอดี', () => {
    // ชิ้นกว้าง 20 มุมซ้าย x=88 → กึ่งกลาง=98 ห่างเส้น 100 อยู่ 2 (ในระยะ 3)
    const r = applySnap(88, 0, 20, 10, targets, 3)
    expect(r.x).toBeCloseTo(90) // ขยับให้กึ่งกลาง=100 → มุมซ้าย=90
    expect(r.vx).toBe(100)
  })

  it('ขอบซ้ายเข้าใกล้เส้น → ดูดขอบซ้ายให้ตรง', () => {
    // มุมซ้าย x=101.5 ใกล้เส้น 100 (ห่าง 1.5) — ใกล้กว่าการดูดกึ่งกลาง
    const r = applySnap(101.5, 0, 40, 10, targets, 3)
    expect(r.x).toBeCloseTo(100)
    expect(r.vx).toBe(100)
  })

  it('เกินระยะ → ไม่ดูด (คงตำแหน่งเดิม, ไม่มีเส้น)', () => {
    const r = applySnap(50, 0, 20, 10, targets, 3)
    expect(r.x).toBe(50)
    expect(r.vx).toBeNull()
  })

  it('ดูดแกน y ได้อิสระจากแกน x', () => {
    // y: มุมบน 57 กึ่งกลาง 57+5=62 ใกล้ 60 (ห่าง 2) → ดูด; x ไกลไม่ดูด
    const r = applySnap(10, 57, 20, 10, targets, 3)
    expect(r.vx).toBeNull()
    expect(r.y).toBeCloseTo(55) // กึ่งกลาง=60 → มุมบน=55
    expect(r.vy).toBe(60)
  })

  it('เลือกจุดอ้างอิงที่ใกล้ที่สุดเมื่อมีหลายจุดเข้าเกณฑ์', () => {
    // ชิ้นกว้าง 4 มุมซ้าย 99: ซ้าย=99 (ห่าง1), กึ่งกลาง=101 (ห่าง1), ขวา=103 (ห่าง3)
    // ซ้ายกับกึ่งกลางห่างเท่ากัน — ตัวหลังที่เจอ (กึ่งกลาง) ชนะเพราะ <= bestDist
    const r = applySnap(99, 0, 4, 10, { xs: [100], ys: [] }, 3)
    expect(r.vx).toBe(100)
    // ไม่ว่าเลือกซ้ายหรือกึ่งกลาง ผลลัพธ์ต้องทำให้จุดใดจุดหนึ่งตรง 100
    expect([100, 98]).toContain(Math.round(r.x))
  })
})
