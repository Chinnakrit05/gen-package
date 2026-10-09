import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { computeMatrices, to3D } from '../fold'
import { getTemplate } from './index'
import { getMaterial } from '../materials'
import { dielineDXFString } from '../dxf'
import type { Vec2 } from '../types'

// FEFCO 0217 ทรงจั่ว: ฝาหน้า-หลังพับแบนที่ปาก, หูหิ้วสองชั้นตั้งกลาง, หน้าจั่วเอนเข้าให้หูมนโผล่ทะลุร่อง, ก้นล็อก
// ตรวจตำแหน่ง 3D จริงผ่าน computeMatrices แทนการดูภาพ (พิกัด: ผนังหน้าอยู่ z=0, ด้านในกล่อง = +z)
const mat = getMaterial('carton-300')
const t = mat.thickness
const layer = t + 0.05
const tp = getTemplate('fefco-0217')
const box = { W: 300, D: 150, H: 180, handle: false }
const Dp = box.D + 2 * t
const d = tp.generate(box, mat)
const M = computeMatrices(d.panels, 1)
const panel = (id: string) => d.panels.find((p) => p.id === id)!
const pts = (id: string): Vector3[] => panel(id).outline.map((q) => to3D(q).applyMatrix4(M.get(id)!))
const front = panel('front')
const rimY = -Math.min(...front.outline.map((p) => p.y))
const floorY = -Math.max(...front.outline.map((p) => p.y))

const inPoly = (pt: Vec2, poly: Vec2[]) => {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c
  }
  return c
}

