import { describe, expect, it } from 'vitest'
import { isFreshWork, STANDARD_SIZE } from './standardSize'
import { parseSpec } from './project'

describe('standardSize: ขนาดมาตรฐานเมื่อสลับประเภทงาน', () => {
  it('ทุกค่าอยู่ในช่วงที่ parseSpec รับได้ (ไม่ถูก clamp) และถุง/ขวด D ไม่เกิน W', () => {
    for (const sz of Object.values(STANDARD_SIZE)) {
      const spec = parseSpec({ template: 'tuck-end', materialId: 'carton-300', ...sz, handle: false })!
      expect({ W: spec.W, D: spec.D, H: spec.H }).toEqual(sz)
      expect(sz.D).toBeLessThan(sz.W)
    }
  })

  it('ยังไม่เริ่มงาน = ไม่มีลายและไม่มีรูปพื้น', () => {
    expect(isFreshWork([], null)).toBe(true)
    expect(isFreshWork([], { src: 'data:x' } as never)).toBe(false)
    expect(isFreshWork([{ id: 'a', type: 'text' } as never], null)).toBe(false)
  })
})
