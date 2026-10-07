import { describe, expect, it } from 'vitest'
import { proofDeco, proofHex, proofPixels, proofRGB } from './softProof'
import type { NutritionEl, ShapeEl, TextEl } from './artwork'

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

describe('soft-proof CMYK: LUT', () => {
  it('ขาว/ดำ/เทาคงเดิม (แก้ gray balance แล้ว ไม่อมเหลือง ไม่ยกดำ)', () => {
    for (const v of [0, 32, 64, 128, 191, 255]) {
      for (const c of proofRGB(v, v, v)) expect(Math.abs(c - v)).toBeLessThanOrEqual(2)
    }
  })

  it('สีจอที่หมึกพิมพ์ไม่ได้ (RGB ล้วน) หม่นลงชัด', () => {
    expect(dist(proofRGB(0, 0, 255), [0, 0, 255])).toBeGreaterThan(100) // ฟ้าจอ → น้ำเงินหมึก
    expect(dist(proofRGB(0, 255, 0), [0, 255, 0])).toBeGreaterThan(100) // เขียวสะท้อนแสง
    // ทิศทางถูก: ฟ้ายังเป็นโทนน้ำเงิน (B เด่นสุด) ไม่กลายเป็นสีอื่น
    const [r, g, b] = proofRGB(0, 0, 255)
    expect(b).toBeGreaterThan(g)
    expect(g).toBeGreaterThan(r)
  })

  it('สีกลาง ๆ ที่อยู่ใน gamut ขยับน้อยกว่าสีนอก gamut มาก', () => {
    const inGamut = dist(proofRGB(180, 120, 90), [180, 120, 90])
    const outGamut = dist(proofRGB(0, 0, 255), [0, 0, 255])
    expect(inGamut).toBeLessThan(15)
    expect(outGamut).toBeGreaterThan(inGamut * 5)
  })

  it('proofPixels = proofRGB ทีละพิกเซล และไม่แตะ alpha', () => {
    const px = new Uint8ClampedArray([0, 0, 255, 128, 200, 200, 200, 7])
    proofPixels(px)
    expect([px[0], px[1], px[2]]).toEqual(proofRGB(0, 0, 255))
    expect(px[3]).toBe(128)
    expect([px[4], px[5], px[6]]).toEqual(proofRGB(200, 200, 200))
    expect(px[7]).toBe(7)
  })
})

describe('soft-proof CMYK: สี hex', () => {
  it('รับ #rgb/#RRGGBB คืน hex ตัวเล็ก 6 หลัก; เก็บ alpha ของ #rrggbbaa', () => {
    expect(proofHex('#fff')).toBe('#ffffff')
    expect(proofHex('#FFFFFF')).toBe('#ffffff')
    expect(proofHex('#000000')).toBe('#000000')
    expect(proofHex('#0000ff80')).toMatch(/^#[0-9a-f]{6}80$/)
  })

  it('ค่าที่ไม่ใช่ hex (none/ชื่อสี) คืนเดิม', () => {
    expect(proofHex('none')).toBe('none')
    expect(proofHex('transparent')).toBe('transparent')
  })
})

describe('soft-proof CMYK: ลาย (Deco)', () => {
  it('ข้อความ: แปลง color/strokeColor ไม่แตะ id/ตำแหน่ง และไม่แก้ object เดิม', () => {
    const t: TextEl = { id: 't1', type: 'text', text: 'สวัสดี', color: '#00ff00', strokeColor: '#0000ff', size: 8, w: 30, x: 5, y: 6, rot: 0 }
    const p = proofDeco(t) as TextEl
    expect(p).not.toBe(t)
    expect(t.color).toBe('#00ff00') // ต้นฉบับไม่เปลี่ยน
    expect(p.color).toBe(proofHex('#00ff00'))
    expect(p.strokeColor).toBe(proofHex('#0000ff'))
    expect([p.id, p.x, p.y, p.text, p.size]).toEqual([t.id, t.x, t.y, t.text, t.size])
  })

  it('ข้อความไม่มีขอบ: ไม่เพิ่มคีย์ strokeColor', () => {
    const t: TextEl = { id: 't2', type: 'text', text: 'a', color: '#222222', size: 5, w: 5, x: 0, y: 0, rot: 0 }
    expect('strokeColor' in proofDeco(t)).toBe(false)
  })

  it('รูปทรง: แปลง fill/stroke/ไล่สี; คง none', () => {
    const s: ShapeEl = {
      id: 's1', type: 'shape', shape: 'rect', w: 10, h: 10, fill: '#ff0000', stroke: 'none', strokeW: 0, x: 0, y: 0, rot: 0,
      grad: { from: '#00ffff', to: '#ffff00', angle: 90 },
    }
    const p = proofDeco(s) as ShapeEl
    expect(p.fill).toBe(proofHex('#ff0000'))
    expect(p.stroke).toBe('none')
    expect(p.grad).toEqual({ from: proofHex('#00ffff'), to: proofHex('#ffff00'), angle: 90 })
  })

  it('ตารางโภชนาการไม่ตั้งสีหมึก (ดำ) คืน object เดิม', () => {
    const n = { id: 'n1', type: 'nutrition', x: 0, y: 0, rot: 0 } as unknown as NutritionEl
    expect(proofDeco(n)).toBe(n)
  })
})
