import { describe, expect, it } from 'vitest'
import { computeMatrices, to3D } from '../fold'
import { getTemplate } from './index'
import { getMaterial } from '../materials'
import { dielineDXFString } from '../dxf'

// กล่องฝาสไลด์ = 2 ชิ้น: ลิ้นชัก (d- ถาด) + ปลอกสวม (s- ท่อ) วางเคียงกัน
const mat = getMaterial('carton-300')
const tp = getTemplate('slide-box')
const box = { W: 90, D: 120, H: 35, handle: false }
const d = tp.generate(box, mat)

describe('slide-box: โครงสร้างกล่องฝาสไลด์', () => {
  it('ลงทะเบียน + มีลิ้นชัก (d-) และปลอกสวม (s-)', () => {
    expect(tp.id).toBe('slide-box')
    expect(d.panels.some((p) => p.id === 'd-base')).toBe(true) // ลิ้นชักเป็นถาด
    expect(d.panels.some((p) => p.id === 's-front')).toBe(true) // ปลอกสวมเป็นท่อ
    expect(d.panels.some((p) => p.id === 's-glue')).toBe(true) // ปีกทากาวปลอก
  })

  it('สองชิ้นแยก root คนละต้น ไม่ทับกันในแผ่น', () => {
    const roots = d.panels.filter((p) => p.parentId === null).map((p) => p.id)
    expect(roots).toContain('d-base')
    expect(roots).toContain('s-front')
    const dMaxX = Math.max(...d.panels.filter((p) => p.id.startsWith('d-')).flatMap((p) => p.outline.map((q) => q.x)))
    const sMinX = Math.min(...d.panels.filter((p) => p.id.startsWith('s-')).flatMap((p) => p.outline.map((q) => q.x)))
    expect(sMinX).toBeGreaterThanOrEqual(dMaxX)
  })

  it('พับแล้ว matrices finite + DXF ไม่มี NaN', () => {
    const M = computeMatrices(d.panels, 1)
    for (const p of d.panels) {
      const v = to3D(p.outline[0]).applyMatrix4(M.get(p.id)!)
      expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)).toBe(true)
    }
    const dxf = dielineDXFString(d)
    expect(dxf).toContain('SECTION')
    expect(dxf).not.toContain('NaN')
  })
})
