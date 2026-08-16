import { describe, expect, it } from 'vitest'
import {
  generatePouch,
  pouchDepthFactor,
  pouchWidthFactor,
  pouchSection,
  isPouch,
  POUCH_SIDE_SEAL,
  POUCH_TOP_SEAL,
} from './pouch'
import { getMaterial } from './materials'
import { dielinePDFBytes } from './pdf'
import { computeGuides } from './guides'

const mat = getMaterial('pouch-foil')

describe('pouch: dieline แผ่นฟิล์มแบน', () => {
  it('วัสดุ pouch ถูกจำแนกเป็นถุง', () => {
    expect(isPouch(mat)).toBe(true)
    expect(isPouch(getMaterial('pet-bottle'))).toBe(false)
    expect(isPouch(getMaterial('carton-300'))).toBe(false)
  })

  it('ขนาดแผ่น = (2W + ริมซีล) × (ริมบน + สูงลำตัว + ก้น)', () => {
    const W = 120,
      D = 70,
      H = 180
    const p = generatePouch({ W, D, H }, mat)
    expect(p.label.width).toBe(2 * W + POUCH_SIDE_SEAL)
    expect(p.label.height).toBe(POUCH_TOP_SEAL + H + D)
    expect(p.gusset).toBe(D)
    // พื้นที่พิมพ์หน้า/หลังอยู่ใต้ริมซีลบน กว้าง W สูง H
    expect(p.frontRect).toEqual({ x: 0, y: POUCH_TOP_SEAL, w: W, h: H })
    expect(p.backRect).toEqual({ x: W, y: POUCH_TOP_SEAL, w: W, h: H })
  })

  it('ก้น (D) ถูก clamp ไม่เกินความกว้างถุง และไม่ต่ำกว่า 10', () => {
    expect(generatePouch({ W: 100, D: 300, H: 150 }, mat).gusset).toBe(100) // เกิน W → = W
    expect(generatePouch({ W: 100, D: 3, H: 150 }, mat).gusset).toBe(10) // ต่ำกว่า 10 → 10
  })

  it('มีเส้นตัดรอบนอก + รอยพับ/ซีล 5 เส้น (สันข้าง/กาว/ปาก/ก้น/กลางก้น)', () => {
    const p = generatePouch({ W: 120, D: 70, H: 180 }, mat)
    expect(p.label.segments.filter((s) => s.kind === 'cut').length).toBe(1)
    expect(p.label.segments.filter((s) => s.kind === 'crease').length).toBe(5)
    expect(p.label.panels.map((pp) => pp.id)).toEqual(['film', 'glue'])
  })

  it('ไม่ใส่ซิป (ค่าเริ่มต้น) → ไม่มี zipY และไม่มีเส้น/รอยฉีกเพิ่ม', () => {
    const p = generatePouch({ W: 120, D: 70, H: 180 }, mat)
    expect(p.zipper).toBe(false)
    expect(p.zipY).toBeUndefined()
    expect(p.label.segments.filter((s) => s.kind === 'crease').length).toBe(5)
    expect(p.label.segments.filter((s) => s.kind === 'cut').length).toBe(1)
  })

  it('ใส่ซิป → เพิ่มแนวซิป (crease) + รอยฉีกสองข้าง (cut) + zipY อยู่ใต้ปากบน', () => {
    const p = generatePouch({ W: 120, D: 70, H: 180 }, mat, { zipper: true })
    expect(p.zipper).toBe(true)
    expect(p.zipY).toBe(POUCH_TOP_SEAL + 18) // inset 18 (H สูงพอ)
    expect(p.label.segments.filter((s) => s.kind === 'crease').length).toBe(6) // +แนวซิป
    expect(p.label.segments.filter((s) => s.kind === 'cut').length).toBe(3) // +รอยฉีก 2 ข้าง
    expect(p.label.dims.some((d) => d.label.includes('ซิป'))).toBe(true)
  })

  it('ถุงเตี้ยมาก: แนวซิปไม่ต่ำกว่าครึ่งลำตัว', () => {
    const p = generatePouch({ W: 120, D: 70, H: 20 }, mat, { zipper: true }) // H เล็ก → inset ถูกจำกัด
    expect(p.zipY! - POUCH_TOP_SEAL).toBeLessThanOrEqual(10) // ≤ H*0.5
  })

  it('รูปแบบซองแบน (flat): ไม่มีก้น — สูงแผ่น = ริมบน+ตัว+ริมล่าง, ไม่มีเส้นพับกลางก้น', () => {
    const W = 100,
      D = 70,
      H = 140
    const p = generatePouch({ W, D, H }, mat, { style: 'flat' })
    expect(p.style).toBe('flat')
    expect(p.gusset).toBe(0) // ไม่มีก้น (ไม่ใช้ D)
    expect(p.label.height).toBe(POUCH_TOP_SEAL + H + POUCH_TOP_SEAL) // ริมบน + ตัว + ริมล่าง
    // ซองแบน = crease 4 เส้น (สันข้าง/กาว/ซีลบน/ซีลล่าง) ไม่มีพับกลางก้น
    expect(p.label.segments.filter((s) => s.kind === 'crease').length).toBe(4)
    expect(p.label.dims.some((d) => d.label.includes('ก้น'))).toBe(false)
    expect(p.label.dims.some((d) => d.label.includes('กว้างซอง'))).toBe(true)
    expect(p.depth3D).toBeGreaterThan(0) // ยังพองบาง ๆ ใน 3D
  })

  it('ค่าเริ่มต้น (ไม่ระบุ opts) = ถุงตั้ง', () => {
    expect(generatePouch({ W: 100, D: 70, H: 140 }, mat).style).toBe('stand')
  })

  it('ถุงก้นแบนตั้งเหลี่ยม (box): มีทั้งจีบข้างและก้น + ตั้งได้', () => {
    const p = generatePouch({ W: 90, D: 60, H: 200 }, mat, { style: 'box' })
    expect(p.stands).toBe(true)
    expect(p.label.width).toBe(2 * 90 + 2 * 60 + POUCH_SIDE_SEAL) // มีจีบข้าง
    expect(p.label.height).toBe(POUCH_TOP_SEAL + 200 + 60) // ริมบน + ตัว + ก้น
    expect(p.label.dims.some((d) => d.label.includes('จีบข้าง'))).toBe(true)
    expect(p.label.dims.some((d) => d.label.includes('ก้น'))).toBe(true)
  })

  it('ซองหลังกลาง (pillow): ไม่มีก้น/จีบ + มีเส้นซีลหลังกลาง + พองมากกว่าซองแบน', () => {
    const p = generatePouch({ W: 100, D: 70, H: 150 }, mat, { style: 'pillow' })
    expect(p.stands).toBe(false)
    expect(p.gusset).toBe(0)
    expect(p.label.width).toBe(2 * 100 + POUCH_SIDE_SEAL) // ไม่มีจีบข้าง
    expect(p.depth3D).toBeGreaterThan(generatePouch({ W: 100, D: 70, H: 150 }, mat, { style: 'flat' }).depth3D)
  })

  it('ถุงมีจุก (spout): ตั้งได้เหมือน doypack + spout=true + มีป้ายจุก', () => {
    const p = generatePouch({ W: 110, D: 70, H: 180 }, mat, { style: 'spout' })
    expect(p.spout).toBe(true)
    expect(p.stands).toBe(true)
    expect(p.label.height).toBe(POUCH_TOP_SEAL + 180 + 70) // ก้น gusset เหมือน stand
    expect(p.label.dims.some((d) => d.label.includes('จุก'))).toBe(true)
  })

  it('รูปแบบซองข้างจีบ (gusset): กว้างแผ่น = 2W + จีบสองข้าง + ซีล, มีเส้นจีบ, ก้นซีลแบน', () => {
    const W = 90,
      D = 60,
      H = 200
    const p = generatePouch({ W, D, H }, mat, { style: 'gusset' })
    expect(p.style).toBe('gusset')
    expect(p.gusset).toBe(D) // จีบข้าง = D (clamp 10..W)
    expect(p.label.width).toBe(2 * W + 2 * D + POUCH_SIDE_SEAL) // หน้า+หลัง+จีบสองข้าง+ซีล
    expect(p.label.height).toBe(POUCH_TOP_SEAL + H + POUCH_TOP_SEAL) // ริมบน+ตัว+ริมล่าง (ไม่มีก้น)
    // หลังอยู่ถัดจากหน้า+จีบซ้าย
    expect(p.frontRect).toEqual({ x: 0, y: POUCH_TOP_SEAL, w: W, h: H })
    expect(p.backRect).toEqual({ x: W + D, y: POUCH_TOP_SEAL, w: W, h: H })
    // crease: ซีลข้าง(กาว) + สันพับ 3 + จีบกลาง 2 + ซีลบน + ซีลล่าง = 8
    expect(p.label.segments.filter((s) => s.kind === 'crease').length).toBe(8)
    expect(p.label.dims.some((d) => d.label.includes('จีบข้าง'))).toBe(true)
    expect(p.label.dims.some((d) => d.label.includes('ก้น'))).toBe(false)
  })

  it('dieline ไหลผ่าน guides + export PDF (CMYK) ได้เหมือน Dieline ปกติ', () => {
    const p = generatePouch({ W: 120, D: 70, H: 180 }, mat)
    expect(() => computeGuides(p.label.panels)).not.toThrow()
    const s = new TextDecoder('latin1').decode(dielinePDFBytes(p.label, true))
    expect(s.startsWith('%PDF-1.5')).toBe(true)
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true)
    // สีเป็น CMYK (k/K) ตามไฟล์ผลิต
    expect(/[\d.]+ [\d.]+ [\d.]+ [\d.]+ K\b/.test(s)).toBe(true)
  })
})

