import { describe, expect, it } from 'vitest'
import { computeMatrices, to3D } from '../fold'
import { getTemplate } from './index'
import { getMaterial } from '../materials'
import { dielineDXFString } from '../dxf'

// นามบัตรเป็นการ์ดแบนสองหน้า — ยืนยันมีหน้า+หลัง วางเรียงกัน ไม่มีการพับ (ทุกจุดอยู่ระนาบ z=0)
const mat = getMaterial('carton-300')
const tp = getTemplate('card')
const W = 90
const H = 54
const GAP = 10 // ระยะห่างหน้า-หลัง (ต้องตรงกับ card.ts)
const d = tp.generate({ W, D: 54, H, handle: false }, mat)
const M = computeMatrices(d.panels, 1)

describe('card: โครงสร้าง dieline', () => {
  it('ลงทะเบียนใน registry และมีสองหน้า (หน้า+หลัง)', () => {
    expect(tp.id).toBe('card')
    expect(tp.supportsHandle).toBe(false)
    expect(d.panels).toHaveLength(2)
    expect(d.panels.map((p) => p.id)).toEqual(['card', 'card-back'])
  })

  it('หน้าหลังวางเรียงกัน + มีป้ายกำกับหน้า/หลัง', () => {
    const front = d.panels[0].outline
    const back = d.panels[1].outline
    expect(Math.min(...front.map((q) => q.x))).toBe(0)
    expect(Math.min(...back.map((q) => q.x))).toBe(W + GAP) // หลังเริ่มหลังเว้นช่อง
    expect(d.captions).toHaveLength(2)
  })

  it('ขนาดแผ่น = (2W+GAP)×H ไม่มีรอยพับ', () => {
    expect(d.width).toBe(2 * W + GAP)
    expect(d.height).toBe(H)
    expect(d.segments.filter((s) => s.kind === 'crease')).toHaveLength(0)
  })

  it('พับแล้วยังแบนสนิท — ทุกจุดของทุกหน้าอยู่ระนาบ z=0', () => {
    for (const p of d.panels) {
      const zs = p.outline.map((q) => to3D(q).applyMatrix4(M.get(p.id)!).z)
      zs.forEach((z) => expect(Math.abs(z)).toBeLessThan(1e-6))
    }
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
