import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { computeMatrices, to3D } from '../fold'
import { getTemplate } from './index'
import { getMaterial } from '../materials'
import { dielineDXFString } from '../dxf'
import type { Vec2 } from '../types'

// FEFCO 0217 ทรงจั่ว: ผนังข้างยื่นเป็นหน้าจั่ว, หลังคาหน้า-หลังเอียงมาชนสันแล้วตั้งเป็นหูหิ้วสองชั้น, ก้นล็อก
// ตรวจตำแหน่ง 3D จริงที่ fold=1 แทนการดูภาพ (พิกัด: ผนังหน้าอยู่ z=0, ด้านในกล่อง = +z)
const mat = getMaterial('carton-300')
const t = mat.thickness
const layer = t + 0.05
const tp = getTemplate('fefco-0217')
const box = { W: 300, D: 150, H: 180, handle: false }
const Dp = box.D + 2 * t
const Hp = box.H + 2 * t
const d = tp.generate(box, mat)
const M = computeMatrices(d.panels, 1)
const panel = (id: string) => d.panels.find((p) => p.id === id)!
const pts = (id: string): Vector3[] => panel(id).outline.map((q) => to3D(q).applyMatrix4(M.get(id)!))
const front = panel('front')
const rimY = -Math.min(...front.outline.map((p) => p.y))
const floorY = -Math.max(...front.outline.map((p) => p.y))

