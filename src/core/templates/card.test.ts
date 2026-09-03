import { describe, expect, it } from 'vitest'
import { computeMatrices, to3D } from '../fold'
import { getTemplate } from './index'
import { getMaterial } from '../materials'
import { dielineDXFString } from '../dxf'

// นามบัตรเป็นการ์ดแบน — ยืนยันว่าไม่มีการพับ (ทุกจุดอยู่ระนาบ z=0) และขนาด = W×H เป๊ะ
const mat = getMaterial('carton-300')
const tp = getTemplate('card')
const W = 90
const H = 54
const d = tp.generate({ W, D: 54, H, handle: false }, mat)
const M = computeMatrices(d.panels, 1)

describe('card: โครงสร้าง dieline', () => {
  it('ลงทะเบียนใน registry และมีแผงเดียว (การ์ดแบน)', () => {
    expect(tp.id).toBe('card')
    expect(tp.supportsHandle).toBe(false)
    expect(d.panels).toHaveLength(1)
  })

  it('ขนาดแผ่น = W×H ไม่บวกเผื่อความหนา (ไม่มีรอยพับ)', () => {
    expect(d.width).toBe(W)
    expect(d.height).toBe(H)
    expect(d.segments.filter((s) => s.kind === 'crease')).toHaveLength(0)
  })

  it('พับแล้วยังแบนสนิท — ทุกจุดอยู่ระนาบ z=0', () => {
    const p = d.panels[0]
    const zs = p.outline.map((q) => to3D(q).applyMatrix4(M.get(p.id)!).z)
    zs.forEach((z) => expect(Math.abs(z)).toBeLessThan(1e-6))
  })

  it('foldDepth = 0 และ tilt = 0 (การ์ดไม่พับ ไม่เอียง)', () => {
    expect(tp.foldDepth({ W, D: 54, H, handle: false }, mat)).toBe(0)
    expect(tp.tilt).toBe(0)
  })

  it('ส่งออก DXF ได้ (outline finite ทั้งหมด)', () => {
    const pts = d.panels.flatMap((p) => p.outline)
    expect(pts.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))).toBe(true)
    const dxf = dielineDXFString(d)
    expect(dxf).toContain('SECTION')
  })
})
