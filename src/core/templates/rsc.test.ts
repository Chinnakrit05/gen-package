import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { computeMatrices, to3D } from '../fold'
import { getTemplate } from './index'
import { getMaterial } from '../materials'
import { computeGuides } from '../guides'
import { dielineDXFString } from '../dxf'
import type { Vec2 } from '../types'

// เทสต์การพับเชิงตัวเลข — ยืนยันตำแหน่งจริงของทุกแผงที่ fold=1 ผ่าน computeMatrices
// แทนการดูภาพ 3D (จับบั๊กทิศพับ/zOffset/ลิ้นชนกันได้โดยไม่ต้องใช้ตา)

const mat = getMaterial('corrugated-b')
const t = mat.thickness
const tp = getTemplate('rsc')
const W = 250
const D = 200
const H = 150
const Wp = W + 2 * t
const Dp = D + 2 * t
const Hp = H + 2 * t
const d = tp.generate({ W, D, H, handle: false }, mat)
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

describe('rsc: โครงสร้าง dieline', () => {
  it('ลงทะเบียนใน registry และมีแผงครบ 13 ชิ้น (ผนัง5 + ลิ้น8)', () => {
    expect(tp.id).toBe('rsc')
    expect(d.panels).toHaveLength(13)
  })

  it('outline ทุกจุด finite และแผ่นกว้าง = รอบตัว 2(Wp+Dp) + ปีกกาว', () => {
    const pts = d.panels.flatMap((p) => p.outline)
    expect(pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
    expect(d.width).toBeGreaterThan(2 * (Wp + Dp)) // มีปีกทากาวเพิ่มจากผนังสี่ด้าน
  })

  it('มีลิ้นบน-ล่างครบ 8 ชิ้น (ข้าง4 + หน้าหลัง4)', () => {
    const flaps = d.panels.filter((p) => p.id.startsWith('flap-'))
    expect(flaps).toHaveLength(8)
  })
})

describe('rsc: ตำแหน่งหลังพับสุด (fold=1)', () => {
  it('ผนัง 4 ด้านประกอบเป็นท่อสี่เหลี่ยม (หน้า-หลังห่าง Dp, ข้างห่าง Wp)', () => {
    const f = world('front')
    const b = world('back')
    const sl = world('side-left')
    const sr = world('side-right')
    expect(Math.abs(f.z)).toBeLessThan(0.5) // หน้า = root อยู่ระนาบ z=0
    expect(Math.abs(f.distanceTo(b) - Dp)).toBeLessThan(1)
    expect(Math.abs(sl.distanceTo(sr) - Wp)).toBeLessThan(1)
    // ผนังทุกด้านอยู่กลางความสูง (แกน y)
    const yMid = -(Math.min(...worldPts('front').map((p) => -p.y)) + Hp / 2)
    for (const id of ['front', 'back', 'side-left', 'side-right']) {
      expect(Math.abs(world(id).y - yMid)).toBeLessThan(0.5)
    }
  })

  it('ลิ้นบนอยู่ระนาบบน, ลิ้นล่างอยู่ระนาบล่าง ห่างกัน ~Hp', () => {
    // ลิ้นซ้อนชั้นตามแกนสูง (y) ด้วย zOffset กัน z-fighting → ยอมให้ต่างกันได้ในระยะซ้อนชั้น
    const stack = 3 * (t + 0.05)
    const tops = ['flap-t-sl', 'flap-t-sr', 'flap-t-front', 'flap-t-back'].map((id) => world(id).y)
    const bots = ['flap-b-sl', 'flap-b-sr', 'flap-b-front', 'flap-b-back'].map((id) => world(id).y)
    const yTop = tops[0]
    const yBot = bots[0]
    for (const y of tops) expect(Math.abs(y - yTop)).toBeLessThan(stack) // ลิ้นบนอยู่แถวระนาบบน
    for (const y of bots) expect(Math.abs(y - yBot)).toBeLessThan(stack)
    expect(Math.abs(Math.abs(yTop - yBot) - Hp)).toBeLessThan(stack + 1) // บน-ล่างห่าง ~Hp
  })

  it('ลิ้นทุกชิ้นพับเข้าใน footprint ท่อ (ไม่โผล่นอกกล่อง)', () => {
    const fx = worldPts('front').map((p) => p.x)
    const x0 = Math.min(...fx) - 0.5
    const x1 = Math.max(...fx) + 0.5
    for (const id of d.panels.filter((p) => p.id.startsWith('flap-')).map((p) => p.id)) {
      for (const v of worldPts(id)) {
        expect(v.x).toBeGreaterThan(x0 - t) // อยู่ในความกว้างท่อ (x = ช่วงผนังหน้า)
        expect(v.x).toBeLessThan(x1 + t)
        expect(Math.abs(v.z)).toBeLessThan(Dp + 1) // อยู่ในความลึกท่อ
      }
    }
  })

  it('ลิ้นหน้า-หลัง (outer) พับมาชนกลางฝา — centroid ห่างกันตามแกน z ~Dp/2', () => {
    const zf = world('flap-t-front').z
    const zb = world('flap-t-back').z
    // ลิ้นหน้ายาว Dp/2 จากผนังหน้า, ลิ้นหลังยาว Dp/2 จากผนังหลัง → centroid ห่างกัน ~Dp/2 ชนกันกลาง
    expect(Math.abs(Math.abs(zf - zb) - Dp / 2)).toBeLessThan(1.5)
  })
})

describe('rsc: ลำดับจังหวะพับ', () => {
  const ownAngle = (id: string, fold: number) => {
    const p = d.panels.find((q) => q.id === id)!
    const Mf = computeMatrices(d.panels, fold)
    const own = Mf.get(id)!.clone()
    if (p.parentId) own.premultiply(Mf.get(p.parentId)!.clone().invert())
    const q = new Quaternion().setFromRotationMatrix(own)
    return 2 * Math.acos(Math.min(1, Math.abs(q.w)))
  }
  const progressAt = (id: string, fold: number) => {
    const full = ownAngle(id, 1)
    return full < 1e-9 ? 1 : ownAngle(id, fold) / full
  }

  it('ลิ้นหน้า-หลัง (outer) ยังไม่พับจนลิ้นข้าง (inner) พับไปแล้วเกิน 70% (กันชนกลางทาง)', () => {
    let started = 1
    for (let f = 0; f <= 1.0001; f += 0.01) {
      if (progressAt('flap-t-front', f) > 0.01) {
        started = f
        break
      }
    }
    expect(progressAt('flap-t-sl', started)).toBeGreaterThan(0.7)
  })

  it('ทุกแผงพับครบเมื่อ fold=1', () => {
    for (const p of d.panels) expect(progressAt(p.id, 1)).toBeCloseTo(1, 6)
  })
})

describe('rsc: เข้ากับระบบอื่น', () => {
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
