import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { computeMatrices, to3D } from '../fold'
import { getTemplate } from './index'
import { getMaterial } from '../materials'
import { dielineDXFString } from '../dxf'
import type { Panel, Vec2 } from '../types'

// FEFCO 0215 = ปีกกาว|หลัง|ข้างซ้าย|หน้า|ข้างขวา + ฝาบนเสียบ + ก้นล็อก 1-2-3
// ตรวจตำแหน่ง 3D หลังพับเสร็จ: ชั้นวัสดุของก้น, ลิ้นปลายลงช่องบาก, ขอของลิ้นข้างกดลิ้นปลาย
const tp = getTemplate('fefco-0215')

for (const [mid, box] of [
  ['carton-300', { W: 90, D: 60, H: 150, handle: false }],
  ['corrugated-e', { W: 250, D: 200, H: 210, handle: false }],
  ['carton-400', { W: 60, D: 120, H: 80, handle: false }],
] as const) {
  describe(`fefco-0215 ${mid} ${box.W}×${box.D}×${box.H}`, () => {
    const t = getMaterial(mid).thickness
    const d = tp.generate(box, getMaterial(mid))
    const M = computeMatrices(d.panels, 1)
    const panel = (id: string) => d.panels.find((p) => p.id === id)!
    const w3 = (id: string, q: Vec2) => to3D(q).applyMatrix4(M.get(id)!)
    const center = (pts: Vec2[]) => ({ x: pts.reduce((s, q) => s + q.x, 0) / pts.length, y: pts.reduce((s, q) => s + q.y, 0) / pts.length })
    const xs = (p: Panel) => p.outline.map((q) => q.x)
    const front = panel('front')
    const botY = Math.max(...front.outline.map((q) => q.y))
    const floor = -botY // พื้นกล่องใน 3D (แกน y ขึ้น)

    it('ผังเรียง ปีกกาว | หลัง | ข้างซ้าย | หน้า | ข้างขวา และมีลิ้นก้นครบ', () => {
      const order = ['glue', 'back', 'side-left', 'front', 'side-right'].map((id) => Math.min(...xs(panel(id))))
      expect([...order].sort((a, b) => a - b)).toEqual(order)
      for (const id of ['base-left', 'base-right', 'base-back', 'base-front', 'base-tab', 'tuck-top', 'tongue-top', 'dust-tl', 'dust-tr']) {
        expect(panel(id)).toBeTruthy()
      }
    })

    it('ลิ้นก้นนอนราบที่พื้น เรียงชั้นจากนอกเข้าใน: หน้า → หลัง → ลิ้นปลาย → ลิ้นข้าง', () => {
      const lift = (id: string) => {
        const ys = panel(id).outline.map((q) => w3(id, q).y - floor)
        expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.01) // ราบ
        return ys[0]
      }
      const f = lift('base-front')
      const b = lift('base-back')
      const tab = lift('base-tab')
      const l = lift('base-left')
      const r = lift('base-right')
      expect(f).toBeGreaterThanOrEqual(-0.01)
      expect(b).toBeGreaterThan(f)
      expect(tab).toBeGreaterThan(b)
      expect(l).toBeGreaterThan(tab)
      expect(r).toBeCloseTo(l, 6)
      expect(l).toBeLessThan(4 * (t + 0.05) + 0.01)
    })

    it('คอลิ้นหน้าตรงขอบในช่องบากลิ้นหลัง (กลางก้น) และลิ้นปลายแคบกว่าช่องบาก', () => {
      const back = panel('base-back').outline
      const notchTop = Math.min(...back.filter((q) => q.x > Math.min(...back.map((p) => p.x)) + 1 && q.x < Math.max(...back.map((p) => p.x)) - 1).map((q) => q.y))
      const notchPts = back.filter((q) => Math.abs(q.y - notchTop) < 1e-6)
      const notchW = Math.abs(notchPts[0].x - notchPts[1].x)
      const notchMid = w3('base-back', center(notchPts))
      const tab = panel('base-tab').outline
      const neck = [tab[0], tab[tab.length - 1]]
      const neckMid = w3('base-tab', center(neck))
      expect(Math.hypot(neckMid.x - notchMid.x, neckMid.z - notchMid.z)).toBeLessThan(0.01)
      const tabW = Math.max(...tab.map((q) => q.x)) - Math.min(...tab.map((q) => q.x))
      expect(tabW).toBeLessThan(notchW)
      // ลิ้นปลายยื่นไปทางหลัง (อยู่เหนือเนื้อลิ้นหลัง ไม่ใช่ในช่องบาก)
      const tabC = w3('base-tab', center(tab))
      const backHinge = w3('back', { x: (Math.min(...xs(panel('back'))) + Math.max(...xs(panel('back')))) / 2, y: botY })
      expect(Math.abs(tabC.z - backHinge.z)).toBeLessThan(Math.abs(neckMid.z - backHinge.z))
    })

    it('ขอของลิ้นข้างทั้งสองอยู่เหนือลิ้นปลาย (กดล็อก) และลิ้นข้างไม่ชนกันกลางก้น', () => {
      const tab = panel('base-tab').outline
      const tabW = tab.map((q) => w3('base-tab', q))
      const inTab = (v: Vector3) => {
        const xs3 = tabW.map((q) => q.x)
        const zs3 = tabW.map((q) => q.z)
        return v.x > Math.min(...xs3) && v.x < Math.max(...xs3) && v.z > Math.min(...zs3) && v.z < Math.max(...zs3)
      }
      for (const id of ['base-left', 'base-right']) {
        const pts = panel(id).outline.map((q) => w3(id, q))
        expect(pts.some(inTab)).toBe(true)
      }
      // ปลายลิ้นข้างสองฝั่งเว้นช่องกลาง
      const reach = (id: string) => panel(id).outline.map((q) => w3(id, q).x)
      const l = reach('base-left')
      const r = reach('base-right')
      const gap = Math.max(Math.min(...l), Math.min(...r)) - Math.min(Math.max(...l), Math.max(...r))
      expect(gap).toBeGreaterThan(0)
    })

    it('ลิ้นกันฝุ่นเฉียงฝั่งผนังหน้า (หลบลิ้นเสียบ) ตรงฝั่งผนังหลัง', () => {
      const frontZ = w3('front', { x: front.outline[0].x, y: front.outline[0].y }).z
      for (const id of ['dust-tl', 'dust-tr']) {
        const pts = panel(id).outline.map((q) => w3(id, q))
        const nearFront = Math.min(...pts.map((v) => Math.abs(v.z - frontZ)))
        expect(nearFront).toBeGreaterThan(0) // ไม่ล้ำผนังหน้า
        expect(nearFront).toBeLessThan(t + 1)
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
