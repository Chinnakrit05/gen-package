import { describe, expect, it } from 'vitest'
import {
  SHEET_GAP,
  SHEET_MARGIN,
  STICKER_SHEETS,
  cutBox,
  layoutStickerSheet,
  placePath,
  placePoint,
  sheetDieline,
  stickerSheetById,
  sheetsNeeded,
} from './stickerSheet'
import { generateSticker } from './templates/sticker'
import { pathToPolylines } from './dxf'
import { preflightSticker } from './stickerPreflight'

const a6 = stickerSheetById('a6')!
const a5 = stickerSheetById('a5')!

describe('ขนาดแผ่น', () => {
  it('A6/A5/A4 ตรงมาตรฐาน และจำนวนต่อ A3 ถูก', () => {
    expect(STICKER_SHEETS.map((s) => [s.id, s.w, s.h, s.perA3])).toEqual([
      ['a6', 105, 148, 8],
      ['a5', 148, 210, 4],
      ['a4', 210, 297, 2],
    ])
  })
})

describe('layoutStickerSheet', () => {
  it('ดวง 40×40 บน A6: 2×3 = 6 ดวง (ขอบ 5 มม. ระยะห่าง 2 มม.)', () => {
    const L = layoutStickerSheet({ x0: 0, y0: 0, x1: 40, y1: 40 }, a6)
    expect([L.cols, L.rows, L.count, L.rotated]).toEqual([2, 3, 6, false])
  })

  it('ทุกดวงอยู่ในขอบแผ่น และห่างกันอย่างน้อย 2 มม.', () => {
    const box = { x0: 3, y0: 7, x1: 33, y1: 52 } // ดวง 30×45 ที่ไม่ได้เริ่มที่ 0,0
    const L = layoutStickerSheet(box, a5)
    const rects = L.placements.map((pl) => {
      const ps = [placePoint(pl, { x: box.x0, y: box.y0 }), placePoint(pl, { x: box.x1, y: box.y1 })]
      return {
        x0: Math.min(ps[0].x, ps[1].x),
        y0: Math.min(ps[0].y, ps[1].y),
        x1: Math.max(ps[0].x, ps[1].x),
        y1: Math.max(ps[0].y, ps[1].y),
      }
    })
    for (const r of rects) {
      expect(r.x0).toBeGreaterThanOrEqual(SHEET_MARGIN - 1e-9)
      expect(r.y0).toBeGreaterThanOrEqual(SHEET_MARGIN - 1e-9)
      expect(r.x1).toBeLessThanOrEqual(a5.w - SHEET_MARGIN + 1e-9)
      expect(r.y1).toBeLessThanOrEqual(a5.h - SHEET_MARGIN + 1e-9)
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]
        const b = rects[j]
        const dx = Math.max(b.x0 - a.x1, a.x0 - b.x1)
        const dy = Math.max(b.y0 - a.y1, a.y0 - b.y1)
        expect(Math.max(dx, dy)).toBeGreaterThanOrEqual(SHEET_GAP - 1e-9)
      }
    }
  })

  it('หมุน 90° เมื่อได้จำนวนมากกว่า และวางจุดตรงช่องเดิม', () => {
    // 90×30 บน A6: ตั้งได้ 1×4 = 4, หมุนได้ 3×1 = 3 → ไม่หมุน; 30×90 บน A6 แนวนอน (148×105) ไม่มีในชุด
    // ใช้ 60×45: ตั้ง 1×2 = 2, หมุน (45×60) 2×2 = 4 → หมุน
    const box = { x0: 0, y0: 0, x1: 60, y1: 45 }
    const L = layoutStickerSheet(box, a6)
    expect(L.rotated).toBe(true)
    expect(L.count).toBe(4)
    for (const pl of L.placements) {
      const c = [
        placePoint(pl, { x: 0, y: 0 }),
        placePoint(pl, { x: 60, y: 0 }),
        placePoint(pl, { x: 60, y: 45 }),
        placePoint(pl, { x: 0, y: 45 }),
      ]
      const w = Math.max(...c.map((p) => p.x)) - Math.min(...c.map((p) => p.x))
      const h = Math.max(...c.map((p) => p.y)) - Math.min(...c.map((p) => p.y))
      expect([w, h]).toEqual([45, 60]) // หมุนแล้วกว้าง-สูงสลับกัน
    }
  })

  it('ดวงใหญ่เกินแผ่น → 0 ดวง', () => {
    expect(layoutStickerSheet({ x0: 0, y0: 0, x1: 120, y1: 160 }, a6).count).toBe(0)
  })

  it('จำนวนแผ่นปัดขึ้น', () => {
    expect(sheetsNeeded(100, 6)).toBe(17)
    expect(sheetsNeeded(100, 0)).toBe(0)
  })
})

describe('placePath / sheetDieline', () => {
  it('path ที่มี arc แปลงแล้วตรงกับ outline ที่แปลงด้วย placement เดียวกัน (ทั้งตั้ง/หมุน)', () => {
    const d = generateSticker({ W: 60, D: 60, H: 45, handle: false })
    for (const rot of [false, true]) {
      const pl = { rot, tx: 100, ty: 20 }
      const moved = pathToPolylines(placePath(d.segments[0].d, pl)).flat()
      const ref = pathToPolylines(d.segments[0].d).flat().map((p) => placePoint(pl, p))
      expect(moved.length).toBe(ref.length)
      moved.forEach((p, i) => {
        expect(p.x).toBeCloseTo(ref[i].x, 2)
        expect(p.y).toBeCloseTo(ref[i].y, 2)
      })
    }
  })

  it('แผ่นที่เรียงแล้วผ่านการตรวจระยะห่างเส้นตัดของสติกเกอร์', () => {
    const d = generateSticker({ W: 40, D: 40, H: 30, handle: false })
    const L = layoutStickerSheet(cutBox(d), a6)
    const s = sheetDieline(d, L)
    expect(s.width).toBe(105)
    expect(s.panels).toHaveLength(L.count)
    expect(s.segments).toHaveLength(L.count)
    const issues = preflightSticker({ loops: s.panels.map((p) => p.outline), sheet: { w: s.width, h: s.height } })
    expect(issues.map((i) => i.code)).not.toContain('gap')
  })
})
