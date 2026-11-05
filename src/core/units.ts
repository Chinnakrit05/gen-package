// หน่วยวัด: เรขาคณิตภายในเก็บเป็น มม. เสมอ — ฟังก์ชันนี้แปลงเพื่อ "แสดงผล/ป้อนค่า" เท่านั้น
// ใช้ร่วมกันระหว่างแผง DimField, blueprint และป้ายขนาดบนมุมมอง 3D ให้ค่าตรงกันทุกจุด
export const MM_PER_IN = 25.4

export type LengthUnit = 'mm' | 'cm' | 'in'
export const LENGTH_UNITS: readonly LengthUnit[] = ['mm', 'cm', 'in']

const MM_PER: Record<LengthUnit, number> = { mm: 1, cm: 10, in: MM_PER_IN }
// ทศนิยมที่แสดง: มม. 1 ตำแหน่ง (0.1 มม.), ซม. 2 ตำแหน่ง (0.1 มม.), นิ้ว 2 ตำแหน่ง
const DECIMALS: Record<LengthUnit, number> = { mm: 1, cm: 2, in: 2 }

export function parseLengthUnit(value: unknown): LengthUnit {
  return value === 'cm' || value === 'in' ? value : 'mm'
}

// ค่าตัวเลขตามหน่วยที่เลือก (ปัดพอดีอ่าน)
export function dimValue(mm: number, unit: LengthUnit): number {
  const f = 10 ** DECIMALS[unit]
  return Math.round((mm / MM_PER[unit]) * f) / f
}

// ค่าที่ป้อนในหน่วยที่เลือก → มม.
export function toMm(value: number, unit: LengthUnit): number {
  return value * MM_PER[unit]
}

// ขั้นของช่องตัวเลข: มม. ตามที่ช่องกำหนด, ซม. = ขั้น มม. เดียวกันหาร 10, นิ้ว 0.05
export function unitStep(unit: LengthUnit, mmStep: number): number {
  if (unit === 'in') return 0.05
  return unit === 'cm' ? mmStep / 10 : mmStep
}

export function unitLabel(unit: LengthUnit, lang: 'th' | 'en' = 'th'): string {
  if (lang === 'en') return unit === 'in' ? 'in' : unit
  return unit === 'in' ? 'นิ้ว' : unit === 'cm' ? 'ซม.' : 'มม.'
}

// ข้อความค่าขนาด เช่น "80 มม.", "8 ซม." หรือ "3.15 นิ้ว"
export function fmtDim(mm: number, unit: LengthUnit): string {
  return `${dimValue(mm, unit)} ${unitLabel(unit)}`
}

// แปลงตัวเลข (มม.) ทุกตัวในป้ายข้อความ เช่น "W 80.8" → "W 8.08" (ซม.)
export function convertLabelNumbers(label: string, unit: LengthUnit): string {
  if (unit === 'mm') return label
  return label.replace(/\d+(\.\d+)?/g, (m) => String(dimValue(Number(m), unit)))
}
