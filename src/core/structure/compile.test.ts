import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { computeMatrices, to3D } from '../fold'
import { getMaterial } from '../materials'
import { generateTuckEndBox } from '../templates/tuckEnd'
import { generateSleeve } from '../templates/sleeve'
import type { Dieline, Vec2 } from '../types'
import { compileStructure, foldedExtent } from './compile'
import { parseStructure, STRUCTURE_SCHEMA, type BoxStructure } from './grammar'
import { MAILER_STRUCTURE, REVERSE_TUCK_STRUCTURE, TRAY_STRUCTURE, TUCK_END_STRUCTURE, sleeveStructure } from './examples'
import { checkFoldSweep, polygonsOverlap } from './validate'

const carton = getMaterial('carton-300')
const box = { W: 80, D: 50, H: 120 }

// ตำแหน่ง 3D ของแผงหลังพับสุด (จุดบนขอบทุกจุด) — เทียบรูปทรงโดยไม่สนลำดับ/จำนวนจุด:
// ทุกจุดของ a ต้องอยู่ห่างขอบของ b ไม่เกิน tol และกลับกัน
function world(d: Dieline, id: string): Vector3[] {
  const end = computeMatrices(d.panels, 1)
  const p = d.panels.find((x) => x.id === id)!
  return p.outline.map((v) => to3D(v).applyMatrix4(end.get(id)!))
}
function distToSeg(p: Vector3, a: Vector3, b: Vector3): number {
  const ab = b.clone().sub(a)
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / Math.max(1e-9, ab.lengthSq())))
  return p.distanceTo(a.clone().add(ab.multiplyScalar(t)))
}
function boundaryGap(a: Vector3[], b: Vector3[]): number {
  let worst = 0
  for (const p of a) {
    let d = Infinity
    for (let i = 0; i < b.length; i++) d = Math.min(d, distToSeg(p, b[i], b[(i + 1) % b.length]))
    worst = Math.max(worst, d)
  }
  return worst
}
const samePanel = (a: Dieline, b: Dieline, id: string, tol: number) => {
  const pa = world(a, id)
  const pb = world(b, id)
  expect(boundaryGap(pa, pb), `${id}: a→b`).toBeLessThan(tol)
  expect(boundaryGap(pb, pa), `${id}: b→a`).toBeLessThan(tol)
}