describe('fefco-0217: โครงสร้าง dieline', () => {
  it('ผังซ้าย→ขวา: ข้าง | หน้า | ข้าง | หลัง | ปีกกาวขวาสุด', () => {
    const minX = (id: string) => Math.min(...panel(id).outline.map((p) => p.x))
    const order = ['side-left', 'front', 'side-right', 'back', 'glue'].map(minX)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('หน้าจั่วมีร่อง, หูหลังเจาะรูจับ, หูหน้ามีลิ้นดัน, หูหิ้วมีร่องบากสองมุม', () => {
    expect(panel('gable-left').holes).toHaveLength(1)
    expect(panel('gable-right').holes).toHaveLength(1)
    expect(panel('fin-back').holes).toHaveLength(1)
    expect(panel('grip-flap').parentId).toBe('fin-front')
    // ร่องบาก: ขอบบนหูหิ้วมีจุดต่ำกว่ายอด (ระหว่างหูมนกับแผงกลาง) ทั้งสองฝั่ง
    const fy = panel('fin-front').outline.map((p) => p.y)
    expect(fy.filter((y) => y > 1 && y < Math.max(...fy) - 1).length).toBeGreaterThan(4)
  })

  it('ความยาวฝา+หูหิ้ว ≈ ครึ่งความลึก + ความสูงหูหิ้ว (ตามแบบอ้างอิง)', () => {
    const lid = panel('lid-front').outline.map((p) => p.y)
    expect(Math.max(...lid) - Math.min(...lid)).toBeCloseTo(Dp / 2 - t - 0.01, 3)
  })

  it('ก้นล็อกครบ 4 ลิ้น และ DXF ไม่มี NaN', () => {
    for (const id of ['base-left', 'base-right', 'base-front', 'base-back']) expect(panel(id)).toBeTruthy()
    const dxf = dielineDXFString(d)
    expect(dxf).toContain('SECTION')
    expect(dxf).not.toContain('NaN')
  })
})

describe('fefco-0217: พับเต็ม', () => {
  it('ฝาหน้า-หลังวางแบนที่ระดับปาก ครอบครึ่งความลึกฝั่งตัวเอง', () => {
    for (const id of ['lid-front', 'lid-back']) {
      for (const v of pts(id)) expect(v.y).toBeCloseTo(rimY, 4)
    }
    expect(Math.max(...pts('lid-front').map((v) => v.z))).toBeCloseTo(Dp / 2 - t - 0.01, 3)
    expect(Math.min(...pts('lid-back').map((v) => v.z))).toBeCloseTo(Dp / 2 + t + 0.01, 3)
  })

  it('หูหิ้วสองแผ่นตั้งดิ่งกลางกล่อง แนบสนิท (ห่าง 2t)', () => {
    for (const id of ['fin-front', 'fin-back']) {
      const zs = pts(id).map((v) => v.z)
      expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(1e-6)
      expect(Math.min(...pts(id).map((v) => v.y))).toBeCloseTo(rimY, 4) // ตั้งจากระดับปาก
    }
    const zf = pts('fin-front')[0].z
    const zb = pts('fin-back')[0].z
    expect(zb - zf).toBeGreaterThanOrEqual(2 * t)
    expect(zb - zf).toBeLessThan(2 * t + 0.05)
    expect((zf + zb) / 2).toBeCloseTo(Dp / 2, 4)
  })

  it('หน้าจั่วเอนเข้า ยอดอยู่กลางความลึก สูงใกล้แต่ไม่เกินยอดหูหิ้ว', () => {
    const finTop = Math.max(...pts('fin-front').map((v) => v.y))
    for (const id of ['gable-left', 'gable-right']) {
      const apex = pts(id).reduce((m, v) => (v.y > m.y ? v : m))
      expect(apex.z).toBeCloseTo(Dp / 2, 0)
      expect(apex.y).toBeLessThan(finTop)
      expect(apex.y - rimY).toBeGreaterThan(0.85 * (finTop - rimY))
    }
    // เอนเข้า: ยอดอยู่ด้านในแนวผนังข้างของตัวเอง
    const wallX = (id: string) => pts(id)[0].x
    const apexX = (id: string) => pts(id).reduce((m, v) => (v.y > m.y ? v : m)).x
    const mid = (wallX('side-left') + wallX('side-right')) / 2
    for (const [g, s] of [['gable-left', 'side-left'], ['gable-right', 'side-right']]) {
      expect(Math.abs(apexX(g) - mid)).toBeLessThan(Math.abs(wallX(s) - mid) - 10)
    }
  })

  it('หูมนทั้งสี่มุมอยู่นอกหน้าจั่ว (โผล่ผ่านร่อง)', () => {
    // จุดของหูหิ้วที่อยู่ในแนวหูมน (ใกล้ปลาย x) ต้องอยู่ฝั่งนอกระนาบหน้าจั่ว (z ท้องถิ่น < 0)
    for (const gid of ['gable-left', 'gable-right']) {
      const inv = M.get(gid)!.clone().invert()
      for (const fid of ['fin-front', 'fin-back']) {
        const local = pts(fid).map((v) => v.clone().applyMatrix4(inv))
        // จุดนอกสุดฝั่งหน้าจั่วนี้ = ยอดหูมน
        const outer = local.reduce((m, v) => (v.z < m.z ? v : m))
        expect(outer.z).toBeLessThan(-5)
      }
    }
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

// ระหว่าง animation: ฝา/หูหิ้วข้ามเนื้อหน้าจั่วได้เฉพาะในช่องร่อง — ลองหลายวัสดุ/ขนาด
describe.each([
  ['carton-300', { W: 300, D: 150, H: 180 }],
  ['corrugated-e', { W: 300, D: 150, H: 180 }],
  ['corrugated-b', { W: 200, D: 100, H: 120 }],
  ['carton-300', { W: 120, D: 60, H: 90 }],
] as const)('fefco-0217 %s %o: ไม่ทะลุหน้าจั่วตลอดการพับ', (mid, size) => {
  it('หูหิ้ว/ฝาผ่านหน้าจั่วได้เฉพาะในร่อง', () => {
    const m = getMaterial(mid)
    const tt = m.thickness
    const dd = tp.generate({ ...size, handle: false }, m)
    const pn = (id: string) => dd.panels.find((p) => p.id === id)!
    let hits = 0
    for (let f = 0; f <= 1.0001; f += 0.005) {
      const Mf = computeMatrices(dd.panels, f)
      for (const gid of ['gable-left', 'gable-right']) {
        const gp = pn(gid)
        const inv = Mf.get(gid)!.clone().invert()
        for (const id of ['fin-front', 'fin-back', 'lid-front', 'lid-back']) {
          const ls = pn(id).outline.map((q) => {
            const l = to3D(q).applyMatrix4(Mf.get(id)!).applyMatrix4(inv)
            return { p: { x: l.x, y: -l.y }, z: l.z }
          })
          ls.forEach((a, i) => {
            const b = ls[(i + 1) % ls.length]
            // ข้ามเนื้อหน้าจั่ว (หนา t ไปทาง +z ท้องถิ่น): ปลายสองข้างอยู่คนละฝั่งของชั้นเนื้อ
            if (!((a.z < -0.05 && b.z > tt + 0.05) || (b.z < -0.05 && a.z > tt + 0.05))) return
            const u = (tt / 2 - a.z) / (b.z - a.z)
            const x = { x: a.p.x + (b.p.x - a.p.x) * u, y: a.p.y + (b.p.y - a.p.y) * u }
            if (inPoly(x, gp.outline) && !inPoly(x, gp.holes![0])) hits++
          })
        }
      }
    }
    expect(hits).toBe(0)
  })
})
