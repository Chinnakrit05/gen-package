import { describe, expect, it } from 'vitest'
import { FINISHES, FINISH_MIN_TEXT_MM, finishDef, finishGroups, finishSmallText, isFinishKind, isFoil, printsCmyk } from './finish'

describe('งานพิมพ์พิเศษ (finish)', () => {
  it('ทุกชนิดมีชื่อ spot ไม่ซ้ำ เป็น name ของ PDF ได้ (ASCII ไม่มีช่องว่าง) + สีสำรอง CMYK 0..1', () => {
    const names = FINISHES.map((f) => f.spot)
    expect(new Set(names).size).toBe(names.length)
    for (const f of FINISHES) {
      expect(f.spot).toMatch(/^[A-Za-z0-9_]+$/)
      expect(f.alt).toHaveLength(4)
      for (const v of f.alt) expect(v >= 0 && v <= 1).toBe(true)
      expect(FINISH_MIN_TEXT_MM[f.id]).toBeGreaterThan(0)
    }
  })

  it('ฟอยล์แทนหมึก (ไม่พิมพ์ CMYK) ส่วน Spot UV/ปั๊ม พิมพ์ตามปกติ', () => {
    expect(isFoil('foil-gold')).toBe(true)
    expect(isFoil('spot-uv')).toBe(false)
    expect(printsCmyk({ finish: 'foil-silver' })).toBe(false)
    expect(printsCmyk({ finish: 'spot-uv' })).toBe(true)
    expect(printsCmyk({ finish: 'emboss' })).toBe(true)
    expect(printsCmyk({})).toBe(true)
    expect(printsCmyk({ hidden: true })).toBe(false)
  })

  it('ปั๊มนูน/จม มีทิศนูนตรงข้าม, ฟอยล์เป็นโลหะ, UV มันวาวกว่าวัสดุ', () => {
    expect(finishDef('emboss')?.relief).toBe(1)
    expect(finishDef('deboss')?.relief).toBe(-1)
    expect(finishDef('foil-gold')?.metal).toBe(1)
    expect(finishDef('spot-uv')!.rough).toBeLessThan(0.2)
  })

  it('จัดกลุ่มตามลำดับ FINISHES ข้ามชิ้นซ่อน; ตรวจข้อความเล็ก', () => {
    const decos = [
      { id: 'a', type: 'text', size: 2, finish: 'spot-uv' as const },
      { id: 'b', type: 'text', size: 10, finish: 'foil-gold' as const },
      { id: 'c', type: 'shape', finish: 'foil-gold' as const },
      { id: 'd', type: 'text', size: 1, finish: 'emboss' as const, hidden: true },
      { id: 'e', type: 'text', size: 1 },
    ]
    const g = finishGroups(decos)
    expect(g.map((x) => [x.def.id, x.items.map((i) => i.id)])).toEqual([
      ['foil-gold', ['b', 'c']],
      ['spot-uv', ['a']],
    ])
    expect(finishSmallText(decos).map((d) => d.id)).toEqual([]) // 2 มม. = ขั้นต่ำของ UV พอดี
    expect(finishSmallText([{ type: 'text', size: 3, finish: 'emboss' as const }])).toHaveLength(1)
  })

  it('isFinishKind กรองค่าที่ไม่รู้จัก', () => {
    expect(isFinishKind('deboss')).toBe(true)
    expect(isFinishKind('hologram')).toBe(false)
    expect(isFinishKind(undefined)).toBe(false)
  })
})