describe('pouch: หน้าตัด 3D (ยืนได้/พุงป่อง/ปากซีล)', () => {
  it('ครึ่งความลึกก้น > 0 (ตั้งได้) และปากบนแบนเกือบ 0', () => {
    expect(pouchDepthFactor(0)).toBeGreaterThan(0.5) // ก้นมีความลึก → ตั้งได้
    expect(pouchDepthFactor(1)).toBeLessThan(0.15) // ปากซีลแบน
  })

  it('พุงป่องสุดช่วงกลางล่าง มากกว่าก้นและปาก', () => {
    const belly = pouchDepthFactor(0.4)
    expect(belly).toBeGreaterThan(pouchDepthFactor(0))
    expect(belly).toBeGreaterThan(pouchDepthFactor(0.95))
    expect(belly).toBeCloseTo(1, 5)
  })

  it('ครึ่งความกว้างอยู่ในช่วง (0,1] คอดเล็กน้อยที่ปลาย', () => {
    for (const v of [0, 0.2, 0.5, 0.8, 1]) {
      const a = pouchWidthFactor(v)
      expect(a).toBeGreaterThan(0)
      expect(a).toBeLessThanOrEqual(1)
    }
    expect(pouchWidthFactor(0.5)).toBe(1)
    expect(pouchWidthFactor(1)).toBeLessThan(1) // ปากคอดเข้าซีล
  })

  it('ซองแบน (flat): วงรีสมมาตร ซีลแบนทั้งบน-ล่าง พองสุดกลาง', () => {
    expect(pouchDepthFactor(0, 'flat')).toBeLessThan(0.1) // ซีลล่างแบน
    expect(pouchDepthFactor(1, 'flat')).toBeLessThan(0.1) // ซีลบนแบน
    expect(pouchDepthFactor(0.5, 'flat')).toBeCloseTo(1, 5) // พองสุดกลาง
  })

  it('ซองข้างจีบ (gusset): ลำตัวเต็ม (แท่ง) + หน้าตัดเหลี่ยมกว่าวงรี', () => {
    expect(pouchDepthFactor(0.5, 'gusset')).toBe(1) // ลำตัวเต็ม
    expect(pouchDepthFactor(0.02, 'gusset')).toBeLessThan(0.4) // ริมล่างบีบแบน
    // หน้าตัดที่ 45°: superellipse เหลี่ยมกว่าวงรี (ค่าเข้าใกล้ 1 มากกว่า)
    const box = pouchSection(Math.PI / 4, 'gusset')
    const ell = pouchSection(Math.PI / 4, 'stand')
    expect(Math.abs(box.cx)).toBeGreaterThan(Math.abs(ell.cx))
  })
})
