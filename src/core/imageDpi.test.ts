import { describe, expect, it } from 'vitest'
import { imageDrawMm, isVectorSrc, needsDpiCheck, pixelsNeeded, printDpi } from './imageDpi'
import type { ImageEl } from './artwork'

const img = (o: Partial<ImageEl>): ImageEl => ({ id: 'i', type: 'image', src: 'data:image/png;base64,AA', aspect: 2, w: 50, h: 25, x: 0, y: 0, rot: 0, ...o })

describe('imageDpi: ขนาดที่วาดจริง', () => {
  it('cover สัดส่วนตรงกรอบ = ขนาดกรอบ', () => {
    expect(imageDrawMm(img({}))).toEqual({ w: 50, h: 25 })
  })
  it('cover กรอบสี่เหลี่ยมจัตุรัส: รูปกว้างล้นด้านข้าง (ภาพเต็มกว้างกว่ากรอบ)', () => {
    const d = imageDrawMm(img({ w: 30, h: 30 }))
    expect(d.w).toBeCloseTo(60)
    expect(d.h).toBeCloseTo(30)
  })
  it('cover + cropZoom 2 → ภาพเต็มใหญ่ขึ้นสองเท่า (dpi ลดลงครึ่ง)', () => {
    expect(imageDrawMm(img({ cropZoom: 2 }))).toEqual({ w: 100, h: 50 })
  })
  it('contain กรอบจัตุรัส: พอดีด้านกว้าง', () => {
    const d = imageDrawMm(img({ w: 30, h: 30, fit: 'contain' }))
    expect(d.w).toBeCloseTo(30)
    expect(d.h).toBeCloseTo(15)
  })
  it('stretch = ขนาดกรอบเสมอ', () => {
    expect(imageDrawMm(img({ w: 30, h: 30, fit: 'stretch' }))).toEqual({ w: 30, h: 30 })
  })
})

describe('imageDpi: ความละเอียด', () => {
  it('600 px บนกว้าง 50.8 มม. (2 นิ้ว) = 300 dpi', () => {
    expect(printDpi(600, 300, 50.8, 25.4)).toBeCloseTo(300)
  })
  it('stretch ยืดไม่เท่ากัน: ใช้แกนที่แย่กว่า', () => {
    expect(printDpi(600, 600, 50.8, 101.6)).toBeCloseTo(150)
  })
  it('พิกเซลที่ต้องมี: 100 มม. ที่ 300 dpi ≈ 1182 px', () => {
    expect(pixelsNeeded(100)).toBe(1182)
  })
})

describe('imageDpi: ชิ้นไหนต้องตรวจ', () => {
  it('SVG ไม่ต้องตรวจ (เวกเตอร์)', () => {
    expect(isVectorSrc('data:image/svg+xml;base64,PHN2Zy8+')).toBe(true)
    expect(needsDpiCheck(img({ src: 'data:image/svg+xml;base64,PHN2Zy8+' }))).toBe(false)
  })
  it('ลายจากไลบรารีและรูปที่ซ่อน ไม่ต้องตรวจ; รูปนำเข้าปกติต้องตรวจ', () => {
    expect(needsDpiCheck(img({ preset: 'dots' }))).toBe(false)
    expect(needsDpiCheck(img({ hidden: true }))).toBe(false)
    expect(needsDpiCheck(img({}))).toBe(true)
    expect(needsDpiCheck(img({ src: 'data:image/jpeg;base64,AA' }))).toBe(true)
  })
})
