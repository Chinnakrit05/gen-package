import { describe, expect, it } from 'vitest'
import {
  CORNER_ROUND,
  contourFromAlpha,
  distanceTo,
  fillHoles,
  loopArea,
  parseStickerCut,
  simplifyLoop,
  type AlphaMask,
} from './stickerContour'
import type { Vec2 } from './types'
import { preflightSticker } from './stickerPreflight'

// mask ทดสอบสร้างจากฟังก์ชันรูปทรง (มม.) ที่ความละเอียด s พิกเซล/มม. บนพื้นที่ size×size มม.
function maskOf(inside: (x: number, y: number) => boolean, size = 60, s = 8): AlphaMask {
  const w = size * s
  const h = size * s
  const data = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) data[y * w + x] = inside((x + 0.5) / s, (y + 0.5) / s) ? 255 : 0
  }
  return { data, w, h, pxPerMm: s, origin: { x: 0, y: 0 } }
}
const disc = (cx: number, cy: number, r: number) => (x: number, y: number) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r
const radii = (l: Vec2[], cx: number, cy: number) => l.map((p) => Math.hypot(p.x - cx, p.y - cy))

describe('distance transform', () => {
  it('ระยะยุคลิดแม่นยำ (ไม่ใช่ chamfer)', () => {
    const w = 21
    const h = 21
    const m = new Uint8Array(w * h)
    m[10 * w + 10] = 1
    const d = distanceTo(m, w, h)
    expect(d[10 * w + 10]).toBe(0)
    expect(d[10 * w + 13]).toBeCloseTo(3, 5)
    expect(d[13 * w + 14]).toBeCloseTo(5, 5) // 3-4-5
  })

  it('อุดรูภายในแต่ไม่แตะพื้นหลังที่ต่อกับขอบ', () => {
    const w = 7
    const h = 7
    const m = new Uint8Array(w * h)
    for (let y = 1; y < 6; y++) for (let x = 1; x < 6; x++) m[y * w + x] = 1
    m[3 * w + 3] = 0 // รูกลาง
    const f = fillHoles(m, w, h)
    expect(f[3 * w + 3]).toBe(1)
    expect(f[0]).toBe(0)
  })
})

describe('contourFromAlpha', () => {
  it('วงกลม → loop เดียว ปิด รัศมีถูกต้อง', () => {
    const loops = contourFromAlpha(maskOf(disc(30, 30, 15)), 0)
    expect(loops).toHaveLength(1)
    const r = radii(loops[0], 30, 30)
    for (const v of r) expect(Math.abs(v - 15)).toBeLessThan(0.2)
    expect(Math.abs(loopArea(loops[0]))).toBeCloseTo(Math.PI * 225, -1)
  })

  it('ขอบขาว 2 มม. → ขยายออกรอบตัว 2 มม.', () => {
    const [l] = contourFromAlpha(maskOf(disc(30, 30, 15)), 2)
    for (const v of radii(l, 30, 30)) expect(Math.abs(v - 17)).toBeLessThan(0.2)
  })

  it('ไม่มีขอบขาว → หดเข้าในเนื้อ 1 มม. (สีเลยเส้นตัดออกไป)', () => {
    const [l] = contourFromAlpha(maskOf(disc(30, 30, 15)), -1)
    for (const v of radii(l, 30, 30)) expect(Math.abs(v - 14)).toBeLessThan(0.2)
  })

  it('สองชิ้นห่างกัน → สองเส้นตัด, ชิ้นใกล้กันพอให้ขอบขาวรวมเป็นเส้นเดียว', () => {
    const two = (gap: number) => (x: number, y: number) =>
      disc(18, 30, 10)(x, y) || disc(18 + 20 + gap, 30, 10)(x, y)
    expect(contourFromAlpha(maskOf(two(12), 70), 2)).toHaveLength(2)
    expect(contourFromAlpha(maskOf(two(2), 70), 2)).toHaveLength(1)
  })

  it('รูในชิ้นงานไม่กลายเป็นเส้นตัด (ตัดเฉพาะขอบนอก)', () => {
    const ring = (x: number, y: number) => disc(30, 30, 18)(x, y) && !disc(30, 30, 8)(x, y)
    expect(contourFromAlpha(maskOf(ring), 2)).toHaveLength(1)
  })

  it('ช่องแคบที่ถูกปิดตอนลบมุม ไม่กลายเป็นรูตัดด้านใน (เช่นหัวตัวอักษรที่เกือบปิด)', () => {
    // วงแหวนหนา 4 มม. มีช่องเปิดกว้าง 1.5 มม. — ขอบขาว+ลบมุมจะเชื่อมช่องปิด เกิดโพรงด้านใน
    const C = (x: number, y: number) => {
      const r = Math.hypot(x - 30, y - 30)
      return r >= 10 && r <= 14 && !(Math.abs(y - 30) < 0.75 && x > 30)
    }
    for (const off of [2, 1]) {
      const loops = contourFromAlpha(maskOf(C), off)
      expect(loops).toHaveLength(1)
    }
  })

  it('มุมเว้าแหลม (รูปตัว L) ถูกลบมุมเป็นโค้ง — ไม่มีจุดหักศอก', () => {
    const L = (x: number, y: number) => (x > 10 && x < 50 && y > 10 && y < 25) || (x > 10 && x < 25 && y > 10 && y < 50)
    const [l] = contourFromAlpha(maskOf(L), 2)
    // มุมเว้าของ L อยู่ที่ (25,25) → เส้นตัดขยาย 2 มม. ต้องไม่ผ่านจุดมุมเว้าแหลม (27,27) แบบหักศอก:
    // ระยะจากมุมเว้าของเส้น offset ถึงเส้นตัดจริงต้องเพิ่มขึ้นเพราะโค้งรัศมี CORNER_ROUND
    const corner = { x: 27, y: 27 }
    const nearest = Math.min(...l.map((p) => Math.hypot(p.x - corner.x, p.y - corner.y)))
    expect(nearest).toBeGreaterThan(CORNER_ROUND * (Math.SQRT2 - 1) * 0.6)
  })
})

