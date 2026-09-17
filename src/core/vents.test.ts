import { describe, expect, it } from 'vitest'
import { getTemplate } from './templates'
import { getMaterial } from './materials'
import { applyVents, parseVents, DEFAULT_VENTS, type VentConfig } from './vents'
import type { Panel, Vec2 } from './types'

// รูระบายอากาศเป็น post-process เชิงเรขาคณิตล้วน — ตรวจว่ารูถูกเติมลงผนังที่ถูกต้อง
// จำนวนตรง (rows×cols/ผนัง) อยู่ในกรอบผนัง และ segment 'cut' เพิ่มขึ้นเท่าจำนวนรู

const mat = getMaterial('corrugated-b')
const rsc = getTemplate('rsc')
const base = rsc.generate({ W: 250, D: 200, H: 150, handle: false }, mat)

const panelById = (panels: Panel[], id: string) => panels.find((p) => p.id === id)!
const bbox = (o: Vec2[]) => ({
  x0: Math.min(...o.map((p) => p.x)),
  y0: Math.min(...o.map((p) => p.y)),
  x1: Math.max(...o.map((p) => p.x)),
  y1: Math.max(...o.map((p) => p.y)),
})
const cfg = (o: Partial<VentConfig>): VentConfig => ({ ...DEFAULT_VENTS, on: true, ...o })

describe('applyVents', () => {
  it('ปิด/undefined → คืน dieline เดิมไม่แตะ', () => {
    expect(applyVents(base, undefined)).toBe(base)
    expect(applyVents(base, { ...DEFAULT_VENTS, on: false })).toBe(base)
  })

  it('sides → เจาะเฉพาะผนังหน้า-หลัง (front/back) แถว×คอลัมน์ต่อผนัง', () => {
    const rows = 3
    const cols = 6
    const d = applyVents(base, cfg({ walls: 'sides', rows, cols, dia: 8 }))
    expect(panelById(d.panels, 'front').holes?.length).toBe(rows * cols)
    expect(panelById(d.panels, 'back').holes?.length).toBe(rows * cols)
    expect(panelById(d.panels, 'side-left').holes).toBeUndefined()
    expect(panelById(d.panels, 'side-right').holes).toBeUndefined()
    // เพิ่ม segment cut = จำนวนรูรวม (2 ผนัง)
    const cuts = d.segments.length - base.segments.length
    expect(cuts).toBe(2 * rows * cols)
  })

  it('ends → เจาะเฉพาะผนังหัวท้าย (side-left/right)', () => {
    const d = applyVents(base, cfg({ walls: 'ends', rows: 2, cols: 4 }))
    expect(panelById(d.panels, 'side-left').holes?.length).toBe(8)
    expect(panelById(d.panels, 'side-right').holes?.length).toBe(8)
    expect(panelById(d.panels, 'front').holes).toBeUndefined()
  })

  it('all → เจาะทั้งสี่ผนัง', () => {
    const d = applyVents(base, cfg({ walls: 'all', rows: 2, cols: 2 }))
    for (const id of ['front', 'back', 'side-left', 'side-right']) {
      expect(panelById(d.panels, id).holes?.length).toBe(4)
    }
  })

  it('รูอยู่ในกรอบผนังทั้งหมด', () => {
    const r = 8 / 2
    const d = applyVents(base, cfg({ walls: 'all', rows: 3, cols: 5, dia: 8 }))
    const front = panelById(d.panels, 'front')
    const b = bbox(front.outline)
    for (const ring of front.holes ?? []) {
      for (const pt of ring) {
        expect(pt.x).toBeGreaterThanOrEqual(b.x0)
        expect(pt.x).toBeLessThanOrEqual(b.x1)
        expect(pt.y).toBeGreaterThanOrEqual(b.y0)
        expect(pt.y).toBeLessThanOrEqual(b.y1)
      }
    }
    // ขอบสุดของรูต้องพ้นขอบผนังอย่างน้อยรัศมี
    const centers = (front.holes ?? []).map((ring) => ({
      x: ring.reduce((s, p) => s + p.x, 0) / ring.length,
      y: ring.reduce((s, p) => s + p.y, 0) / ring.length,
    }))
    for (const c of centers) {
      expect(c.x - r).toBeGreaterThanOrEqual(b.x0)
      expect(c.x + r).toBeLessThanOrEqual(b.x1)
    }
  })

  it('ผนังแคบ → ลดจำนวนรูอัตโนมัติไม่ให้ซ้อนทับ (auto-fit)', () => {
    // tuck-end ผนังหัวท้าย = ด้านลึก D=50 มม. (แคบ) — ขอ 12 คอลัมน์ รู ⌀8
    const small = getTemplate('tuck-end').generate(
      { W: 80, D: 50, H: 120, handle: false },
      getMaterial('carton-300'),
    )
    const d = applyVents(small, cfg({ walls: 'ends', rows: 1, cols: 12, dia: 8 }))
    const end = panelById(d.panels, 'side-left')
    const n = end.holes?.length ?? 0
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThan(12) // ถูกลดลงเพราะผนังแคบ
    // จุดศูนย์กลางที่ติดกันต้องห่าง ≥ เส้นผ่านศูนย์กลาง (ไม่ซ้อน)
    const cx = (ring: Vec2[]) => ring.reduce((s, p) => s + p.x, 0) / ring.length
    const xs = (end.holes ?? []).map(cx).sort((a, b) => a - b)
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(8)
  })

  it('ไม่ทำลาย holes เดิมของผนัง (ต่อท้าย)', () => {
    const withHole = {
      ...base,
      panels: base.panels.map((p) =>
        p.id === 'front' ? { ...p, holes: [[{ x: 0, y: 0 }]] } : p,
      ),
    }
    const d = applyVents(withHole, cfg({ walls: 'sides', rows: 1, cols: 1 }))
    // 1 รูเดิม + 1 รูใหม่
    expect(panelById(d.panels, 'front').holes?.length).toBe(2)
  })
})

describe('parseVents', () => {
  it('on ไม่เป็น true → undefined (เก็บเฉพาะเมื่อเปิด)', () => {
    expect(parseVents(undefined)).toBeUndefined()
    expect(parseVents({ on: false, dia: 8 })).toBeUndefined()
    expect(parseVents({ dia: 8 })).toBeUndefined()
  })

  it('clamp ค่าให้อยู่ในช่วง + walls ที่ไม่รู้จัก → sides', () => {
    const v = parseVents({ on: true, walls: 'xxx', dia: 999, rows: 99, cols: 99 })!
    expect(v.on).toBe(true)
    expect(v.walls).toBe('sides')
    expect(v.dia).toBeLessThanOrEqual(30)
    expect(v.rows).toBeLessThanOrEqual(10)
    expect(v.cols).toBeLessThanOrEqual(16)
  })

  it('ค่าปกติ round-trip', () => {
    const v = parseVents({ on: true, walls: 'ends', dia: 10, rows: 4, cols: 8 })!
    expect(v).toEqual({ on: true, walls: 'ends', dia: 10, rows: 4, cols: 8 })
  })
})
