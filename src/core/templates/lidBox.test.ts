import { describe, expect, it } from 'vitest'
import { computeMatrices, rollBeads, to3D } from '../fold'
import { getTemplate } from './index'
import { LID_SEAT } from './lidBox'
import { getMaterial } from '../materials'
import { dielineDXFString } from '../dxf'

// กล่องฝาครอบ = 2 ชิ้น (ฐาน b- / ฝา l-) วางเคียงกันในแผ่นเดียว พับแยกอิสระ
const mat = getMaterial('carton-300')
const tp = getTemplate('lid-box')
const box = { W: 160, D: 110, H: 70, handle: false }
const d = tp.generate(box, mat)

describe('lid-box: โครงสร้างกล่องฝาครอบ', () => {
  it('ลงทะเบียนใน registry', () => {
    expect(tp.id).toBe('lid-box')
    expect(tp.supportsHandle).toBe(false)
  })

  it('มีสองชิ้น: ฐาน (b-) และ ฝา (l-) — ฝาเป็นชิ้นที่พลิกมาประกอบบนฐาน (assemble) ไม่ใช่รอยพับจริง', () => {
    const roots = d.panels.filter((p) => p.parentId === null).map((p) => p.id)
    expect(roots).toEqual(['b-base'])
    const lb = d.panels.find((p) => p.id === 'l-base')!
    expect(lb.parentId).toBe('b-base')
    expect(lb.assemble).toBe(true)
    expect(Math.abs(lb.foldAngle!)).toBe(180)
    expect(rollBeads(d.panels, computeMatrices(d.panels, 1))).toHaveLength(0) // ไม่มีสันม้วนปลอม
  })

  it('dieline: ฝาวางขวาของฐานไม่ทับกัน, ฝาลึกเท่าฐาน (telescope เต็ม) แต่กว้าง/ยาวกว่าให้สวมทับ', () => {
    const xs = (pre: string) => d.panels.filter((p) => p.id.startsWith(pre)).flatMap((p) => p.outline.map((q) => q.x))
    expect(Math.min(...xs('l-'))).toBeGreaterThanOrEqual(Math.max(...xs('b-')))
    const ext = (id: string) => {
      const o = d.panels.find((p) => p.id === id)!.outline
      return { w: Math.max(...o.map((q) => q.x)) - Math.min(...o.map((q) => q.x)), h: Math.max(...o.map((q) => q.y)) - Math.min(...o.map((q) => q.y)) }
    }
    expect(ext('l-back').h).toBeCloseTo(ext('b-back').h, 6) // ผนังสูงเท่ากัน
    expect(ext('l-base').w).toBeGreaterThan(ext('b-base').w)
    expect(ext('l-base').h).toBeGreaterThan(ext('b-base').h)
  })

  it('ลิ้นมุมเป็นสี่เหลี่ยมเต็ม (4 จุด) เว้นร่องหลบข้างผนังหน้า-หลัง', () => {
    for (const pre of ['b-', 'l-']) {
      for (const k of ['tab-lb', 'tab-lf', 'tab-rb', 'tab-rf']) {
        const o = d.panels.find((p) => p.id === pre + k)!.outline
        expect(o).toHaveLength(4)
        const w = Math.max(...o.map((q) => q.x)) - Math.min(...o.map((q) => q.x))
        expect(w).toBeGreaterThan(box.H * 0.9) // เกือบเต็มความสูงผนัง
      }
    }
  })

  it('3D: ฝาพลิกมาครอบตรงกลางฐาน ขอบฝาวางบนขอบฐาน และคลุมรอบฐานทุกด้าน', () => {
    const M = computeMatrices(d.panels, 1)
    const pts = (pre: string) =>
      d.panels.filter((p) => p.id.startsWith(pre)).flatMap((p) => p.outline.map((q) => to3D(q).applyMatrix4(M.get(p.id)!)))
    const bb = (v: ReturnType<typeof pts>) => ({
      x0: Math.min(...v.map((q) => q.x)), x1: Math.max(...v.map((q) => q.x)),
      y0: Math.min(...v.map((q) => q.y)), y1: Math.max(...v.map((q) => q.y)),
      z0: Math.min(...v.map((q) => q.z)), z1: Math.max(...v.map((q) => q.z)),
    })
    const B = bb(pts('b-'))
    const L = bb(pts('l-'))
    const t = mat.thickness
    expect((L.x0 + L.x1) / 2).toBeCloseTo((B.x0 + B.x1) / 2, 3)
    expect((L.y0 + L.y1) / 2).toBeCloseTo((B.y0 + B.y1) / 2, 3)
    expect(L.x0).toBeLessThan(B.x0) // ฝาคลุมกว้างกว่าฐาน
    expect(L.x1).toBeGreaterThan(B.x1)
    expect(L.y0).toBeLessThan(B.y0)
    expect(L.y1).toBeGreaterThan(B.y1)
    // สวมมิด: ผิวในฝาเหนือขอบฐาน LID_SEAT ขอบฝาลงเกือบถึงพื้น — สูงรวมเท่าฐาน + ความหนาฝา
    expect(L.z1).toBeCloseTo(box.H + 2 * t + LID_SEAT, 3)
    expect(L.z0).toBeCloseTo(t + LID_SEAT, 3)
    expect(L.z0).toBeLessThan(B.z1)
    expect(B.z0).toBeCloseTo(0, 3)
  })

  it('3D: พลิกเสร็จก่อน (ขอบฝาวางบนขอบฐาน) แล้วจึงสวมลงตรง ๆ — ผนังฝาไม่ทะลุผนังฐานตลอดการสวม', () => {
    const t = mat.thickness
    const lb = d.panels.find((p) => p.id === 'l-base')!
    expect(lb.slide!.stage).toBeGreaterThan(lb.stage)
    const bbAt = (f: number, pre: string) => {
      const M = computeMatrices(d.panels, f)
      const v = d.panels.filter((p) => p.id.startsWith(pre)).flatMap((p) => p.outline.map((q) => to3D(q).applyMatrix4(M.get(p.id)!)))
      return {
        x0: Math.min(...v.map((q) => q.x)), x1: Math.max(...v.map((q) => q.x)),
        y0: Math.min(...v.map((q) => q.y)), y1: Math.max(...v.map((q) => q.y)),
        z0: Math.min(...v.map((q) => q.z)),
      }
    }
    // หาจังหวะที่ฝาเริ่มเลื่อนลง (ขอบฝาต่ำกว่าขอบฐาน): ตอนนั้นการพลิกต้องเสร็จแล้ว ฝาอยู่ตรงฐาน
    const B = bbAt(1, 'b-')
    let sliding = -1
    for (let f = 0.5; f <= 1.0001; f += 0.005) {
      const L = bbAt(f, 'l-')
      const over = L.x0 < B.x0 && L.x1 > B.x1 && L.y0 < B.y0 && L.y1 > B.y1
      // ฝาซ้อนเหนือรอยเท้าฐานและต่ำกว่าขอบฐาน = กำลังสวมลง → ต้องครอบรอบฐาน (ไม่ทับผนัง)
      const overlapsXY = L.x0 < B.x1 && L.x1 > B.x0 && L.y0 < B.y1 && L.y1 > B.y0
      if (overlapsXY && L.z0 < box.H + t - 0.5) {
        if (sliding < 0) sliding = f
        expect(over).toBe(true)
      }
    }
    expect(sliding).toBeGreaterThan(0)
    const before = bbAt(sliding - 0.01, 'l-')
    expect(before.z0).toBeGreaterThan(box.H + t - 0.6) // ก่อนสวม ขอบฝาอยู่บนขอบฐาน
  })

  it('ฝาเริ่มพลิกหลังถาดทั้งสองพับเสร็จ (ไม่กวาดผ่านผนังที่ยังพับไม่เสร็จ)', () => {
    let started = 1
    for (let f = 0; f <= 1.0001; f += 0.01) {
      const m = computeMatrices(d.panels, f).get('l-base')!
      if (to3D(d.panels.find((p) => p.id === 'l-base')!.outline[0]).applyMatrix4(m).z > 0.5) {
        started = f
        break
      }
    }
    const M = computeMatrices(d.panels, started)
    const wallUp = (id: string) => {
      const p = d.panels.find((q) => q.id === id)!
      return Math.max(...p.outline.map((q) => to3D(q).applyMatrix4(M.get(id)!).z))
    }
    expect(wallUp('b-front')).toBeGreaterThan((box.H + mat.thickness) * 0.9)
  })

  it('พับแล้ว matrices finite ทุกแผง + ส่งออก DXF ได้', () => {
    const M = computeMatrices(d.panels, 1)
    for (const p of d.panels) {
      const m = M.get(p.id)!
      const v = to3D(p.outline[0]).applyMatrix4(m)
      expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)).toBe(true)
    }
    const dxf = dielineDXFString(d)
    expect(dxf).toContain('SECTION')
    expect(dxf).not.toContain('NaN')
  })
})
