import { describe, expect, it } from 'vitest'
import { preflightSticker } from './stickerPreflight'
import type { AlphaMask } from './stickerContour'
import { roundedRectPts } from './templates/shared'
import type { Vec2 } from './types'

const sq = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
]
const rr = (x0: number, y0: number, x1: number, y1: number, r = 2) => roundedRectPts(x0, y0, x1, y1, r)

// ลายสี่เหลี่ยมทึบ (มม.) บน mask ที่มีขอบเผื่อ 3 มม. รอบแผ่น 60×60
function art(x0: number, y0: number, x1: number, y1: number): AlphaMask {
  const s = 8
  const pad = 3
  const w = (60 + 2 * pad) * s
  const h = w
  const data = new Uint8Array(w * h)
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const x = (px + 0.5) / s - pad
      const y = (py + 0.5) / s - pad
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) data[py * w + px] = 255
    }
  }
  return { data, w, h, pxPerMm: s, origin: { x: -pad, y: -pad } }
}
const codes = (loops: Vec2[][], a?: AlphaMask, contour = true) =>
  preflightSticker({ loops, art: a, sheet: { w: 60, h: 60 }, contour }).map((i) => i.code)

describe('preflightSticker', () => {
  const cut = rr(10, 10, 50, 50)

  it('ลายห่างเส้นตัด ≥1 มม. → ผ่าน', () => {
    expect(codes([cut], art(15, 15, 45, 45))).not.toContain('art-edge')
  })

  it('ลายชิดเส้นตัด (<1 มม.) ไม่มีเผื่อสี → error', () => {
    expect(codes([cut], art(10.3, 15, 45, 45))).toContain('art-edge')
  })

  it('สีเลยเส้นตัด ≥1 มม. (ตั้งใจชนขอบ) → ผ่าน', () => {
    expect(codes([cut], art(7, 7, 53, 53))).not.toContain('art-edge')
  })

  it('สีเลยเส้นตัดไม่ถึง 1 มม. → error', () => {
    expect(codes([cut], art(9.6, 15, 45, 45))).toContain('art-edge')
  })

  it('เส้นตัดสองชิ้นห่าง <2 มม. → error, ≥2 มม. → ผ่าน', () => {
    expect(codes([rr(5, 10, 25, 30), rr(26, 10, 46, 30)])).toContain('gap')
    expect(codes([rr(5, 10, 25, 30), rr(28, 10, 48, 30)])).not.toContain('gap')
  })

  it('ช่องเจาะ <2 มม. → error', () => {
    expect(codes([rr(10, 10, 50, 50), sq(29, 29, 30.5, 31)])).toContain('hole')
    expect(codes([rr(10, 10, 50, 50), rr(25, 25, 35, 35)])).not.toContain('hole')
  })

  it('มุมหักศอก → เตือน, มุมมน 2 มม. → ผ่าน', () => {
    expect(codes([sq(10, 10, 50, 50)])).toContain('corner')
    expect(codes([cut])).not.toContain('corner')
  })

  it('ชิ้นเล็กมาก → เตือน', () => {
    expect(codes([rr(10, 10, 15, 15, 1)])).toContain('tiny')
  })

  it('เส้นตัดชนขอบแผ่น → เตือน', () => {
    expect(codes([rr(0, 10, 50, 50)])).toContain('edge')
    // มุมที่เกิดจากการถูกตัดตรงขอบแผ่น ไม่เตือนซ้ำเป็นมุมแหลม — แต่มุมแหลมจุดอื่นยังต้องเตือน
    expect(codes([sq(0, 10, 60, 50)])).not.toContain('corner')
    expect(codes([sq(0, 10, 50, 50)])).toContain('corner')
    expect(codes([cut])).not.toContain('edge')
    // สี่เหลี่ยมเต็มแผ่น: เส้นตัด = ขอบแผ่นโดยตั้งใจ ไม่เตือน
    expect(codes([rr(0, 0, 60, 60)], undefined, false)).not.toContain('edge')
  })

  it('ฟิล์มใสไม่รองขาว: ลายสีอ่อนมาก หรือสีพื้นอ่อน → เตือน; สีเข้ม/รองขาว → ไม่เตือน', () => {
    const a = art(15, 15, 45, 45)
    const run = (lightRatio: number, lightFill = false, clear = true) =>
      preflightSticker({
        loops: [cut],
        art: { ...a, lightRatio },
        sheet: { w: 60, h: 60 },
        clearNoWhite: clear ? { lightFill } : undefined,
      }).map((i) => i.code)
    expect(run(0.6)).toContain('clear-light')
    expect(run(0.05)).not.toContain('clear-light')
    expect(run(0.05, true)).toContain('clear-light')
    expect(run(0.9, false, false)).not.toContain('clear-light') // ไม่ใช่ฟิล์มใส/รองขาวแล้ว
  })

  it('หลายจุดรหัสเดียวกันรวมเป็นรายการเดียว', () => {
    const r = preflightSticker({
      loops: [sq(5, 5, 20, 20), sq(30, 30, 45, 45)],
      sheet: { w: 60, h: 60 },
    })
    expect(r.filter((i) => i.code === 'corner')).toHaveLength(1)
    expect(r.find((i) => i.code === 'corner')!.th).toContain('2 จุด')
  })
})
