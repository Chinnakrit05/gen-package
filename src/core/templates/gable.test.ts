import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { computeMatrices, to3D } from '../fold'
import { getTemplate } from './index'
import { getMaterial } from '../materials'
import { computeGuides } from '../guides'
import { dielineDXFString } from '../dxf'

// กล่องหูหิ้ว (gable carry box): ท่อทากาวข้าง + ก้นล็อก + ฝาแบนผ่าร่องกลาง + หูหิ้วสองชั้น
// + แผงปิดบนสองซีกจากผนังข้างพับทับฝา ปลายลงล็อกร่องกลาง — ตรวจตำแหน่ง 3D หลังพับเชิงตัวเลข
const mat = getMaterial('carton-300')
const t = mat.thickness
const tp = getTemplate('gable')
const box = { W: 200, D: 100, H: 120 }
const d = tp.generate(box, mat)
const M = computeMatrices(d.panels, 1)
const Dp = box.D + 2 * t

const pts = (id: string): Vector3[] => {
  const p = d.panels.find((q) => q.id === id)!
  return p.outline.map((v) => to3D(v).applyMatrix4(M.get(id)!))
}
const bb = (id: string) => {
  const v = pts(id)
  return {
    x0: Math.min(...v.map((q) => q.x)), x1: Math.max(...v.map((q) => q.x)),
    y0: Math.min(...v.map((q) => q.y)), y1: Math.max(...v.map((q) => q.y)),
    z0: Math.min(...v.map((q) => q.z)), z1: Math.max(...v.map((q) => q.z)),
  }
}
const front = bb('front')
const yTop = front.y1 // ระดับปากกล่อง (world y ขึ้น)
const xL = front.x0
const xR = front.x1
const xC = (xL + xR) / 2

describe('gable: โครงสร้าง dieline', () => {
  it('ลงทะเบียน + แผงครบ: ลำตัว 4 + ลิ้นกาว + ก้น 4 + ฝาแบน 4 ซีก + หูหิ้ว 2 + แผงปิดบน 4 ซีก + ลิ้นปลาย 4', () => {
    expect(tp.id).toBe('gable')
    expect(tp.supportsHandle).toBe(false)
    expect(d.panels).toHaveLength(23)
    for (const id of ['front', 'back', 'side-left', 'side-right', 'glue', 'fin-front', 'fin-back']) {
      expect(d.panels.some((p) => p.id === id)).toBe(true)
    }
    expect(d.panels.filter((p) => p.id.startsWith('cap-'))).toHaveLength(4)
    expect(d.panels.filter((p) => p.id.startsWith('tip-'))).toHaveLength(4)
  })

  it('หูหิ้วทั้งสองเจาะรูจับ + เส้นตัด/รอยพับสร้างจากแผงได้ครบ', () => {
    expect(d.panels.find((p) => p.id === 'fin-front')!.holes).toHaveLength(1)
    expect(d.panels.find((p) => p.id === 'fin-back')!.holes).toHaveLength(1)
    expect(d.segments.filter((s) => s.kind === 'crease').length).toBeGreaterThanOrEqual(20)
    expect(d.segments.filter((s) => s.kind === 'cut').length).toBeGreaterThan(10)
  })
})