describe('compileStructure reproduces hand-written templates', () => {
  it('tuck-end: every panel lands where generateTuckEndBox puts it (3D, after folding)', () => {
    const ref = generateTuckEndBox(box, carton)
    const out = compileStructure(TUCK_END_STRUCTURE, box, carton)
    expect(out.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(out.dieline).not.toBeNull()
    const d = out.dieline!
    expect(d.panels.map((p) => p.id).sort()).toEqual(ref.panels.map((p) => p.id).sort())
    // ลิ้นเสียบใช้ zOffset 0.15 ใน template แต่คอมไพเลอร์ใช้ชั้นวัสดุเต็ม (t+0.05) — ต่างกัน < 0.5 มม.
    for (const p of ref.panels) samePanel(d, ref, p.id, 0.6)
    expect(d.width).toBeCloseTo(ref.width, 3)
    expect(d.height).toBeCloseTo(ref.height, 3)
    expect(out.stages).toBe(4)
    expect(out.tilt).toBe(0)
    // ลำดับพับ: ลำตัว 0 → ลิ้นกันฝุ่น 1 → ฝา 2 → ลิ้นเสียบ 3 (เดาจากการจำลอง ไม่ได้บอกใน grammar)
    const stage = (id: string) => d.panels.find((p) => p.id === id)!.stage
    expect([stage('front'), stage('dust-tl'), stage('tuck-top'), stage('tongue-top')]).toEqual([0, 1, 2, 3])
    expect(d.panels.find((p) => p.id === 'tongue-top')!.tuck).toBe(true)
    // ปิดครบทุกด้าน
    for (const v of Object.values(out.coverage)) expect(v).toBeGreaterThan(0.85)
    expect(checkFoldSweep(d.panels)).toEqual([])
  })

  it('tuck-end on E-flute keeps thickness allowances in step with the template', () => {
    const mat = getMaterial('corrugated-e')
    const ref = generateTuckEndBox(box, mat)
    const d = compileStructure(TUCK_END_STRUCTURE, box, mat).dieline!
    for (const p of ref.panels) samePanel(d, ref, p.id, 1.9)
    expect(d.width).toBeCloseTo(ref.width, 3)
  })

  it('sleeve: open tube matches generateSleeve and reports the open ends', () => {
    const ref = generateSleeve(box, carton)
    const out = compileStructure(sleeveStructure(box.H), box, carton)
    expect(out.ok).toBe(true)
    for (const p of ref.panels) samePanel(out.dieline!, ref, p.id, 0.6)
    const open = out.issues.find((i) => i.code === 'open-faces')
    expect(open?.ids?.sort()).toEqual(['bottom', 'top'])
  })
})

describe('compileStructure infers fold order and layers from the fold simulation', () => {
  it('mailer-like box: front/back walls wait for the corner dust flaps, lid wraps outside', () => {
    const out = compileStructure(MAILER_STRUCTURE, { W: 200, D: 140, H: 60 }, carton)
    expect(out.issues.filter((i) => i.severity === 'error')).toEqual([])
    const d = out.dieline!
    const by = new Map(d.panels.map((p) => [p.id, p]))
    expect(by.get('side-left')!.stage).toBe(0)
    expect(by.get('dust-lb')!.stage).toBe(1)
    // ผนังหน้า/หลังถูกเลื่อนไปหลังลิ้นมุม (เดิม 0) เพราะไม่งั้นลิ้นกวาดทะลุ
    expect(by.get('front')!.stage).toBeGreaterThan(by.get('dust-lf')!.stage)
    expect(by.get('back')!.stage).toBeGreaterThan(by.get('dust-lb')!.stage)
    expect(by.get('lid')!.stage).toBeGreaterThan(by.get('back')!.stage)
    expect(by.get('lip')!.tuck).toBe(true)
    // ปีกข้างฝาห่อนอกผนังข้าง → ชั้นวัสดุเป็นลบ (ดันออกนอก); ลิ้นกันฝุ่นอยู่ด้านใน → บวก
    expect(by.get('lip-left')!.zOffset).toBeLessThan(0)
    expect(by.get('dust-lb')!.zOffset).toBeGreaterThan(0)
    expect(out.tilt).toBe(-Math.PI / 2)
    expect(checkFoldSweep(d.panels)).toEqual([])
    for (const v of Object.values(out.coverage)) expect(v).toBeGreaterThan(0.85)
    // ขนาดกล่องพับแล้ว ≈ ด้านใน + ความหนา
    // ปีกข้างฝาห่อนอกผนังสองข้าง จึงกว้างกว่าด้านนอกกล่องอีก 2 ชั้นวัสดุ
    const ext = foldedExtent(d)
    expect(Math.abs(ext.x - (200 + 2 * carton.thickness))).toBeLessThan(2 * (carton.thickness + 0.05) + 0.01)
    expect(ext.z).toBeGreaterThan(60)
  })

  it('reverse tuck (AI-designed, not in the template registry) compiles into a closed box', () => {
    const out = compileStructure(REVERSE_TUCK_STRUCTURE, { W: 70, D: 40, H: 110 }, carton)
    expect(out.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(out.stages).toBe(4)
    for (const v of Object.values(out.coverage)) expect(v).toBeGreaterThan(0.85)
    const by = new Map(out.dieline!.panels.map((p) => [p.id, p]))
    // ฝาบนห้อยจากผนังหน้า ฝาล่างจากผนังหลัง — คนละผนังกับ tuck-end ปกติ แต่ลิ้นเสียบยังได้ tuck และพับหลังสุด
    expect(by.get('tuck-top')!.parentId).toBe('front')
    expect(by.get('tuck-bot')!.parentId).toBe('back')
    expect(by.get('tongue-top')!.tuck).toBe(true)
    expect(by.get('tongue-top')!.stage).toBe(3)
    expect(checkFoldSweep(out.dieline!.panels)).toEqual([])
  })

  it('open tray: corner tabs fold before the front/back walls; top stays open on purpose', () => {
    const out = compileStructure(TRAY_STRUCTURE, { W: 160, D: 110, H: 40 }, carton)
    expect(out.issues.filter((i) => i.severity === 'error')).toEqual([])
    const by = new Map(out.dieline!.panels.map((p) => [p.id, p]))
    expect(by.get('front')!.stage).toBeGreaterThan(by.get('corner-lf')!.stage)
    expect(out.issues.find((i) => i.code === 'open-faces')?.ids).toEqual(['top'])
    expect(out.coverage.bottom).toBeGreaterThan(0.95)
  })
})

describe('compileStructure rejects structures that cannot be made', () => {
  const base = (over: Partial<BoxStructure>): BoxStructure => ({ ...TUCK_END_STRUCTURE, ...over })

  it('reports panels that overlap on the sheet instead of producing a dieline', () => {
    // ผนังหลังต่อจากด้านซ้ายของ side-left แทนด้านขวาของ side-right → ทับปีกทากาว
    const s = base({
      panels: TUCK_END_STRUCTURE.panels.map((p) =>
        p.id === 'back' ? { ...p, attach: { to: 'side-left', edge: 'left', fold: 90 as const } } : p,
      ),
    })
    // parseStructure จับว่าขอบซ้ายของ side-left ถูกใช้สองครั้ง (glue + back)
    const parsed = parseStructure(JSON.parse(JSON.stringify(s)))
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.issues.map((i) => i.code)).toContain('edge-used')
  })

  it('reports a lid that is too deep to fold without sweeping through the far wall', () => {
    const s = base({
      panels: TUCK_END_STRUCTURE.panels.map((p) => (p.id === 'tuck-top' ? { ...p, size: 140 } : p)),
    })
    const out = compileStructure(s, box, carton)
    expect(out.ok).toBe(false)
    expect(out.issues.map((i) => i.code)).toContain('lid-deep')
    expect(out.issues.find((i) => i.code === 'lid-deep')?.message).toContain('50.8')
  })

  it('warns about a lid that stops short of the far wall', () => {
    const s = base({
      panels: TUCK_END_STRUCTURE.panels.map((p) => (p.id === 'tuck-top' ? { ...p, size: 30 } : p)),
    })
    const out = compileStructure(s, box, carton)
    expect(out.ok).toBe(true)
    expect(out.issues.map((i) => i.code)).toContain('lid-short')
  })

  it('flags open faces when a wall is missing', () => {
    const s = base({
      panels: TUCK_END_STRUCTURE.panels.filter((p) => p.id !== 'tuck-bot'),
      flaps: TUCK_END_STRUCTURE.flaps.filter((f) => f.id !== 'tongue-bot'),
    })
    const out = compileStructure(s, box, carton)
    expect(out.ok).toBe(true)
    expect(out.issues.find((i) => i.code === 'open-faces')?.ids).toEqual(['bottom'])
  })
})

describe('parseStructure', () => {
  it('accepts the examples and normalises ids', () => {
    for (const s of [TUCK_END_STRUCTURE, MAILER_STRUCTURE, TRAY_STRUCTURE]) {
      const r = parseStructure(JSON.parse(JSON.stringify(s)))
      expect(r.ok, s.name).toBe(true)
    }
    // id ถูกแปลงเป็นตัวเล็กทั้งที่ประกาศและที่อ้างถึง จึงยังชี้ถึงกันได้
    const r = parseStructure({ ...TUCK_END_STRUCTURE, panels: TUCK_END_STRUCTURE.panels.map((p) => ({ ...p, id: p.id.toUpperCase() })) })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.structure.panels.map((p) => p.id)).toEqual(TUCK_END_STRUCTURE.panels.map((p) => p.id))
  })

  it('explains what is wrong in Thai so the AI can fix it', () => {
    const r = parseStructure({
      name: 'x', orientation: 'sideways',
      panels: [
        { id: 'a', kind: 'body', attach: null, w: 'W', h: 'H', size: null },
        { id: 'b', kind: 'lid', attach: { to: 'zzz', edge: 'top', fold: 90 }, w: null, h: null, size: 'D' },
        { id: 'c', kind: 'body', attach: { to: 'a', edge: 'left', fold: 90 }, w: null, h: null, size: null },
      ],
      flaps: [{ id: 'f', type: 'tuck', on: 'a', edge: 'top', depth: null, side: null }],
      explanation: '',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const codes = r.issues.map((i) => i.code)
      expect(codes).toEqual(expect.arrayContaining(['orientation', 'attach-target', 'size', 'tuck-not-on-lid']))
      for (const i of r.issues) expect(i.message).toMatch(/[ก-๙]/)
    }
  })

  it('rejects cycles and two roots', () => {
    const r = parseStructure({
      name: 'x', orientation: 'front',
      panels: [
        { id: 'a', kind: 'body', attach: { to: 'b', edge: 'left', fold: 90 }, w: null, h: null, size: 'W' },
        { id: 'b', kind: 'body', attach: { to: 'a', edge: 'right', fold: 90 }, w: null, h: null, size: 'W' },
      ],
      flaps: [], explanation: '',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['root', 'cycle']))
  })

  it('schema is strict and uses only keywords Claude structured outputs accept', () => {
    // Claude ตอบ 400 กับ minimum/maximum/multipleOf/minLength/maxLength/minItems/maxItems — เคยพังในหน้าทดลองมาแล้ว
    const banned = ['minimum', 'maximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern', 'uniqueItems']
    const walk = (node: unknown) => {
      if (typeof node !== 'object' || node === null) return
      const n = node as Record<string, unknown>
      for (const k of banned) expect(n, `พบ ${k}`).not.toHaveProperty(k)
      if (n.type === 'object') {
        expect(n.additionalProperties).toBe(false)
        expect(Object.keys(n.properties as object).sort()).toEqual([...(n.required as string[])].sort())
      }
      for (const v of Object.values(n)) walk(v)
    }
    walk(STRUCTURE_SCHEMA)
  })

  it('caps the number of panels and flaps in the parser instead of the schema', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ id: `f${i}`, type: 'tab', on: 'front', edge: 'top', depth: null, side: null }))
    const r = parseStructure({ ...TUCK_END_STRUCTURE, flaps: many })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues[0].message).toContain('เกิน 24')
  })
})

describe('polygonsOverlap', () => {
  const sq = (x: number, y: number, s: number): Vec2[] => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }]
  it('ignores shared edges and corners but catches real overlap and containment', () => {
    expect(polygonsOverlap(sq(0, 0, 10), sq(10, 0, 10))).toBe(false)
    expect(polygonsOverlap(sq(0, 0, 10), sq(10, 10, 10))).toBe(false)
    expect(polygonsOverlap(sq(0, 0, 10), sq(5, 5, 10))).toBe(true)
    expect(polygonsOverlap(sq(0, 0, 10), sq(2, 2, 3))).toBe(true)
  })
})
