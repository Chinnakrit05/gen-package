import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { computeMatrices, to3D } from '../fold'
import { getTemplate } from './index'
import { getMaterial } from '../materials'
import { computeGuides } from '../guides'
import { dielineDXFString } from '../dxf'
import type { Vec2 } from '../types'

// เทสต์การพับเชิงตัวเลข: ที่ fold=1 ผนังต้องตั้งฉาก ลิ้นมุมต้องพับเข้าด้านในกล่อง (ไม่ทะลุ/ไม่ลอย)
const mat = getMaterial('carton-300')
const t = mat.thickness
const tp = getTemplate('tray')
const Hp = 40 + t
const d = tp.generate({ W: 160, D: 110, H: 40, handle: false }, mat)
const M = computeMatrices(d.panels, 1)

const centroid = (pts: Vec2[]) => {
  const c = pts.reduce((s, p) => ({ x: s.x + p.x, y: s.y + p.y }), { x: 0, y: 0 })
  return { x: c.x / pts.length, y: c.y / pts.length }
}
const world = (id: string): Vector3 => {
  const p = d.panels.find((q) => q.id === id)!
  return to3D(centroid(p.outline)).applyMatrix4(M.get(id)!)
}
const worldPts = (id: string): Vector3[] => {
  const p = d.panels.find((q) => q.id === id)!
  return p.outline.map((q) => to3D(q).applyMatrix4(M.get(id)!))
}

const base = d.panels.find((p) => p.id === 'base')!
const cx0 = Math.min(...base.outline.map((p) => p.x))
const cx1 = Math.max(...base.outline.map((p) => p.x))
const yF = -Math.max(...base.outline.map((p) => p.y)) // ผนังหน้า (world y)
const yB = -Math.min(...base.outline.map((p) => p.y)) // ผนังหลัง

describe('tray: โครงสร้าง dieline', () => {
  it('ลงทะเบียนใน registry และมีแผงครบ 9 ชิ้น (ฐาน+4 ผนัง+4 ลิ้นมุม)', () => {
    expect(tp.id).toBe('tray')
    expect(d.panels).toHaveLength(9)
    expect(d.panels.filter((p) => p.id.startsWith('tab-'))).toHaveLength(4)
  })

  it('outline ทุกจุด finite และเป็นถาดเปิดบน (ไม่มีฝา/ลิ้นเสียบ)', () => {
    const pts = d.panels.flatMap((p) => p.outline)
    expect(pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
    expect(d.panels.some((p) => p.id === 'lid' || p.id === 'lip')).toBe(false)
  })
})

describe('tray: ตำแหน่งหลังพับสุด (fold=1)', () => {
  it('ฐานอยู่กับที่ z=0', () => {
    expect(Math.abs(world('base').z)).toBeLessThan(0.01)
  })

  it.each([
    ['front', yF, 'y'],
    ['back', yB, 'y'],
    ['left', cx0, 'x'],
    ['right', cx1, 'x'],
  ] as const)('ผนัง %s ตั้งฉากบนระนาบตัวเอง สูง ~Hp/2', (id, plane, axis) => {
    const v = world(id)
    expect(Math.abs((axis === 'x' ? v.x : v.y) - plane)).toBeLessThan(0.5)
    expect(v.z).toBeGreaterThan(Hp * 0.3)
    expect(v.z).toBeLessThan(Hp * 0.7)
  })

  it.each([
    ['tab-lb', 'y', yB],
    ['tab-lf', 'y', yF],
    ['tab-rb', 'y', yB],
    ['tab-rf', 'y', yF],
  ] as const)('ลิ้นมุม %s พับเข้าแนบผนัง (ทุกจุดอยู่ในกล่อง ไม่ทะลุ/ไม่ลอยเหนือขอบ)', (id, _axis, plane) => {
    const pts = worldPts(id)
    // ทุกมุมอยู่ในกรอบกล่อง x∈[cx0,cx1], y∈[yF,yB], z∈[0,Hp]
    for (const v of pts) {
      expect(v.x).toBeGreaterThan(cx0 - 1)
      expect(v.x).toBeLessThan(cx1 + 1)
      expect(v.y).toBeGreaterThan(yF - 1)
      expect(v.y).toBeLessThan(yB + 1)
      expect(v.z).toBeGreaterThan(-1)
      expect(v.z).toBeLessThan(Hp + 1)
    }
    // แนบผนังหน้า/หลัง: กึ่งกลางลิ้นอยู่ใกล้ระนาบผนังนั้น (พับเข้าด้านในเล็กน้อย)
    const c = world(id)
    expect(Math.abs(c.y - plane)).toBeLessThan(4 * t + 1)
  })
})

describe('tray: เข้ากับระบบอื่น', () => {
  it('guides คำนวณได้', () => {
    const g = computeGuides(d.panels)
    expect(g.safe.length).toBeGreaterThanOrEqual(5)
    expect(g.bleed.length).toBeGreaterThan(0)
  })

  it('DXF สร้างได้ไม่มี NaN', () => {
    const dxf = dielineDXFString(d)
    expect(dxf).toContain('EOF')
    expect(dxf).not.toContain('NaN')
  })
})
