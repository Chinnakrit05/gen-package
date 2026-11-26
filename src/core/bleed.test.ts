import { describe, expect, it } from 'vitest'
import { getTemplate } from './templates'
import { getMaterial } from './materials'
import { BLEED_MM, clampBleed, computeGuides } from './guides'
import { parseProject } from './project'
import { parseProjectFile, serializeProject } from './projectFile'

// ระยะตัดตก (Project.bleed 3–10 มม.) = เส้นรอบชั้นในที่ร่นจากเส้นรอบนอกของแผ่นเข้ามาเท่าระยะที่ตั้งทุกด้าน
// (เขตที่ไม่ควรวางกราฟิก/ข้อมูลสำคัญ) — ไม่ขยายขนาดแผ่น/ไฟล์ และสีพื้นยังเต็มแผงถึงเส้นตัดเหมือนเดิม
const d = getTemplate('tuck-end').generate({ W: 80, D: 50, H: 120, handle: false }, getMaterial('carton-300'))
// ขอบล่างของแผงหน้า = เส้นตัดขอบนอกตรง (ผนังที่ไม่มีฝาล่าง)
const front = d.panels.find((p) => p.id === 'front')!
const fx = (Math.min(...front.outline.map((q) => q.x)) + Math.max(...front.outline.map((q) => q.x))) / 2
const fy = Math.max(...front.outline.map((q) => q.y))

// จุดที่เส้นไกด์ตัดแนวตั้ง x = fx
const crossingsAtFx = (b: number) => {
  const ys: number[] = []
  for (const line of computeGuides(d, b).bleed)
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i]
      const c = line[i + 1]
      if ((a.x - fx) * (c.x - fx) > 0 || a.x === c.x) continue
      ys.push(a.y + ((fx - a.x) / (c.x - a.x)) * (c.y - a.y))
    }
  return ys
}

describe('ระยะตัดตก', () => {
  it('clampBleed: 3–10 มม. ปัดครึ่งมม.; ค่าเพี้ยน = 3', () => {
    expect(clampBleed(1)).toBe(3)
    expect(clampBleed(12)).toBe(10)
    expect(clampBleed(5.3)).toBe(5.5)
    expect(clampBleed('x')).toBe(BLEED_MM)
  })

  it('เส้นตัดตกอยู่ "ใน" เส้นตัดขอบนอก ห่างเท่าระยะที่ตั้ง', () => {
    for (const b of [3, 6, 10]) {
      const ys = crossingsAtFx(b)
      expect(ys.length).toBeGreaterThan(0)
      // ไม่มีเส้นออกนอกแผ่น
      expect(Math.max(...ys)).toBeLessThan(fy)
      // เส้นที่ใกล้ขอบล่างแผงหน้าที่สุดร่นเข้ามา b มม.
      const near = ys.filter((y) => y > fy - 15)
      expect(Math.max(...near)).toBeCloseTo(fy - b, 1)
    }
  })

  it('ทุกจุดของเส้นอยู่ในเนื้อวัสดุ และไม่เลยกรอบแผ่น', () => {
    const xs = d.panels.flatMap((p) => p.outline.map((q) => q.x))
    const ys = d.panels.flatMap((p) => p.outline.map((q) => q.y))
    for (const b of [3, 10])
      for (const line of computeGuides(d, b).bleed)
        for (const p of line) {
          expect(p.x).toBeGreaterThanOrEqual(Math.min(...xs) + b - 0.2)
          expect(p.x).toBeLessThanOrEqual(Math.max(...xs) - b + 0.2)
          expect(p.y).toBeGreaterThanOrEqual(Math.min(...ys) + b - 0.2)
          expect(p.y).toBeLessThanOrEqual(Math.max(...ys) - b + 0.2)
        }
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
