import { describe, expect, it } from 'vitest'
import {
  WATERMARK_ANGLE,
  WATERMARK_SIZE_MAX,
  WATERMARK_SIZE_MIN,
  WATERMARK_TEXT,
  drawWatermark,
  previewWatermarked,
  watermarkSize,
  watermarkTiles,
} from './watermark'

describe('previewWatermarked', () => {
  const free = { plan: 'free' as const, openAccess: false, licensedProjectIds: ['bought'] }

  it('watermarks only designs a known Freemium workspace has not bought', () => {
    expect(previewWatermarked(free, true, 'draft')).toBe(true)
    expect(previewWatermarked(free, true, 'bought')).toBe(false)
    expect(previewWatermarked({ ...free, plan: 'pro' }, true, 'draft')).toBe(false)
  })

  it('never watermarks during open access, even if the plan still reads free', () => {
    expect(previewWatermarked({ ...free, plan: 'pro', openAccess: true }, true, 'draft')).toBe(false)
    expect(previewWatermarked({ ...free, openAccess: true }, true, 'draft')).toBe(false)
  })

  it('does not watermark while entitlements are loading or failed to load', () => {
    expect(previewWatermarked(null, false, 'draft')).toBe(false)
    expect(previewWatermarked(null, true, 'draft')).toBe(false)
    expect(previewWatermarked(free, false, 'draft')).toBe(false)
  })
})

const inside = (w: number, h: number) => {
  const tiles = watermarkTiles(w, h)
  const size = watermarkSize(w, h)
  return tiles.every((t) => t.x >= -size && t.x <= w + size && t.y >= -size && t.y <= h + size)
}

describe('watermarkTiles', () => {
  it('ขนาดตัวอักษร = ด้านสั้น/10 clamp 6–40 มม.', () => {
    expect(watermarkSize(20, 300)).toBe(WATERMARK_SIZE_MIN) // 2 → 6
    expect(watermarkSize(120, 200)).toBe(12)
    expect(watermarkSize(900, 1200)).toBe(WATERMARK_SIZE_MAX) // 90 → 40
    for (const t of watermarkTiles(900, 1200)) expect(t.size).toBe(WATERMARK_SIZE_MAX)
    for (const t of watermarkTiles(20, 300)) expect(t.size).toBe(WATERMARK_SIZE_MIN)
  })

  it('ทุกจุดอยู่ในกรอบแผ่นเผื่อ 1 ขนาดตัวอักษร และมุม −30° เสมอ', () => {
    for (const [w, h] of [[100, 100], [300, 180], [60, 420], [1000, 700]] as const) {
      expect(inside(w, h)).toBe(true)
      for (const t of watermarkTiles(w, h)) expect(t.angle).toBe(WATERMARK_ANGLE)
    }
  })

  it('จำนวนจุดเพิ่มตามขนาดแผ่น (ตัวอักษร clamp แล้วแผ่นใหญ่ได้จุดมากกว่า)', () => {
    const small = watermarkTiles(100, 100).length
    const medium = watermarkTiles(600, 400).length
    const large = watermarkTiles(1500, 1000).length
    expect(small).toBeGreaterThan(0)
    expect(medium).toBeGreaterThan(small)
    expect(large).toBeGreaterThan(medium)
  })

  it('เห็น ~3–5 แถวบนแผ่นสี่เหลี่ยมทั่วไป', () => {
    // แถว = ระยะตั้งฉากกับแนวข้อความ (หมุน −30°) → นับค่าเฉพาะของ v = -x·sin + y·cos (ปัดทศนิยม)
    const w = 240
    const h = 160
    const rad = (WATERMARK_ANGLE * Math.PI) / 180
    const rows = new Set(
      watermarkTiles(w, h).map((t) => Math.round((-(t.x - w / 2) * Math.sin(rad) + (t.y - h / 2) * Math.cos(rad)) * 10)),
    )
    expect(rows.size).toBeGreaterThanOrEqual(3)
    expect(rows.size).toBeLessThanOrEqual(7)
  })

  it('แผ่นจิ๋วยังได้อย่างน้อย 1 จุด และผลลัพธ์ deterministic', () => {
    const tiny = watermarkTiles(8, 8)
    expect(tiny.length).toBeGreaterThanOrEqual(1)
    expect(inside(8, 8)).toBe(true)
    expect(watermarkTiles(150, 90)).toEqual(watermarkTiles(150, 90))
  })

  it('ข้อความสองภาษาขึ้นต้นด้วยชื่อแอป', () => {
    expect(WATERMARK_TEXT.th.startsWith('PackIt')).toBe(true)
    expect(WATERMARK_TEXT.en.startsWith('PackIt')).toBe(true)
  })
})

describe('drawWatermark', () => {
  it('วาดทุกจุดด้วย stroke ขาว + fill เข้ม ที่ alpha 0.18 และคืนสถานะ ctx', () => {
    const calls: string[] = []
    const state = { alpha: 1, font: '', saves: 0 }
    const fake = {
      set globalAlpha(v: number) {
        state.alpha = v
        calls.push(`alpha:${v}`)
      },
      get globalAlpha() {
        return state.alpha
      },
      set font(v: string) {
        state.font = v
      },
      get font() {
        return state.font
      },
      textAlign: '',
      textBaseline: '',
      lineJoin: '',
      lineWidth: 0,
      strokeStyle: '',
      fillStyle: '',
      save: () => {
        state.saves++
      },
      restore: () => {
        state.saves--
      },
      translate: () => {},
      rotate: () => {},
      strokeText: (text: string) => calls.push(`stroke:${text}:${fake.strokeStyle}`),
      fillText: (text: string) => calls.push(`fill:${text}:${fake.fillStyle}`),
    }
    const w = 200
    const h = 120
    drawWatermark(fake as unknown as CanvasRenderingContext2D, w, h, 4, 'PackIt · PREVIEW')
    const n = watermarkTiles(w, h).length
    expect(calls.filter((c) => c.startsWith('stroke:PackIt · PREVIEW:#ffffff'))).toHaveLength(n)
    expect(calls.filter((c) => c.startsWith('fill:PackIt · PREVIEW:#111111'))).toHaveLength(n)
    expect(calls).toContain('alpha:0.18')
    expect(state.saves).toBe(0)
    expect(state.font).toContain('700')
    expect(state.font).toContain(`${watermarkSize(w, h) * 4}px`)
  })
})
