import { describe, expect, it } from 'vitest'
import { computeMatrices, to3D } from '../fold'
import { getTemplate } from './index'
import { getMaterial } from '../materials'
import { dielineDXFString } from '../dxf'
import type { Vec2 } from '../types'

// กล่องหน้าต่าง = ปีกกาว | หลัง | ข้างซ้าย | หน้า (หน้าต่าง + ฝาบน/ล่าง) | ข้างขวา — ตรวจตำแหน่ง 3D หลังพับ
const tp = getTemplate('display-box')

for (const [mid, box] of [
  ['carton-300', { W: 120, D: 60, H: 180, handle: false }],
  ['corrugated-e', { W: 90, D: 90, H: 120, handle: false }],
] as const) {
  describe(`display-box ${mid} ${box.W}×${box.D}×${box.H}`, () => {
    const t = getMaterial(mid).thickness
    const d = tp.generate(box, getMaterial(mid))
    const M = computeMatrices(d.panels, 1)
    const panel = (id: string) => d.panels.find((p) => p.id === id)!
    const w3 = (id: string, q: Vec2) => to3D(q).applyMatrix4(M.get(id)!)
    const xs = (id: string) => panel(id).outline.map((q) => q.x)
    const front = panel('front')
    const top = Math.min(...front.outline.map((q) => q.y))
    const bot = Math.max(...front.outline.map((q) => q.y))

    it('ผังเรียง ปีกกาว | หลัง | ข้างซ้าย | หน้า | ข้างขวา; ฝาบน+ล่างต่อจากแผงหน้า', () => {
      const order = ['glue', 'back', 'side-left', 'front', 'side-right'].map((id) => Math.min(...xs(id)))
      expect([...order].sort((a, b) => a - b)).toEqual(order)
      expect(panel('tuck-top').parentId).toBe('front')
      expect(panel('tuck-bot').parentId).toBe('front')
      expect(tp.tilt).toBe(0)
    })

    it('หน้าต่างมุมมนอยู่กลางแผงหน้า เว้นขอบทุกด้าน และมีเส้นตัดหน้าต่าง', () => {
      const win = front.holes![0]
      const fx = xs('front')
      const wx = win.map((q) => q.x)
      const wy = win.map((q) => q.y)
      expect(Math.min(...wx) - Math.min(...fx)).toBeGreaterThan(5)
      expect(Math.max(...fx) - Math.max(...wx)).toBeCloseTo(Math.min(...wx) - Math.min(...fx), 6)
      expect(Math.min(...wy) - top).toBeGreaterThan(5)
      expect(bot - Math.max(...wy)).toBeCloseTo(Math.min(...wy) - top, 6)
      const n = d.segments.filter((s) => s.kind === 'cut' && s.d.includes('Q')).length
      expect(n).toBeGreaterThan(0)
    })

    it('พับเต็ม: ฝาบน/ล่างปิดที่ขอบปากทั้งสอง ลิ้นเสียบแนบด้านในผนังหลัง', () => {
      const frontZ = w3('front', front.outline[0]).z
      const backPt = w3('back', panel('back').outline[0])
      const depth = Math.abs(backPt.z - frontZ)
      expect(depth).toBeCloseTo(box.D + 2 * t, 0)
      for (const [lid, edgeY] of [['tuck-top', top], ['tuck-bot', bot]] as const) {
        const ys = panel(lid).outline.map((q) => w3(lid, q).y)
        expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.05) // ฝาราบ
        expect(Math.abs(ys[0] - -edgeY)).toBeLessThan(1)
      }
      for (const tg of ['tongue-top', 'tongue-bot']) {
        const zs = panel(tg).outline.map((q) => w3(tg, q).z)
        // ลิ้นตั้งแนบผนังหลัง (ห่างผนังหลังไม่เกินสองชั้นวัสดุ)
        for (const z of zs) expect(Math.abs(z - backPt.z)).toBeLessThan(2 * (t + 0.05) + 0.5)
      }
    })

    it('ลิ้นกันฝุ่นมีไหล่ล็อกฝั่งผนังหลัง (ที่ลิ้นเสียบสอดลง)', () => {
      const backZ = w3('back', panel('back').outline[0]).z
      for (const id of ['dust-tl', 'dust-tr', 'dust-bl', 'dust-br']) {
        const pts = panel(id).outline.map((q) => w3(id, q))
        // จุดใกล้ผนังหลังที่สุดต้องห่างจากผนังหลังมากกว่าจุดใกล้ผนังหน้าห่างจากผนังหน้า (ไหล่บากฝั่งหลัง)
        const frontZ = w3('front', front.outline[0]).z
        const nearBack = Math.min(...pts.map((v) => Math.abs(v.z - backZ)))
        const nearFront = Math.min(...pts.map((v) => Math.abs(v.z - frontZ)))
        expect(nearBack).toBeGreaterThan(nearFront - 0.01)
      }
    })

    it('matrices finite + DXF ไม่มี NaN', () => {
      for (const p of d.panels) {
        const v = w3(p.id, p.outline[0])
        expect(Number.isFinite(v.x + v.y + v.z)).toBe(true)
      }
      const dxf = dielineDXFString(d)
      expect(dxf).toContain('SECTION')
      expect(dxf).not.toContain('NaN')
    })
  })
}
