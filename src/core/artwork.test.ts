import { beforeAll, describe, expect, it } from 'vitest'
import {
  elCenter,
  elH,
  elW,
  alignToFace,
  alignInSelection,
  distribute,
  stepRepeat,
  expandGroups,
  selectionBounds,
  faceBounds,
  decoLabel,
  FONTS,
  imgPAR,
  imageMaskSVG,
  textFont,
  flipTransform,
  gradVec,
  gradientSVGString,
  makeImageEl,
  makeShapeEl,
  makeTextEl,
  measureText,
  parseDeco,
  parseDecos,
  recenter,
  shapeSVG,
  shapeVertices,
  isPolyShape,
  textFxAttrs,
  textShadowSVG,
  textShadowId,
  isCurvedText,
  curvedGlyphs,
  svgArtworkLayer,
  makeNutritionEl,
  nutritionLayout,
  nutritionInnerSVG,
  sheetUV,
  withTextW,
  type Deco,
  type ShapeEl,
  type TextEl,
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

describe('ครอป/มาสก์รูป (image)', () => {
  const img = (over = {}): Deco => ({
    id: 'im', type: 'image', src: 'data:image/png;base64,AAA', aspect: 2, w: 40, h: 20, x: 5, y: 6, rot: 0, ...over,
  })

  it('makeImageEl: h = w/aspect (สัดส่วนเดิม) และ elH = h', () => {
    const d = dieline()
    const el = makeImageEl(d, 'data:image/png;base64,AAA', 2)
    expect(el.h).toBeCloseTo(el.w / 2)
    expect(elH(el)).toBe(el.h)
  })

  it('imgPAR: cover=slice, contain=meet, stretch=none', () => {
    expect(imgPAR('cover')).toBe('xMidYMid slice')
    expect(imgPAR('contain')).toBe('xMidYMid meet')
    expect(imgPAR('stretch')).toBe('none')
    expect(imgPAR(undefined)).toBe('xMidYMid slice') // ค่าเริ่มต้น = cover
  })

  it('imageMaskSVG: วงรี→ellipse, มุมโค้ง→rect rx, ไม่มีมาสก์→ว่าง', () => {
    expect(imageMaskSVG(img({ circle: true }) as never)).toContain('<ellipse')
    expect(imageMaskSVG(img({ radius: 5 }) as never)).toMatch(/<rect .*rx="5"/)
    expect(imageMaskSVG(img() as never)).toBe('')
  })

  it('parse: h เก่าไม่มี → w/aspect; fit/radius/circle คงเมื่อถูกต้อง', () => {
    const noH = parseDeco({ type: 'image', src: 'data:image/png;base64,A', aspect: 2, w: 40, x: 0, y: 0, rot: 0 }) as { h: number }
    expect(noH.h).toBeCloseTo(20)
    const full = parseDeco({ ...img({ fit: 'contain', radius: 4, circle: true }) }) as { fit?: string; radius?: number; circle?: boolean }
    expect(full).toMatchObject({ fit: 'contain', radius: 4, circle: true })
    const bad = parseDeco({ ...img({ fit: 'weird', radius: -1 }) }) as { fit?: string; radius?: number }
    expect(bad.fit).toBeUndefined()
    expect(bad.radius).toBeUndefined()
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

describe('จัดแนวเทียบแผงหน้า (alignToFace)', () => {
  const d = dieline()
  const b = faceBounds(d)
  const el = makeShapeEl(d, 'rect') // มี w,h ชัดเจน
  const w = elW(el)
  const h = elH(el)

  it('แนวนอน: ชิดซ้าย/กลาง/ชิดขวา วางขอบตรงกับ bbox แผงหน้า (y คงเดิม)', () => {
    expect(alignToFace(d, el, 'left').x).toBeCloseTo(b.x0)
    expect(alignToFace(d, el, 'hcenter').x).toBeCloseTo((b.x0 + b.x1) / 2 - w / 2)
    expect(alignToFace(d, el, 'right').x).toBeCloseTo(b.x1 - w)
    expect(alignToFace(d, el, 'left').y).toBe(el.y) // ไม่แตะแกน y
  })

  it('แนวตั้ง: ชิดบน/กลาง/ชิดล่าง วางขอบตรงกับ bbox แผงหน้า (x คงเดิม)', () => {
    expect(alignToFace(d, el, 'top').y).toBeCloseTo(b.y0)
    expect(alignToFace(d, el, 'vcenter').y).toBeCloseTo((b.y0 + b.y1) / 2 - h / 2)
    expect(alignToFace(d, el, 'bottom').y).toBeCloseTo(b.y1 - h)
    expect(alignToFace(d, el, 'top').x).toBe(el.x)
  })

  it('คงขนาด/ชนิด/มุม ไม่เปลี่ยน', () => {
    const r = alignToFace(d, { ...el, rot: 30 }, 'right')
    expect(r.type).toBe(el.type)
    expect(elW(r)).toBe(w)
    expect(r.rot).toBe(30)
  })
})

describe('เลือกหลายชิ้น + จัดกลุ่ม', () => {
  const shp = (id: string, x: number, y: number, w = 20, h = 20, groupId?: string): Deco => ({
    id, type: 'shape', shape: 'rect', w, h, fill: '#000', stroke: 'none', strokeW: 0, x, y, rot: 0,
    ...(groupId ? { groupId } : {}),
  })

  it('expandGroups: คลิกชิ้นในกลุ่ม → ดึงทั้งกลุ่ม, คงลำดับ, ไม่ซ้ำ', () => {
    const decos = [shp('a', 0, 0, 20, 20, 'g1'), shp('b', 50, 0), shp('c', 100, 0, 20, 20, 'g1')]
    expect(expandGroups(decos, ['a'])).toEqual(['a', 'c']) // a,c กลุ่มเดียวกัน
    expect(expandGroups(decos, ['b'])).toEqual(['b']) // ไม่มีกลุ่ม
    expect(expandGroups(decos, ['b', 'c'])).toEqual(['a', 'b', 'c'])
  })

  it('selectionBounds: กรอบรวมครอบทุกชิ้นที่เลือก', () => {
    const decos = [shp('a', 0, 0, 20, 10), shp('b', 100, 50, 30, 20)]
    expect(selectionBounds(decos, ['a', 'b'])).toEqual({ x0: 0, x1: 130, y0: 0, y1: 70 })
    expect(selectionBounds(decos, [])).toBeNull()
  })

  it('alignInSelection: ชิดซ้าย/ขวาเทียบกรอบรวม (ไม่ใช่แผงหน้า)', () => {
    const decos = [shp('a', 10, 0, 20, 20), shp('b', 100, 0, 40, 20)]
    const left = alignInSelection(decos, ['a', 'b'], 'left')
    expect(left.find((d) => d.id === 'a')!.x).toBe(10) // x0 ของกรอบ = 10
    expect(left.find((d) => d.id === 'b')!.x).toBe(10)
    const right = alignInSelection(decos, ['a', 'b'], 'right')
    // x1 = max(10+20, 100+40)=140 → a.x=140-20=120, b.x=140-40=100
    expect(right.find((d) => d.id === 'a')!.x).toBe(120)
    expect(right.find((d) => d.id === 'b')!.x).toBe(100)
    // ชิ้นที่ไม่ได้เลือกไม่ขยับ
    expect(alignInSelection(decos, ['a'], 'right').find((d) => d.id === 'b')!.x).toBe(100)
  })

  it('stepRepeat: กริด cols×rows สร้างสำเนา (ยกเว้นเซลล์ต้นฉบับ), ตำแหน่งตามระยะ, กลุ่มเดียว', () => {
    const decos = [shp('a', 10, 20)]
    const copies = stepRepeat(decos, ['a'], { cols: 3, rows: 2, dx: 30, dy: 40 })
    expect(copies).toHaveLength(3 * 2 - 1) // 5 สำเนา (ไม่รวมต้นฉบับ)
    // แถว 0: c1=(40,20), c2=(70,20); แถว1: c0=(10,60), c1=(40,60), c2=(70,60)
    const at = (x: number, y: number) => copies.some((c) => Math.round(c.x) === x && Math.round(c.y) === y)
    expect(at(40, 20)).toBe(true)
    expect(at(70, 20)).toBe(true)
    expect(at(10, 60)).toBe(true)
    expect(at(70, 60)).toBe(true)
    // groupId เดียวกันทุกสำเนา + id ไม่ซ้ำ
    expect(new Set(copies.map((c) => c.groupId)).size).toBe(1)
    expect(new Set(copies.map((c) => c.id)).size).toBe(copies.length)
  })

  it('stepRepeat: brick เยื้องแถวคี่ครึ่งระยะ; 1×1 = ไม่มีสำเนา', () => {
    const decos = [shp('a', 0, 0)]
    const brick = stepRepeat(decos, ['a'], { cols: 2, rows: 2, dx: 20, dy: 20, brick: true })
    // แถว1 (r=1) c0 เยื้อง +10 → x=10
    expect(brick.some((c) => Math.round(c.x) === 10 && Math.round(c.y) === 20)).toBe(true)
    expect(stepRepeat(decos, ['a'], { cols: 1, rows: 1, dx: 20, dy: 20 })).toHaveLength(0)
  })

  it('distribute: กึ่งกลางห่างเท่ากัน หัว-ท้ายอยู่กับที่ (ต้อง ≥3)', () => {
    // กึ่งกลาง x: a=10, b=40, c=100 → กระจายให้ b ไปกลาง (55)
    const decos = [shp('a', 0, 0, 20, 20), shp('b', 30, 0, 20, 20), shp('c', 90, 0, 20, 20)]
    const r = distribute(decos, ['a', 'b', 'c'], 'h')
    const cx = (id: string) => { const d = r.find((x) => x.id === id)!; return d.x + 10 }
    expect(cx('a')).toBeCloseTo(10) // หัวคงเดิม
    expect(cx('c')).toBeCloseTo(100) // ท้ายคงเดิม
    expect(cx('b')).toBeCloseTo(55) // กลางพอดี
    // < 3 ชิ้น → ไม่เปลี่ยน
    expect(distribute(decos, ['a', 'b'], 'h')).toEqual(decos)
  })
})

describe('ฟอนต์ + น้ำหนักตัวอักษร', () => {
  it('textFont: ใส่น้ำหนัก+family, ฟอนต์ไม่รู้จัก → Noto (ตัวแรก)', () => {
    expect(textFont({ size: 20, font: 'kanit', weight: 700 })).toBe("700 20px 'Kanit', sans-serif")
    expect(textFont({ size: 10 })).toBe("400 10px 'Noto Sans Thai', sans-serif")
    expect(textFont({ size: 10, font: 'ไม่มี' })).toContain("'Noto Sans Thai'")
  })

  it('มี Noto เป็นตัวแรก (ค่าเริ่มต้น) และทุกตัวมี css/nameTh', () => {
    expect(FONTS[0].id).toBe('noto')
    for (const f of FONTS) {
      expect(f.css).toMatch(/^'.+'$/)
      expect(f.nameTh.length).toBeGreaterThan(0)
    }
  })

  it('parse text: คง font ที่รู้จัก + weight 700; ค่าอื่น/ไม่มี → ไม่ใส่คีย์', () => {
    const t = parseDeco({ type: 'text', text: 'a', size: 10, color: '#000', x: 0, y: 0, rot: 0, font: 'prompt', weight: 700 }) as { font?: string; weight?: number }
    expect(t.font).toBe('prompt')
    expect(t.weight).toBe(700)
    const plain = parseDeco({ type: 'text', text: 'a', size: 10, color: '#000', x: 0, y: 0, rot: 0, font: 'เดา', weight: 500 }) as { font?: string; weight?: number }
    expect(plain.font).toBeUndefined()
    expect(plain.weight).toBeUndefined()
  })
})

describe('ไล่สี (gradient)', () => {
  const g = (over = {}): Deco => ({
    id: 'gx', type: 'shape', shape: 'rect', w: 20, h: 10, fill: '#000', stroke: 'none', strokeW: 0, x: 0, y: 0, rot: 0,
    grad: { from: '#ff0000', to: '#0000ff', angle: 90 }, ...over,
  })

  it('gradVec: 0°=แนวนอน, 90°=แนวตั้ง', () => {
    const h = gradVec(0)
    expect(h.x1).toBeCloseTo(0)
    expect(h.x2).toBeCloseTo(1)
    expect(h.y1).toBeCloseTo(0.5)
    const v = gradVec(90)
    expect(v.y1).toBeCloseTo(0)
    expect(v.y2).toBeCloseTo(1)
    expect(v.x1).toBeCloseTo(0.5)
  })

  it('gradientSVGString: linear มี stop 2 สี, radial ใช้ radialGradient', () => {
    const lin = gradientSVGString(g() as never)
    expect(lin).toContain('<linearGradient id="grad-gx"')
    expect(lin).toContain('stop-color="#ff0000"')
    expect(lin).toContain('stop-color="#0000ff"')
    expect(gradientSVGString(g({ grad: { from: '#fff', to: '#000', angle: 0, radial: true } }) as never)).toContain('<radialGradient')
  })

  it('shapeSVG: ใช้ url(#grad-id) + ฝัง defs เมื่อมี grad', () => {
    const svg = shapeSVG(g() as never, '')
    expect(svg).toContain('fill="url(#grad-gx)"')
    expect(svg).toContain('<defs>')
  })

  it('parse: grad ถูกต้อง (ค่าครบ), line ไม่รับ grad', () => {
    const ok = parseDeco({ ...g() }) as { grad?: { from: string; angle: number } }
    expect(ok.grad).toMatchObject({ from: '#ff0000', to: '#0000ff', angle: 90 })
    const line = parseDeco({ id: 'l', type: 'shape', shape: 'line', w: 20, h: 2, fill: 'none', stroke: '#000', strokeW: 2, x: 0, y: 0, rot: 0, grad: { from: '#fff', to: '#000', angle: 0 } }) as { grad?: unknown }
    expect(line.grad).toBeUndefined()
  })
})

describe('พลิก (flip)', () => {
  const el = (over = {}): Deco => ({
    id: 'a', type: 'shape', shape: 'rect', w: 20, h: 10, fill: '#000', stroke: 'none', strokeW: 0, x: 5, y: 6, rot: 0, ...over,
  })

  it('flipTransform: ว่างถ้าไม่พลิก, สะท้อนรอบกึ่งกลางเมื่อพลิก', () => {
    expect(flipTransform(el())).toBe('')
    // center = (5+10, 6+5) = (15,11); flipX → scale(-1 1) รอบจุดนั้น
    expect(flipTransform(el({ flipX: true }))).toContain('scale(-1 1)')
    expect(flipTransform(el({ flipX: true }))).toContain('translate(15 11)')
    expect(flipTransform(el({ flipY: true }))).toContain('scale(1 -1)')
    expect(flipTransform(el({ flipX: true, flipY: true }))).toContain('scale(-1 -1)')
  })

  it('opacity: parse เก็บเมื่อ <1 (clamp 0..1), =1/ไม่มี → ไม่ใส่คีย์', () => {
    expect((parseDeco({ ...el({ opacity: 0.4 }) }) as { opacity?: number }).opacity).toBe(0.4)
    expect((parseDeco({ ...el({ opacity: 1 }) }) as { opacity?: number }).opacity).toBeUndefined()
    expect((parseDeco({ ...el() }) as { opacity?: number }).opacity).toBeUndefined()
    expect((parseDeco({ ...el({ opacity: -3 }) }) as { opacity?: number }).opacity).toBe(0)
  })

  it('parse: คง flipX/flipY = true, ปกติไม่ใส่คีย์', () => {
    const flipped = parseDeco({ ...el({ flipX: true }) })
    expect(flipped).toMatchObject({ flipX: true })
    expect((flipped as { flipY?: boolean }).flipY).toBeUndefined()
    const plain = parseDeco({ ...el() }) as { flipX?: boolean }
    expect(plain.flipX).toBeUndefined()
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

  it('name: parse คงชื่อที่ตั้งเอง, ว่าง/ไม่มี → ไม่ใส่คีย์ (decoLabel fallback ตามชนิด)', () => {
    const named = parseDeco({ type: 'shape', shape: 'rect', w: 10, h: 10, fill: '#000', stroke: 'none', strokeW: 0, x: 0, y: 0, rot: 0, name: 'แถบหัว' })!
    expect(named.name).toBe('แถบหัว')
    expect(decoLabel(named)).toBe('แถบหัว')
    const noName = parseDeco({ type: 'shape', shape: 'ellipse', w: 10, h: 10, fill: '#000', stroke: 'none', strokeW: 0, x: 0, y: 0, rot: 0, name: '  ' })!
    expect(noName.name).toBeUndefined()
    expect(decoLabel(noName)).toBe('วงกลม')
  })

  it('hidden/locked: parse คงค่า true, ปกติไม่ใส่ flag (round-trip สะอาด)', () => {
    const withFlags = parseDeco({ type: 'text', text: 'a', size: 10, color: '#000', x: 0, y: 0, rot: 0, hidden: true, locked: true })
    expect(withFlags).toMatchObject({ hidden: true, locked: true })
    const noFlags = parseDeco({ type: 'text', text: 'a', size: 10, color: '#000', x: 0, y: 0, rot: 0 })!
    expect(noFlags.hidden).toBeUndefined()
    expect(noFlags.locked).toBeUndefined()
  })
})

describe('รูปทรงเพิ่ม (triangle/polygon/star) + เส้นประ', () => {
  it('shapeVertices: จำนวนจุดถูกต้อง + อยู่ในกรอบกึ่งกลาง', () => {
    expect(shapeVertices('triangle', 100, 100)).toHaveLength(3)
    expect(shapeVertices('polygon', 100, 100, 6)).toHaveLength(6)
    expect(shapeVertices('star', 100, 100, 5)).toHaveLength(10) // 5 แฉก = 10 จุด
    // จุดยอดอยู่ในกรอบ ±w/2, ±h/2
    for (const p of shapeVertices('polygon', 80, 60, 5)) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(40 + 1e-6)
      expect(Math.abs(p.y)).toBeLessThanOrEqual(30 + 1e-6)
    }
  })

  it('isPolyShape แยกรูปปิดมีพื้นจาก line/rect/ellipse', () => {
    expect(isPolyShape('triangle')).toBe(true)
    expect(isPolyShape('star')).toBe(true)
    expect(isPolyShape('rect')).toBe(false)
    expect(isPolyShape('line')).toBe(false)
  })

  it('shapeSVG: รูปหลายเหลี่ยมออกเป็น <polygon> + เส้นประใส่ dasharray', () => {
    const star: ShapeEl = { id: 's', type: 'shape', shape: 'star', sides: 5, w: 60, h: 60, fill: '#f00', stroke: '#000', strokeW: 2, dash: true, x: 10, y: 10, rot: 0 }
    const svg = shapeSVG(star, '')
    expect(svg.includes('<polygon')).toBe(true)
    expect(svg.includes('stroke-dasharray=')).toBe(true)
    // 5 แฉก = 10 คู่พิกัด
    expect((svg.match(/points="([^"]+)"/)![1].trim().split(/\s+/)).length).toBe(10)
  })

  it('parseDeco: รับรูปทรงใหม่ + sides + dash และปัด sides ให้อยู่ 3..12', () => {
    const p = parseDeco({ type: 'shape', shape: 'polygon', sides: 99, dash: true, w: 40, h: 40, fill: '#000', stroke: '#000', strokeW: 1, x: 0, y: 0, rot: 0 }) as ShapeEl
    expect(p.shape).toBe('polygon')
    expect(p.sides).toBe(12) // clamp
    expect(p.dash).toBe(true)
    // รูปทรงไม่รู้จัก → fallback rect
    const bad = parseDeco({ type: 'shape', shape: 'blob', w: 10, h: 10, fill: '#000', stroke: 'none', strokeW: 0, x: 0, y: 0, rot: 0 }) as ShapeEl
    expect(bad.shape).toBe('rect')
  })
})

describe('มาสก์รูปตามทรง + ข้อความเส้นขอบ/เงา', () => {
  const imgMask = (over = {}) => ({ id: 'im', type: 'image' as const, src: 'data:image/png;base64,AAA', aspect: 1, w: 40, h: 40, x: 10, y: 10, rot: 0, ...over })

  it('imageMaskSVG: maskShape → clipPath polygon (จำนวนจุดตาม sides)', () => {
    const svg = imageMaskSVG(imgMask({ maskShape: 'star', maskSides: 6 }) as never)
    expect(svg).toContain('<clipPath')
    expect(svg).toContain('<polygon')
    expect(svg.match(/points="([^"]+)"/)![1].trim().split(/\s+/).length).toBe(12) // 6 แฉก
  })

  it('imageMaskSVG: maskShape ทับ circle/radius (โพลิกอนชนะ)', () => {
    expect(imageMaskSVG(imgMask({ circle: true, maskShape: 'triangle' }) as never)).toContain('<polygon')
  })

  it('parseDeco: image รับ maskShape + clamp maskSides 3..12', () => {
    const p = parseDeco({ type: 'image', src: 'data:image/png;base64,A', aspect: 1, w: 20, h: 20, maskShape: 'polygon', maskSides: 99, x: 0, y: 0, rot: 0 }) as { maskShape?: string; maskSides?: number }
    expect(p.maskShape).toBe('polygon')
    expect(p.maskSides).toBe(12)
    const bad = parseDeco({ type: 'image', src: 'data:image/png;base64,A', aspect: 1, w: 20, h: 20, maskShape: 'blob', x: 0, y: 0, rot: 0 }) as { maskShape?: string }
    expect(bad.maskShape).toBeUndefined()
  })

  it('textFxAttrs/textShadowSVG: ขอบใช้ paint-order, เงาสร้าง filter + feDropShadow', () => {
    const t = { id: 't', type: 'text' as const, text: 'HI', size: 20, color: '#000', w: 30, x: 0, y: 0, rot: 0, strokeColor: '#fff', strokeW: 1, shadow: true }
    const attrs = textFxAttrs(t)
    expect(attrs).toContain('paint-order="stroke"')
    expect(attrs).toContain('stroke="#fff"')
    expect(attrs).toContain(`url(#${textShadowId('t')})`)
    const defs = textShadowSVG(t)
    expect(defs).toContain('<feDropShadow')
    expect(textShadowSVG({ ...t, shadow: false })).toBe('') // ไม่มีเงา → ว่าง
  })

  it('parseDeco: text รับ strokeColor+strokeW (คู่กัน) และ shadow', () => {
    const p = parseDeco({ type: 'text', text: 'a', size: 10, color: '#000', strokeColor: '#ffffff', strokeW: 2, shadow: true, x: 0, y: 0, rot: 0 }) as { strokeColor?: string; strokeW?: number; shadow?: boolean }
    expect(p.strokeColor).toBe('#ffffff')
    expect(p.strokeW).toBe(2)
    expect(p.shadow).toBe(true)
    // strokeW โดยไม่มีสี → ไม่เก็บ
    const noColor = parseDeco({ type: 'text', text: 'a', size: 10, color: '#000', strokeW: 2, x: 0, y: 0, rot: 0 }) as { strokeW?: number }
    expect(noColor.strokeW).toBeUndefined()
  })
})

describe('ข้อความโค้ง (curved text)', () => {
  const t = (over = {}): TextEl => ({ id: 'c', type: 'text', text: 'ABCDE', size: 10, color: '#000', w: 30, x: 10, y: 10, rot: 0, ...over }) as TextEl

  it('isCurvedText: ต้องมี curve และ |curve|>=1', () => {
    expect(isCurvedText(t())).toBe(false)
    expect(isCurvedText(t({ curve: 0.4 }))).toBe(false)
    expect(isCurvedText(t({ curve: 90 }))).toBe(true)
    expect(isCurvedText(t({ curve: -120 }))).toBe(true)
  })

  it('curvedGlyphs: จำนวนอักษรตรง, x เรียงซ้าย→ขวา, มุมกลาง≈0 สมมาตร', () => {
    const gs = curvedGlyphs(t({ curve: 120 }))
    expect(gs).toHaveLength(5)
    for (let i = 1; i < gs.length; i++) expect(gs[i].x).toBeGreaterThan(gs[i - 1].x)
    // อักษรกลาง (index 2) อยู่ยอดโค้ง มุม≈0
    expect(Math.abs(gs[2].rot)).toBeLessThan(15)
    // สมมาตร: มุมหัว-ท้ายตรงข้ามกัน
    expect(gs[0].rot).toBeCloseTo(-gs[4].rot, 5)
  })

  it('curve บวก vs ลบ กลับด้านโก่ง (y ปลายสลับเครื่องหมาย)', () => {
    const up = curvedGlyphs(t({ curve: 120 }))
    const down = curvedGlyphs(t({ curve: -120 }))
    expect(Math.sign(up[0].y)).toBe(-Math.sign(down[0].y))
  })

  it('svgArtworkLayer: โค้ง = หลาย <text> ต่ออักษร ในกลุ่มเดียว', () => {
    const svg = svgArtworkLayer([t({ curve: 120 })])
    expect((svg.match(/<text /g) || []).length).toBe(5) // 5 อักษร = 5 text
  })

  it('parseDeco: รับ curve + clamp -300..300, ปัดค่าน้อย(<1)ทิ้ง', () => {
    expect((parseDeco({ type: 'text', text: 'a', size: 10, color: '#000', curve: 999, x: 0, y: 0, rot: 0 }) as TextEl).curve).toBe(300)
    expect((parseDeco({ type: 'text', text: 'a', size: 10, color: '#000', curve: 0.3, x: 0, y: 0, rot: 0 }) as TextEl).curve).toBeUndefined()
  })
})

describe('ตารางข้อมูลโภชนาการ (nutrition)', () => {
  it('makeNutritionEl: ค่าเริ่มต้นครบ + ความสูงคำนวณได้ + วางในแผ่น', () => {
    const d = dieline()
    const el = makeNutritionEl(d)
    expect(el.type).toBe('nutrition')
    expect(el.rows.length).toBeGreaterThan(3)
    expect(elW(el)).toBe(el.w)
    expect(elH(el)).toBeGreaterThan(el.w) // ตารางสูงกว่ากว้าง
    expect(el.x).toBeGreaterThanOrEqual(0)
    expect(el.y).toBeGreaterThanOrEqual(0)
  })

  it('nutritionLayout: มีเส้นกรอบนอก 4 + ความสูงเพิ่มตามจำนวนแถว', () => {
    const d = dieline()
    const base = makeNutritionEl(d)
    const more = { ...base, rows: [...base.rows, ...base.rows] }
    expect(nutritionLayout(more).h).toBeGreaterThan(nutritionLayout(base).h)
    // เส้นกรอบนอกอย่างน้อย 4 เส้น
    expect(nutritionLayout(base).lines.length).toBeGreaterThanOrEqual(4)
  })

  it('nutritionInnerSVG + svgArtworkLayer: มีหัวตาราง/สารอาหาร/หน่วยบริโภค', () => {
    const el = makeNutritionEl(dieline())
    const svg = nutritionInnerSVG(el)
    expect(svg).toContain('ข้อมูลโภชนาการ')
    expect(svg).toContain('โซเดียม')
    expect(svg).toContain('หนึ่งหน่วยบริโภค')
    expect(svg).toContain('<rect') // พื้นขาว
    // ไหลผ่าน layer รวม
    expect(svgArtworkLayer([el])).toContain('ข้อมูลโภชนาการ')
  })

  it('parseDeco: nutrition round-trip เก็บแถว/ค่า และปัด paper=false', () => {
    const el = makeNutritionEl(dieline())
    const p = parseDeco({ ...el, paper: false, ink: '#0f6e56' }) as typeof el
    expect(p.type).toBe('nutrition')
    expect(p.rows.length).toBe(el.rows.length)
    expect(p.rows[0].label).toBe(el.rows[0].label)
    expect(p.paper).toBe(false)
    expect(p.ink).toBe('#0f6e56')
    // ไม่มี w → null
    expect(parseDeco({ type: 'nutrition', serving: '', servings: '', energy: '', rows: [], vitamins: [], footnote: '', x: 0, y: 0, rot: 0 })).toBeNull()
  })
})
