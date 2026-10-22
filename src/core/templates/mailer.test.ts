import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { computeMatrices, to3D } from '../fold'
import { getTemplate } from './index'
import { getMaterial } from '../materials'
import type { BoxParams, Vec2 } from '../types'

// กล่องไปรษณีย์ฝาพับ (≈FEFCO 0426): ปีกข้างฝาต้องเก็บ "ด้านใน" ผนังข้างเมื่อปิดสนิท — มองจากนอกไม่เห็น
// และไม่ชนลิ้นกันฝุ่น/ลิ้นหน้าที่แนบด้านในผนังหน้า-หลัง; มีรูหิ้ว → ปีกเจาะรูตรงกับรูผนัง
const tp = getTemplate('mailer')

const inPoly = (pt: Vec2, poly: Vec2[]) => {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c
  }
  return c
}

const cases: [string, Partial<BoxParams>][] = [
  ['corrugated-e', {}],
  ['carton-300', {}],
  ['corrugated-b', { W: 300, D: 200, H: 110, handle: true }],
  ['corrugated-e', { W: 120, D: 70, H: 30, handle: true }], // เล็กสุดที่ยังได้รูหิ้ว
]

describe.each(cases)('mailer / %s %j', (mid, over) => {
  const mat = getMaterial(mid)
  const t = mat.thickness
  const box = { ...tp.defaults, handle: false, ...over }
  const d = tp.generate(box, mat)
  const M = computeMatrices(d.panels, 1)
  const panel = (id: string) => d.panels.find((p) => p.id === id)!
  // ทั้งสองผิวของแผง (ผิวแผ่นคลี่ z=0 และผิวหนา t ที่ extrude ไปทาง +z ของแผง)
  const body = (id: string): Vector3[] =>
    panel(id).outline.flatMap((v) => [0, t].map((z) => to3D(v).add(new Vector3(0, 0, z)).applyMatrix4(M.get(id)!)))
  const base = panel('base').outline
  const cx0 = Math.min(...base.map((p) => p.x))
  const cx1 = Math.max(...base.map((p) => p.x))
  const yF = -Math.max(...base.map((p) => p.y))
  const yB = -Math.min(...base.map((p) => p.y))
  const Hp = box.H + t

  it.each([
    ['lip-left', 'side-left', cx0, 1],
    ['lip-right', 'side-right', cx1, -1],
  ] as const)('%s ห้อยลงด้านในผนังข้าง ไม่โผล่นอกกล่อง', (id, wall, plane, dir) => {
    const wallIn = Math.max(...body(wall).map((q) => (q.x - plane) * dir)) // ผิวในผนังข้าง
    expect(wallIn).toBeCloseTo(t, 3)
    for (const q of body(id)) {
      expect((q.x - plane) * dir).toBeGreaterThan(wallIn) // ด้านในผนัง
      expect((q.x - plane) * dir).toBeLessThan(wallIn + t + 1) // แนบผนัง
      expect(q.z).toBeGreaterThan(t)
      expect(q.z).toBeLessThan(Hp + 0.01)
    }
  })

  it('ปีกข้างฝาหลบลิ้นกันฝุ่นและลิ้นหน้า (ช่วงลึกไม่ทับกัน)', () => {
    const ys = (ids: string[]) => ids.flatMap((id) => body(id).map((q) => q.y))
    const front = Math.max(...ys(['dust-lf', 'dust-rf', 'lip']))
    const back = Math.min(...ys(['dust-lb', 'dust-rb']))
    expect(front).toBeGreaterThan(yF)
    expect(back).toBeLessThan(yB)
    for (const y of ys(['lip-left', 'lip-right'])) {
      expect(y).toBeGreaterThan(front)
      expect(y).toBeLessThan(back)
    }
  })

  it('ฝาวางบนผนังข้าง ไม่ทับเนื้อผนัง', () => {
    for (const q of body('lid')) {
      expect(q.x).toBeGreaterThan(cx0 + t)
      expect(q.x).toBeLessThan(cx1 - t)
      expect(q.z).toBeGreaterThan(Hp - t - 0.01)
      expect(q.z).toBeLessThan(Hp + 0.01)
    }
  })

  if (box.handle) {
    it.each([
      ['lip-left', 'side-left'],
      ['lip-right', 'side-right'],
    ] as const)('รูหิ้วของ %s อยู่ในเนื้อปีกและตรงกับรูผนัง', (id, wall) => {
      const flap = panel(id)
      expect(flap.holes).toHaveLength(1)
      const ring = flap.holes![0]
      for (const v of ring) expect(inPoly(v, flap.outline)).toBe(true)
      const c3 = (pid: string) => {
        const r = panel(pid).holes![0]
        const c = r.reduce((s, v) => ({ x: s.x + v.x / r.length, y: s.y + v.y / r.length }), { x: 0, y: 0 })
        return to3D(c).applyMatrix4(M.get(pid)!)
      }
      const a = c3(id)
      const b = c3(wall)
      expect(a.y).toBeCloseTo(b.y, 3)
      expect(a.z).toBeCloseTo(b.z, 3)
    })
  }
})
