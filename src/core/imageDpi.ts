import type { ImageEl } from './artwork'

// ความละเอียดของรูปตาม "ขนาดที่วางจริงบนแผ่น" (dpi = พิกเซลของรูป ÷ ขนาดที่พิมพ์เป็นนิ้ว)
// งานพิมพ์แนะนำ ≥300 dpi; ต่ำกว่า 150 dpi จะเห็นแตก/เบลอชัดเมื่อพิมพ์จริง → เตือนผู้ใช้
export const LOW_DPI = 150
export const GOOD_DPI = 300
const MM_PER_IN = 25.4

// ขนาดที่ภาพถูกวาดจริง (มม.) — สูตรเดียวกับ drawImageFit: cover ล้นกรอบ (คูณ cropZoom), contain พอดีกรอบ,
// stretch ยืดเต็มกรอบ ส่วนที่ล้นถูกครอปทิ้ง แต่ความละเอียดคิดจากขนาดภาพเต็ม (พิกเซลกระจายบนพื้นที่นั้น)
export function imageDrawMm(e: Pick<ImageEl, 'w' | 'h' | 'aspect' | 'fit' | 'cropZoom'>): { w: number; h: number } {
  const fit = e.fit ?? 'cover'
  if (fit === 'stretch') return { w: e.w, h: e.h }
  const wide = fit === 'cover' ? e.aspect > e.w / e.h : e.aspect < e.w / e.h
  const zoom = fit === 'cover' ? Math.max(1, e.cropZoom ?? 1) : 1
  const w = (wide ? e.h * e.aspect : e.w) * zoom
  const h = (wide ? e.h : e.w / e.aspect) * zoom
  return { w, h }
}

// dpi ที่ได้จริง — ใช้ด้านที่แย่กว่า (stretch อาจยืดสองแกนไม่เท่ากัน)
export function printDpi(pxW: number, pxH: number, wMm: number, hMm: number): number {
  if (!(wMm > 0) || !(hMm > 0)) return Infinity
  return Math.min(pxW / (wMm / MM_PER_IN), pxH / (hMm / MM_PER_IN))
}

// พิกเซลที่ต้องมีเพื่อให้ได้ dpi เป้าหมายที่ขนาดนี้ (ไว้บอกผู้ใช้ว่าควรหารูปใหญ่แค่ไหน)
export function pixelsNeeded(mm: number, dpi = GOOD_DPI): number {
  return Math.ceil((mm / MM_PER_IN) * dpi)
}

// SVG = เวกเตอร์ คมทุกขนาด ไม่ต้องตรวจ
export function isVectorSrc(src: string): boolean {
  return /^data:image\/svg\+xml/i.test(src) || /\.svg(\?|#|$)/i.test(src)
}

// ตรวจเฉพาะรูปที่ผู้ใช้นำเข้าเอง — ลายจากไลบรารี (preset) แอปสร้างเอง ผู้ใช้แก้ด้วยการหารูปใหม่ไม่ได้
export function needsDpiCheck(e: ImageEl): boolean {
  return !e.preset && !e.hidden && !isVectorSrc(e.src)
}
