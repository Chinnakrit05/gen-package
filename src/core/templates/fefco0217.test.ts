import { describe, expect, it } from 'vitest'
import { computeMatrices, to3D } from '../fold'
import { getTemplate } from './index'
import { getMaterial } from '../materials'
import { dielineDXFString } from '../dxf'

// FEFCO 0217 = tube + ฝาข้างปิดบน + หูหิ้วหน้า-หลังชนกลาง (เจาะรูจับ) + ก้น auto-lock
const mat = getMaterial('carton-300')
const tp = getTemplate('fefco-0217')
const box = { W: 160, D: 100, H: 120, handle: false }
const Dp = box.D + 2 * mat.thickness
const d = tp.generate(box, mat)
const M = computeMatrices(d.panels, 1)

describe('fefco-0217: กล่องหูหิ้วบนก้นล็อก', () => {
  it('ลงทะเบียน + มีหูหิ้วหน้า-หลัง (เจาะรูจับ) และก้น 4 ลิ้น', () => {
    expect(tp.id).toBe('fefco-0217')
    const hf = d.panels.find((p) => p.id === 'handle-front')!
    const hb = d.panels.find((p) => p.id === 'handle-back')!
    expect(hf.holes).toBeTruthy()
    expect(hb.holes).toBeTruthy()
    for (const id of ['base-left', 'base-right', 'base-front', 'base-back']) {
      expect(d.panels.some((p) => p.id === id)).toBe(true)
    }
  })

  it('พับเต็ม: ยอดหูหิ้วหน้า-หลังมาชนกลาง (z ≈ Dp/2) และยื่นเหนือปากกล่อง', () => {
    const hf = d.panels.find((p) => p.id === 'handle-front')!
    const hb = d.panels.find((p) => p.id === 'handle-back')!
    const topF = to3D(hf.outline[1]).applyMatrix4(M.get('handle-front')!)
    const topB = to3D(hb.outline[1]).applyMatrix4(M.get('handle-back')!)
    expect(topF.z).toBeCloseTo(Dp / 2, 0) // ยอดหน้าเลื่อนมากลาง
    expect(topB.z).toBeCloseTo(Dp / 2, 0) // ยอดหลังเลื่อนมากลาง (ชนกัน)
    // ยอดหูหิ้ว (3D y) อยู่เหนือขอบบนกล่อง
    const front = d.panels.find((p) => p.id === 'front')!
    const rimY = to3D({ x: front.outline[0].x, y: Math.min(...front.outline.map((p) => p.y)) }).applyMatrix4(M.get('front')!).y
    expect(topF.y).toBeGreaterThan(rimY) // 3D y มากกว่า = สูงกว่าขอบปาก
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
