import { describe, expect, it } from 'vitest'
import { computeMatrices, to3D } from '../fold'
import { getTemplate } from './index'
import { getMaterial } from '../materials'
import { dielineDXFString } from '../dxf'

// FEFCO 0215 = tube + ฝาบนเสียบ + ก้นล็อก 4 ลิ้น
const mat = getMaterial('carton-300')
const tp = getTemplate('fefco-0215')
const box = { W: 90, D: 60, H: 150, handle: false }
const d = tp.generate(box, mat)
const M = computeMatrices(d.panels, 1)

describe('fefco-0215: กล่องฝาบนก้นล็อก', () => {
  it('ลงทะเบียน + มีฝาบนเสียบ และก้น 4 ลิ้น', () => {
    expect(tp.id).toBe('fefco-0215')
    expect(d.panels.some((p) => p.id === 'tuck-top')).toBe(true)
    for (const id of ['base-left', 'base-right', 'base-front', 'base-back']) {
      expect(d.panels.some((p) => p.id === id)).toBe(true)
    }
  })

  it('พับเต็ม: ลิ้นก้นทั้ง 4 ลงมาที่ระดับก้นเดียวกัน (ปิดพื้น)', () => {
    const front = d.panels.find((p) => p.id === 'front')!
    const botY = Math.max(...front.outline.map((p) => p.y))
    const floorY = to3D({ x: front.outline[0].x, y: botY }).applyMatrix4(M.get('front')!).y
    for (const id of ['base-left', 'base-right', 'base-front', 'base-back']) {
      const p = d.panels.find((x) => x.id === id)!
      const tip = to3D(p.outline[1]).applyMatrix4(M.get(id)!)
      expect(Math.abs(tip.y - floorY)).toBeLessThan(2) // ลิ้นราบที่ระดับก้น
    }
  })

  it('ลิ้นหน้า-หลังลึกกว่าลิ้นข้าง (เกยทับล็อกกลาง)', () => {
    const depth = (id: string) => {
      const p = d.panels.find((x) => x.id === id)!
      return Math.max(...p.outline.map((q) => q.y)) - Math.min(...p.outline.map((q) => q.y))
    }
    expect(depth('base-front')).toBeGreaterThan(depth('base-left'))
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
