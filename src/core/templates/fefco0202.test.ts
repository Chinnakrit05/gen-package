import { describe, expect, it } from 'vitest'
import { computeMatrices, to3D } from '../fold'
import { getTemplate } from './index'
import { getMaterial } from '../materials'
import { dielineDXFString } from '../dxf'

// FEFCO 0202 OSC = RSC แต่ลิ้นหน้า-หลังยาวเต็มลึก เกยทับกันเต็ม
const mat = getMaterial('carton-300')
const tp = getTemplate('fefco-0202')
const box = { W: 120, D: 90, H: 180, handle: false }
const Dp = box.D + 2 * mat.thickness
const d = tp.generate(box, mat)
const M = computeMatrices(d.panels, 1)

const flapLen = (id: string) => {
  const p = d.panels.find((x) => x.id === id)!
  return Math.max(...p.outline.map((q) => q.y)) - Math.min(...p.outline.map((q) => q.y))
}

describe('fefco-0202: OSC ลิ้นเกยทับ', () => {
  it('ลงทะเบียน + มีลิ้นครบ 8 (บน-ล่าง × 4 ผนัง)', () => {
    expect(tp.id).toBe('fefco-0202')
    for (const id of ['flap-t-front', 'flap-t-back', 'flap-t-sl', 'flap-t-sr', 'flap-b-front', 'flap-b-back', 'flap-b-sl', 'flap-b-sr']) {
      expect(d.panels.some((p) => p.id === id)).toBe(true)
    }
  })

  it('ลิ้นหน้า-หลัง (outer) ยาวเต็มลึก Dp และยาวกว่าลิ้นข้าง (inner)', () => {
    expect(flapLen('flap-b-front')).toBeCloseTo(Dp, 1) // เต็มลึก
    expect(flapLen('flap-b-front')).toBeGreaterThan(flapLen('flap-b-sl')) // ยาวกว่าลิ้นข้าง
  })

  it('พับเต็ม: ลิ้นหน้ากับลิ้นหลังเกยทับกัน (ปลายลิ้นหน้าถึงผนังหลัง)', () => {
    const front = d.panels.find((p) => p.id === 'flap-b-front')!
    // ปลายไกลของลิ้นหน้า (y = bot + outerLen)
    const farY = Math.max(...front.outline.map((p) => p.y))
    const far = front.outline.find((p) => p.y === farY)!
    const tip = to3D(far).applyMatrix4(M.get('flap-b-front')!)
    expect(tip.z).toBeGreaterThan(Dp * 0.8) // เลยไปเกือบถึงผนังตรงข้าม = เกยทับ
  })

  it('matrices finite + DXF ไม่มี NaN', () => {
    for (const p of d.panels) {
      const v = to3D(p.outline[0]).applyMatrix4(M.get(p.id)!)
      expect(Number.isFinite(v.x + v.y + v.z)).toBe(true)
    }
    const dxf = dielineDXFString(d)
    expect(dxf).toContain('SECTION')
    expect(dxf).not.toContain('NaN')
  })
})