describe('fefco-0217: โครงสร้าง dieline', () => {
  it('ผังซ้าย→ขวา: ข้าง | หน้า | ข้าง | หลัง | ปีกกาวขวาสุด', () => {
    const minX = (id: string) => Math.min(...panel(id).outline.map((p) => p.x))
    const order = ['side-left', 'front', 'side-right', 'back', 'glue'].map(minX)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('หน้าจั่วมีร่องล็อก, หูหลังเจาะรูจับ, หูหน้ามีลิ้นดัน, มีหูมนสี่มุม', () => {
    expect(panel('gable-left').holes).toHaveLength(1)
    expect(panel('gable-right').holes).toHaveLength(1)
    expect(panel('fin-back').holes).toHaveLength(1)
    expect(panel('grip-flap').parentId).toBe('fin-front')
    // หูมน: ยอดหูหิ้วมีจุดต่ำกว่าแนวยอด (ร่องบาก) ทั้งสองฝั่ง
    const fy = panel('fin-front').outline.map((p) => p.y)
    expect(fy.filter((y) => y > 1 && y < Math.max(...fy) - 1).length).toBeGreaterThan(4)
  })

  it('ก้นล็อกครบ 4 ลิ้น และ DXF ไม่มี NaN', () => {
    for (const id of ['base-left', 'base-right', 'base-front', 'base-back']) expect(panel(id)).toBeTruthy()
    const dxf = dielineDXFString(d)
    expect(dxf).toContain('SECTION')
    expect(dxf).not.toContain('NaN')
  })
})

describe('fefco-0217: พับเต็ม', () => {
  it('ยอดหน้าจั่วอยู่กลางความลึก สูงเหนือสัน แต่ไม่เกินยอดหูหิ้ว', () => {
    const apex = pts('gable-left').reduce((m, v) => (v.y > m.y ? v : m))
    expect(apex.z).toBeCloseTo(Dp / 2, 0)
    const finTop = Math.max(...pts('fin-front').map((v) => v.y))
    const ridge = Math.min(...pts('fin-front').map((v) => v.y))
    expect(apex.y).toBeGreaterThan(ridge + 10)
    expect(apex.y).toBeLessThan(finTop)
    expect(ridge).toBeGreaterThan(rimY)
  })

  it('หูมนโผล่นอกหน้าจั่วทั้งสองข้าง (หูหิ้วยาวกว่าตัวกล่อง)', () => {
    const xl = pts('gable-left')[0].x // หน้าจั่วตั้งดิ่ง: x คงที่ทั้งแผง
    const xr = pts('gable-right')[0].x
    const [lo, hi] = [Math.min(xl, xr), Math.max(xl, xr)]
    for (const id of ['fin-front', 'fin-back']) {
      const xs = pts(id).map((v) => v.x)
      expect(Math.min(...xs)).toBeLessThan(lo - 5)
      expect(Math.max(...xs)).toBeGreaterThan(hi + 5)
    }
  })

  // ระหว่าง animation: ขอบหูหิ้ว/หลังคาข้ามเนื้อหน้าจั่วได้เฉพาะในช่องร่อง
  it('หูหิ้วไม่ทะลุเนื้อหน้าจั่วตลอดการพับ (ผ่านได้เฉพาะร่อง)', () => {
    const inPoly = (pt: Vec2, poly: Vec2[]) => {
      let c = false
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i]
        const b = poly[j]
        if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c
      }
      return c
    }
    let hits = 0
    for (let f = 0; f <= 1.0001; f += 0.005) {
      const Mf = computeMatrices(d.panels, f)
      for (const gid of ['gable-left', 'gable-right']) {
        const gp = panel(gid)
        const inv = Mf.get(gid)!.clone().invert()
        for (const id of ['fin-front', 'fin-back', 'roof-front', 'roof-back']) {
          const ls = panel(id).outline.map((q) => {
            const l = to3D(q).applyMatrix4(Mf.get(id)!).applyMatrix4(inv)
            return { p: { x: l.x, y: -l.y }, z: l.z }
          })
          ls.forEach((a, i) => {
            const b = ls[(i + 1) % ls.length]
            // ข้ามเนื้อหน้าจั่ว (หนา t ไปทาง +z ท้องถิ่น): ปลายสองข้างอยู่คนละฝั่งของชั้นเนื้อ
            if (!((a.z < -0.05 && b.z > t + 0.05) || (b.z < -0.05 && a.z > t + 0.05))) return
            const u = (t / 2 - a.z) / (b.z - a.z)
            const x = { x: a.p.x + (b.p.x - a.p.x) * u, y: a.p.y + (b.p.y - a.p.y) * u }
            if (inPoly(x, gp.outline) && !inPoly(x, gp.holes![0])) hits++
          })
        }
      }
    }
    expect(hits).toBe(0)
  })

  it('หลังคาสองแผงมาชนสันใต้ยอดจั่ว และหูหิ้วตั้งดิ่งแนบกันกลางกล่อง', () => {
    for (const id of ['fin-front', 'fin-back']) {
      const zs = pts(id).map((v) => v.z)
      expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(1e-6) // ตั้งดิ่ง (ระนาบ z คงที่)
      expect(Math.min(...pts(id).map((v) => v.y))).toBeGreaterThan(rimY) // อยู่เหนือปากกล่อง
    }
    const zf = pts('fin-front')[0].z
    const zb = pts('fin-back')[0].z
    // หูหิ้วสองแผ่นหนา t ชี้เข้าหากัน: ระยะระนาบ = 2t (+เศษ) → ผิวในแนบสนิท ไม่ทับเนื้อและไม่มีช่อง
    expect(zb - zf).toBeGreaterThanOrEqual(2 * t)
    expect(zb - zf).toBeLessThan(2 * t + 0.05)
    expect((zf + zb) / 2).toBeCloseTo(Dp / 2, 4)
  })

  it('ลิ้นก้นทุกชิ้นวางราบที่พื้นกล่อง (ภายในระยะซ้อนชั้น)', () => {
    for (const id of ['base-left', 'base-right', 'base-front', 'base-back']) {
      for (const v of pts(id)) {
        expect(v.y - floorY).toBeGreaterThan(-0.01)
        expect(v.y - floorY).toBeLessThan(4 * layer)
        expect(v.z).toBeGreaterThan(-0.01)
        expect(v.z).toBeLessThan(Dp + 0.01)
      }
    }
    expect(Hp).toBeGreaterThan(0)
  })

  it('ลิ้นดันหูหน้าทะลุไปหลังแผ่นหูหลัง', () => {
    const zb = pts('fin-back')[0].z
    expect(Math.max(...pts('grip-flap').map((v) => v.z))).toBeGreaterThan(zb + 5)
  })

  it('matrices finite ทุกแผง', () => {
    for (const p of d.panels) {
      const v = to3D(p.outline[0]).applyMatrix4(M.get(p.id)!)
      expect(Number.isFinite(v.x + v.y + v.z)).toBe(true)
    }
  })
})
