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

describe('tray: โครงสร้าง dieline (roll end tray)', () => {
  it('ลงทะเบียนใน registry และมีแผงครบ 13 ชิ้น (ฐาน+4 ผนัง+4 หูมุม+สัน 2+ชั้นทบ 2)', () => {
    expect(tp.id).toBe('tray')
    expect(d.panels).toHaveLength(13)
    expect(d.panels.filter((p) => p.id.startsWith('ear-'))).toHaveLength(4)
    for (const id of ['spine-left', 'spine-right', 'roll-left', 'roll-right']) {
      expect(d.panels.some((p) => p.id === id)).toBe(true)
    }
  })

  it('ถาดเปิดบน (ไม่มีฝา/ปีก/ลิ้นเสียบ) ผนังหน้า-หลังสูงเท่ากัน และฐานเจาะช่องล็อก 4 ช่อง', () => {
    const pts = d.panels.flatMap((p) => p.outline)
    expect(pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
    expect(d.panels.some((p) => p.id === 'lid' || p.id === 'lip' || p.id.startsWith('lid-flap'))).toBe(false)
    const h = (id: string) => {
      const ys = d.panels.find((p) => p.id === id)!.outline.map((q) => q.y)
      return Math.max(...ys) - Math.min(...ys)
    }
    expect(h('front')).toBeCloseTo(h('back'), 6)
    expect(base.holes).toHaveLength(4)
    expect(Math.min(...pts.map((q) => q.y))).toBeCloseTo(0, 6) // ผนังหลังชิดขอบบนแผ่น
  })
})

describe('tray: ตำแหน่งหลังพับสุด (fold=1)', () => {
  it('ฐานอยู่กับที่ z=0', () => {
    expect(Math.abs(world('base').z)).toBeLessThan(0.01)
  })

  it.each([
    ['front', yF, 'y'],
    ['back', yB, 'y'],
    ['side-left', cx0, 'x'],
    ['side-right', cx1, 'x'],
  ] as const)('ผนัง %s ตั้งฉากบนระนาบตัวเอง สูง ~Hp/2', (id, plane, axis) => {
    const v = world(id)
    expect(Math.abs((axis === 'x' ? v.x : v.y) - plane)).toBeLessThan(0.5)
    expect(v.z).toBeGreaterThan(Hp * 0.3)
    expect(v.z).toBeLessThan(Hp * 0.7)
  })

  it.each([
    ['ear-fl', cx0, 1],
    ['ear-bl', cx0, 1],
    ['ear-fr', cx1, -1],
    ['ear-br', cx1, -1],
  ] as const)('หูมุม %s พับแนบด้านในผนังข้าง ทุกมุมอยู่ในกล่อง', (id, plane, dir) => {
    for (const v of worldPts(id)) {
      expect((v.x - plane) * dir).toBeGreaterThanOrEqual(-0.01)
      expect(Math.abs(v.x - plane)).toBeLessThan(3 * t + 1)
      expect(v.y).toBeGreaterThan(yF - 1)
      expect(v.y).toBeLessThan(yB + 1)
      expect(v.z).toBeGreaterThan(-1)
      expect(v.z).toBeLessThan(Hp + 1)
    }
  })

  it.each([
    ['roll-left', cx0, 1],
    ['roll-right', cx1, -1],
  ] as const)('%s ทบลงด้านในทับหูมุม พาดจากบนผนังลงถึงฐาน', (id, plane, dir) => {
    const pts = worldPts(id)
    expect(pts.every((v) => (v.x - plane) * dir > 0.5)).toBe(true)
    expect(pts.every((v) => Math.abs(v.x - plane) < 4 * t + 2)).toBe(true)
    expect(Math.max(...pts.map((v) => v.z))).toBeGreaterThan(Hp * 0.85)
    expect(Math.min(...pts.map((v) => v.z))).toBeLessThan(2)
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
