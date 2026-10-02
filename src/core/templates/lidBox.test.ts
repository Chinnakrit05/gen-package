import { describe, expect, it } from 'vitest'
import { computeMatrices, to3D } from '../fold'
import { getTemplate } from './index'
import { getMaterial } from '../materials'
import { dielineDXFString } from '../dxf'

// กล่องฝาครอบ = 2 ชิ้น (ฐาน b- / ฝา l-) วางเคียงกันในแผ่นเดียว พับแยกอิสระ
const mat = getMaterial('carton-300')
const tp = getTemplate('lid-box')
const box = { W: 160, D: 110, H: 70, handle: false }
const d = tp.generate(box, mat)

describe('lid-box: โครงสร้างกล่องฝาครอบ', () => {
  it('ลงทะเบียนใน registry', () => {
    expect(tp.id).toBe('lid-box')
    expect(tp.supportsHandle).toBe(false)
  })

  it('มีสองชิ้น: ฐาน (b-) และ ฝา (l-) อย่างละ root ของตัวเอง', () => {
    const bases = d.panels.filter((p) => p.parentId === null).map((p) => p.id)
    expect(bases).toContain('b-base')
    expect(bases).toContain('l-base')
    expect(d.panels.some((p) => p.id === 'b-back')).toBe(true)
    expect(d.panels.some((p) => p.id === 'l-back')).toBe(true)
  })

  it('ฝาวางขวาของฐาน ไม่ทับกัน (ฝาตื้นกว่าฐาน)', () => {
    const bMaxX = Math.max(...d.panels.filter((p) => p.id.startsWith('b-')).flatMap((p) => p.outline.map((q) => q.x)))
    const lMinX = Math.min(...d.panels.filter((p) => p.id.startsWith('l-')).flatMap((p) => p.outline.map((q) => q.x)))
    expect(lMinX).toBeGreaterThanOrEqual(bMaxX) // ฝาอยู่ขวาฐาน ไม่ทับ
  })

  it('พับแล้ว matrices finite ทุกแผง + ส่งออก DXF ได้', () => {
    const M = computeMatrices(d.panels, 1)
    for (const p of d.panels) {
      const m = M.get(p.id)!
      const v = to3D(p.outline[0]).applyMatrix4(m)
      expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)).toBe(true)
    }
    const dxf = dielineDXFString(d)
    expect(dxf).toContain('SECTION')
    expect(dxf).not.toContain('NaN')
  })
})
