import { describe, it, expect } from 'vitest'
import { elH, textLinesOf, textLineH, textAnchor, textAnchorX, textLineY, type TextEl } from './artwork'

const base = (over: Partial<TextEl>): TextEl => ({
  id: 't',
  type: 'text',
  text: 'a\nb\nc',
  color: '#000',
  size: 10,
  w: 40,
  x: 0,
  y: 0,
  rot: 0,
  ...over,
})

describe('ข้อความหลายบรรทัด — เรขาคณิต', () => {
  it('textLinesOf แยกตาม \\n', () => {
    expect(textLinesOf(base({ text: 'a\nbb\nccc' }))).toEqual(['a', 'bb', 'ccc'])
  })

  it('textLineH = size × lh (ไม่ใส่ = 1.25)', () => {
    expect(textLineH(base({ size: 10 }))).toBeCloseTo(12.5, 6)
    expect(textLineH(base({ size: 10, lh: 1.5 }))).toBeCloseTo(15, 6)
  })

  it('elH = จำนวนบรรทัด × ความสูงบรรทัด', () => {
    expect(elH(base({ text: 'a\nb\nc', size: 10 }))).toBeCloseTo(37.5, 6) // 3 × 12.5
    expect(elH(base({ text: 'x', size: 10 }))).toBeCloseTo(12.5, 6) // บรรทัดเดียว = เท่าเดิม
    expect(elH(base({ text: 'a\nb', size: 10, lh: 2 }))).toBeCloseTo(40, 6) // 2 × 20
  })

  it('textLineY = y กึ่งกลางของแต่ละบรรทัด', () => {
    const e = base({ text: 'a\nb\nc', size: 10, y: 0 }) // lineH 12.5
    expect([0, 1, 2].map((i) => textLineY(e, i))).toEqual([6.25, 18.75, 31.25])
  })

  it('textAnchor แปลงตามการจัดชิด', () => {
    expect(textAnchor(base({}))).toBe('start') // ไม่ใส่ = ชิดซ้าย
    expect(textAnchor(base({ align: 'left' }))).toBe('start')
    expect(textAnchor(base({ align: 'center' }))).toBe('middle')
    expect(textAnchor(base({ align: 'right' }))).toBe('end')
  })

  it('textAnchorX ตามการจัดชิด (x=0, w=40)', () => {
    expect(textAnchorX(base({ align: 'left' }))).toBe(0)
    expect(textAnchorX(base({ align: 'center' }))).toBe(20)
    expect(textAnchorX(base({ align: 'right' }))).toBe(40)
  })
})