describe('gable: ตำแหน่งหลังพับสุด (fold=1)', () => {
  it('ลำตัวเป็นกล่องปิดรอบ: ผนังหน้า z=0, หลัง z≈Dp, ข้างสองด้านที่ปลาย x', () => {
    expect(front.z1).toBeCloseTo(0, 3)
    const back = bb('back')
    expect(back.z0).toBeCloseTo(Dp, 1)
    expect(Math.min(bb('side-left').x0, bb('side-right').x0)).toBeCloseTo(xL, 1)
    expect(Math.max(bb('side-left').x1, bb('side-right').x1)).toBeCloseTo(xR, 1)
  })

  it('ฝาแบนสี่ซีกนอนที่ปาก ครึ่งความลึกจากผนังของตัวเอง เว้นร่องกลางตามยาว', () => {
    for (const id of ['lid-front-a', 'lid-front-b', 'lid-back-a', 'lid-back-b']) {
      const b = bb(id)
      expect(b.y0).toBeCloseTo(yTop, 3)
      expect(b.y1).toBeCloseTo(yTop, 3)
      expect(b.z1 - b.z0).toBeCloseTo(Dp / 2 - t - 0.01, 2)
    }
    const fa = bb('lid-front-a')
    const fb = bb('lid-front-b')
    const gapX = Math.max(fb.x0 - fa.x1, fa.x0 - fb.x1)
    expect(gapX).toBeGreaterThan(2 * t) // ร่องรับลิ้นปลายสองแผ่น
  })

  it('หูหิ้วสองชั้นตั้งดิ่งกลางกล่อง แนบกัน รูจับตรงกัน', () => {
    const f = bb('fin-front')
    const b = bb('fin-back')
    expect(f.z1 - f.z0).toBeLessThan(0.01)
    expect(b.z1 - b.z0).toBeLessThan(0.01)
    expect(b.z0 - f.z0).toBeCloseTo(2 * (t + 0.01), 3)
    expect((f.z0 + b.z0) / 2).toBeCloseTo(Dp / 2, 2)
    expect(f.y0).toBeCloseTo(yTop, 3)
    expect(f.y1 - yTop).toBeGreaterThan(25)
    expect(f.y1).toBeCloseTo(b.y1, 3)
    const hole = (id: string) => {
      const h = d.panels.find((p) => p.id === id)!.holes![0].map((v) => to3D(v).applyMatrix4(M.get(id)!))
      return { x: h.reduce((s, v) => s + v.x, 0) / h.length, y: h.reduce((s, v) => s + v.y, 0) / h.length }
    }
    expect(hole('fin-front').x).toBeCloseTo(hole('fin-back').x, 2)
    expect(hole('fin-front').y).toBeCloseTo(hole('fin-back').y, 2)
  })

  it('แผงปิดบนนอนทับบนฝาแบน (เหนือฝา) ข้างละซีกของหูหิ้ว ยาวถึงกลางกล่อง', () => {
    for (const id of ['cap-right-a', 'cap-right-b', 'cap-left-a', 'cap-left-b']) {
      const b = bb(id)
      expect(b.y0).toBeGreaterThan(yTop) // อยู่บนฝา ไม่ทะลุลง
      expect(b.y1 - yTop).toBeLessThan(2 * t + 0.5)
      expect(b.x0).toBeGreaterThanOrEqual(xL - 0.01)
      expect(b.x1).toBeLessThanOrEqual(xR + 0.01)
      expect(Math.min(Math.abs(b.x0 - xC), Math.abs(b.x1 - xC))).toBeLessThan(2 * t + 1) // ถึงกลางกล่อง
      // ไม่ทับหูหิ้ว: อยู่ฝั่งหน้าหรือฝั่งหลังของระนาบหูหิ้วทั้งแผง
      const fz0 = bb('fin-front').z0
      const fz1 = bb('fin-back').z0
      expect(b.z1 <= fz0 + 0.01 || b.z0 >= fz1 - 0.01).toBe(true)
    }
  })

  it('ลิ้นปลายสี่อันลงร่องกลางของฝาแบน (ใต้ระดับปาก ในแนวร่อง)', () => {
    for (const id of ['tip-right-a', 'tip-right-b', 'tip-left-a', 'tip-left-b']) {
      const b = bb(id)
      expect(b.y0).toBeLessThan(yTop - 5)
      expect(Math.abs((b.x0 + b.x1) / 2 - xC)).toBeLessThan(t + 1)
    }
  })

  it('ลิ้นก้นสี่อันพับเข้าปิดก้น อยู่ในรอยเท้ากล่อง', () => {
    for (const id of ['base-front', 'base-back', 'base-left', 'base-right']) {
      const b = bb(id)
      expect(b.y1 - b.y0).toBeLessThan(0.01)
      expect(b.y0).toBeLessThan(front.y0 + 4 * t + 1)
      expect(b.x0).toBeGreaterThanOrEqual(xL - 0.01)
      expect(b.x1).toBeLessThanOrEqual(xR + 0.01)
      expect(b.z0).toBeGreaterThanOrEqual(-0.01)
      expect(b.z1).toBeLessThanOrEqual(Dp + 0.01)
    }
  })

  it('ลิ้นปลายงอรอไว้ก่อนแผงปิดบนเริ่มพับลง (ไม่กวาดสวนกันในร่อง)', () => {
    const cap = d.panels.find((p) => p.id === 'cap-right-a')!
    const tip = d.panels.find((p) => p.id === 'tip-right-a')!
    expect(tip.stage).toBeLessThan(cap.stage)
  })
})

describe('gable: เข้ากับระบบอื่น', () => {
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
