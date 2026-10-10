import { describe, expect, it } from 'vitest'
import type { Vector3 } from 'three'
import { computeMatrices, to3D, rollBeads } from '../fold'
import { getTemplate } from './index'
import { getMaterial } from '../materials'
import { computeGuides } from '../guides'
import { dielineDXFString } from '../dxf'

// Rollover mailer = โครง roll end เดียวกับ FEFCO 0427 (หูมุม + ผนังทบรอยพับคู่ + ลิ้นล็อกช่องฐาน)
// ต่างที่ปีกข้างฝายาวเกือบเต็มฝา มุมฝั่งลิ้นหน้ามน และผังวางฝาไว้บน (ไม่หมุน)
const mat = getMaterial('carton-300')
const t = mat.thickness
const tp = getTemplate('rollover-mailer')
const box = { W: 220, D: 150, H: 70, handle: false }
const Hp = box.H + t
const Dp = box.D + 2 * t
const sp = 3 * t + 0.2
const d = tp.generate(box, mat)
const M = computeMatrices(d.panels, 1)

const pts = (id: string): Vector3[] => {
  const p = d.panels.find((q) => q.id === id)!
  return p.outline.map((v) => to3D(v).applyMatrix4(M.get(id)!))
}
const base = d.panels.find((p) => p.id === 'base')!
const cx0 = Math.min(...base.outline.map((p) => p.x))
const cx1 = Math.max(...base.outline.map((p) => p.x))
const yF = -Math.max(...base.outline.map((p) => p.y))
const yB = -Math.min(...base.outline.map((p) => p.y))

describe('rollover-mailer: โครงสร้าง dieline', () => {
  it('ลงทะเบียน + แผงครบ 19 ชิ้น (หูมุม 4, สัน+ชั้นทบ 4, ฝา+ปีกข้าง 2+แผงหน้าคลุม+หูแผงหน้า 2)', () => {
    expect(tp.id).toBe('rollover-mailer')
    expect(d.panels).toHaveLength(19)
    for (const id of ['ear-fl', 'ear-br', 'spine-left', 'roll-right', 'lid', 'lid-flap-left', 'lid-flap-right', 'lip', 'lip-ear-left', 'lip-ear-right']) {
      expect(d.panels.some((p) => p.id === id)).toBe(true)
    }
    expect(base.holes).toHaveLength(4) // ช่องล็อกลิ้นชั้นทบ
  })

  it('แผงหน้าฝากว้างเต็มแผ่น (คลุมแนวปีกข้างฝา) มีรอยพับหูที่มุมกล่อง', () => {
    const xsOf = (id: string) => d.panels.find((p) => p.id === id)!.outline.map((q) => q.x)
    const flapX = [...xsOf('lid-flap-left'), ...xsOf('lid-flap-right')]
    const frontX = [...xsOf('lip'), ...xsOf('lip-ear-left'), ...xsOf('lip-ear-right')]
    expect(Math.min(...frontX)).toBeCloseTo(Math.min(...flapX), 6)
    expect(Math.max(...frontX)).toBeCloseTo(Math.max(...flapX), 6)
    expect(d.panels.find((p) => p.id === 'lip')!.tuck).toBeFalsy()
  })

  it('ผังวางฝาไว้บน (ไม่หมุน) และปีกข้างฝายาวเกือบเต็มฝา', () => {
    const lid = d.panels.find((p) => p.id === 'lid')!
    const lidYs = lid.outline.map((q) => q.y)
    expect(Math.max(...lidYs)).toBeLessThan(Math.min(...base.outline.map((q) => q.y))) // ฝาอยู่เหนือฐาน
    const flap = d.panels.find((p) => p.id === 'lid-flap-left')!
    const fys = flap.outline.map((q) => q.y)
    expect(Math.max(...fys) - Math.min(...fys)).toBeGreaterThan(Dp - 2 * t - 2)
  })
})

