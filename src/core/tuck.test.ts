import { describe, expect, it } from 'vitest'
import { Matrix4, Vector3 } from 'three'
import { computeMatrices, to3D } from './fold'
import { getTemplate } from './templates'
import { getMaterial } from './materials'
import type { BoxParams, Panel } from './types'

// ลิ้นเสียบ (Panel.tuck) ต้องไม่กวาดทะลุผนังหน้าระหว่าง animation การพับ
// วัดในกรอบของสภาพปิดสนิท (fold=1): ระนาบฝา = แนวขอบปาก, ระนาบลิ้น = แนวผนังที่ลิ้นแนบ
// จุดใดของลิ้นที่ "ต่ำกว่าขอบปาก" และ "ล้ำแนวลิ้นออกไปทางผนังหน้า" พร้อมกัน = ทะลุผนัง

const TOL = 1 // มม. — เผื่อ zOffset ชั้นวัสดุ
const cases: [string, string, Partial<BoxParams>][] = [
  ['tuck-end', 'carton-300', {}],
  ['tuck-end', 'carton-300', { W: 60, D: 120, H: 80 }], // ฝาลึก ลิ้นสั้นเทียบฝา
  ['tuck-end', 'corrugated-e', { W: 40, D: 30, H: 120 }], // กล่องผอม ลิ้นยาวเทียบฝา
  ['fefco-0215', 'corrugated-e', {}],
  ['mailer', 'corrugated-e', {}],
  ['rollover-mailer', 'corrugated-e', {}],
  ['fefco-0427', 'corrugated-e', {}],
]

const centroid3 = (p: Panel) => {
  const c = p.outline.reduce((s, q) => ({ x: s.x + q.x, y: s.y + q.y }), { x: 0, y: 0 })
  return to3D({ x: c.x / p.outline.length, y: c.y / p.outline.length })
}
const normalOf = (pts: Vector3[]) =>
  pts[1].clone().sub(pts[0]).cross(pts[2].clone().sub(pts[0])).normalize()

describe('ลิ้นเสียบไม่ทะลุผนังระหว่างพับ', () => {
  for (const [tid, mid, over] of cases) {
    it(`${tid} / ${mid} ${JSON.stringify(over)}`, () => {
      const tp = getTemplate(tid)
      const d = tp.generate({ ...tp.defaults, ...over }, getMaterial(mid))
      const tucks = d.panels.filter((p) => p.tuck)
      expect(tucks.length).toBeGreaterThan(0)
      const end = computeMatrices(d.panels, 1)
      for (const lip of tucks) {
        const lid = d.panels.find((p) => p.id === lip.parentId)!
        const wall = d.panels.find((p) => p.id === lid.parentId)!
        const lidPts = lid.outline.map((q) => to3D(q).applyMatrix4(end.get(lid.id)!))
        const lipPts = lip.outline.map((q) => to3D(q).applyMatrix4(end.get(lip.id)!))
        // ทิศ "ออกนอกกล่อง" ของระนาบฝา: ผนังที่ฝาต่ออยู่ (อยู่ใต้ฝา) ต้องได้ค่าลบ
        const nLid = normalOf(lidPts)
        const wallC = centroid3(wall).applyMatrix4(end.get(wall.id)!)
        if (wallC.clone().sub(lidPts[0]).dot(nLid) > 0) nLid.negate()
        // ทิศ "ล้ำไปทางผนังหน้า" ของระนาบลิ้น: บานพับฝา (ฝั่งผนังหลัง) ต้องได้ค่าลบ
        const nLip = normalOf(lipPts)
        const lidHinge = to3D(lid.hingeA!).applyMatrix4(end.get(lid.id)!)
        if (lidHinge.clone().sub(lipPts[0]).dot(nLip) > 0) nLip.negate()

        let worst = 0
        for (let f = 0; f <= 1.0001; f += 0.005) {
          const M = computeMatrices(d.panels, f)
          for (const q of lip.outline) {
            const w = to3D(q).applyMatrix4(M.get(lip.id)!)
            const below = -w.clone().sub(lidPts[0]).dot(nLid)
            const beyond = w.clone().sub(lipPts[0]).dot(nLip)
            if (below > TOL) worst = Math.max(worst, beyond)
          }
        }
        expect(worst, `${lip.id} ล้ำผนัง`).toBeLessThan(TOL)
      }
    })
  }

  it('ลิ้นพับครบ 90° ตอนปิดสนิท และแผ่นยังแบนตอน fold=0', () => {
    const tp = getTemplate('tuck-end')
    const d = tp.generate(tp.defaults, getMaterial('carton-300'))
    const flat = computeMatrices(d.panels, 0)
    for (const p of d.panels) expect(flat.get(p.id)!.equals(new Matrix4())).toBe(true)
    const end = computeMatrices(d.panels, 1)
    const lip = d.panels.find((p) => p.id === 'tongue-top')!
    const lid = d.panels.find((p) => p.id === 'tuck-top')!
    const nLid = normalOf(lid.outline.map((q) => to3D(q).applyMatrix4(end.get(lid.id)!)))
    const nLip = normalOf(lip.outline.map((q) => to3D(q).applyMatrix4(end.get(lip.id)!)))
    expect(Math.abs(nLid.dot(nLip))).toBeLessThan(1e-6)
  })
})
