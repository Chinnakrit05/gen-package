import { describe, expect, it } from 'vitest'
import { computeMatrices, to3D } from '../fold'
import { getTemplate } from './index'
import { getMaterial } from '../materials'
import { dielineDXFString } from '../dxf'
import type { Panel, Vec2 } from '../types'

// FEFCO 0215 = ปีกกาว|หลัง|ข้างซ้าย|หน้า|ข้างขวา + ฝาบนเสียบ + ก้นล็อก 1-2-3
// ตรวจตำแหน่ง 3D หลังพับเสร็จ: ชั้นวัสดุของก้น, ลิ้นปลายลงช่องบาก, ขอของลิ้นข้างกดลิ้นปลาย
const tp = getTemplate('fefco-0215')
const inPoly = (pt: Vec2, poly: Vec2[]) => {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c
  }
  return c
}

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
      for (const id of ['base-left', 'base-right', 'base-back', 'base-front', 'tuck-top', 'tongue-top', 'dust-tl', 'dust-tr']) {
        expect(panel(id)).toBeTruthy()
      }
    })

    it('ลิ้นก้นนอนราบที่พื้น เรียงชั้นจากนอกเข้าใน: หน้า → ลิ้นข้าง → หลัง → ปลายลิ้นหน้าที่สอดลงร่อง', () => {
      const lift = (id: string) => {
        const ys = panel(id).outline.map((q) => w3(id, q).y - floor)
        expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.01) // ราบ
        return ys[0]
      }
      const f = lift('base-front')
      const b = lift('base-back')
      const l = lift('base-left')
      const r = lift('base-right')
      expect(f).toBeGreaterThanOrEqual(-0.01)
      expect(l).toBeGreaterThan(f)
      expect(r).toBeCloseTo(l, 6)
      expect(b).toBeGreaterThan(l)
      expect(b).toBeLessThan(3 * (t + 0.05) + 0.01)
      // ลิ้นปลายงอจากคอ (บานพับ = ขอบลิ้นหน้า ต่อเนื่องไม่มีขั้น) ปลายพักเหนือผิวในลิ้นหลัง
      const tab = panel('base-tab')
      expect(tab.parentId).toBe('base-front')
      const neckY = tab.outline.slice(0, 1).concat(tab.outline.slice(-1)).map((q) => w3('base-tab', q).y - floor)
      for (const y of neckY) expect(y).toBeCloseTo(f, 6)
      const tipY = Math.max(...tab.outline.map((q) => w3('base-tab', q).y - floor))
      expect(tipY).toBeGreaterThan(b + (t + 0.05) * 0.5)
    })

    it('จังหวะก้น: 1 พับเลยระนาบ → 2 พับเลยระนาบ → 1,2 คืนระนาบ → 3 ปิดท้าย; ระหว่างเลย ลิ้นข้างอยู่ใต้ลิ้นหลัง', () => {
      const st = (id: string) => panel(id).stage
      expect(st('base-back')).toBeLessThan(st('base-left'))
      expect(st('base-left')).toBe(st('base-right'))
      expect(panel('base-back').refold!.stage).toBe(panel('base-left').refold!.stage)
      expect(panel('base-left').refold!.stage).toBeGreaterThan(st('base-left'))
      expect(st('base-front')).toBeGreaterThan(panel('base-left').refold!.stage)
      expect(-90 - panel('base-left').foldAngle!).toBeCloseTo(30, 6)
      expect(-90 - panel('base-back').foldAngle!).toBeGreaterThanOrEqual(30)
      // ปากบนพับหลังก้นเสร็จ
      expect(st('dust-tl')).toBeGreaterThan(st('base-front'))
      // หลังลิ้นข้างพับเลยเสร็จ (ก่อนคืน): ทุกจุดของลิ้นข้างที่ตกในพื้นที่ลิ้นหลังอยู่ด้านนอก (ใต้) ลิ้นหลัง
      const all = computeMatrices(d.panels, 0.47) // WINDOWS_7: ข้างจบ 0.5, คืนเริ่ม 0.46 → ตรวจหลายจุด
      for (const f of [0.4, 0.44, 0.47, 0.5, 0.55, 0.6]) {
        const M2 = computeMatrices(d.panels, f)
        const inv = M2.get('base-back')!.clone().invert()
        for (const id of ['base-left', 'base-right']) {
          for (const q of panel(id).outline) {
            const l = to3D(q).applyMatrix4(M2.get(id)!).applyMatrix4(inv)
            const inBack = inPoly({ x: l.x, y: -l.y }, panel('base-back').outline)
            if (inBack) expect(l.z).toBeLessThan(0.01)
          }
        }
      }
      expect(all.size).toBeGreaterThan(0)
    })

    // ช่องบากลิ้นหลัง: จุดขอบในช่องบาก (u = Dp/2) สองมุม ในพิกัด 3D
    const notch = () => {
      const back = panel('base-back').outline
      const bx = back.map((q) => q.x)
      const inner = back.filter((q) => q.x > Math.min(...bx) + 1 && q.x < Math.max(...bx) - 1)
      const top = Math.min(...inner.map((q) => q.y))
      const pts = back.filter((q) => Math.abs(q.y - top) < 1e-6)
      const deep = Math.max(...back.map((q) => q.y))
      return { pts, w: Math.abs(pts[0].x - pts[1].x), depth: deep - top }
    }
    // ลิ้นปลายของลิ้นหน้า = ส่วนที่เลยคอ (จุดลึกเกินครึ่งความลึกก้น)
    const tabOf = () => panel('base-tab').outline

    it('คอลิ้นหน้าตรงขอบในช่องบากลิ้นหลัง (กลางก้น) และลิ้นปลายแคบกว่าช่องบาก', () => {
      const n = notch()
      const notchMid = w3('base-back', center(n.pts))
      const tab = tabOf()
      const neck = [tab[0], tab[tab.length - 1]]
      const neckMid = w3('base-tab', center(neck))
      expect(Math.hypot(neckMid.x - notchMid.x, neckMid.z - notchMid.z)).toBeLessThan(0.01)
      const tabW = Math.max(...tab.map((q) => q.x)) - Math.min(...tab.map((q) => q.x))
      expect(tabW).toBeLessThan(n.w)
    })

    it('ร่องขอของลิ้นข้างทั้งสองคร่อมมุมในช่องบากลิ้นหลังพอดี ฟันอยู่ในช่องบากและงอนเลยขอบใน; ลิ้นข้างไม่ชนกันกลางก้น', () => {
      const n = notch()
      const corners = n.pts.map((q) => w3('base-back', q))
      const nz = corners[0].z // แนวขอบในช่องบาก
      const nx = corners.map((v) => v.x).sort((a, b) => a - b)
      const backZ = w3('back', { x: Math.min(...xs(panel('back'))), y: botY }).z
      const towardBack = Math.sign(backZ - nz)
      for (const id of ['base-left', 'base-right']) {
        const pts = panel(id).outline.map((q) => w3(id, q))
        // ปลายขอบเฉียง (จุดที่ 2 ของลิ้นข้างฝั่งผนังหลัง) = มุมในช่องบาก
        const apex = pts.reduce((best, v) => (Math.abs(v.z - nz) < 1e-6 && Math.min(...nx.map((x) => Math.abs(v.x - x))) < Math.min(...nx.map((x) => Math.abs(best.x - x))) ? v : best), pts[0])
        expect(Math.min(...nx.map((x) => Math.abs(apex.x - x)))).toBeLessThan(0.01)
        expect(Math.abs(apex.z - nz)).toBeLessThan(0.01)
        // ฟัน: จุดที่งอนไปทางหลังเลยขอบใน อยู่ในแถบช่องบาก (ระหว่างขอบช่องบากสองข้าง)
        const tooth = pts.filter((v) => (v.z - nz) * towardBack > 0.5 && v.x > nx[0] && v.x < nx[1])
        expect(tooth.length).toBeGreaterThan(0)
      }
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

    it('ปลายลิ้นก้นทั้ง 4 จบแนวเดียวกัน (สัดส่วนกล่องทั่วไป)', () => {
      const depth = (id: string) => Math.max(...panel(id).outline.map((q) => q.y)) - botY
      const ds = ['base-back', 'base-left', 'base-tab', 'base-right'].map(depth)
      if (box.D <= box.W) for (const v of ds) expect(v).toBeCloseTo(ds[0], 6)
      else expect(depth('base-left')).toBeLessThanOrEqual(depth('base-back') + 1e-6) // ลึกกว่ากว้าง: ลิ้นข้างยาวเกินกลางก้นไม่ได้
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

describe('fefco-0215: ลึก D ได้ถึง 200 (template อื่น/ภาชนะ 150)', () => {
  it('templateMaxD + parseSpec ตัดตาม template', async () => {
    const { templateMaxD } = await import('./index')
    const { parseSpec } = await import('../project')
    expect(templateMaxD('fefco-0215', true)).toBe(200)
    expect(templateMaxD('tuck-end', true)).toBe(150)
    expect(templateMaxD('fefco-0215', false)).toBe(150) // วัสดุภาชนะ/ถุง
    expect(parseSpec({ template: 'fefco-0215', materialId: 'corrugated-e', W: 250, D: 200, H: 210 })?.D).toBe(200)
    expect(parseSpec({ template: 'fefco-0215', materialId: 'corrugated-e', W: 250, D: 260, H: 210 })?.D).toBe(200)
    expect(parseSpec({ template: 'tuck-end', materialId: 'carton-300', W: 80, D: 200, H: 120 })?.D).toBe(150)
  })
})
