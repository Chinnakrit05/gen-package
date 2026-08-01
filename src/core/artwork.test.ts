import { beforeAll, describe, expect, it } from 'vitest'
import {
  elCenter,
  elH,
  elW,
  makeImageEl,
  makeShapeEl,
  makeTextEl,
  measureText,
  parseDeco,
  parseDecos,
  recenter,
  shapeSVG,
  sheetUV,
  withTextW,
  type Deco,
} from './artwork'
import { TEMPLATES } from './templates'
import { getMaterial } from './materials'

// เทสต์รันบน node — stub canvas 2d ให้ measureText ทำงาน (กว้าง ≈ 0.6·size ต่ออักขระ)
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

const dieline = () =>
  TEMPLATES[0].generate({ W: 80, D: 50, H: 120, handle: false }, getMaterial('carton-300'))

describe('sheetUV: สูตร map แผ่นคลี่ → texture (จุดที่พลิกแกน)', () => {
  // พลาดตรงนี้เมื่อไหร่ ลายบนกล่อง 3D จะกลับหัวหรือเลื่อนไปคนละแผง
  it.each([
    ['ซ้ายบนแผ่น (0,0) → uv (0,1)', 0, 0, 0, 1],
    ['ขวาล่างแผ่น (W,H) → uv (1,0)', 300, -200, 1, 0],
    ['กึ่งกลางแผ่น → uv (0.5,0.5)', 150, -100, 0.5, 0.5],
  ])('%s', (_n, X, Y, eu, ev) => {
    const [u, v] = sheetUV(X, Y, 300, 200)
    expect(u).toBeCloseTo(eu, 9)
    expect(v).toBeCloseTo(ev, 9)
  })
})

