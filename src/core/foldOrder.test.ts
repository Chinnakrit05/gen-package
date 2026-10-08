import { describe, expect, it } from 'vitest'
import { Matrix4, Vector3 } from 'three'
import { computeMatrices, to3D } from './fold'
import { TEMPLATES } from './templates'
import { getMaterial } from './materials'
import type { Panel, Vec2 } from './types'

// ลำดับพับต้องไม่ทำให้แผงทะลุกัน: ถ้าแผง p จบลงซ้อนแนบแผง q (ชั้นวัสดุ เช่น ลิ้นมุมแนบในผนัง)
// ระหว่าง animation ห้ามให้ p ไปอยู่ "ผิดฝั่ง" ของ q ภายในพื้นที่ q ขณะที่ q เข้าที่แล้ว (เอียงไม่เกิน 20°)
// — นั่นคืออาการลิ้นกวาดอยู่นอกผนังที่ตั้งแล้ว แล้วทะลุเข้าไปตอนท้าย (ผนังต้องตั้งหลังลิ้นพับเข้า)
// ข้อยกเว้นต้องมีเหตุผลทางกายภาพกำกับ

const ALLOWED = new Set([
  // ก้น auto-lock: ลิ้นก้นสอดล็อกผ่านกันจริงตามแบบ (ระยะซ้อน 2–5 มม.)
  'fefco-0215:base-left→base-front', 'fefco-0215:base-left→base-back',
  'fefco-0215:base-right→base-front', 'fefco-0215:base-right→base-back',
  // ลิ้นยาวเต็มความลึก: ปลายลิ้นหน้าแตะแนวบานพับลิ้นหลังพอดี (เฉียดขอบ ไม่ผ่านเนื้อแผง)
  'fefco-0202:flap-t-back→flap-t-front', 'fefco-0202:flap-b-back→flap-b-front',
])

const inPoly = (pt: Vec2, poly: Vec2[]) => {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c
  }
  return c
}
// พิกัดในระนาบแผ่นคลี่ของแผงอ้างอิง + ระยะตั้งฉาก (z)
const toLocal = (v: Vector3, inv: Matrix4) => {
  const l = v.clone().applyMatrix4(inv)
  return { p: { x: l.x, y: -l.y }, z: l.z }
}
const normal = (m: Matrix4) => new Vector3(0, 0, 1).transformDirection(m)

describe('ลำดับพับ: แผงไม่กวาดผิดฝั่งของแผงที่จะซ้อนทับ', () => {
  for (const tp of TEMPLATES) {
    for (const mid of ['carton-300', 'corrugated-e']) {
      it(`${tp.id} / ${mid}`, () => {
        const d = tp.generate(tp.defaults, getMaterial(mid))
        const by = new Map(d.panels.map((p) => [p.id, p]))
        const isAnc = (a: Panel, b: Panel) => {
          for (let c: Panel | undefined = b; c; c = c.parentId ? by.get(c.parentId) : undefined) if (c === a) return true
          return false
        }
        const end = computeMatrices(d.panels, 1)
        // คู่ที่จบลงซ้อนกัน (ห่าง < 5 มม. และ p อยู่ในพื้นที่ q) พร้อมฝั่งสุดท้าย
        const pairs: [Panel, Panel, number][] = []
        for (const p of d.panels) {
          for (const q of d.panels) {
            if (p === q || isAnc(p, q) || isAnc(q, p)) continue
            const inv = end.get(q.id)!.clone().invert()
            const vs = p.outline.map((v) => toLocal(to3D(v).applyMatrix4(end.get(p.id)!), inv))
            if (!vs.every((v) => Math.abs(v.z) < 5)) continue
            const c = { x: vs.reduce((s, v) => s + v.p.x, 0) / vs.length, y: vs.reduce((s, v) => s + v.p.y, 0) / vs.length }
            const cz = vs.reduce((s, v) => s + v.z, 0) / vs.length
            if (Math.abs(cz) > 0.01 && inPoly(c, q.outline)) pairs.push([p, q, Math.sign(cz)])
          }
        }
        const bad: string[] = []
        for (let f = 0; f <= 1.0001; f += 0.01) {
          const M = computeMatrices(d.panels, f)
          for (const [p, q, side] of pairs) {
            const key = `${tp.id}:${p.id}→${q.id}`
            if (ALLOWED.has(key) || bad.includes(key)) continue
            if (normal(M.get(q.id)!).dot(normal(end.get(q.id)!)) < Math.cos((20 * Math.PI) / 180)) continue
            const inv = M.get(q.id)!.clone().invert()
            for (const v of p.outline) {
              const l = toLocal(to3D(v).applyMatrix4(M.get(p.id)!), inv)
              if (l.z * side < -1 && inPoly(l.p, q.outline)) {
                bad.push(key)
                break
              }
            }
          }
        }
        expect(bad).toEqual([])
      })
    }
  }
})
