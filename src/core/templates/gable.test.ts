import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { computeMatrices, to3D } from '../fold'
import { getTemplate } from './index'
import { getMaterial } from '../materials'
import { computeGuides } from '../guides'
import { dielineDXFString } from '../dxf'
import type { Vec2 } from '../types'

// เทสต์การพับเชิงตัวเลข: ยืนยันว่าผนัง 4 ด้านตั้งฉาก และแผงจั่วสองด้านเอียงมาชนกันที่สัน
const mat = getMaterial('carton-300')
const t = mat.thickness
const tp = getTemplate('gable')
const Hp = 150 + t
const d = tp.generate({ W: 120, D: 100, H: 150 }, mat)
const M = computeMatrices(d.panels, 1)

const centroid = (pts: Vec2[]) => {
  const c = pts.reduce((s, p) => ({ x: s.x + p.x, y: s.y + p.y }), { x: 0, y: 0 })
  return { x: c.x / pts.length, y: c.y / pts.length }
}
const world = (id: string): Vector3 => {
  const p = d.panels.find((q) => q.id === id)!
  return to3D(centroid(p.outline)).applyMatrix4(M.get(id)!)
}
const worldPt = (id: string, p: Vec2): Vector3 => to3D(p).applyMatrix4(M.get(id)!)

const base = d.panels.find((p) => p.id === 'base')!
const cx0 = Math.min(...base.outline.map((p) => p.x))
const cx1 = Math.max(...base.outline.map((p) => p.x))
const by0 = Math.min(...base.outline.map((p) => p.y))
const by1 = Math.max(...base.outline.map((p) => p.y))
const centerX = (cx0 + cx1) / 2
const centerYworld = -(by0 + by1) / 2
const gback = d.panels.find((p) => p.id === 'gable-back')!
const gfront = d.panels.find((p) => p.id === 'gable-front')!
// ขอบสันของแต่ละแผงจั่ว = ขอบที่ไกลจาก hinge สุด (y เล็กสุดของจั่วหลัง, y ใหญ่สุดของจั่วหน้า)
const ridgeBack = { x: centerX, y: Math.min(...gback.outline.map((p) => p.y)) }
const ridgeFront = { x: centerX, y: Math.max(...gfront.outline.map((p) => p.y)) }

describe('gable: โครงสร้าง dieline', () => {
  it('ลงทะเบียนใน registry + มีแผงครบ (ฐาน+4ผนัง+4ลิ้น+2จั่ว = 11)', () => {
    expect(tp.id).toBe('gable')
    expect(d.panels).toHaveLength(11)
  })
  it('แผงจั่วทั้งสองมีรูหิ้ว', () => {
    expect(gback.holes).toHaveLength(1)
    expect(gfront.holes).toHaveLength(1)
  })
  it('outline ทุกจุด finite', () => {
    const pts = d.panels.flatMap((p) => p.outline)
    expect(pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
  })
})

describe('gable: ตำแหน่งหลังพับสุด (fold=1)', () => {
  it('base อยู่กับที่ z=0', () => {
    expect(Math.abs(world('base').z)).toBeLessThan(0.01)
  })

  it.each([
    ['back', 'y', -by0],
    ['front', 'y', -by1],
    ['left', 'x', cx0],
    ['right', 'x', cx1],
  ] as const)('ผนัง %s ตั้งฉาก สูง ~Hp/2', (id, axis, plane) => {
    const v = world(id)
    expect(Math.abs((axis === 'x' ? v.x : v.y) - plane)).toBeLessThan(0.5)
    expect(v.z).toBeGreaterThan(Hp * 0.3)
    expect(v.z).toBeLessThan(Hp * 0.7)
  })

  it('ยอดจั่วสองด้านมาชนกันที่สัน (จุดเดียวกัน)', () => {
    const a = worldPt('gable-back', ridgeBack)
    const b = worldPt('gable-front', ridgeFront)
    expect(a.distanceTo(b)).toBeLessThan(2)
  })

  it('สันอยู่เหนือผนัง (z > Hp) เหนือกึ่งกลางฐาน', () => {
    const a = worldPt('gable-back', ridgeBack)
    expect(a.z).toBeGreaterThan(Hp)
    expect(Math.abs(a.x - centerX)).toBeLessThan(1)
    expect(Math.abs(a.y - centerYworld)).toBeLessThan(2)
  })

  it('รูหิ้วสองแผงอยู่สูงใกล้ยอด สมมาตรรอบสัน (หูหิ้วแบบบีบสองช่อง)', () => {
    const hb = worldPt('gable-back', centroid(gback.holes![0]))
    const hf = worldPt('gable-front', centroid(gfront.holes![0]))
    // อยู่บนหลังคาใกล้ยอดทั้งคู่
    expect(hb.z).toBeGreaterThan(Hp * 0.8)
    expect(hf.z).toBeGreaterThan(Hp * 0.8)
    // สมมาตรรอบกึ่งกลาง (จุดกึ่งกลางระหว่างสองรูอยู่เหนือกลางฐาน)
    const mid = hb.clone().add(hf).multiplyScalar(0.5)
    expect(Math.abs(mid.x - centerX)).toBeLessThan(1)
    expect(Math.abs(mid.y - centerYworld)).toBeLessThan(2)
  })
})

describe('gable: เข้ากับระบบอื่น', () => {
  it('guides คำนวณได้', () => {
    const g = computeGuides(d.panels)
    expect(g.safe.length).toBeGreaterThanOrEqual(5)
  })
  it('DXF สร้างได้ไม่มี NaN', () => {
    const dxf = dielineDXFString(d)
    expect(dxf).toContain('EOF')
    expect(dxf).not.toContain('NaN')
  })
})
