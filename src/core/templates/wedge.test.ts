import { describe, expect, it } from 'vitest'
import { computeMatrices, to3D } from '../fold'
import { getTemplate } from './index'
import { getMaterial } from '../materials'
import { dielineDXFString } from '../dxf'

// กล่องแซนวิช = ปริซึมสามเหลี่ยม ชิ้นเดียว: ฐาน + หลัง + ฝาเฉียง + สามเหลี่ยมข้างสองด้าน
const mat = getMaterial('carton-300')
const tp = getTemplate('wedge')
const box = { W: 120, D: 110, H: 80, handle: false }
const d = tp.generate(box, mat)

describe('wedge: โครงสร้างกล่องแซนวิช', () => {
  it('ลงทะเบียน + ครบ 5 แผง (ฐาน/หลัง/ฝา/ข้างซ้าย-ขวา)', () => {
    expect(tp.id).toBe('wedge')
    const ids = d.panels.map((p) => p.id).sort()
    expect(ids).toEqual(['back', 'base', 'side-left', 'side-right', 'top'])
  })

  it('ผนังข้างเป็นสามเหลี่ยม (3 จุด), ฝาเฉียงยาว = √(D²+H²)', () => {
    expect(d.panels.find((p) => p.id === 'side-left')!.outline).toHaveLength(3)
    const top = d.panels.find((p) => p.id === 'top')!
    const ys = top.outline.map((p) => p.y)
    const slant = Math.max(...ys) - Math.min(...ys)
    expect(slant).toBeCloseTo(Math.hypot(box.D, box.H), 3)
  })

  it('พับแล้วได้ทรง 3 มิติ (z ยกขึ้นจริง) + matrices finite', () => {
    const M = computeMatrices(d.panels, 1)
    // ยอดผนังหลัง (ขอบบน) ต้องยกขึ้น (z ≠ 0) เมื่อพับเต็ม
    const back = d.panels.find((p) => p.id === 'back')!
    const topEdge = to3D(back.hingeA!).applyMatrix4(M.get('back')!) // จุดบานพับฐาน
    const backTop = to3D({ x: back.hingeA!.x, y: back.hingeA!.y - box.H }).applyMatrix4(M.get('back')!)
    expect(Math.abs(backTop.z - topEdge.z)).toBeGreaterThan(box.H * 0.5) // ผนังหลังตั้งขึ้น
    for (const p of d.panels) {
      const v = to3D(p.outline[0]).applyMatrix4(M.get(p.id)!)
      expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)).toBe(true)
    }
  })

  it('ส่งออก DXF ได้ ไม่มี NaN', () => {
    const dxf = dielineDXFString(d)
    expect(dxf).toContain('SECTION')
    expect(dxf).not.toContain('NaN')
  })
})
