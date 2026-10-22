import { describe, expect, it } from 'vitest'
import { GRAIN_AMP, hasGrain, holoColor, paperGrain } from './paperSurface'
import { CARD_STOCK_IDS, DEFAULT_CARD_MAT, MATERIALS, getMaterial, isCardMat, isStickerMat, packKind } from './materials'

const S = 8 // px/มม. เท่ากับแผนที่ผิวของ 3D
const W = 96
const H = 96
const std = (a: Float32Array) => {
  const m = a.reduce((s, v) => s + v, 0) / a.length
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length)
}
// ผลต่างเฉลี่ยระหว่างพิกเซลห่างกัน (dx, dy) — ใช้วัดทิศ/คาบของลาย
const diff = (a: Float32Array, dx: number, dy: number) => {
  let s = 0
  let n = 0
  for (let y = 0; y + dy < H; y++)
    for (let x = 0; x + dx < W; x++) {
      s += Math.abs(a[(y + dy) * W + x + dx] - a[y * W + x])
      n++
    }
  return s / n
}

describe('paperGrain: เนื้อกระดาษนูนต่ำ', () => {
  it.each(['felt', 'linen', 'kraft'] as const)('%s: อยู่ในช่วง ±GRAIN_AMP มีเนื้อ (ไม่เรียบ) และคงที่ทุกครั้ง', (s) => {
    const a = paperGrain(s, W, H, S)
    expect(a.every((v) => Math.abs(v) <= GRAIN_AMP)).toBe(true)
    expect(std(a)).toBeGreaterThan(GRAIN_AMP * 0.1)
    expect(paperGrain(s, W, H, S)).toEqual(a)
  })

  it('คราฟท์: เส้นใยยาวตามแนวนอน — เปลี่ยนตามแกนตั้งมากกว่าแกนนอน', () => {
    const a = paperGrain('kraft', W, H, S)
    expect(diff(a, 0, 2)).toBeGreaterThan(diff(a, 2, 0) * 1.5)
  })

  it('ลินิน: ลายทอซ้ำที่ระยะเส้นด้าย 0.6 มม. (ห่างหนึ่งคาบคล้ายกว่าครึ่งคาบ)', () => {
    const a = paperGrain('linen', W, H, S)
    const period = Math.round(0.6 * S)
    expect(diff(a, period, 0)).toBeLessThan(diff(a, Math.round(period / 2), 0))
  })

  it('holo ไม่มีเนื้อนูน (ฟิล์มเรียบ) / สีรุ้งวนครบรอบ', () => {
    expect(hasGrain('holo')).toBe(false)
    expect(hasGrain(undefined)).toBe(false)
    expect(holoColor(0)).toBe(holoColor(1 / 3))
    expect(holoColor(0)).not.toBe(holoColor(1 / 6))
  })
})

describe('วัสดุนามบัตร/สติกเกอร์', () => {
  it('กระดาษนามบัตร card-* เป็นแผ่นพับได้ (เส้นทางกล่อง) และค่าเริ่มต้นอยู่ในรายการกระดาษนามบัตร', () => {
    const cards = MATERIALS.filter(isCardMat)
    expect(cards.length).toBeGreaterThanOrEqual(6)
    for (const m of cards) {
      expect(packKind(m)).toBe('box')
      expect(CARD_STOCK_IDS).toContain(m.id)
    }
    expect(CARD_STOCK_IDS[0]).toBe(DEFAULT_CARD_MAT)
    expect(CARD_STOCK_IDS).toContain('carton-300') // งานเก่าที่ตั้งกระดาษกล่องไว้ยังเลือกได้
  })

  it('สติกเกอร์ใหม่อยู่ในกลุ่มสติกเกอร์ และผิวพิเศษตั้งค่าตรงชนิด', () => {
    for (const id of ['sticker-art-gloss', 'sticker-kraft', 'sticker-felt', 'sticker-silver', 'sticker-holo']) {
      expect(isStickerMat(getMaterial(id))).toBe(true)
    }
    expect(getMaterial('sticker-holo').surface).toBe('holo')
    expect(getMaterial('sticker-silver').metalness).toBeGreaterThan(0.5)
    expect(getMaterial('card-cotton').surface).toBe('felt')
  })

  it('กระดาษสีไม่มีหมึกขาว (ดำ/คราฟท์) พิมพ์แบบ multiply และบอกผู้ใช้ในหมายเหตุ', () => {
    for (const m of MATERIALS.filter((m) => m.inkMultiply)) {
      expect(m.note).toMatch(/หมึกขาว/)
    }
    expect(getMaterial('card-black').inkMultiply).toBe(true)
  })
})
