import { describe, expect, it } from 'vitest'
import {
  HANG_HOLE_R,
  ZIGZAG_PITCH,
  generatePouch,
  hangHoleY,
  resolveTear,
  tearAtDefault,
  zigzagDepth,
  zigzagTop,
  type PouchAddons,
  type PouchStyle,
} from './pouch'
import { pouchZipIssues } from './pouchPreflight'
import { getMaterial } from './materials'
import { parseProject } from './project'

// ซิปล็อกกับรอยฉีกแยกกัน + รอยฉีกแบบขอบบนฟันปลา
const box = { W: 140, D: 80, H: 200, handle: false }
const foil = getMaterial('pouch-foil')
const make = (style: PouchStyle, zipper: boolean, addons: PouchAddons = {}) =>
  generatePouch(box, foil, { style, zipper, addons })

describe('รอยฉีกแยกจากซิป', () => {
  it('ค่าเดิม: มีซิปไม่ได้เลือกรอยฉีก = รอยบาก V (งานเก่าไม่เปลี่ยน), ไม่มีซิป = ไม่มีรอยฉีก', () => {
    expect(resolveTear(true)).toBe('notch')
    expect(resolveTear(false)).toBe('none')
    const p = make('stand', true)
    expect(p.tear).toBe('notch')
    expect(p.tearNotches).toHaveLength(4)
  })

  it('ซิปอย่างเดียว: มีแนวซิป ไม่มีรอยบาก และไม่มีคำเตือนเรื่องรอยฉีก', () => {
    const p = make('stand', true, { tear: 'none' })
    expect(p.zipY).toBeDefined()
    expect(p.tearY).toBeUndefined()
    expect(p.tearNotches).toHaveLength(0)
    expect(pouchZipIssues(p).filter((i) => i.code.startsWith('tear'))).toEqual([])
  })

  it('รอยบากอย่างเดียว: ใต้ซีลบน ไม่มีแนวซิป/ซิปใน 3D', () => {
    const p = make('stand', false, { tear: 'notch' })
    expect(p.zipY).toBeUndefined()
    expect(p.tearY).toBe(tearAtDefault(p.frontRect.y, box.H))
    expect(p.tearY! - p.frontRect.y).toBeGreaterThanOrEqual(3)
    expect(p.tearNotches).toHaveLength(4)
    expect(pouchZipIssues(p)).toEqual([])
  })
})

describe('ขอบบนฟันปลา', () => {
  it('zigzagTop: ฟันเต็มจำนวน ยอดอยู่ที่ขอบ ร่องลึก d', () => {
    const z = zigzagTop(0, 100, 2)
    expect(z.gaps).toHaveLength(Math.round(100 / ZIGZAG_PITCH))
    expect(z.path.trim().split(' L ').at(-1)).toBe('100 0')
    for (const g of z.gaps) expect(Math.max(...g.map((q) => q.y))).toBe(2)
  })

  for (const style of ['stand', 'kseal', 'flat', 'gusset', 'box', 'pillow'] as const) {
    it(`${style}: เส้นตัดขอบบนเป็นฟันปลา ร่องไม่ลึกเกินครึ่งซีลบน และ 3D เจาะร่องผ่าน trims`, () => {
      const p = make(style, false, { tear: 'zigzag' })
      const st = p.frontRect.y
      expect(p.tear).toBe('zigzag')
      const outer = p.label.segments.find((s) => s.kind === 'cut')!.d
      const ys = [...outer.matchAll(/L ([\d.]+) ([\d.]+)/g)].map((m) => Number(m[2])).filter((y) => y < st)
      const d = Math.max(...ys)
      expect(d).toBeGreaterThan(0)
      expect(d).toBeLessThanOrEqual(Math.min(zigzagDepth(st), 2) + 1e-9)
      expect(p.trims.length).toBeGreaterThan(10)
      expect(p.tearNotches).toHaveLength(0)
    })
  }

  it('มีรูแขวน: ร่องฟันไม่กินถึงรูแขวน', () => {
    const p = make('stand', false, { tear: 'zigzag', hangHole: true })
    const st = p.frontRect.y
    const deepest = Math.max(...p.trims.flatMap((t) => t.map((q) => q.y)))
    expect(deepest).toBeLessThan(hangHoleY(st) - HANG_HOLE_R)
  })

  it('ถุงมีจุกไม่มีขอบฟันปลา (ขอบบนเป็นที่เชื่อมจุก)', () => {
    expect(make('spout', false, { tear: 'zigzag' }).tear).toBe('none')
  })

  it('บันทึก tear ได้เฉพาะค่าที่รู้จัก', () => {
    const base = { id: 'x', name: 'n', live: { template: 'tuck-end', materialId: 'pouch-foil', W: 140, D: 80, H: 200, handle: false }, decos: [] }
    expect(parseProject({ ...base, pouchAddons: { tear: 'zigzag' } }, 0)!.pouchAddons).toEqual({ tear: 'zigzag' })
    expect(parseProject({ ...base, pouchAddons: { tear: 'laser' } }, 0)!.pouchAddons).toBeUndefined()
  })
})

