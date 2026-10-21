import { describe, expect, it } from 'vitest'
import { isFreshWork, POUCH_STANDARD, standardSizeFor, VESSEL_STANDARD } from './standardSize'
import { parseSpec } from './project'
import { generateVessel } from './vessel'
import { generatePouch, POUCH_STYLES } from './pouch'
import { getMaterial, MATERIALS, packKind } from './materials'
import { pouchVolumeMl, tubeVolumeMl, vesselVolumeMl } from './capacity'

const passes = (sz: { W: number; D: number; H: number }, materialId: string) => {
  const spec = parseSpec({ template: 'tuck-end', materialId, ...sz, handle: false })!
  expect({ W: spec.W, D: spec.D, H: spec.H }).toEqual({ W: sz.W, D: sz.D, H: sz.H })
}

describe('standardSize: ขนาดมาตรฐานตามวัสดุภาชนะ/รูปแบบถุง', () => {
  it('ภาชนะทุกวัสดุมีขนาดมาตรฐาน อยู่ในช่วงที่ parseSpec รับได้ และ ⌀ปาก ≤ ⌀ตัว', () => {
    for (const m of MATERIALS.filter((x) => packKind(x) === 'vessel')) {
      const sz = VESSEL_STANDARD[m.id]
      expect(sz, m.id).toBeDefined()
      passes(sz, m.id)
      expect(sz.D).toBeLessThanOrEqual(sz.W)
    }
  })

  it('ถุงทุกรูปแบบมีขนาดมาตรฐาน อยู่ในช่วงที่ parseSpec รับได้ และลึกไม่เกินกว้าง', () => {
    for (const s of POUCH_STYLES) {
      const sz = POUCH_STANDARD[s.id]
      expect(sz, s.id).toBeDefined()
      passes(sz, 'pouch-foil')
      expect(sz.D).toBeLessThanOrEqual(sz.W)
    }
  })

  it('ความจุที่ได้ตรงกับชนิดสินค้าที่ระบุ (สูตรความจุของแอป หัก headspace แล้ว)', () => {
    const vesselMl = (id: string) => {
      const v = generateVessel({ ...VESSEL_STANDARD[id], handle: false }, getMaterial(id))
      return v.tube ? tubeVolumeMl(v.tube) : vesselVolumeMl(v.profile)
    }
    expect(vesselMl('pet-bottle')).toBeGreaterThan(400) // 500 มล.
    expect(vesselMl('pet-bottle')).toBeLessThan(520)
    expect(vesselMl('aluminum')).toBeGreaterThan(280) // 330 มล.
    expect(vesselMl('aluminum')).toBeLessThan(340)
    expect(vesselMl('glass')).toBeGreaterThan(750) // 750 มล.
    expect(vesselMl('tube-laminate')).toBeGreaterThan(45) // 50 มล.
    expect(vesselMl('tube-laminate')).toBeLessThan(70)
    const pouchMl = (s: keyof typeof POUCH_STANDARD) => {
      const sz = POUCH_STANDARD[s]
      const p = generatePouch(sz, getMaterial('pouch-foil'), { style: s })
      return pouchVolumeMl(sz.W, sz.H, p.depth3D, s)
    }
    expect(pouchMl('spout')).toBeGreaterThan(200) // 250 มล.
    expect(pouchMl('spout')).toBeLessThan(300)
    expect(pouchMl('stand')).toBeGreaterThan(550) // กาแฟเมล็ด 250 ก. ≈ 600–750 มล.
    expect(pouchMl('gusset')).toBeGreaterThan(550)
  })

  it('standardSizeFor: ภาชนะตามวัสดุ ถุงตามรูปแบบ วัสดุที่ไม่รู้จัก = null', () => {
    expect(standardSizeFor('aluminum', 'stand', 'vessel')).toEqual({ W: 66, D: 53, H: 115 })
    expect(standardSizeFor('pouch-kraft', 'gusset', 'pouch')).toEqual({ W: 80, D: 60, H: 210 })
    expect(standardSizeFor('unknown', 'stand', 'vessel')).toBeNull()
  })

  it('ยังไม่เริ่มงาน = ไม่มีลายและไม่มีรูปพื้น', () => {
    expect(isFreshWork([], null)).toBe(true)
    expect(isFreshWork([], { src: 'data:x' } as never)).toBe(false)
    expect(isFreshWork([{ id: 'a', type: 'text' } as never], null)).toBe(false)
  })
})