// เส้นตัดที่ระบบสร้างเองต้องผ่านกติกามุมโค้งของตัวเองทุกความละเอียด (ไม่มีหักศอกจากขั้นบันไดพิกเซล)
describe.each([3, 5, 8])('contour ที่ %i px/มม. ผ่านกติกามุมโค้ง', (s) => {
  const shapes: Record<string, (x: number, y: number) => boolean> = {
    L: (x, y) => (x > 10 && x < 50 && y > 10 && y < 25) || (x > 10 && x < 25 && y > 10 && y < 50),
    เอียง: (x, y) => {
      const u = (x - 30) * 0.8 - (y - 30) * 0.6
      const v = (x - 30) * 0.6 + (y - 30) * 0.8
      return Math.abs(u) < 15 && Math.abs(v) < 8
    },
    ตัวอักษร: (x, y) =>
      [12, 22, 32, 42].some((cx) => Math.abs(x - cx) < 3 && Math.abs(y - 20) < 6) || (y > 24 && y < 26 && x > 10 && x < 46),
  }
  for (const [name, f] of Object.entries(shapes)) {
    for (const off of [2, -1]) {
      it(`${name} offset ${off}`, () => {
        const loops = contourFromAlpha(maskOf(f, 60, s), off)
        expect(loops.length).toBeGreaterThan(0)
        const iss = preflightSticker({ loops, sheet: { w: 60, h: 60 }, contour: true })
        expect(iss.filter((i) => i.code === 'corner')).toEqual([])
      })
    }
  }
})

describe('simplifyLoop', () => {
  it('ลดจุดบนเส้นตรงแต่คงมุม', () => {
    const sq: Vec2[] = []
    for (let i = 0; i < 10; i++) sq.push({ x: i, y: 0 })
    for (let i = 0; i < 10; i++) sq.push({ x: 10, y: i })
    for (let i = 10; i > 0; i--) sq.push({ x: i, y: 10 })
    for (let i = 10; i > 0; i--) sq.push({ x: 0, y: i })
    const s = simplifyLoop(sq, 0.1)
    expect(s.length).toBeLessThanOrEqual(5)
    expect(Math.abs(loopArea(s))).toBeCloseTo(100, 5)
  })
})

describe('parseStickerCut', () => {
  it('ค่าเริ่มต้น (สี่เหลี่ยม) ไม่เก็บ, contour clamp ขอบ ≥ 1 มม.', () => {
    expect(parseStickerCut({ shape: 'rect' })).toBeUndefined()
    expect(parseStickerCut({ shape: 'contour', border: 'white', offset: 0.2 })).toEqual({
      shape: 'contour',
      border: 'white',
      offset: 1,
    })
    expect(parseStickerCut({ shape: 'contour', border: 'none', offset: 'x' })?.border).toBe('none')
    // แผ่นหลายดวงเก็บได้แม้เป็นสี่เหลี่ยม; ค่าแผ่นแปลก ๆ ทิ้ง
    expect(parseStickerCut({ shape: 'rect', sheet: 'a6' })).toEqual({ shape: 'rect', border: 'white', offset: 2, sheet: 'a6' })
    expect(parseStickerCut({ shape: 'rect', sheet: 'b9' })).toBeUndefined()
    // จำนวนต่อแผ่น: ปัดเป็นจำนวนเต็ม จำกัดเพดาน และเก็บเฉพาะเมื่อมีแผ่น
    expect(parseStickerCut({ shape: 'rect', sheet: 'a5', perSheet: 7.6 })?.perSheet).toBe(8)
    expect(parseStickerCut({ shape: 'rect', sheet: 'a5', perSheet: 9999 })?.perSheet).toBe(200)
    expect(parseStickerCut({ shape: 'contour', perSheet: 8 })?.perSheet).toBeUndefined()
  })
})
