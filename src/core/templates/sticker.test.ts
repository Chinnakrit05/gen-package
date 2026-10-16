import { describe, expect, it } from 'vitest'
import { computeMatrices, to3D } from '../fold'
import { getTemplate } from './index'
import { getMaterial } from '../materials'
import { dielineDXFString } from '../dxf'
import { generateSticker, STICKER_BASIC_SHAPES } from './sticker'
import { preflightSticker } from '../stickerPreflight'
import { parseStickerCut } from '../stickerContour'

// สติกเกอร์ไดคัท = แผ่นพิมพ์แบนชิ้นเดียว มุมมน ไม่มีรอยพับ
const mat = getMaterial('sticker-vinyl')
const tp = getTemplate('sticker')
const W = 60
const H = 40
const d = tp.generate({ W, D: 60, H, handle: false }, mat)
const M = computeMatrices(d.panels, 1)

describe('sticker: โครงสร้าง dieline', () => {
  it('ลงทะเบียนใน registry เป็นแผ่นเดียว ไม่พับ ไม่เอียง', () => {
    expect(tp.id).toBe('sticker')
    expect(tp.supportsHandle).toBe(false)
    expect(tp.tilt).toBe(0)
    expect(tp.foldDepth({ W, D: 60, H, handle: false }, mat)).toBe(0)
    expect(d.panels).toHaveLength(1)
    expect(d.panels[0].id).toBe('sticker')
  })

  it('ขนาดแผ่น = W×H ไม่มีรอยพับ', () => {
    expect(d.width).toBe(W)
    expect(d.height).toBe(H)
    expect(d.segments.filter((s) => s.kind === 'crease')).toHaveLength(0)
    expect(d.segments.filter((s) => s.kind === 'cut')).toHaveLength(1)
  })

  it('outline มุมมนอยู่ในกรอบ W×H และ finite', () => {
    const o = d.panels[0].outline
    expect(o.length).toBeGreaterThan(4) // มุมมน → มีจุดโค้ง มากกว่าสี่เหลี่ยม
    expect(o.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))).toBe(true)
    expect(Math.min(...o.map((q) => q.x))).toBeGreaterThanOrEqual(-1e-6)
    expect(Math.max(...o.map((q) => q.x))).toBeLessThanOrEqual(W + 1e-6)
    expect(Math.min(...o.map((q) => q.y))).toBeGreaterThanOrEqual(-1e-6)
    expect(Math.max(...o.map((q) => q.y))).toBeLessThanOrEqual(H + 1e-6)
  })

  it('พับแล้วยังแบนสนิท — ทุกจุดอยู่ระนาบ z=0', () => {
    const zs = d.panels[0].outline.map((q) => to3D(q).applyMatrix4(M.get('sticker')!).z)
    zs.forEach((z) => expect(Math.abs(z)).toBeLessThan(1e-6))
  })

  it('ส่งออก DXF ได้', () => {
    const dxf = dielineDXFString(d)
    expect(dxf).toContain('SECTION')
  })
})

describe('sticker: รูปทรงพื้นฐาน', () => {
  it.each(STICKER_BASIC_SHAPES.map((s) => [s.id] as const))('%s พอดีกรอบ W×H ทุกขนาด และผ่านกติกาไดคัท (มุมโค้ง/ขนาด)', (shape) => {
    for (const [w, h] of [[60, 40], [40, 60], [50, 50], [15, 12]] as const) {
      const dl = generateSticker({ W: w, D: 60, H: h }, shape)
      const pts = dl.panels[0].outline
      expect(pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
      const xs = pts.map((p) => p.x)
      const ys = pts.map((p) => p.y)
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(-1e-6)
      expect(Math.max(...xs)).toBeLessThanOrEqual(w + 1e-6)
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(-1e-6)
      expect(Math.max(...ys)).toBeLessThanOrEqual(h + 1e-6)
      // ใช้กรอบเกือบเต็ม (มุมมน/ปลายแฉกที่มนทำให้ขาดได้เล็กน้อย)
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(w * 0.9)
      expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(h * 0.9)
      const issues = preflightSticker({ loops: [pts], sheet: { w, h } })
      expect(issues.filter((i) => i.code === 'corner')).toEqual([])
      expect(dl.segments[0].d).not.toContain('NaN')
    }
  })

  it('สี่เหลี่ยมมุมมนเท่าเดิม (ค่าเริ่มต้น) และ template ยังให้สี่เหลี่ยมมุมมน', () => {
    expect(generateSticker({ W, D: 60, H }).panels[0].outline).toEqual(d.panels[0].outline)
  })

  it('เก็บรูปทรงลงงานได้ (rect = ค่าเริ่มต้นไม่เก็บ)', () => {
    expect(parseStickerCut({ shape: 'heart', border: 'white', offset: 2 })?.shape).toBe('heart')
    expect(parseStickerCut({ shape: 'rect', border: 'white', offset: 2 })).toBeUndefined()
    expect(parseStickerCut({ shape: 'blob', border: 'white', offset: 2 })).toBeUndefined()
  })
})