describe('ขอบฟันปลา: ฟันทุกชั้นตรงกันในถุงที่ขึ้นรูป (ไดคัทตัดทะลุทีเดียว)', () => {
  // ความลึกร่องที่พิกัดฟิล์ม u จากเส้นตัดขอบบน
  const depthAt = (outer: string, u: number) => {
    const pts = [...outer.matchAll(/L ([\d.e-]+) ([\d.e-]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const)
    for (let i = 1; i < pts.length; i++) {
      const [[x0, y0], [x1, y1]] = [pts[i - 1], pts[i]]
      if (u >= x0 - 1e-9 && u <= x1 + 1e-9 && x1 > x0) return y0 + ((y1 - y0) * (u - x0)) / (x1 - x0)
    }
    return NaN
  }
  const W = box.W
  const cases: [PouchStyle, (u: number) => number][] = [
    ['stand', (u) => 2 * W - u], // หลังกลับด้าน
    ['flat', (u) => 2 * W - u],
    ['gusset', (u) => 2 * W + box.D - u], // หลังอยู่ถัดจีบ
  ]
  for (const [style, backOf] of cases) {
    it(`${style}: ร่องฟันหน้า = หลังที่ตำแหน่งเดียวกัน`, () => {
      const p = make(style, false, { tear: 'zigzag' })
      const outer = p.label.segments.find((s) => s.kind === 'cut')!.d
      for (let u = 0.3; u < W; u += 1.7) expect(depthAt(outer, backOf(u))).toBeCloseTo(depthAt(outer, u), 6)
      expect(depthAt(outer, 0)).toBeCloseTo(0, 9) // ขอบถุงเป็นยอดฟัน
      expect(depthAt(outer, W)).toBeCloseTo(0, 9)
    })
  }
  it('ซองหลังกลาง: หลังสองซีกต่อกันตรงฟันหน้า', () => {
    const p = make('pillow', false, { tear: 'zigzag' })
    const outer = p.label.segments.find((s) => s.kind === 'cut')!.d
    const f0 = p.frontRect.x
    for (let x = 0.4; x < W; x += 1.3) {
      // X = x บนหน้า ↔ หลัง: ซีกขวาเริ่มที่ขอบขวาหน้า (X = W) วิ่งกลับมา X = W/2, ซีกซ้ายจาก X = W/2 ถึง 0
      const back = x >= W / 2 ? f0 + W + (W - x) : p.backRectL!.x + (W / 2 - x)
      expect(depthAt(outer, back)).toBeCloseTo(depthAt(outer, f0 + x), 6)
    }
  })
})

describe('รอยบาก V: ทะลุทุกชั้นที่ขอบข้างจริงของถุง', () => {
  // จุดยอดบากที่ขอบ (ตำแหน่ง u ของปากบาก) ของแต่ละสามเหลี่ยม
  const mouths = (p: ReturnType<typeof make>) => p.tearNotches.map((t) => t[0].x).sort((a, b) => a - b)

  it('ซองแบน/ถุงตั้ง: แผงหน้า-หลังสองข้าง = 4 บาก ใต้ซีลบน', () => {
    for (const style of ['flat', 'stand'] as const) {
      const p = make(style, false, { tear: 'notch' })
      expect(mouths(p)).toEqual([0, box.W, box.W, 2 * box.W])
      expect(p.tearY!).toBeGreaterThan(p.frontRect.y)
    }
  })

  it('ซองข้างจีบ: บากทุกชั้นที่ขอบพับ (หน้า/จีบสองชั้น/หลัง/ลิ้นกาว) และอยู่ในแนวซีลบน (ข้างพับใต้ซีลจะรั่ว)', () => {
    const p = make('gusset', false, { tear: 'notch' })
    const { W } = box
    const g = p.gusset
    const Wp = 2 * W + 2 * g
    expect(mouths(p)).toEqual([0, W, W, W + g, W + g, 2 * W + g, 2 * W + g, Wp, Wp].sort((a, b) => a - b))
    expect(p.tearY! + 2.5).toBeLessThanOrEqual(p.frontRect.y)
    expect(pouchZipIssues(p)).toEqual([])
    // ผู้ใช้เลื่อนลงใต้ซีล → error รั่ว
    const low = make('gusset', false, { tear: 'notch', tearAt: p.frontRect.y + 10 })
    expect(pouchZipIssues(low).map((i) => i.code)).toContain('tear-fold')
  })

  it('ซองหลังกลาง: บากที่สันพับสองข้าง ทั้งหน้าและหลัง ในแนวซีลบน (ไม่ใช่ปลายครีบกลางหลัง)', () => {
    const p = make('pillow', false, { tear: 'notch' })
    const f0 = p.frontRect.x
    const { W } = box
    expect(mouths(p)).toEqual([f0, f0, f0 + W, f0 + W])
    expect(p.tearY! + 2.5).toBeLessThanOrEqual(p.frontRect.y)
  })
})

describe('รูแขวนทะลุทุกชั้น', () => {
  it('ซองหลังกลาง: รูกลางหน้า + คร่อมรอยต่อกลางหลังทั้งสองปลายฟิล์ม (หลัง+ครีบ) — ไม่งั้นชั้นหลังปิดรู', () => {
    const p = make('pillow', false, { hangHole: true })
    const f0 = p.frontRect.x
    const xs = p.hangHoles.map((h) => h.x).sort((a, b) => a - b)
    expect(xs).toEqual([p.backRectL!.x, f0 + box.W / 2, f0 + 1.5 * box.W].sort((a, b) => a - b))
    expect(p.hangHoles.filter((h) => h.cut)).toHaveLength(1) // dieline ตัดรูหน้า ชั้นอื่นเจาะหลังขึ้นรูป
  })
  it('ซองข้างจีบ: รูหน้า + รูหลังตรงกัน', () => {
    const p = make('gusset', false, { hangHole: true })
    expect(p.hangHoles.map((h) => h.x)).toEqual([box.W / 2, box.W + p.gusset + box.W / 2])
  })
})