describe('rollover-mailer: ตำแหน่งหลังพับสุด (fold=1)', () => {
  it('ไม่มีรอยพับ 180° (ผนังทบเป็นสันแบน) → ไม่มีสันม้วนโค้ง', () => {
    expect(rollBeads(d.panels, M)).toHaveLength(0)
  })

  it.each([
    ['roll-left', cx0, 1],
    ['roll-right', cx1, -1],
  ] as const)('%s ทบลงด้านใน ห่างผนัง ~sp พาดจากบนผนังลงถึงฐาน', (id, plane, dir) => {
    const v = pts(id)
    expect(v.every((q) => (q.x - plane) * dir > 0.5)).toBe(true)
    expect(v.every((q) => Math.abs(q.x - plane) < 4 * t + 2)).toBe(true)
    expect(Math.max(...v.map((q) => q.z))).toBeGreaterThan(Hp * 0.85)
    expect(Math.min(...v.map((q) => q.z))).toBeLessThan(2)
  })

  it('ฝาปิดที่ความสูง Hp คลุมฐาน', () => {
    const v = pts('lid')
    for (const q of v) {
      expect(Math.abs(q.z - Hp)).toBeLessThan(2 * t + 1)
      expect(q.y).toBeGreaterThan(yF - 0.5)
      expect(q.y).toBeLessThan(yB + 0.5)
    }
  })

  it.each([
    ['lid-flap-left', cx0, 1],
    ['lid-flap-right', cx1, -1],
  ] as const)('%s ห้อยลงด้านในชั้นทบตลอดแนวยาว ระหว่างผนังหน้า-หลัง', (id, plane, dir) => {
    for (const q of pts(id)) {
      expect((q.x - plane) * dir).toBeGreaterThanOrEqual(sp - 0.01)
      expect((q.x - plane) * dir).toBeLessThan(sp + 2 * t + 1)
      expect(q.z).toBeGreaterThan(t)
      expect(q.z).toBeLessThan(Hp + 0.5)
      expect(q.y).toBeGreaterThan(yF + t - 0.01)
      expect(q.y).toBeLessThan(yB - t + 0.01)
    }
  })

  it('แผงหน้าฝาคลุมด้านนอกผนังหน้า กว้างเต็มกล่อง สูงเกือบเท่าผนัง', () => {
    const v = pts('lip')
    for (const q of v) {
      expect(q.y).toBeLessThanOrEqual(yF + 0.01) // นอกผนังหน้า
      expect(q.y).toBeGreaterThan(yF - 2 * t - 1)
    }
    const xs = v.map((q) => q.x)
    expect(Math.min(...xs)).toBeCloseTo(cx0, 3)
    expect(Math.max(...xs)).toBeCloseTo(cx1, 3)
    const zs = v.map((q) => q.z)
    expect(Math.max(...zs)).toBeGreaterThan(Hp - 1)
    expect(Math.min(...zs)).toBeGreaterThan(0) // ไม่ถึงพื้น (เห็นผนังหน้าใต้แผง)
    expect(Math.min(...zs)).toBeLessThan(Hp * 0.25)
  })

  it.each([
    ['lip-ear-left', cx0, -1],
    ['lip-ear-right', cx1, 1],
  ] as const)('%s อ้อมมุมไปแนบด้านนอกผนังข้าง ช่วงหน้ากล่อง', (id, plane, dir) => {
    for (const q of pts(id)) {
      expect((q.x - plane) * dir).toBeGreaterThanOrEqual(-0.01) // นอกผนังข้าง
      expect(Math.abs(q.x - plane)).toBeLessThan(2 * t + 1)
      expect(q.y).toBeGreaterThan(yF - 2 * t - 1) // เริ่มจากมุมนอก (แผงหน้าอยู่นอกผนังหน้า)
      expect(q.y).toBeLessThan(yB)
      expect(q.z).toBeGreaterThan(0)
      expect(q.z).toBeLessThan(Hp + 0.5)
    }
  })

  it('ตลอดการปิดฝา แผงหน้าและหูไม่เข้าไปในตัวกล่อง (ไม่ทะลุผนัง)', () => {
    for (let f = 0; f <= 1.0001; f += 0.005) {
      const Mf = computeMatrices(d.panels, f)
      for (const id of ['lip', 'lip-ear-left', 'lip-ear-right']) {
        const p = d.panels.find((q) => q.id === id)!
        for (const v of p.outline) {
          const w = to3D(v).applyMatrix4(Mf.get(id)!)
          const inside = w.x > cx0 + 0.5 && w.x < cx1 - 0.5 && w.y > yF + 0.5 && w.y < yB - 0.5 && w.z > 0.5 && w.z < Hp - 0.5
          expect(inside).toBe(false)
        }
      }
    }
  })
})

describe('rollover-mailer: เข้ากับระบบอื่น', () => {
  it('guides + DXF ไม่มี NaN', () => {
    const g = computeGuides(d.panels)
    expect(g.bleed.length).toBeGreaterThan(0)
    const dxf = dielineDXFString(d)
    expect(dxf).toContain('EOF')
    expect(dxf).not.toContain('NaN')
  })
})
