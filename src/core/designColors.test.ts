import { describe, expect, it } from 'vitest'
import { designPalette, hexToCmyk, normHex, svgDataUrlColors } from './designColors'
import { assemblePDF } from './specSheet'
import type { Deco } from './artwork'

const text = (over: Partial<Extract<Deco, { type: 'text' }>> = {}): Deco =>
  ({ id: 't', type: 'text', text: 'ชาดอกอัญชัน', color: '#1f3a93', size: 8, w: 40, x: 0, y: 0, rot: 0, ...over }) as Deco
const shape = (over: Partial<Extract<Deco, { type: 'shape' }>> = {}): Deco =>
  ({ id: 's', type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, rot: 0, fill: '#c9a227', stroke: 'none', strokeW: 0, ...over }) as Deco
const svgUrl = (svg: string) => `data:image/svg+xml;base64,${btoa(svg)}`

describe('ชุดสีในงานออกแบบ', () => {
  it('normHex / CMYK สูตรเดียวกับไฟล์ผลิต', () => {
    expect(normHex('#abc')).toBe('#AABBCC')
    expect(normHex('#1f3a93cc')).toBe('#1F3A93')
    expect(normHex('none')).toBeNull()
    expect(hexToCmyk('#FF0000')).toEqual([0, 1, 1, 0])
    expect(hexToCmyk('#000000')).toEqual([0, 0, 0, 1])
  })

  it('รวมสีพื้น ข้อความ (ตัว/ขอบ/เอฟเฟกต์) รูปทรง — นับซ้ำ บอกที่ใช้ และเรียงตามจำนวนครั้ง', () => {
    const p = designPalette({
      fillColor: '#f5efe0',
      decos: [
        text({ strokeColor: '#ffffff', strokeW: 0.3, fx: { kind: 'drop' } }),
        shape(),
        shape({ id: 's2', fill: '#1f3a93', name: 'แถบล่าง' }),
      ],
    })
    const by = new Map(p.colors.map((c) => [c.hex, c]))
    expect(by.get('#F5EFE0')!.uses).toEqual(['สีพื้นแพ็กเกจ'])
    expect(by.get('#1F3A93')!.count).toBe(2)
    expect(by.get('#1F3A93')!.uses).toEqual(['ข้อความ "ชาดอกอัญชัน"', 'แถบล่าง'])
    expect(by.get('#FFFFFF')!.uses[0]).toContain('(ขอบ)')
    expect(by.get('#000000')!.uses[0]).toContain('เอฟเฟกต์เงา') // สีเงาเริ่มต้นของเอฟเฟกต์
    expect(by.get('#C9A227')!.cmyk).toEqual([0, 19, 81, 21])
    expect(p.colors[0].hex).toBe('#1F3A93')
  })

  it('ไล่สี / เส้นวาดเอง / ตารางโภชนาการ / ลายจากคลัง / รูป SVG ของ AI', () => {
    const p = designPalette({
      decos: [
        text({ grad: { from: '#ff0000', to: '#0000ff', angle: 0 } }),
        { id: 'p', type: 'path', anchors: [], closed: false, w: 10, h: 10, x: 0, y: 0, rot: 0, fill: 'none', stroke: '#00aa00', strokeW: 0.5 } as Deco,
        { id: 'n', type: 'nutrition', w: 40, x: 0, y: 0, rot: 0, serving: '', servings: '', energy: '', rows: [], vitamins: [], footnote: '' } as Deco,
        { id: 'i1', type: 'image', src: 'data:image/png;base64,AAAA', aspect: 1, w: 10, h: 10, x: 0, y: 0, rot: 0, preset: 'leaf', presetColor: '#336633' } as Deco,
        { id: 'i2', type: 'image', src: svgUrl('<svg><path fill="#123456"/><stop stop-color="#abcdef"/></svg>'), aspect: 1, w: 10, h: 10, x: 0, y: 0, rot: 0 } as Deco,
      ],
    })
    const hexes = p.colors.map((c) => c.hex)
    for (const h of ['#FF0000', '#0000FF', '#00AA00', '#000000', '#FFFFFF', '#336633', '#123456', '#ABCDEF']) expect(hexes).toContain(h)
    expect(p.colors.find((c) => c.hex === '#FF0000')!.uses[0]).toContain('(ไล่สี)')
    expect(p.rasterImages).toBe(0)
  })

  it('ฟอยล์ไม่พิมพ์หมึก → แยกเป็นรายการฟอยล์; ชิ้นซ่อนไม่นับ; รูป raster นับจำนวน; สีฝาภาชนะ', () => {
    const p = designPalette({
      decos: [
        text({ finish: 'foil-gold', color: '#998877' }),
        shape({ hidden: true, fill: '#445566' }),
        { id: 'i', type: 'image', src: 'data:image/jpeg;base64,AAAA', aspect: 1, w: 10, h: 10, x: 0, y: 0, rot: 0 } as Deco,
      ],
      fillImage: { src: 'data:image/jpeg;base64,BBBB', aspect: 1 },
      capColor: '#f4f4f2',
    })
    expect(p.colors.map((c) => c.hex)).toEqual(['#F4F4F2'])
    expect(p.colors[0].uses[0]).toContain('ฝา')
    expect(p.foils).toEqual([{ name: 'ฟอยล์ทอง', spot: 'Foil_Gold', count: 1 }])
    expect(p.rasterImages).toBe(2)
  })

  it('อ่านสีจาก SVG data URL ทั้ง base64 และ URI-encoded', () => {
    expect(svgDataUrlColors(svgUrl('<rect fill="#fff" stroke="#000"/>'))).toEqual(['#FFFFFF', '#000000'])
    expect(svgDataUrlColors(`data:image/svg+xml,${encodeURIComponent('<g style="fill:#ff8800"/>')}`)).toEqual(['#FF8800'])
    expect(svgDataUrlColors('data:image/png;base64,AAAA')).toEqual([])
  })
})

describe('ใบสเปกหลายหน้า (assemblePDF)', () => {
  it('2 หน้า: Pages มี Kids 2 ใบ และ xref ชี้ตำแหน่งวัตถุถูกต้อง', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
    const bytes = assemblePDF([{ jpeg, w: 4, h: 4 }, { jpeg, w: 4, h: 4 }])
    const s = new TextDecoder('latin1').decode(bytes)
    expect(s).toContain('/Kids [3 0 R 6 0 R] /Count 2')
    const xrefPos = Number(/startxref\n(\d+)/.exec(s)![1])
    expect(s.slice(xrefPos, xrefPos + 4)).toBe('xref')
    const entries = s.slice(xrefPos).split('\n').slice(3, 3 + 8)
    entries.forEach((line, i) => {
      const off = Number(line.slice(0, 10))
      expect(s.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`)
    })
    expect(s).toContain('/Size 9')
  })
})
