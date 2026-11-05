import { describe, expect, it } from 'vitest'
import { convertLabelNumbers, dimValue, fmtDim, parseLengthUnit, toMm, unitStep } from './units'

describe('units', () => {
  it('แปลง มม. → มม./ซม./นิ้ว เพื่อแสดง และกลับเป็น มม.', () => {
    expect(dimValue(140, 'mm')).toBe(140)
    expect(dimValue(140, 'cm')).toBe(14)
    expect(dimValue(80.8, 'cm')).toBe(8.08)
    expect(dimValue(254, 'in')).toBe(10)
    expect(toMm(21.5, 'cm')).toBe(215)
    expect(toMm(1, 'in')).toBe(25.4)
  })

  it('ป้ายขนาดและขั้นของช่องตามหน่วย', () => {
    expect(fmtDim(215, 'cm')).toBe('21.5 ซม.')
    expect(fmtDim(80, 'mm')).toBe('80 มม.')
    expect(unitStep('cm', 0.5)).toBe(0.05)
    expect(unitStep('mm', 0.5)).toBe(0.5)
    expect(unitStep('in', 0.5)).toBe(0.05)
  })

  it('แปลงตัวเลขในป้ายบน blueprint และอ่านหน่วยที่เก็บไว้', () => {
    expect(convertLabelNumbers('W 80.8', 'cm')).toBe('W 8.08')
    expect(convertLabelNumbers('W 80.8', 'mm')).toBe('W 80.8')
    expect(parseLengthUnit('cm')).toBe('cm')
    expect(parseLengthUnit('in')).toBe('in')
    expect(parseLengthUnit('furlong')).toBe('mm')
    expect(parseLengthUnit(null)).toBe('mm')
  })
})
