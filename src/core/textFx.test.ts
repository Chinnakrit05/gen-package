import { describe, expect, it } from 'vitest'
import {
  MIN_PRINT_LINE_MM,
  TEXT_FX_DEFAULTS,
  TEXT_FX_KINDS,
  lightenHex,
  parseTextFx,
  resolveTextFx,
  textFxPlan,
  textFxReach,
} from './textFx'

const base = { size: 20, color: '#336699' }

describe('textFxPlan', () => {
  it('ไม่มีเอฟเฟกต์ = ตัวอักษรอย่างเดียว (+ ขอบเดิม ×2 คร่อมเส้น)', () => {
    expect(textFxPlan(base)).toEqual({ box: null, under: [], main: { fill: '#336699' } })
    expect(textFxPlan({ ...base, strokeColor: '#ffffff', strokeW: 1 }).main).toEqual({ fill: '#336699', stroke: '#ffffff', strokeW: 2 })
  })

  it('shadow เดิม = drop ค่าเริ่มต้น หน้าตาเท่าเงาเก่า (เยื้อง ≈5% ทั้งสองแกน, เบลอ 5%, ทึบ 40%)', () => {
    const p = textFxPlan({ ...base, shadow: true })
    expect(p.under).toHaveLength(1)
    const l = p.under[0]
    expect(l.dx).toBeCloseTo(20 * 0.07 * Math.SQRT1_2, 6)
    expect(l.dy).toBeCloseTo(l.dx, 6)
    expect(l.dx).toBeCloseTo(1, 1) // เดิม 0.05 × 20 = 1 มม.
    expect(l.blur).toBeCloseTo(1, 6)
    expect(l.alpha).toBeCloseTo(0.4, 6)
    expect(l.fill).toBe('#000000')
    expect(textFxPlan({ ...base, fx: { kind: 'drop' } })).toEqual(p)
  })

  it('drop: ทิศ 90° = ลงตรง, ข้อความมีขอบ → เงามีขอบความหนาเท่ากัน', () => {
    const p = textFxPlan({ ...base, strokeColor: '#fff000', strokeW: 1, fx: { kind: 'drop', angle: 90, dist: 10, color: '#ff0000' } })
    expect(p.under[0].dx).toBeCloseTo(0, 6)
    expect(p.under[0].dy).toBeCloseTo(2, 6)
    expect(p.under[0]).toMatchObject({ fill: '#ff0000', stroke: '#ff0000', strokeW: 2 })
  })

  it('background: กล่องใต้ตัวอักษร ระยะขอบ/มน เป็นมม./สัดส่วน', () => {
    const p = textFxPlan({ ...base, fx: { kind: 'background', pad: 50, round: 100, alpha: 60 } })
    expect(p.box).toEqual({ color: TEXT_FX_DEFAULTS.background.color, alpha: 0.6, pad: 10, round: 1 })
    expect(p.main).toEqual({ fill: '#336699' })
  })

  it('hollow/splice: ตัวอักษรไม่มีพื้น ไม่สนขอบเดิม; splice มีชั้นทึบเยื้องไม่เบลอ', () => {
    const src = { ...base, strokeColor: '#ffffff', strokeW: 1 }
    const h = textFxPlan({ ...src, fx: { kind: 'hollow' } })
    expect(h.main).toEqual({ stroke: '#336699', strokeW: 1.2 })
    const s = textFxPlan({ ...src, fx: { kind: 'splice' } })
    expect(s.main).toEqual(h.main)
    expect(s.under).toHaveLength(1)
    expect(s.under[0].blur).toBeUndefined()
    expect(s.under[0].fill).toBe(TEXT_FX_DEFAULTS.splice.color)
  })

  it('เส้นของเอฟเฟกต์ไม่บางกว่าขั้นต่ำงานพิมพ์ แม้ตัวอักษรเล็ก', () => {
    const tiny = { size: 1, color: '#000000' }
    expect(textFxPlan({ ...tiny, fx: { kind: 'hollow', width: 1 } }).main.strokeW).toBe(MIN_PRINT_LINE_MM)
    const d = textFxPlan({ ...tiny, fx: { kind: 'double', width: 1, width2: 1 } })
    expect(d.under[0].strokeW).toBeCloseTo(4 * MIN_PRINT_LINE_MM, 9)
    expect(d.under[1].strokeW).toBeCloseTo(2 * MIN_PRINT_LINE_MM, 9)
  })

  it('double: ขอบนอกวาดก่อนและกว้างกว่าขอบใน ระยะที่เห็นของแต่ละชั้นตรงตามค่าที่ตั้ง', () => {
    const p = textFxPlan({ ...base, fx: { kind: 'double', width: 10, width2: 5 } })
    const [outer, inner] = p.under
    expect(inner.strokeW! / 2).toBeCloseTo(2, 9) // ขอบในยื่นจากตัวอักษร 10% = 2 มม.
    expect((outer.strokeW! - inner.strokeW!) / 2).toBeCloseTo(1, 9) // ขอบนอกยื่นต่ออีก 5% = 1 มม.
    expect(p.main).toEqual({ fill: '#336699' })
  })

  it('textFxReach: ครอบระยะเยื้อง + เส้น + 3σ ของทุกชั้น', () => {
    expect(textFxReach(base)).toBe(0)
    const r = textFxReach({ ...base, fx: { kind: 'drop', dist: 10, blur: 5, angle: 0 } })
    expect(r).toBeCloseTo(2 + 3 * 1, 9)
    expect(textFxReach({ ...base, fx: { kind: 'background', pad: 50 } })).toBeCloseTo(10, 9)
  })
})

describe('parseTextFx / resolveTextFx', () => {
  it('ทุกแบบ parse แล้ว resolve คืนค่าเริ่มต้นของแบบนั้น', () => {
    for (const k of TEXT_FX_KINDS) {
      const fx = parseTextFx({ kind: k.id })
      expect(fx).toEqual({ kind: k.id })
      expect(resolveTextFx({ fx })).toEqual(TEXT_FX_DEFAULTS[k.id])
    }
  })

  it('ทิ้งค่ามั่ว/สีผิดรูปแบบ, clamp ช่วง, ไม่เก็บค่าที่เท่าค่าเริ่มต้น', () => {
    expect(parseTextFx({ kind: 'drop', color: 'red', dist: 'x', blur: 999, alpha: 40, angle: -500 })).toEqual({ kind: 'drop', blur: 40, angle: -180 })
    expect(parseTextFx(null)).toBeUndefined()
    expect(parseTextFx({ kind: 'glitch' })).toBeUndefined()
  })

  it('fx ชนะ shadow เดิม; ไม่มีทั้งคู่ = null', () => {
    expect(resolveTextFx({ shadow: true, fx: { kind: 'hollow' } })?.kind).toBe('hollow')
    expect(resolveTextFx({})).toBeNull()
  })
})

describe('lightenHex', () => {
  it('ผสมขาวตามสัดส่วน', () => {
    expect(lightenHex('#000000', 0.5)).toBe('#808080')
    expect(lightenHex('#ffffff')).toBe('#ffffff')
    expect(lightenHex('oops')).toBe(TEXT_FX_DEFAULTS.splice.color)
  })
})
