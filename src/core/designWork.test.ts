import { describe, expect, it } from 'vitest'
import type { Deco, FillImage } from './artwork'
import { hasDesignWork, summarizeDesignWork } from './designWork'

const text = (id: string) => ({ id, type: 'text', text: 'x', color: '#000000', size: 3, w: 10, x: 0, y: 0, rot: 0 }) as Deco
const shape = { id: 'b', type: 'shape', shape: 'rect', w: 1, h: 1, fill: '#000000', stroke: 'none', strokeW: 0, x: 0, y: 0, rot: 0 } as Deco
const image = { id: 'c', type: 'image', src: 'data:image/png;base64,', aspect: 1, w: 10, h: 10, x: 0, y: 0, rot: 0 } as Deco
const fillImage = { src: 'data:image/png;base64,' } as unknown as FillImage

describe('designWork (งานตกแต่งที่ต้องเตือนก่อนสลับประเภท/รูปแบบ)', () => {
  it('งานใหม่ที่ยังไม่มีลาย/รูปพื้น/สีพื้น ไม่ถือว่ามีงาน', () => {
    expect(hasDesignWork([], null, null)).toBe(false)
    expect(hasDesignWork([], undefined, undefined)).toBe(false)
    expect(summarizeDesignWork([], null, null).total).toBe(0)
  })

  it('มีแค่อย่างเดียว — ชิ้นงานหนึ่งชิ้น รูปพื้น หรือสีพื้น — ก็ถือว่าตกแต่งแล้ว', () => {
    expect(hasDesignWork([text('a')], null, null)).toBe(true)
    expect(hasDesignWork([], fillImage, null)).toBe(true)
    expect(hasDesignWork([], null, '#ff0000')).toBe(true)
  })

  it('สรุปจำนวนตามชนิด', () => {
    const s = summarizeDesignWork([text('a'), text('b'), shape, image], fillImage, '#123456')
    expect(s).toEqual({ text: 2, image: 1, shape: 1, nutrition: 0, fillImage: true, fillColor: true, total: 6 })
  })
})
