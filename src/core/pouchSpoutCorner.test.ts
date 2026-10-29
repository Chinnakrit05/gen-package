import { describe, expect, it } from 'vitest'
import {
  generatePouch,
  spoutBoatT,
  spoutChamfer,
  spoutCornerBulge,
  spoutMarker,
  type SpoutCorner,
} from './pouch'
import { pouchZipIssues } from './pouchPreflight'
import { getMaterial } from './materials'
import { parseProject } from './project'

// ถุงมีจุก: จุกมุมบนซ้าย/ขวา — มุมตัดเฉียง 45° แผงหลังสะท้อนซ้าย-ขวา, ฟิล์มนูนคลุมเรือ; ไม่มีออปชันเสริมของถุงอื่น
const box = { W: 100, D: 50, H: 160, handle: false }
const foil = getMaterial('pouch-foil')
const make = (spoutAt?: SpoutCorner, zipper = false) =>
  generatePouch(box, foil, { style: 'spout', zipper, addons: spoutAt ? { spoutAt } : {} })

describe('ถุงจุกมุม: dieline', () => {
  const W = box.W

  it('จุกกลาง (ค่าเริ่มต้น) ไม่มีมุมเฉียง', () => {
    const p = make()
    expect(p.spoutCorner).toBeUndefined()
    expect(p.trims).toHaveLength(0)
  })

  for (const at of ['left', 'right'] as const) {
    it(`${at}: แผงหน้าตัดมุมด้าน${at === 'left' ? 'ซ้าย' : 'ขวา'} แผงหลังตัดมุมสะท้อน (ตรงกันเมื่อประกบ)`, () => {
      const p = make(at)
      const c = p.spoutCorner!.c
      expect(p.spoutCorner!.side).toBe(at)
      expect(c).toBeCloseTo(spoutChamfer(W, p.frontRect.y), 9)
      // ขอบเฉียงยาวพอให้เรือจุกวางพร้อมระยะเผื่อ
      expect(c * Math.SQRT2).toBeGreaterThan(spoutMarker(W, p.frontRect.y).bw)
      const [front, back] = p.label.panels
      // ระยะจากมุมบนด้านจุก (ท้องถิ่น u + y) ไม่ต่ำกว่า c: ไม่มีเนื้อฟิล์มในสามเหลี่ยมที่ตัดทิ้ง
      const fu = (x: number) => (at === 'left' ? x : W - x)
      const bu = (x: number) => (at === 'left' ? 2 * W - x : x - W)
      expect(Math.min(...front.outline.map((q) => fu(q.x) + q.y))).toBeGreaterThanOrEqual(c - 1e-6)
      expect(Math.min(...back.outline.map((q) => bu(q.x) + q.y))).toBeGreaterThanOrEqual(c - 1e-6)
      // มุมฝั่งตรงข้ามยังเต็ม (แค่มนตามไดคัท) — ขอบบนยาวเกือบเต็มแผง
      const topXs = front.outline.filter((q) => q.y < 1e-6).map((q) => fu(q.x))
      expect(Math.max(...topXs)).toBeGreaterThan(W - 7)
      expect(Math.min(...topXs)).toBeGreaterThanOrEqual(c)
      // 3D ตัดมุมเฉียงด้วย mask: สามเหลี่ยมคลุมจุดมุมแผ่นของทั้งสองแผง
      expect(p.trims.length).toBe(4)
    })
  }
})

describe('ถุงจุกมุม: ฟิล์มคลุมเรือ (3D)', () => {
  const p = make('left')
  const st = p.frontRect.y
  const c = p.spoutCorner!.c
  const bulge = (uf: number, dl: number) => spoutCornerBulge(box.W, st, c, uf, dl)

  it('นูนเต็มความหนาเรือที่กลางขอบเฉียง แล้วลาดหายก่อนถึงขอบข้าง/ขอบบน', () => {
    expect(bulge(c / 2 + 2, c / 2 + 2)).toBeCloseTo(spoutBoatT(box.W, st), 1)
    // ขอบข้างด้านจุก/ขอบบน (ซีลประกบ) ช่วงที่เหลือหลังตัดมุม (ในสามเหลี่ยมมุมไม่มีฟิล์มแล้ว)
    for (let dl = c; dl <= 120; dl += 2) expect(bulge(0, dl)).toBe(0)
    for (let uf = c; uf <= box.W; uf += 2) expect(bulge(uf, 0)).toBe(0)
    expect(bulge(box.W / 2, 60)).toBe(0) // กลางถุง
    // ลึกเลยปลายเรือ → แนบผิวถุง
    const d = spoutMarker(box.W, st).bh + 8
    expect(bulge(c / 2 + d / Math.SQRT2, c / 2 + d / Math.SQRT2)).toBe(0)
  })
})

describe('ถุงมีจุก: ไม่มีซิป/รอยฉีก/รูแขวน/วาล์ว/ที่รัดปาก (เปิด-ปิดด้วยฝาจุก)', () => {
  for (const spoutAt of [undefined, 'left'] as const) {
    it(`จุก${spoutAt ? 'มุม' : 'กลาง'}: ค่าที่เคยเก็บในงานไม่ถูกใช้ — แบบพิมพ์/3D/ตรวจไฟล์สะอาด`, () => {
      const p = generatePouch(box, foil, {
        style: 'spout',
        zipper: true,
        addons: { spoutAt, tear: 'notch', hangHole: true, valve: true, tinTie: true, zipAt: 40, tearAt: 30 },
      })
      expect(p.zipper).toBe(false)
      expect(p.zipY).toBeUndefined()
      expect(p.tear).toBe('none')
      expect(p.tearNotches).toHaveLength(0)
      expect(p.hangHole || p.valve || p.tinTie).toBe(false)
      expect(p.hangHoles).toHaveLength(0)
      expect(p.valveAt).toBeUndefined()
      expect(p.spoutCorner?.side).toBe(spoutAt)
      expect(pouchZipIssues(p)).toEqual([])
    })
  }
})

describe('บันทึก spoutAt', () => {
  const base = { id: 'x', name: 'n', live: { template: 'tuck-end', materialId: 'pouch-foil', W: 100, D: 50, H: 160, handle: false }, decos: [] }
  it('เก็บเฉพาะ left/right — ค่าอื่นทิ้ง', () => {
    expect(parseProject({ ...base, pouchAddons: { spoutAt: 'right' } }, 0)!.pouchAddons).toEqual({ spoutAt: 'right' })
    expect(parseProject({ ...base, pouchAddons: { spoutAt: 'top' } }, 0)!.pouchAddons).toBeUndefined()
  })
})