describe('การวางอัตโนมัติ', () => {
  it('image: วางกลางหน้าโชว์ สูงตาม aspect และอยู่ในแผ่น', () => {
    const d = dieline()
    const el = makeImageEl(d, 'data:image/png;base64,AAA', 2)
    expect(el.type).toBe('image')
    expect(elH(el)).toBeCloseTo(elW(el) / 2)
    expect(el.rot).toBe(0)
    expect(el.x).toBeGreaterThanOrEqual(0)
    expect(el.y).toBeGreaterThanOrEqual(0)
    expect(el.x + elW(el)).toBeLessThanOrEqual(d.width)
    expect(el.y + elH(el)).toBeLessThanOrEqual(d.height)
  })

  it('recenter: คงขนาด/มุม เปลี่ยนแค่ตำแหน่งกลับเข้าแผ่น', () => {
    const d = dieline()
    const el = makeImageEl(d, 'data:image/png;base64,AAA', 1)
    const rc = recenter(d, { ...el, x: -50, y: -50, rot: 45 })
    expect(elW(rc)).toBe(elW(el))
    expect(rc.rot).toBe(45)
    expect(rc.x).toBeGreaterThanOrEqual(0)
    expect(rc.y).toBeGreaterThanOrEqual(0)
  })

  it('text: มีค่าเริ่มต้นครบ และ withTextW วัดความกว้างใหม่', () => {
    const d = dieline()
    const el = makeTextEl(d, 'ทดสอบ')
    expect(el.type).toBe('text')
    expect(elH(el)).toBeCloseTo(el.size * 1.25)
    expect(el.color).toMatch(/^#/)
    expect(withTextW({ ...el, text: 'ยาวขึ้นมาก' }).w).toBeGreaterThan(withTextW({ ...el, text: 'x' }).w)
    expect(typeof measureText('x', 10)).toBe('number')
  })

  it('จุดกึ่งกลางไม่ขึ้นกับ rot (หมุนรอบตัวเอง ไม่ใช่ย้ายที่)', () => {
    const el = makeImageEl(dieline(), 'data:image/png;base64,AAA', 1)
    const c0 = elCenter(el)
    const c1 = elCenter({ ...el, rot: 90 })
    expect(c1.x).toBeCloseTo(c0.x)
    expect(c1.y).toBeCloseTo(c0.y)
  })

  it('id ไม่ซ้ำกัน', () => {
    const d = dieline()
    const ids = [makeImageEl(d, 'data:image/png;base64,A', 1).id, makeTextEl(d, 'x').id, makeTextEl(d, 'y').id]
    expect(new Set(ids).size).toBe(3)
  })
})

describe('รูปทรงพื้นฐาน (shape)', () => {
  it.each(['rect', 'ellipse', 'line'] as const)('makeShapeEl %s: วางกลางหน้าโชว์ ขนาด+สีครบ', (shape) => {
    const d = dieline()
    const el = makeShapeEl(d, shape)
    expect(el.type).toBe('shape')
    expect(el.shape).toBe(shape)
    expect(elW(el)).toBeGreaterThan(0)
    expect(elH(el)).toBeGreaterThan(0)
    expect(el.x).toBeGreaterThanOrEqual(0)
    expect(el.y).toBeGreaterThanOrEqual(0)
    if (shape === 'line') {
      expect(el.stroke).toMatch(/^#/)
      expect(el.strokeW).toBeGreaterThan(0)
      expect(el.h).toBe(el.strokeW) // เส้น: สูง = ความหนา
    } else {
      expect(el.fill).toMatch(/^#/)
    }
  })

  it('elH ของ shape = h (ไม่ใช่สูตร text/image)', () => {
    const d = dieline()
    const el = makeShapeEl(d, 'rect')
    expect(elH(el)).toBe(el.h)
    expect(elCenter(el)).toEqual({ x: el.x + el.w / 2, y: el.y + el.h / 2 })
  })

  it('parseDeco round-trip shape คงทุกฟิลด์', () => {
    const src = { type: 'shape', shape: 'ellipse', w: 40, h: 25, fill: '#123456', stroke: 'none', strokeW: 0, x: 5, y: 6, rot: 15 }
    const el = parseDeco(src)
    expect(el).not.toBeNull()
    expect(el).toMatchObject({ type: 'shape', shape: 'ellipse', w: 40, h: 25, fill: '#123456', stroke: 'none', strokeW: 0, x: 5, y: 6, rot: 15 })
  })

  it('parseDeco: shape ไม่รู้จัก → rect, ขนาด ≤ 0 → null', () => {
    expect((parseDeco({ type: 'shape', shape: 'ดาว', w: 10, h: 10, x: 0, y: 0, rot: 0 }) as { shape: string }).shape).toBe('rect')
    expect(parseDeco({ type: 'shape', shape: 'rect', w: 0, h: 10, x: 0, y: 0, rot: 0 })).toBeNull()
  })

  it('shapeSVG: rect มีพื้น+ขอบ, ellipse ใช้ cx/rx, line ใช้ x1..x2', () => {
    expect(shapeSVG({ id: 'a', type: 'shape', shape: 'rect', w: 20, h: 10, fill: '#0f6e56', stroke: '#000', strokeW: 2, x: 1, y: 2, rot: 0 }, ''))
      .toMatch(/<rect .*fill="#0f6e56".*stroke="#000".*stroke-width="2"/)
    expect(shapeSVG({ id: 'b', type: 'shape', shape: 'ellipse', w: 20, h: 10, fill: '#0f6e56', stroke: 'none', strokeW: 0, x: 0, y: 0, rot: 0 }, ''))
      .toMatch(/<ellipse .*rx="10".*ry="5"/)
    expect(shapeSVG({ id: 'c', type: 'shape', shape: 'line', w: 30, h: 2, fill: 'none', stroke: '#222', strokeW: 2, x: 0, y: 0, rot: 0 }, ''))
      .toMatch(/<line x1="0".*x2="30".*stroke="#222"/)
  })
})

describe('persistence + migration', () => {
  it('ข้อมูลรุ่นเก่า (โลโก้เดี่ยว ไม่มี type) แปลงเป็น image element', () => {
    const legacy = { src: 'data:image/png;base64,AAA', aspect: 1.5, x: 10, y: 20, w: 30 }
    const list = parseDecos(undefined, legacy)
    expect(list).toHaveLength(1)
    expect(list[0].type).toBe('image')
    expect(list[0].rot).toBe(0)
    expect(list[0].x).toBe(10)
  })

  it('round-trip รายการใหม่คงจำนวนและชนิด', () => {
    const d = dieline()
    const good: Deco[] = [makeImageEl(d, 'data:image/png;base64,AAA', 1), makeTextEl(d, 'hi')]
    const round = parseDecos(JSON.parse(JSON.stringify(good)))
    expect(round.map((x) => x.type)).toEqual(['image', 'text'])
  })

  it.each([
    ['src ไม่ใช่ data URI', { type: 'image', src: 'http://evil/x.png', aspect: 1, w: 10, x: 0, y: 0, rot: 0 }],
    ['text size ≤ 0', { type: 'text', text: 'a', size: 0, color: '#000', x: 0, y: 0, rot: 0 }],
    ['aspect = 0', { type: 'image', src: 'data:image/png;base64,A', aspect: 0, w: 10, x: 0, y: 0, rot: 0 }],
    ['null', null],
  ])('ปฏิเสธข้อมูลเสีย: %s', (_n, bad) => {
    expect(parseDeco(bad)).toBeNull()
  })

  it('parseDecos รับค่าเสียแล้วคืน []', () => {
    expect(parseDecos('ไม่ใช่ array', undefined)).toHaveLength(0)
  })

  it('hidden/locked: parse คงค่า true, ปกติไม่ใส่ flag (round-trip สะอาด)', () => {
    const withFlags = parseDeco({ type: 'text', text: 'a', size: 10, color: '#000', x: 0, y: 0, rot: 0, hidden: true, locked: true })
    expect(withFlags).toMatchObject({ hidden: true, locked: true })
    const noFlags = parseDeco({ type: 'text', text: 'a', size: 10, color: '#000', x: 0, y: 0, rot: 0 })!
    expect(noFlags.hidden).toBeUndefined()
    expect(noFlags.locked).toBeUndefined()
  })
})
