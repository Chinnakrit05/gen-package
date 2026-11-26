import { describe, expect, it } from 'vitest'
import { getTemplate } from './templates'
import { getMaterial } from './materials'
import { BLEED_MM, bleedFillPolys, clampBleed, computeGuides } from './guides'
import { bleedCoverRect, fillImageRect, panelsBBox } from './artwork'
import { dielinePDFBytes } from './pdf'
import { parseProject } from './project'
import { parseProjectFile, serializeProject } from './projectFile'
import type { Vec2 } from './types'

// ระยะตัดตก (Project.bleed 3–10 มม.): เส้นไกด์ + สีพื้น/รูปพื้นเลยเส้นตัดขอบนอก + ขอบไฟล์ผลิต
const d = getTemplate('tuck-end').generate({ W: 80, D: 50, H: 120, handle: false }, getMaterial('carton-300'))

const inPoly = (pt: Vec2, poly: Vec2[]) => {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c
  }
  return c
}
const covered = (pt: Vec2, polys: Vec2[][]) => polys.some((p) => inPoly(pt, p))
// จุดกึ่งกลางขอบล่างของแผงหน้า (ขอบนอก = เส้นตัดตรงของผนังที่ไม่มีฝาล่าง) แล้วยื่นออกนอกแผ่น
const front = d.panels.find((p) => p.id === 'front')!
const fx = (Math.min(...front.outline.map((q) => q.x)) + Math.max(...front.outline.map((q) => q.x))) / 2
const fy = Math.max(...front.outline.map((q) => q.y))

describe('ระยะตัดตก', () => {
  it('clampBleed: 3–10 มม. ปัดครึ่งมม.; ค่าเพี้ยน = 3', () => {
    expect(clampBleed(1)).toBe(3)
    expect(clampBleed(12)).toBe(10)
    expect(clampBleed(5.3)).toBe(5.5)
    expect(clampBleed('x')).toBe(BLEED_MM)
  })

  it('เส้นไกด์ bleed อยู่ห่างเส้นตัดเท่าระยะที่ตั้ง', () => {
    for (const b of [3, 6, 10]) {
      const g = computeGuides(d, b)
      // เส้นไกด์ช่วงที่ผ่านแนวตั้งกึ่งกลางแผงหน้า ใต้ขอบล่าง (เส้นตรงเหลือแค่จุดปลาย → หาจุดตัดของช่วง)
      const ys: number[] = []
      for (const line of g.bleed)
        for (let i = 0; i < line.length - 1; i++) {
          const a = line[i]
          const c = line[i + 1]
          if ((a.x - fx) * (c.x - fx) > 0 || a.x === c.x) continue
          const y = a.y + ((fx - a.x) / (c.x - a.x)) * (c.y - a.y)
          if (y > fy) ys.push(y)
        }
      expect(ys.length).toBeGreaterThan(0)
      expect(Math.min(...ys) - fy).toBeCloseTo(b, 1)
    }
  })

  it('พื้นที่สีพื้นคลุมแถบตัดตกนอกเส้นตัด แต่ไม่เลยระยะที่ตั้ง; 0 = เฉพาะแผง', () => {
    const polys = bleedFillPolys(d, 5)
    expect(covered({ x: fx, y: fy + 4.5 }, polys)).toBe(true)
    expect(covered({ x: fx, y: fy + 5.5 }, polys)).toBe(false)
    expect(covered({ x: fx, y: fy + 1 }, bleedFillPolys(d, 0))).toBe(false)
    // ทุกรูปหันทิศเดียวกัน (เติม nonzero ไม่เกิดรู)
    const area = (p: Vec2[]) => p.reduce((s, q, i) => s + q.x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * q.y, 0)
    for (const p of polys) expect(area(p)).toBeGreaterThan(0)
  })

  it('รูปพื้น cover ขยายรอบกึ่งกลางพอคลุมแถบตัดตก; contain ไม่ขยาย', () => {
    const box = panelsBBox(d)
    const cover = { src: '', aspect: 1, fit: 'cover' as const }
    const r = bleedCoverRect(fillImageRect(box, cover), box, cover, 6)
    expect(r.x).toBeLessThanOrEqual(box.x0 - 6 + 1e-6)
    expect(r.y).toBeLessThanOrEqual(box.y0 - 6 + 1e-6)
    expect(r.x + r.w).toBeGreaterThanOrEqual(box.x1 + 6 - 1e-6)
    expect(r.y + r.h).toBeGreaterThanOrEqual(box.y1 + 6 - 1e-6)
    const contain = { ...cover, fit: 'contain' as const }
    const c0 = fillImageRect(box, contain)
    expect(bleedCoverRect(c0, box, contain, 6)).toEqual(c0)
  })

  it('PDF: หน้ากว้างพอสำหรับแถบตัดตก และภาพลายวางเกินกรอบแผ่นเท่า margin', () => {
    const K = 72 / 25.4
    const bytes = dielinePDFBytes(d, false, { jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), w: 1, h: 1, margin: 8 }, null, '#123456', null, null, null, 8)
    const s = new TextDecoder('latin1').decode(bytes)
    const mb = /MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(s)!
    const pad = 8 + 3
    expect(Number(mb[1])).toBeCloseTo((d.width + pad * 2) * K, 1)
    expect(s).toContain(`${(d.width + 16).toFixed(3)} 0 0 ${(d.height + 16).toFixed(3)} ${(pad - 8).toFixed(3)} ${(pad - 8).toFixed(3)} cm`)
  })

  it('เก็บในงาน: เฉพาะเมื่อ ≠ 3, ตัดค่าเกินช่วง และผ่านไฟล์ .genpkg.json', () => {
    const base = { id: 'p', name: 'x', updatedAt: 0, live: { template: 'tuck-end', materialId: 'carton-300', W: 80, D: 50, H: 120, handle: false }, qty: 1, fillColor: null, decos: [], history: [], histIdx: -1 }
    expect(parseProject({ ...base, bleed: 7 }, 0)!.bleed).toBe(7)
    expect(parseProject({ ...base, bleed: 3 }, 0)!.bleed).toBeUndefined()
    expect(parseProject({ ...base, bleed: 40 }, 0)!.bleed).toBe(10)
    const file = serializeProject(parseProject({ ...base, bleed: 6.5 }, 0)!)
    const back = parseProjectFile(file)
    expect(back.ok && back.project.bleed).toBe(6.5)
  })
})
