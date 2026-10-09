import type { Dieline, Panel, Segment, Vec2 } from './types'
import { STICKER_RULES } from './stickerContour'
export { PER_SHEET_MAX } from './stickerContour'
import { P, fmt } from './templates/shared'

// แผ่นสติกเกอร์หลายดวง (sticker sheet แบบโรงพิมพ์ดิจิทัล เช่น Lalapix: A6 = 8 แผ่น/A3, A5 = 4 แผ่น/A3)
// ออกแบบดวงเดียว แล้วระบบเรียงซ้ำเต็มแผ่นเอง — เส้นตัดห่างกัน ≥2 มม. + ขอบแผ่น, หมุน 90° ถ้าได้จำนวนมากกว่า
// ทั้งหมด pure: ใช้ร่วมกันทั้งพรีวิว / PDF / SVG / DXF จึงตรงกันทุกไฟล์

export type StickerSheetId = 'a6' | 'a5' | 'a4'
export interface StickerSheet {
  id: StickerSheetId
  nameTh: string
  w: number
  h: number
  perA3: number // ตัดจาก A3 ได้กี่แผ่น
}
export const STICKER_SHEETS: StickerSheet[] = [
  { id: 'a6', nameTh: 'A6', w: 105, h: 148, perA3: 8 },
  { id: 'a5', nameTh: 'A5', w: 148, h: 210, perA3: 4 },
  { id: 'a4', nameTh: 'A4', w: 210, h: 297, perA3: 2 },
]
export const stickerSheetById = (id?: string) => STICKER_SHEETS.find((s) => s.id === id)

export const SHEET_MARGIN = 5 // มม. — ระยะจากขอบแผ่นถึงเส้นตัดดวงนอกสุด (กันตัดแผ่นแล้วโดนดวง/จับลอกได้)
export const SHEET_GAP = STICKER_RULES.minGap // ระยะระหว่างเส้นตัดของดวงที่ติดกัน
export const STICKER_MIN_SIZE = 10 // มม. — สติกเกอร์เล็กสุด (กล่องใช้ 30)

export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}
// ตำแหน่งดวงบนแผ่น: q = R(p) + t (R = หมุน 90° ตามเข็ม ในพิกัด y ลง เมื่อ rot)
export interface Placement {
  rot: boolean
  tx: number
  ty: number
}
export interface SheetLayout {
  sheet: StickerSheet
  cols: number
  rows: number
  rotated: boolean
  count: number
  placements: Placement[]
}

export const placePoint = (pl: Placement, p: Vec2): Vec2 =>
  pl.rot ? { x: pl.tx - p.y, y: pl.ty + p.x } : { x: pl.tx + p.x, y: pl.ty + p.y }

// transform สำหรับ SVG/canvas ที่ให้ผลเดียวกับ placePoint
export const placementSVG = (pl: Placement) =>
  pl.rot ? `translate(${fmt3(pl.tx)} ${fmt3(pl.ty)}) rotate(90)` : `translate(${fmt3(pl.tx)} ${fmt3(pl.ty)})`
const fmt3 = (v: number) => String(Math.round(v * 1000) / 1000)

// กรอบเส้นตัดของดวง (ไม่ใช่กรอบแผ่นออกแบบ — ไดคัทตามรูปเล็กกว่าแผ่น)
export function cutBox(d: Dieline): Box {
  const pts = d.panels.flatMap((p) => p.outline)
  return {
    x0: Math.min(...pts.map((p) => p.x)),
    y0: Math.min(...pts.map((p) => p.y)),
    x1: Math.max(...pts.map((p) => p.x)),
    y1: Math.max(...pts.map((p) => p.y)),
  }
}

export function layoutStickerSheet(
  box: Box,
  sheet: StickerSheet,
  margin = SHEET_MARGIN,
  gap = SHEET_GAP,
  limit?: number, // กำหนดจำนวนต่อแผ่น: วางไม่เกินเท่านี้ (แถวสุดท้ายอาจไม่เต็ม)
): SheetLayout {
  const pw = box.x1 - box.x0
  const ph = box.y1 - box.y0
  const fit = (w: number, h: number) => {
    const cols = Math.max(0, Math.floor((sheet.w - 2 * margin + gap) / (w + gap)))
    const rows = Math.max(0, Math.floor((sheet.h - 2 * margin + gap) / (h + gap)))
    return { cols, rows, n: cols * rows }
  }
  const a = fit(pw, ph)
  const b = fit(ph, pw)
  const rotated = b.n > a.n // เสมอกัน → ไม่หมุน (ลายตั้งตรงอ่านง่ายกว่า)
  const { cols, rows } = rotated ? b : a
  const cw = rotated ? ph : pw // ขนาดช่องบนแผ่น
  const ch = rotated ? pw : ph
  // จัดกลุ่มกลางแผ่น
  const gx = (sheet.w - (cols * cw + (cols - 1) * gap)) / 2
  const gy = (sheet.h - (rows * ch + (rows - 1) * gap)) / 2
  const placements: Placement[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = gx + c * (cw + gap) // มุมซ้ายบนของช่อง
      const cy = gy + r * (ch + gap)
      placements.push(
        rotated
          ? // R(x,y) = (-y, x): มุมซ้ายบนของดวงหลังหมุนมาจาก (x0, y1)
            { rot: true, tx: cx + box.y1, ty: cy - box.x0 }
          : { rot: false, tx: cx - box.x0, ty: cy - box.y0 },
      )
    }
  }
  if (limit !== undefined && placements.length > limit) placements.length = Math.max(0, limit)
  return { sheet, cols, rows, rotated, count: placements.length, placements }
}

