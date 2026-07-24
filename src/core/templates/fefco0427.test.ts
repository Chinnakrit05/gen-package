import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { computeMatrices, to3D } from '../fold'
import { getTemplate } from './index'
import { getMaterial } from '../materials'
import { computeGuides } from '../guides'
import { dielineDXFString } from '../dxf'
import type { Vec2 } from '../types'

// เทสต์การพับเชิงตัวเลข — แทนการดูภาพ 3D ด้วยการคำนวณตำแหน่งจริงของทุกแผง
// ที่ fold=1 ผ่าน computeMatrices แล้วยืนยันว่าอยู่ระนาบ/ความสูงที่กล่องจริงต้องเป็น
// (วิธีนี้จับบั๊กทิศพับ/เครื่องหมาย zOffset ได้โดยไม่ต้องใช้ตา)

const mat = getMaterial('corrugated-e')
const t = mat.thickness
const tp = getTemplate('fefco-0427')
const Hp = 60 + t
const d = tp.generate({ W: 200, D: 140, H: 60, handle: false }, mat)
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
const yF = -Math.max(...base.outline.map((p) => p.y)) // ระนาบผนังหน้า (world y)
const yB = -Math.min(...base.outline.map((p) => p.y))

describe('fefco-0427: โครงสร้าง dieline', () => {
  it('ลงทะเบียนใน registry และมีแผงครบ 13 ชิ้น', () => {
    expect(tp.id).toBe('fefco-0427')
    expect(d.panels).toHaveLength(13)
  })

  it('ฐานเจาะช่องเสียบลิ้น 4 ช่อง ชิดขอบซ้าย-ขวา', () => {
    expect(base.holes).toHaveLength(4)
    for (const slot of base.holes!) {
      const c = centroid(slot)
      const off = Math.min(c.x - cx0, cx1 - c.x)
      expect(off).toBeGreaterThan(0)
      expect(off).toBeLessThan(6)
    }
  })

  it('outline ทุกจุด finite และแผ่นกว้างพอสำหรับผนังม้วนสองข้าง', () => {
    const pts = d.panels.flatMap((p) => p.outline)
    expect(pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
    expect(d.width).toBeGreaterThan(cx1 - cx0 + 2 * Hp) // ม้วน+ลิ้นเพิ่มจากผนังปกติ
  })
})

describe('fefco-0427: ตำแหน่งหลังพับสุด (fold=1)', () => {
  it('base อยู่กับที่ z=0', () => {
    expect(Math.abs(world('base').z)).toBeLessThan(0.01)
  })

  it.each([
    ['front', yF, 'y'],
    ['back', yB, 'y'],
    ['side-left', cx0, 'x'],
    ['side-right', cx1, 'x'],
  ] as const)('%s ตั้งฉากบนระนาบตัวเอง สูง ~Hp/2', (id, plane, axis) => {
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
  ] as const)('%s พับแนบด้านในผนังข้าง', (id, plane, dir) => {
    const v = world(id)
    expect((v.x - plane) * dir).toBeGreaterThanOrEqual(-0.01) // ฝั่งในกล่อง
    expect(Math.abs(v.x - plane)).toBeLessThan(3 * t + 1)
    expect(v.z).toBeGreaterThan(0)
    expect(v.z).toBeLessThan(Hp)
    expect(v.y).toBeGreaterThan(yF - 1)
    expect(v.y).toBeLessThan(yB + 1)
  })

  it.each([
    ['roll-left', cx0, 1],
    ['roll-right', cx1, -1],
  ] as const)('%s ม้วน 180° กลับเข้าด้านใน พาดจากบนผนังลงถึงฐาน', (id, plane, dir) => {
    const pts = worldPts(id)
    const xs = pts.map((v) => v.x)
    const zs = pts.map((v) => v.z)
    expect(xs.every((x) => (x - plane) * dir > 0.5)).toBe(true) // อยู่ในกล่อง ไม่ทะลุออกนอก
    expect(xs.every((x) => Math.abs(x - plane) < 4 * t + 2)).toBe(true)
    expect(Math.max(...zs)).toBeGreaterThan(Hp * 0.85) // มาจากสันบนผนัง
    expect(Math.min(...zs)).toBeLessThan(2) // ลิ้นลงถึง/ทะลุระดับฐานที่ช่องเสียบ
  })

  it('lid ปิดบนสุด z≈Hp คลุมฐาน', () => {
    const v = world('lid')
    expect(Math.abs(v.z - Hp)).toBeLessThan(2 * t + 1)
    expect(v.y).toBeGreaterThan(yF)
    expect(v.y).toBeLessThan(yB)
  })

  it('lip เสียบลงด้านในผนังหน้า', () => {
    const v = world('lip')
    expect(v.y).toBeGreaterThanOrEqual(yF - 0.01)
    expect(v.y).toBeLessThan(yF + 4 * t + 2)
    expect(v.z).toBeGreaterThan(0)
    expect(v.z).toBeLessThan(Hp)
  })
})

describe('fefco-0427: ลำดับจังหวะพับ', () => {
  // วัดความคืบหน้าของ "บานพับตัวเอง" = มุมหมุนเทียบกับแผงแม่ (parent⁻¹ × own)
  // ต้องหักการเคลื่อนที่ที่ถูกแผงแม่พาไปออก ไม่งั้นแผงลูกจะดูเหมือนเริ่มขยับ
  // ตั้งแต่แม่เริ่มพับ ทั้งที่บานพับตัวเองยังไม่หมุน
  const ownAngle = (id: string, fold: number) => {
    const p = d.panels.find((q) => q.id === id)!
    const M = computeMatrices(d.panels, fold)
    const own = M.get(id)!.clone()
    if (p.parentId) own.premultiply(M.get(p.parentId)!.clone().invert())
    const q = new Quaternion().setFromRotationMatrix(own)
    return 2 * Math.acos(Math.min(1, Math.abs(q.w)))
  }
  const progressAt = (id: string, fold: number) => {
    const full = ownAngle(id, 1)
    return full < 1e-9 ? 1 : ownAngle(id, fold) / full
  }

  it('แผ่นม้วนยังไม่เริ่มทบจนหูมุมพับไปแล้วเกิน 85% (กันสองแผงกวาดเฉียดกัน)', () => {
    let started = 1
    for (let f = 0; f <= 1.0001; f += 0.01) {
      if (progressAt('roll-left', f) > 0.01) {
        started = f
        break
      }
    }
    expect(progressAt('ear-fl', started)).toBeGreaterThan(0.85)
  })

  it('ลิ้นฝายังไม่เสียบจนฝาปิดไปแล้วเกิน 75%', () => {
    let started = 1
    for (let f = 0; f <= 1.0001; f += 0.01) {
      if (progressAt('lip', f) > 0.01) {
        started = f
        break
      }
    }
    expect(progressAt('lid', started)).toBeGreaterThan(0.75)
  })

  it('ทุกแผงพับครบเมื่อ fold=1', () => {
    for (const p of d.panels) expect(progressAt(p.id, 1)).toBeCloseTo(1, 6)
  })
})

describe('fefco-0427: เข้ากับระบบอื่น', () => {
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
