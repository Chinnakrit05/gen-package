// งานพิมพ์พิเศษ (post-press finishing) ต่อชิ้นลาย: ฟอยล์ / Spot UV / ปั๊มนูน-ปั๊มจม (pure)
//
// โรงพิมพ์รับงานพิเศษเป็น "เพลต" แยก: สี spot (Separation) ชื่อเฉพาะ ทึบ 100% ตามรูปทรงที่ต้องการ ตั้ง overprint
// ไม่ให้ลบหมึก CMYK ข้างใต้ — ไฟล์ส่งออกจึงมีเลเยอร์ละหนึ่งชนิด (ชื่อ = ชื่อ spot ที่เขียนในใบสั่งงาน)
// ฟอยล์ปั๊มทับกระดาษ "แทน" หมึก — ชิ้นที่เป็นฟอยล์ไม่พิมพ์ CMYK (ไม่งั้นได้หมึกเหลืองใต้ทองคำเปลว
// ขอบเหลื่อมเห็นสีเหลืองโผล่); Spot UV / ปั๊มนูน-จม ทำบนงานที่พิมพ์แล้ว → ชิ้นนั้นยังพิมพ์ CMYK ตามปกติ

export type FinishKind = 'foil-gold' | 'foil-silver' | 'foil-rose' | 'spot-uv' | 'emboss' | 'deboss'

export interface FinishDef {
  id: FinishKind
  nameTh: string
  nameEn: string
  spot: string // ชื่อสี spot/เลเยอร์ในไฟล์
  alt: [number, number, number, number] // สีสำรอง CMYK (0..1) ตอนแสดงผลเพลตบนจอ/พิมพ์ตรวจ
  display: string // สีเลเยอร์ใน SVG (มองเห็นง่าย ไม่ใช่สีจริง)
  foil?: { base: string; light: string; dark: string } // สีโลหะสำหรับพรีวิว
  printsCmyk: boolean // ชิ้นนี้ยังพิมพ์หมึก CMYK ด้วยไหม
  rough: number // ความด้านของผิว (3D roughness) — ต่ำ = มันวาว
  metal: number // ความเป็นโลหะ (3D metalness)
  relief: -1 | 0 | 1 // ปั๊มจม / เรียบ / ปั๊มนูน
}

export const FINISHES: FinishDef[] = [
  {
    id: 'foil-gold',
    nameTh: 'ฟอยล์ทอง',
    nameEn: 'Gold foil',
    spot: 'Foil_Gold',
    alt: [0, 0.18, 0.62, 0.22],
    display: '#c9a227',
    foil: { base: '#d4af37', light: '#fff1b8', dark: '#8a6a12' },
    printsCmyk: false,
    rough: 0.22,
    metal: 1,
    relief: 0,
  },
  {
    id: 'foil-silver',
    nameTh: 'ฟอยล์เงิน',
    nameEn: 'Silver foil',
    spot: 'Foil_Silver',
    alt: [0.08, 0.04, 0, 0.32],
    display: '#a7adb4',
    foil: { base: '#c4c9cf', light: '#ffffff', dark: '#6f767e' },
    printsCmyk: false,
    rough: 0.2,
    metal: 1,
    relief: 0,
  },
  {
    id: 'foil-rose',
    nameTh: 'ฟอยล์โรสโกลด์',
    nameEn: 'Rose-gold foil',
    spot: 'Foil_RoseGold',
    alt: [0, 0.35, 0.35, 0.1],
    display: '#d8988a',
    foil: { base: '#e0a596', light: '#ffe3da', dark: '#9b5e52' },
    printsCmyk: false,
    rough: 0.24,
    metal: 1,
    relief: 0,
  },
  {
    id: 'spot-uv',
    nameTh: 'เคลือบ Spot UV',
    nameEn: 'Spot UV',
    spot: 'Spot_UV',
    alt: [0.55, 0, 0.1, 0],
    display: '#5ec8e5',
    printsCmyk: true,
    rough: 0.06,
    metal: 0,
    relief: 0,
  },
  {
    id: 'emboss',
    nameTh: 'ปั๊มนูน',
    nameEn: 'Emboss',
    spot: 'Emboss',
    alt: [0, 0.55, 0, 0],
    display: '#e05aa8',
    printsCmyk: true,
    rough: -1, // -1 = ผิวเดิมของวัสดุ
    metal: 0,
    relief: 1,
  },
  {
    id: 'deboss',
    nameTh: 'ปั๊มจม',
    nameEn: 'Deboss',
    spot: 'Deboss',
    alt: [0.45, 0.45, 0, 0],
    display: '#7a6ad8',
    printsCmyk: true,
    rough: -1,
    metal: 0,
    relief: -1,
  },
]

export const finishDef = (k: FinishKind | undefined): FinishDef | undefined => (k ? FINISHES.find((f) => f.id === k) : undefined)
export const isFinishKind = (v: unknown): v is FinishKind => FINISHES.some((f) => f.id === v)
export const isFoil = (k: FinishKind | undefined) => !!finishDef(k)?.foil

// ชิ้นนี้พิมพ์ลงเพลต CMYK ไหม (ฟอยล์ = ไม่)
export const printsCmyk = (e: { finish?: FinishKind; hidden?: boolean }) => !e.hidden && (finishDef(e.finish)?.printsCmyk ?? true)

// จัดกลุ่มชิ้นตามงานพิเศษ (ลำดับตาม FINISHES) — ใช้ทำเพลตส่งออก/สรุปในแท็บส่งออก/ใบสเปก
export function finishGroups<T extends { finish?: FinishKind; hidden?: boolean }>(decos: readonly T[]): { def: FinishDef; items: T[] }[] {
  return FINISHES.map((def) => ({ def, items: decos.filter((d) => !d.hidden && d.finish === def.id) })).filter((g) => g.items.length > 0)
}

// ข้อจำกัดผลิตโดยประมาณ (โรงพิมพ์ทั่วไป): เส้น/ตัวอักษรเล็กกว่านี้ฟอยล์ติดไม่ครบหรือปั๊มไม่ขึ้นรูป
export const FINISH_MIN_TEXT_MM: Record<FinishKind, number> = {
  'foil-gold': 2.5,
  'foil-silver': 2.5,
  'foil-rose': 2.5,
  'spot-uv': 2,
  emboss: 4,
  deboss: 4,
}

// ข้อความที่เล็กเกินสำหรับงานพิเศษที่ตั้งไว้ (ขนาดฟอนต์ = ความสูงตัวอักษร มม.)
export function finishSmallText<T extends { finish?: FinishKind; hidden?: boolean; type: string; size?: number }>(decos: readonly T[]): T[] {
  return decos.filter((d) => !d.hidden && d.finish && d.type === 'text' && (d.size ?? 0) < FINISH_MIN_TEXT_MM[d.finish])
}

// เพลตงานพิเศษสำหรับไฟล์ส่งออก (PDF/SVG): loop ปิดในพิกัดแผ่น เติม even-odd
export interface FinishPlate {
  kind: FinishKind
  loops: { x: number; y: number }[][]
}