// กำหนดจำนวนต่อแผ่น → ตัวคูณขนาด k ที่ใหญ่สุดที่ยังได้ ≥ n ดวง (คงสัดส่วนลาย)
// กรอบเส้นตัดหลังย่อ/ขยาย = ลาย×k + 2·edge — edge = ขอบขาว (ไม่ย่อตามลาย) หรือติดลบเมื่อตัดเข้าเนื้อ;
// สี่เหลี่ยมเต็มแผ่นออกแบบใช้ edge = 0. คืน null เมื่อเล็กแค่ไหนก็ใส่ไม่ครบ
export function fitScaleForCount(
  n: number,
  art: { w: number; h: number },
  edge: number,
  sheet: StickerSheet,
  margin = SHEET_MARGIN,
  gap = SHEET_GAP,
  slack = 0, // มม. เผื่อต่อดวง — ไดคัทตามรูปคำนวณเส้นตัดใหม่หลังย่อ/ขยาย คลาดได้ ±0.2 มม.
): number | null {
  if (n < 1 || art.w <= 0 || art.h <= 0) return null
  const fits = (k: number) =>
    layoutStickerSheet(
      { x0: 0, y0: 0, x1: art.w * k + 2 * edge + slack, y1: art.h * k + 2 * edge + slack },
      sheet,
      margin,
      gap,
    )
      .count >= n
  let lo = 0
  let hi = (Math.max(sheet.w, sheet.h) * 2) / Math.min(art.w, art.h)
  if (!fits(1e-6)) return null
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (fits(mid)) lo = mid
    else hi = mid
  }
  return lo * 0.999 // เผื่อเศษทศนิยม/เส้นตัดที่คำนวณใหม่ต่างเล็กน้อย
}

// แปลงพิกัดทุกจุดใน path (M/L/Q/A/Z แบบ absolute ที่ generator ของเราใช้) ด้วย placement
export function placePath(d: string, pl: Placement): string {
  const tok = d.match(/[MLQAZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []
  const out: string[] = []
  let i = 0
  const num = () => Number(tok[i++])
  const pt = () => {
    const q = placePoint(pl, P(num(), num()))
    return `${fmt3(q.x)} ${fmt3(q.y)}`
  }
  let cmd = ''
  while (i < tok.length) {
    const t = tok[i]
    if (/^[MLQAZ]$/i.test(t)) {
      cmd = t.toUpperCase()
      i++
      out.push(cmd)
      if (cmd === 'Z') continue
    }
    switch (cmd) {
      case 'M':
      case 'L':
        out.push(pt())
        break
      case 'Q':
        out.push(pt(), pt())
        break
      case 'A': {
        const rx = num()
        const ry = num()
        const rot = num() + (pl.rot ? 90 : 0) // วงรีหมุนตาม (วงกลม rx=ry ไม่มีผล)
        const large = num()
        const sweep = num() // การหมุนแบบ proper ไม่กลับทิศ → sweep เดิม
        out.push(`${rx} ${ry} ${rot} ${large} ${sweep}`, pt())
        break
      }
      default:
        i++ // ตัวเลขหลง (ไม่ควรเกิด) — ข้าม
    }
  }
  return out.join(' ')
}

// dieline ทั้งแผ่น: เส้นตัด/แผงของทุกดวง + กรอบบอกขนาดแผ่น (แผ่นตัดจาก A3 โดยโรงพิมพ์ ไม่ใช่เส้นไดคัท)
export function sheetDieline(d: Dieline, layout: SheetLayout): Dieline {
  const panels: Panel[] = []
  const segments: Segment[] = []
  layout.placements.forEach((pl, k) => {
    for (const p of d.panels) {
      panels.push({ ...p, id: `${p.id}@${k}`, parentId: null, outline: p.outline.map((q) => placePoint(pl, q)) })
    }
    for (const s of d.segments) segments.push({ kind: s.kind, d: placePath(s.d, pl) })
  })
  const { w, h } = layout.sheet
  return {
    width: w,
    height: h,
    panels,
    segments,
    dims: [
      { a: P(0, h + 8), b: P(w, h + 8), label: `${layout.sheet.nameTh} ${fmt(w)}` },
      { a: P(-8, 0), b: P(-8, h), label: fmt(h) },
    ],
  }
}

// คลิปลายของแต่ละดวง: กรอบเส้นตัด + ครึ่งระยะห่าง (= เผื่อสีได้ 1 มม. ตามกติกา โดยไม่ล้ำดวงข้างเคียง)
export const artClipBox = (box: Box, gap = SHEET_GAP): Box => ({
  x0: box.x0 - gap / 2,
  y0: box.y0 - gap / 2,
  x1: box.x1 + gap / 2,
  y1: box.y1 + gap / 2,
})

export const sheetsNeeded = (qty: number, perSheet: number) => (perSheet > 0 ? Math.ceil(qty / perSheet) : 0)
