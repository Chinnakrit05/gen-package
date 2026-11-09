import { describe, expect, it } from 'vitest'
import { computeMatrices, to3D } from '../fold'
import { getMaterial } from '../materials'
import type { Dieline, Panel } from '../types'
import { generateReverseTuckBox, generateTuckEndBox } from './tuckEnd'
import { tuckSlit } from './shared'

const carton = getMaterial('carton-300')
const box = { W: 80, D: 50, H: 120, handle: false }

const byId = (d: Dieline) => new Map(d.panels.map((p) => [p.id, p]))
const xs = (p: Panel) => p.outline.map((q) => q.x)
const minX = (p: Panel) => Math.min(...xs(p))
const maxX = (p: Panel) => Math.max(...xs(p))
// จุดศูนย์กลางของแผงหลังพับสุด (พิกัด 3D)
const centre3 = (d: Dieline, id: string) => {
  const end = computeMatrices(d.panels, 1)
  const p = d.panels.find((q) => q.id === id)!
  const pts = p.outline.map((v) => to3D(v).applyMatrix4(end.get(id)!))
  const n = pts.length
  return pts.reduce((s, v) => s.add(v.clone().divideScalar(n)), to3D({ x: 0, y: 0 }).multiplyScalar(0))
}

describe('กล่องฝาเสียบสลับ (reverse tuck)', () => {
  const rte = generateReverseTuckBox(box, carton)
  const ste = generateTuckEndBox(box, carton)
  const by = byId(rte)

  it('ผังแผ่นคลี่: ปีกกาว | หลัง | ข้างซ้าย | หน้า | ข้างขวา — ฝาบนที่หลัง ฝาล่างที่หน้า ปีกกาวต่อจากหลัง', () => {
    const order = ['glue', 'back', 'side-left', 'front', 'side-right'].map((id) => minX(by.get(id)!))
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(by.get('glue')!.parentId).toBe('back')
    expect(by.get('tuck-top')!.parentId).toBe('back')
    expect(by.get('tuck-bot')!.parentId).toBe('front')
    // ฝาบนอยู่เหนือแผงหลัง ฝาล่างอยู่ใต้แผงหน้า (คนละคอลัมน์)
    expect(minX(by.get('tuck-top')!)).toBeLessThan(minX(by.get('side-left')!))
    expect(minX(by.get('tuck-bot')!)).toBeGreaterThan(minX(by.get('front')!))
    expect(rte.width).toBeCloseTo(ste.width, 6)
  })

  it('พับแล้วได้กล่องเดียวกับฝาเสียบปกติ: ผนังทุกด้าน + ฝาบน/ล่างปิดตรงตำแหน่งเดียวกัน', () => {
    for (const id of ['front', 'back', 'side-left', 'side-right', 'tuck-top', 'tuck-bot']) {
      // แผงหน้าเป็นรากทั้งคู่ แต่อยู่คนละตำแหน่งบนแผ่นคลี่ → เทียบตำแหน่งสัมพัทธ์กับแผงหน้า
      const a = centre3(rte, id).sub(centre3(rte, 'front'))
      const b = centre3(ste, id).sub(centre3(ste, 'front'))
      expect(a.distanceTo(b), id).toBeLessThan(1)
    }
  })

  it('ลิ้นกันฝุ่นมีไหล่ล็อกฝั่งผนังที่ลิ้นเสียบสอดลง (บน → ผนังหน้า, ล่าง → ผนังหลัง)', () => {
    // ไหล่ = ด้านที่บากเข้ามากกว่า: ขอบปลายลิ้น (จุดที่ไกลจากบานพับที่สุด) ร่นจากปลายบานพับฝั่งนั้นมากกว่าอีกฝั่ง
    const insetAtMid = (id: string, end: 'left' | 'right') => {
      const p = by.get(id)!
      const far = Math.max(...p.outline.map((q) => Math.abs(q.y - p.hingeA!.y)))
      const tip = p.outline.filter((q) => Math.abs(Math.abs(q.y - p.hingeA!.y) - far) < 1e-6)
      return end === 'left' ? Math.min(...tip.map((q) => q.x)) - minX(p) : maxX(p) - Math.max(...tip.map((q) => q.x))
    }
    // บน: ข้างซ้ายติดหน้าที่ปลายขวา, ข้างขวาติดหน้าที่ปลายซ้าย
    expect(insetAtMid('dust-tl', 'right')).toBeGreaterThan(insetAtMid('dust-tl', 'left') + 1)
    expect(insetAtMid('dust-tr', 'left')).toBeGreaterThan(insetAtMid('dust-tr', 'right') + 1)
    // ล่าง: ข้างซ้ายติดหลังที่ปลายซ้าย, ข้างขวาติดหลัง (ผ่านปีกกาว) ที่ปลายขวา
    expect(insetAtMid('dust-bl', 'left')).toBeGreaterThan(insetAtMid('dust-bl', 'right') + 1)
    expect(insetAtMid('dust-br', 'right')).toBeGreaterThan(insetAtMid('dust-br', 'left') + 1)
  })

  it('ปลายรอยพับลิ้นเสียบเป็นร่องล็อก (เส้นตัด) — รอยพับสั้นกว่าฝาข้างละ slit', () => {
    const lid = by.get('tuck-top')!
    const lidW = maxX(lid) - minX(lid)
    const yi = Math.min(...lid.outline.map((q) => q.y))
    const tongueCrease = rte.segments.find((s) => s.kind === 'crease' && new RegExp(`^M [\\d.]+ ${yi} L [\\d.]+ ${yi}$`).test(s.d))!
    const [, xa, xb] = tongueCrease.d.match(/^M ([\d.]+) [\d.]+ L ([\d.]+)/)!.map(Number)
    expect(xb - xa).toBeCloseTo(lidW - 2 * tuckSlit(lidW), 6)
    // ร่องล็อกเป็นเส้นตัดตามแนวเดียวกันที่ปลายทั้งสอง
    const slits = rte.segments.filter((s) => s.kind === 'cut' && s.d.includes(` ${yi} L `) && s.d.endsWith(` ${yi}`))
    expect(slits.length).toBeGreaterThanOrEqual(1)
  })

  it('รูหิ้วเจาะบนฝาบน (แผงหลัง)', () => {
    const h = generateReverseTuckBox({ ...box, handle: true }, carton)
    expect(byId(h).get('tuck-top')!.holes?.length).toBe(1)
  })
})
