import { describe, expect, it } from 'vitest'
import { freshProjectFor } from './newWork'
import { DEFAULT_CARD_MAT } from './materials'
import { POUCH_STANDARD, VESSEL_STANDARD } from './standardSize'
import { getTemplate } from './templates'

// ชิ้นงานใหม่จากการเปลี่ยนประเภทงาน: ไม่มีอะไรจากงานเก่า — ลาย/สีพื้น/ประวัติว่าง ขนาดมาตรฐานของแบบที่เลือก
describe('freshProjectFor', () => {
  it('งานใหม่ว่างเปล่า มี id/ชื่อของตัวเอง', () => {
    const a = freshProjectFor(3, { template: 'mailer', materialId: 'carton-300' })
    const b = freshProjectFor(3, { template: 'mailer', materialId: 'carton-300' })
    expect(a.id).not.toBe(b.id)
    expect(a.name).toBe('งาน 3')
    expect(a.decos).toEqual([])
    expect(a.fillColor).toBeNull()
    expect(a.fillImage).toBeUndefined()
    expect(a.history).toEqual([])
    expect(a.labelStyle).toBeUndefined()
    expect(a.stickerCut).toBeUndefined()
  })

  it('กล่อง/นามบัตร/สติกเกอร์ใช้ขนาดตั้งต้นของ template', () => {
    for (const [template, materialId] of [['mailer', 'carton-300'], ['card', DEFAULT_CARD_MAT], ['sticker', 'sticker-vinyl']]) {
      const p = freshProjectFor(1, { template, materialId })
      const d = getTemplate(template).defaults
      expect(p.live).toEqual({ template, materialId, W: d.W, D: d.D, H: d.H, handle: false })
    }
  })

  it('ภาชนะ/หลอดใช้ขนาดมาตรฐานของวัสดุ', () => {
    for (const id of ['pet-bottle', 'tube-laminate'] as const) {
      const p = freshProjectFor(1, { template: 'tuck-end', materialId: id })
      expect([p.live.W, p.live.D, p.live.H]).toEqual([VESSEL_STANDARD[id].W, VESSEL_STANDARD[id].D, VESSEL_STANDARD[id].H])
    }
  })

  it('ถุงใช้ขนาดมาตรฐานของรูปแบบถุง และเก็บรูปแบบเฉพาะเมื่อไม่ใช่ค่าเริ่มต้น', () => {
    const g = freshProjectFor(1, { template: 'tuck-end', materialId: 'pouch-foil', pouchStyle: 'gusset' })
    expect(g.pouchStyle).toBe('gusset')
    expect([g.live.W, g.live.D, g.live.H]).toEqual([POUCH_STANDARD.gusset.W, POUCH_STANDARD.gusset.D, POUCH_STANDARD.gusset.H])
    const s = freshProjectFor(1, { template: 'tuck-end', materialId: 'pouch-foil' })
    expect(s.pouchStyle).toBeUndefined()
    expect(s.live.W).toBe(POUCH_STANDARD.stand.W)
  })
})
