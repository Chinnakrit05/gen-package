import { describe, expect, it } from 'vitest'
import { computeMatrices, to3D } from '../fold'
import { getTemplate } from './index'
import { getMaterial } from '../materials'
import { dielineDXFString } from '../dxf'

// กล่องฝาข้าง/หน้าต่าง = ฐาน + หลัง + ซ้าย/ขวา + ฝาบน(คลุม) + ฝาหน้า(ปิด เจาะหน้าต่าง)
const mat = getMaterial('carton-300')
const tp = getTemplate('display-box')
const box = { W: 140, D: 90, H: 140, handle: false }
const d = tp.generate(box, mat)
const M = computeMatrices(d.panels, 1)

describe('display-box: โครงสร้างกล่องฝาข้าง/หน้าต่าง', () => {
  it('ลงทะเบียน + ครบ 6 แผง', () => {
    expect(tp.id).toBe('display-box')
    expect(d.panels.map((p) => p.id).sort()).toEqual(['back', 'base', 'door', 'left', 'right', 'top'])
  })

  it('ฝาหน้ามีรูหน้าต่าง (holes) อยู่ในกรอบฝา', () => {
    const door = d.panels.find((p) => p.id === 'door')!
    expect(door.holes).toBeTruthy()
    const win = door.holes![0]
    const dxs = door.outline.map((p) => p.x)
    const wxs = win.map((p) => p.x)
    expect(Math.min(...wxs)).toBeGreaterThan(Math.min(...dxs)) // หน้าต่างเว้นขอบในฝา
    expect(Math.max(...wxs)).toBeLessThan(Math.max(...dxs))
  })

  it('พับเต็ม: ฝาบนคลุมที่ความสูง H + ฝาหน้าพับขึ้นปิด (z ยกขึ้น)', () => {
    const top = d.panels.find((p) => p.id === 'top')!
    const topFar = to3D({ x: top.outline[0].x, y: Math.min(...top.outline.map((q) => q.y)) }).applyMatrix4(M.get('top')!)
    expect(topFar.z).toBeCloseTo(box.H, 0) // ฝาบนอยู่ระดับ H (คลุม)
    const door = d.panels.find((p) => p.id === 'door')!
    const doorTop = to3D({ x: door.outline[0].x, y: Math.max(...door.outline.map((q) => q.y)) }).applyMatrix4(M.get('door')!)
    expect(doorTop.z).toBeGreaterThan(box.H * 0.5) // ฝาหน้าตั้งปิด
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
