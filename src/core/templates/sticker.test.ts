import { describe, expect, it } from 'vitest'
import { computeMatrices, to3D } from '../fold'
import { getTemplate } from './index'
import { getMaterial } from '../materials'
import { dielineDXFString } from '../dxf'

// สติกเกอร์ไดคัท = แผ่นพิมพ์แบนชิ้นเดียว มุมมน ไม่มีรอยพับ
const mat = getMaterial('sticker-vinyl')
const tp = getTemplate('sticker')
const W = 60
const H = 40
const d = tp.generate({ W, D: 60, H, handle: false }, mat)
const M = computeMatrices(d.panels, 1)

describe('sticker: โครงสร้าง dieline', () => {
  it('ลงทะเบียนใน registry เป็นแผ่นเดียว ไม่พับ ไม่เอียง', () => {
    expect(tp.id).toBe('sticker')
    expect(tp.supportsHandle).toBe(false)
    expect(tp.tilt).toBe(0)
    expect(tp.foldDepth({ W, D: 60, H, handle: false }, mat)).toBe(0)
    expect(d.panels).toHaveLength(1)
    expect(d.panels[0].id).toBe('sticker')
  })

  it('ขนาดแผ่น = W×H ไม่มีรอยพับ', () => {
    expect(d.width).toBe(W)
    expect(d.height).toBe(H)
    expect(d.segments.filter((s) => s.kind === 'crease')).toHaveLength(0)
    expect(d.segments.filter((s) => s.kind === 'cut')).toHaveLength(1)
  })

  it('outline มุมมนอยู่ในกรอบ W×H และ finite', () => {
    const o = d.panels[0].outline
    expect(o.length).toBeGreaterThan(4) // มุมมน → มีจุดโค้ง มากกว่าสี่เหลี่ยม
    expect(o.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))).toBe(true)
    expect(Math.min(...o.map((q) => q.x))).toBeGreaterThanOrEqual(-1e-6)
    expect(Math.max(...o.map((q) => q.x))).toBeLessThanOrEqual(W + 1e-6)
    expect(Math.min(...o.map((q) => q.y))).toBeGreaterThanOrEqual(-1e-6)
    expect(Math.max(...o.map((q) => q.y))).toBeLessThanOrEqual(H + 1e-6)
  })

  it('พับแล้วยังแบนสนิท — ทุกจุดอยู่ระนาบ z=0', () => {
    const zs = d.panels[0].outline.map((q) => to3D(q).applyMatrix4(M.get('sticker')!).z)
    zs.forEach((z) => expect(Math.abs(z)).toBeLessThan(1e-6))
  })

  it('ส่งออก DXF ได้', () => {
    const dxf = dielineDXFString(d)
    expect(dxf).toContain('SECTION')
  })
})
