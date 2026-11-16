import { beforeAll, describe, expect, it } from 'vitest'
import { decosInRect, layerRows, elCenter, elH, elW, isWholeGroup, rotatedSelectionBounds, transformSelection, type Deco } from './artwork'

// รันบน node — stub canvas วัดความกว้างข้อความ (ข้อความในกล่อง boxW ต้องวัดเพื่อหาความสูง)
beforeAll(() => {
  ;(globalThis as unknown as { document: unknown }).document = {
    createElement: () => ({
      getContext: () => {
        let size = 10
        return {
          set font(v: string) {
            size = parseFloat(v) || 10
          },
          measureText: (t: string) => ({ width: (t?.length || 1) * size * 0.6 }),
        }
      },
    }),
  }
})

const shape = (id: string, x: number, y: number, w: number, h: number, extra: Partial<Deco> = {}): Deco =>
  ({ id, type: 'shape', shape: 'rect', x, y, w, h, rot: 0, fill: '#000', stroke: 'none', strokeW: 1, ...extra }) as Deco
const text = (id: string, x: number, y: number): Deco =>
  ({ id, type: 'text', text: 'ทดสอบ', color: '#000', size: 10, w: 40, x, y, rot: 0, boxW: 40, strokeW: 0.5, strokeColor: '#fff' }) as Deco

describe('กรอบรวมแบบรวมการหมุน', () => {
  it('ชิ้นหมุน 90° ได้กรอบสลับกว้าง/สูงรอบจุดกึ่งกลางเดิม', () => {
    const b = rotatedSelectionBounds([shape('a', 0, 0, 40, 10, { rot: 90 })], ['a'])!
    expect(b.x0).toBeCloseTo(15, 6)
    expect(b.x1).toBeCloseTo(25, 6)
    expect(b.y0).toBeCloseTo(-15, 6)
    expect(b.y1).toBeCloseTo(25, 6)
  })
  it('ไม่มีชิ้นที่เลือก = null', () => {
    expect(rotatedSelectionBounds([shape('a', 0, 0, 1, 1)], ['x'])).toBeNull()
  })
})

describe('ลากคลุมเลือก', () => {
  const ds = [shape('a', 0, 0, 10, 10), shape('b', 50, 50, 10, 10), shape('c', 20, 0, 10, 10, { hidden: true })]
  it('เลือกชิ้นที่กรอบแตะ ไม่ต้องคลุมทั้งชิ้น และข้ามชิ้นที่ซ่อน', () => {
    expect(decosInRect(ds, { x0: 5, x1: 25, y0: 5, y1: 8 })).toEqual(['a'])
    expect(decosInRect(ds, { x0: -5, x1: 55, y0: -5, y1: 55 })).toEqual(['a', 'b'])
    expect(decosInRect(ds, { x0: 30, x1: 40, y0: 30, y1: 40 })).toEqual([])
  })
})

describe('ย่อขยาย/หมุนทั้งชุดที่เลือก', () => {
  const ds = [shape('a', 0, 0, 20, 10), text('t', 40, 20), shape('z', 100, 100, 5, 5)]
  it('ย่อขยายรอบจุดตรึง: ตำแหน่งกึ่งกลางและขนาดคูณ k, ตัวอักษร/กล่องข้อความ/เส้นขอบตาม, ชิ้นนอกชุดไม่ขยับ', () => {
    const out = transformSelection(ds, ['a', 't'], { kind: 'scale', k: 2, ax: 0, ay: 0 })
    const a = out[0]
    expect([a.x, a.y, elW(a), elH(a)]).toEqual([0, 0, 40, 20])
    const t = out[1] as Extract<Deco, { type: 'text' }>
    expect(t.size).toBe(20)
    expect(t.boxW).toBe(80)
    expect(t.strokeW).toBe(1)
    const c0 = elCenter(ds[1])
    const c1 = elCenter(t)
    expect(c1.x).toBeCloseTo(c0.x * 2, 2)
    expect(c1.y).toBeCloseTo(c0.y * 2, 2)
    expect(out[2]).toBe(ds[2])
  })
  it('หมุน 90° รอบจุดกลาง: กึ่งกลางชิ้นหมุนตาม มุมของชิ้นบวกเท่ากัน', () => {
    const out = transformSelection(ds, ['a'], { kind: 'rotate', deg: 90, cx: 0, cy: 0 })
    const c = elCenter(out[0])
    expect(c.x).toBeCloseTo(-5, 2)
    expect(c.y).toBeCloseTo(10, 2)
    expect(out[0].rot).toBe(90)
    // หมุนครบรอบกลับที่เดิม
    const back = transformSelection(transformSelection(ds, ['a'], { kind: 'rotate', deg: 200, cx: 3, cy: 7 }), ['a'], { kind: 'rotate', deg: 160, cx: 3, cy: 7 })
    expect(back[0].x).toBeCloseTo(0, 1)
    expect(back[0].y).toBeCloseTo(0, 1)
    expect(back[0].rot).toBe(0)
  })
})

describe('ตรวจว่าชุดที่เลือกเป็นกลุ่มเดียวครบ', () => {
  const ds = [shape('a', 0, 0, 1, 1, { groupId: 'g1' }), shape('b', 0, 0, 1, 1, { groupId: 'g1' }), shape('c', 0, 0, 1, 1)]
  it('เลือกครบทั้งกลุ่มเดียว = ใช่; ปนชิ้นนอกกลุ่ม/ไม่ครบกลุ่ม/ชิ้นเดียว = ไม่ใช่', () => {
    expect(isWholeGroup(ds, ['a', 'b'])).toBe(true)
    expect(isWholeGroup(ds, ['a', 'b', 'c'])).toBe(false)
    expect(isWholeGroup(ds, ['a'])).toBe(false)
    expect(isWholeGroup(ds, ['c', 'a'])).toBe(false)
  })
})

describe('แถวเลเยอร์แบบมีกลุ่ม', () => {
  it('หัวกลุ่มอยู่ตำแหน่งชิ้นบนสุดของกลุ่ม แล้วสมาชิกทั้งหมดย่อหน้าตามมา (รวบชิ้นที่ไม่ติดกัน); กลุ่มชิ้นเดียว = แถวปกติ', () => {
    const ds = [
      shape('a', 0, 0, 1, 1, { groupId: 'g1' }),
      shape('b', 0, 0, 1, 1),
      shape('c', 0, 0, 1, 1, { groupId: 'g1' }),
      shape('d', 0, 0, 1, 1, { groupId: 'solo' }),
    ]
    const rows = layerRows(ds).map((r) => (r.kind === 'head' ? `[${r.groupId}:${r.members.length}]` : `${r.inGroup ? '  ' : ''}${r.d.id}`))
    expect(rows).toEqual(['d', '[g1:2]', '  c', '  a', 'b'])
  })
})
