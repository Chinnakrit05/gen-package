import { describe, expect, it } from 'vitest'
import { buildPouchGeometry } from './PouchViewer3D'
import { generatePouch, brickShape, brickAt } from '../core/pouch'
import { getMaterial } from '../core/materials'

const mat = getMaterial('pouch-kraft')

// ซองข้างจีบ: ไม่มีส่วนไหนของฟิล์มยื่นพ้นทรงถุง — ซีลก้นต้องอยู่ใต้ฐาน/แนบผนังหลัง ไม่เป็นแผ่นยื่นออกนอกถุง
describe('3D ซองข้างจีบ: ซีลก้นไม่ยื่นพ้นฐาน', () => {
  it.each([
    [100, 60, 210],
    [100, 24, 200],
    [50, 24, 70],
    [40, 10, 60],
  ])('W%d D%d H%d', (W, D, H) => {
    const p = generatePouch({ W, D, H }, mat, { style: 'gusset', zipper: true })
    const s = brickShape(p)
    const pos = buildPouchGeometry(p).attributes.position
    let minY = Infinity
    let maxAbsZ = 0
    let maxAbsX = 0
    for (let i = 0; i < pos.count; i++) {
      minY = Math.min(minY, pos.getY(i))
      maxAbsZ = Math.max(maxAbsZ, Math.abs(pos.getZ(i)))
      maxAbsX = Math.max(maxAbsX, Math.abs(pos.getX(i)))
    }
    expect(minY).toBeGreaterThan(-2) // ฐานวางพื้น ซีลก้นแนบใต้ฐาน
    expect(maxAbsZ).toBeLessThanOrEqual(s.b0 + 1) // ไม่ยื่นพ้นหน้า/หลัง
    expect(maxAbsX).toBeLessThanOrEqual(s.a + 0.5)
  })
})

describe('3D ซองข้างจีบ: ซิปอยู่ช่วงคอแบนใต้ซีลบน ไม่คร่อมไหล่/ลำตัว', () => {
  it.each([
    [100, 60, 210],
    [100, 24, 200],
    [50, 24, 70],
  ])('W%d D%d H%d', (W, D, H) => {
    const p = generatePouch({ W, D, H }, mat, { style: 'gusset', zipper: true })
    const s = brickShape(p)
    const dl = p.zipY! - p.frontRect.y
    expect(s.flatL).toBeGreaterThan(dl + 2.5) // ช่วงแบนคลุมแถบซิปทั้งแถบ
    for (const d of [dl - 2.5, dl, dl + 2.5]) {
      const r = brickAt(s, d)
      expect(r.b).toBeCloseTo(s.finHalf, 6) // หน้า-หลังประกบ (ซิปหนีบ)
      expect(r.tilt).toBe(0)
      expect(r.y).toBeGreaterThan(s.bodyH + s.shoulderH)
    }
    // ความยาวผิวหน้ายังเท่ากับ H (UV ไม่ยืด)
    expect(s.flatL + s.shoulderL + s.bodyH + s.baseL).toBeCloseTo(H, 6)
  })

  it('ไม่มีซิป = ไหล่เริ่มที่ซีลบนเหมือนเดิม', () => {
    const s = brickShape(generatePouch({ W: 100, D: 60, H: 210 }, mat, { style: 'gusset' }))
    expect(s.flatL).toBe(0)
  })
})
