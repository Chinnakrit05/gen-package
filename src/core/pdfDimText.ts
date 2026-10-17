import { loadTextFont } from './artwork'
import { packTextMask, type PdfTextMask } from './pdf'

// ป้ายบอกขนาดที่มีอักษรนอก ASCII (ไทย) → ภาพ 1 บิตความละเอียดสูงสำหรับ dielinePDFBytes (ImageMask)
// Helvetica ใน PDF ไม่มีอักษรไทยจึงขึ้นเครื่องหมายคำถาม; ภาพแมสก์ทาสีเลเยอร์ dims ได้และพื้นโปร่ง
// ป้าย ASCII ล้วนคืน null ให้ PDF ใช้ข้อความเวกเตอร์ตามเดิม (คมกว่า ค้นหาได้)
const DPI = 600
const FONT = "'Noto Sans Thai', sans-serif"

export async function renderDimTextMasks(labels: string[], sizeMm: number): Promise<(PdfTextMask | null)[]> {
  const needs = labels.map((l) => /[^\x20-\x7e]/.test(l))
  if (!needs.some(Boolean)) return labels.map(() => null)
  // fontsource โหลด subset ตามอักษรที่ใช้ — รอให้ครบก่อนวาด ไม่งั้น canvas fallback เป็นฟอนต์อื่น
  await loadTextFont(undefined, 400, labels.join(''))
  const pxPerMm = DPI / 25.4
  const px = sizeMm * pxPerMm
  return labels.map((label, i) => {
    if (!needs[i]) return null
    const probe = document.createElement('canvas').getContext('2d')
    if (!probe) return null
    probe.font = `${px}px ${FONT}`
    const m = probe.measureText(label)
    const ascent = Math.ceil(m.actualBoundingBoxAscent || px * 0.8) + 2
    const descent = Math.ceil(m.actualBoundingBoxDescent || px * 0.3) + 2
    const w = Math.max(1, Math.ceil(m.width) + 4)
    const h = Math.max(1, ascent + descent)
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    if (!ctx) return null
    ctx.font = `${px}px ${FONT}`
    ctx.fillStyle = '#000'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(label, 2, ascent)
    const rgba = ctx.getImageData(0, 0, w, h).data
    return {
      w,
      h,
      bits: packTextMask(rgba, w, h),
      widthMm: w / pxPerMm,
      heightMm: h / pxPerMm,
      descentMm: descent / pxPerMm,
    }
  })
}
