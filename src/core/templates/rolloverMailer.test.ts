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
  it('ลงทะเบียน + แผงครบ 19 ชิ้น (หูมุม 4, สัน+ชั้นทบ 4, ฝา+ปีกข้าง 2+ลิ้นหน้ากว้าง+หูลิ้น 2)', () => {
    expect(tp.id).toBe('rollover-mailer')
    expect(d.panels).toHaveLength(19)
    for (const id of ['ear-fl', 'ear-br', 'spine-left', 'roll-right', 'lid', 'lid-flap-left', 'lid-flap-right', 'lip', 'lip-ear-left', 'lip-ear-right']) {
      expect(d.panels.some((p) => p.id === id)).toBe(true)
    }
    expect(base.holes).toHaveLength(4) // ช่องล็อกลิ้นชั้นทบ
  })

  it('ลิ้นหน้ากว้างเต็มแผ่น (ถึงแนวปีกข้างฝา) เป็นลิ้นเสียบ มีรอยพับหูที่แนวขอบฝา', () => {
    const xsOf = (id: string) => d.panels.find((p) => p.id === id)!.outline.map((q) => q.x)
    const flapX = [...xsOf('lid-flap-left'), ...xsOf('lid-flap-right')]
    const frontX = [...xsOf('lip'), ...xsOf('lip-ear-left'), ...xsOf('lip-ear-right')]
    expect(Math.min(...frontX)).toBeCloseTo(Math.min(...flapX), 6)
    expect(Math.max(...frontX)).toBeCloseTo(Math.max(...flapX), 6)
    expect(d.panels.find((p) => p.id === 'lip')!.tuck).toBe(true)
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

  it('ลิ้นหน้าเสียบด้านในผนังหน้า กว้างพอดีระหว่างชั้นทบ', () => {
    const v = pts('lip')
    for (const q of v) {
      expect(q.y).toBeGreaterThanOrEqual(yF - 0.01) // ในผนังหน้า
      expect(q.y).toBeLessThan(yF + 4 * t + 2)
      expect(q.z).toBeGreaterThan(0)
      expect(q.z).toBeLessThan(Hp + 0.5)
    }
    const xs = v.map((q) => q.x)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(cx0 + sp - 0.01)
    expect(Math.max(...xs)).toBeLessThanOrEqual(cx1 - sp + 0.01)
  })

  it.each([
    ['lip-ear-left', cx0, 1],
    ['lip-ear-right', cx1, -1],
  ] as const)('%s เก็บเข้าด้านในผนังข้าง (ในปีกข้างฝา) มองไม่เห็นจากนอก', (id, plane, dir) => {
    for (const q of pts(id)) {
      expect((q.x - plane) * dir).toBeGreaterThanOrEqual(sp + t - 0.01) // ในปีกข้างฝา
      expect((q.x - plane) * dir).toBeLessThan(sp + 3 * t + 1)
      expect(q.y).toBeGreaterThan(yF - 0.01)
      expect(q.y).toBeLessThan(yB)
      expect(q.z).toBeGreaterThan(0)
      expect(q.z).toBeLessThan(Hp + 0.5)
    }
  })

  it('ตลอดการปิดฝา หูลิ้นไม่ออกนอกผนังข้าง', () => {
    for (let f = 0.5; f <= 1.0001; f += 0.005) {
      const Mf = computeMatrices(d.panels, f)
      for (const [id, plane, dir] of [['lip-ear-left', cx0, 1], ['lip-ear-right', cx1, -1]] as const) {
        const p = d.panels.find((q) => q.id === id)!
        for (const v of p.outline) {
          const w = to3D(v).applyMatrix4(Mf.get(id)!)
          if (w.z < Hp - 0.5) expect((w.x - plane) * dir).toBeGreaterThan(sp - 0.01)
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
