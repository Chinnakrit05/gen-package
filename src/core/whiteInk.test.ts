import { describe, expect, it } from 'vitest'
import { traceWhiteInk, whiteInkPath } from './whiteInk'
import { loopArea, type AlphaMask } from './stickerContour'

function maskOf(inside: (x: number, y: number) => boolean, size = 40, s = 8): AlphaMask {
  const w = size * s
  const data = new Uint8Array(w * w)
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) data[y * w + x] = inside((x + 0.5) / s, (y + 0.5) / s) ? 255 : 0
  return { data, w, h: w, pxPerMm: s, origin: { x: 0, y: 0 } }
}

describe('traceWhiteInk', () => {
  it('ช่องในลาย (เช่นรูในตัวอักษร) ยังเป็นรู — ได้เส้นนอก + เส้นใน', () => {
    const ring = (x: number, y: number) => {
      const r = Math.hypot(x - 20, y - 20)
      return r <= 15 && r >= 7
    }
    const loops = traceWhiteInk(maskOf(ring))
    expect(loops).toHaveLength(2)
    const areas = loops.map((l) => Math.abs(loopArea(l))).sort((a, b) => b - a)
    // หดเข้า 0.1 มม. ทั้งขอบนอกและขอบรู
    expect(areas[0]).toBeLessThan(Math.PI * 15 * 15)
    expect(areas[0]).toBeGreaterThan(Math.PI * 14.7 * 14.7)
    expect(areas[1]).toBeGreaterThan(Math.PI * 7 * 7)
    expect(areas[1]).toBeLessThan(Math.PI * 7.3 * 7.3)
  })

  it('ไม่มีลาย → ไม่มีขาว, path เป็น even-odd หลาย subpath', () => {
    expect(traceWhiteInk(maskOf(() => false))).toEqual([])
    const p = whiteInkPath([
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
      [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 3 }],
    ])
    expect(p.match(/M /g)).toHaveLength(2)
    expect(p.match(/Z/g)).toHaveLength(2)
  })
})
