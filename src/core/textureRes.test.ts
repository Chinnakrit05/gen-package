import { describe, expect, it } from 'vitest'
import { TEX_MAX_SIDE, TEX_PX_PER_MM, textureScale } from './textureRes'

describe('textureScale', () => {
  it('แผ่นเล็ก: ได้เต็ม 10 px/มม.', () => {
    expect(textureScale(275, 266)).toBe(TEX_PX_PER_MM) // tuck end 80×50×120 → 2750 px
  })

  it('แผ่นใหญ่: ด้านยาวไม่เกิน 4096 px', () => {
    const s = textureScale(800, 500)
    expect(800 * s).toBeCloseTo(TEX_MAX_SIDE, 6)
    expect(s).toBeLessThan(TEX_PX_PER_MM)
  })

  it('ไม่เกิน maxTextureSize ของ GPU', () => {
    expect(600 * textureScale(600, 300, 2048)).toBeCloseTo(2048, 6)
  })

  it('คมกว่าค่าเดิม (3 px/มม.) อย่างน้อย 3 เท่าสำหรับกล่องทั่วไป', () => {
    expect(textureScale(275, 266) / 3).toBeGreaterThanOrEqual(3)
  })
})
