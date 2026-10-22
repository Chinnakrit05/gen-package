import { describe, expect, it } from 'vitest'
import { heightToNormal } from './useFinishMaps'
import { zipReliefProfile, ZIP_RELIEF_HALF } from './PouchViewer3D'

// แผนที่ความสูงเทา (RGBA) ขนาด w×h จากฟังก์ชันระดับ 0..255
const field = (w: number, h: number, f: (x: number, y: number) => number) => {
  const d = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.fill(f(x, y), (y * w + x) * 4, (y * w + x) * 4 + 3)
  return d
}
const px = (d: Uint8ClampedArray, w: number, x: number, y: number) => [...d.slice((y * w + x) * 4, (y * w + x) * 4 + 3)]

describe('heightToNormal: แผนที่ความสูง → normal map', () => {
  it('ผิวเรียบ = ตั้งฉากผิว (128,128,255)', () => {
    const n = heightToNormal(field(8, 8, () => 128), 8, 8, 8, true)
    expect(px(n, 8, 4, 4)).toEqual([128, 128, 255])
  })

  it('ลาดขึ้นทางขวา → normal เอียงไปทางซ้าย (R < 128), แกน v ไม่เปลี่ยน', () => {
    const n = heightToNormal(field(8, 8, (x) => 100 + 10 * x), 8, 8, 8, true)
    const [r, g, b] = px(n, 8, 4, 4)
    expect(r).toBeLessThan(128)
    expect(g).toBe(128)
    expect(b).toBeLessThan(255)
  })

  it('ลาดตามแถวภาพ: กลับเครื่องหมายตาม flipY (texture แผ่นคลี่ถุง flipY=false)', () => {
    const f = field(8, 8, (_x, y) => 100 + 10 * y) // สูงขึ้นเมื่อแถวลงล่าง
    const up = px(heightToNormal(f, 8, 8, 8, true), 8, 4, 4)[1]
    const down = px(heightToNormal(f, 8, 8, 8, false), 8, 4, 4)[1]
    expect(up).toBeGreaterThan(128) // flipY: แถวล่าง = v ต่ำ → สูงขึ้นเมื่อ v ลด → normal เอียงไป +v
    expect(down).toBeLessThan(128)
  })
})

describe('zipReliefProfile: ซิปปั๊มนูนบนฟิล์ม', () => {
  it('นอกแถบเรียบ ในแถบนูน สันคู่สูงกว่ากลางแถบ และสมมาตร', () => {
    expect(zipReliefProfile(ZIP_RELIEF_HALF)).toBeLessThan(0.02)
    expect(zipReliefProfile(0)).toBeGreaterThan(0.2)
    expect(zipReliefProfile(1.3)).toBeGreaterThan(zipReliefProfile(0))
    expect(zipReliefProfile(-1.3)).toBeCloseTo(zipReliefProfile(1.3), 9)
    for (let dy = -3; dy <= 3; dy += 0.1) expect(zipReliefProfile(dy)).toBeLessThanOrEqual(1)
  })
})
