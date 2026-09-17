// Imposition / yield ต่อแผ่น — กล่อง 1 แบบ(ขนาด dieline) วางบนแผ่นใหญ่ได้กี่ชิ้น
// ใช้ประเมินต้นทุน/สั่งวัสดุ: ยิ่งวางได้เยอะต่อแผ่น ต้นทุนต่อใบยิ่งถูก
//
// เป็น pure ล้วน (เลขล้วน) เพื่อเทสต์เชิงตัวเลขได้ — วางแบบ step&repeat กริดเดียว
// เทียบชิ้นตั้ง (0°) กับชิ้นหมุน (90°) แล้วเลือกทิศที่ได้จำนวนมากกว่า
// (ไม่ทำ bin-packing สลับทิศในแผ่นเดียว — งานจริงส่วนใหญ่วางกริดเดียวอยู่แล้ว)

export interface Sheet {
  id: string
  nameTh: string
  w: number // มม.
  h: number // มม.
}

// แผ่นมาตรฐานที่ใช้บ่อยในงานบรรจุภัณฑ์/พิมพ์ไทย (มม.)
export const SHEET_PRESETS: Sheet[] = [
  { id: '31x43in', nameTh: '31×43 นิ้ว (อาร์ตการ์ด/กล่องแป้ง)', w: 787, h: 1092 },
  { id: '25x36in', nameTh: '25×36 นิ้ว', w: 635, h: 914 },
  { id: '24x35in', nameTh: '24×35 นิ้ว', w: 610, h: 889 },
  { id: '65x90cm', nameTh: '65×90 ซม.', w: 650, h: 900 },
  { id: '70x100cm', nameTh: '70×100 ซม.', w: 700, h: 1000 },
  { id: '79x109cm', nameTh: '79×109 ซม. (B1)', w: 790, h: 1090 },
  { id: 'a1', nameTh: 'A1 (59.4×84.1 ซม.)', w: 594, h: 841 },
]

export interface ImpositionOpt {
  margin: number // ระยะขอบแผ่น (กันขอบ/ขอบจับ) รอบด้าน มม.
  gutter: number // ร่องระหว่างชิ้น มม.
}

export const DEFAULT_OPT: ImpositionOpt = { margin: 10, gutter: 3 }

export interface Layout {
  cols: number
  rows: number
  count: number // ชิ้นต่อแผ่น
  rotated: boolean // true = หมุนชิ้น 90° (สลับกว้าง-ยาว)
  usedFrac: number // สัดส่วนพื้นที่ที่ใช้จริง (0-1) — เศษเหลือ = 1 - usedFrac
}

// จำนวนที่วางได้ในกริดเดียว: n ชิ้นเรียงกันกินพื้นที่ n*piece + (n-1)*gutter ต้อง ≤ avail
export function fitGrid(
  pieceW: number,
  pieceH: number,
  sheetW: number,
  sheetH: number,
  margin: number,
  gutter: number,
): { cols: number; rows: number; count: number } {
  const availW = sheetW - 2 * margin
  const availH = sheetH - 2 * margin
  if (pieceW <= 0 || pieceH <= 0 || availW < pieceW || availH < pieceH) {
    return { cols: 0, rows: 0, count: 0 }
  }
  const cols = Math.floor((availW + gutter) / (pieceW + gutter))
  const rows = Math.floor((availH + gutter) / (pieceH + gutter))
  return { cols, rows, count: cols * rows }
}

// วางกล่องขนาด pieceW×pieceH บนแผ่น เลือกทิศที่ได้จำนวนมากกว่าระหว่างตั้ง/หมุน 90°
export function computeImposition(
  pieceW: number,
  pieceH: number,
  sheet: Sheet,
  opt: ImpositionOpt = DEFAULT_OPT,
): Layout {
  const a = fitGrid(pieceW, pieceH, sheet.w, sheet.h, opt.margin, opt.gutter)
  const b = fitGrid(pieceH, pieceW, sheet.w, sheet.h, opt.margin, opt.gutter)
  const rotated = b.count > a.count
  const best = rotated ? b : a
  const pw = rotated ? pieceH : pieceW
  const ph = rotated ? pieceW : pieceH
  const sheetArea = sheet.w * sheet.h
  const usedFrac = sheetArea > 0 ? (best.count * pw * ph) / sheetArea : 0
  return { cols: best.cols, rows: best.rows, count: best.count, rotated, usedFrac }
}

// จำนวนแผ่นที่ต้องใช้เพื่อผลิตครบตามจำนวนสั่ง (0 = วางไม่ได้เลย → ต้องเปลี่ยนแผ่น/ลดขนาด)
export function sheetsNeeded(qty: number, perSheet: number): number {
  return perSheet > 0 ? Math.ceil(qty / perSheet) : 0
}
