import type { Dieline } from './types'
import type { VentConfig } from './vents'
import { pathToPolylines } from './dxf'
import { ensureThaiFont, drawFill, drawFillImage, drawDecoPreview, type Deco, type FillImage } from './artwork'
import type { DesignPalette } from './designColors'

// ใบสรุปสเปก 1 หน้า (A4) สำหรับส่งโรงงานขอราคา — ไม่ใช่ไฟล์ผลิต
//
// เรนเดอร์ลง canvas ก่อน (ข้อความไทยใช้ฟอนต์เบราว์เซอร์ได้เลย) แล้วฝังเป็น JPEG
// ในหน้า PDF เดียว — เลี่ยงการฝังฟอนต์ไทยลง PDF ซึ่งซับซ้อนมาก ตัว pdf.ts เดิม
// รองรับแค่ Helvetica/ASCII จึงพิมพ์ไทยไม่ได้ วิธี raster นี้พอสำหรับเอกสารขอราคา
// สำคัญ: ต้อง await ensureThaiFont() ก่อน renderCanvas ไม่งั้น canvas อาจ fallback ไปฟอนต์ระบบ
// (Noto Sans Thai self-host ผ่าน @fontsource แต่ fontsource แยกโหลด subset ต่อน้ำหนักแบบ lazy)

export interface SpecSheetInput {
  projectName: string
  templateNameTh: string
  materialNameTh: string
  materialThickness: number
  W: number
  D: number
  H: number
  qty: number
  handle: boolean
  vents?: VentConfig
  finishes?: string[] // งานพิมพ์พิเศษ เช่น "ฟอยล์ทอง (2 ชิ้น) · เพลต Foil_Gold"
  assumptions: string[]
  layoutNote: string
  reasoning: string
  dieline: Dieline
  // ลายบนแผ่น (โลโก้/ข้อความ/รูปทรง) + พื้นสี/รูปพื้น — ให้พรีวิว dieline โชว์ดีไซน์จริงตอนขอราคา
  decos?: Deco[]
  fillColor?: string | null
  fillImage?: FillImage | null
  // ชุดสีที่ใช้ในงาน (designPalette) — มีสี/ฟอยล์/รูป = เพิ่มหน้าตารางรหัสสีต่อท้าย
  palette?: DesignPalette
}

// A4 150dpi (210×297 มม.)
const CW = 1240
const CH = 1754
const M = 96 // ระยะขอบ

const INK = '#232019'
const SUB = '#6a6153'
const RULE = '#d8d0c0'
const CUT = '#33302a'
const CREASE = '#12876a'
const ACCENT = '#0f6e56'

const fmt = (v: number) => String(Math.round(v * 10) / 10)

// ตัดข้อความเป็นบรรทัดตามความกว้าง — ภาษาไทยไม่มีเว้นวรรคระหว่างคำ จึงตัดที่ขอบคำจาก Intl.Segmenter
// (ไม่มี Segmenter = ทีละอักขระเหมือนเดิม; คำเดียวยาวเกินบรรทัดก็ยังถูกหั่นกลางคำ)
const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('th', { granularity: 'word' }) : null
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = []
  let cur = ''
  const pieces = segmenter ? [...segmenter.segment(text)].map((s) => s.segment) : [...text]
  for (const piece of pieces) {
    if (piece.includes('\n') && piece !== '\n') {
      // ช่วงที่มีขึ้นบรรทัดปนอยู่ — ไล่ทีละอักขระ
      for (const ch of piece) {
        if (ch === '\n') {
          lines.push(cur)
          cur = ''
        } else if (ctx.measureText(cur + ch).width > maxW && cur) {
          lines.push(cur)
          cur = ch
        } else cur += ch
      }
      continue
    }
    const ch = piece
    if (ctx.measureText(ch).width > maxW) {
      // คำเดียวยาวเกินบรรทัด — หั่นทีละอักขระ
      for (const c of ch) {
        if (ctx.measureText(cur + c).width > maxW && cur) {
          lines.push(cur)
          cur = c
        } else cur += c
      }
      continue
    }
    if (ch === '\n') {
      lines.push(cur)
      cur = ''
      continue
    }
    const test = cur + ch
    if (ctx.measureText(test).width > maxW && cur) {
      lines.push(cur.trimEnd())
      cur = ch.trimStart() // ไม่ขึ้นบรรทัดใหม่ด้วยช่องว่าง
    } else {
      cur = test
    }
  }
  if (cur) lines.push(cur)
  return lines
}

function drawDielinePreview(
  ctx: CanvasRenderingContext2D,
  d: Dieline,
  x: number,
  y: number,
  w: number,
  h: number,
  art?: { decos: Deco[]; fillColor?: string | null; fillImage?: FillImage | null; imgs: Map<string, HTMLImageElement> },
) {
  const pad = 6
  const s = Math.min((w - pad * 2) / d.width, (h - pad * 2) / d.height)
  const ox = x + (w - d.width * s) / 2
  const oy = y + (h - d.height * s) / 2
  ctx.save()
  ctx.translate(ox, oy)
  ctx.scale(s, s)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  // ลายเป็นชั้นล่าง (พิกัดแผ่นคลี่ มม. เพราะ ctx ถูกสเกลด้วย s แล้ว จึงส่ง s=1) แล้ววาดเส้น dieline ทับเป็นไกด์
  if (art) {
    if (art.fillColor) drawFill(ctx, d, art.fillColor, 1)
    const fimg = art.fillImage ? art.imgs.get(art.fillImage.src) : undefined
    if (art.fillImage && fimg) drawFillImage(ctx, d, fimg, art.fillImage, 1)
    for (const e of art.decos) if (!e.hidden) drawDecoPreview(ctx, e, 1, (src) => art.imgs.get(src))
  }
  for (const seg of d.segments) {
    ctx.beginPath()
    for (const poly of pathToPolylines(seg.d)) {
      poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
    }
    ctx.lineWidth = (seg.kind === 'cut' ? 1.1 : 0.9) / s
    ctx.strokeStyle = seg.kind === 'cut' ? CUT : CREASE
    ctx.setLineDash(seg.kind === 'crease' ? [4 / s, 2.5 / s] : [])
    ctx.stroke()
  }
  ctx.restore()
}

function renderCanvas(input: SpecSheetInput, imgs: Map<string, HTMLImageElement>): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = CW
  canvas.height = CH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('เปิด canvas ไม่ได้')
  const font = (px: number, weight = '400') => `${weight} ${px}px 'Noto Sans Thai', sans-serif`

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, CW, CH)

  let y = M

  // --- หัวเอกสาร ---
  ctx.fillStyle = ACCENT
  ctx.font = font(26, '700')
  ctx.fillText('ใบสรุปสเปกบรรจุภัณฑ์', M, y + 26)
  ctx.textAlign = 'right'
  ctx.fillStyle = SUB
  ctx.font = font(18)
  ctx.fillText(new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' }), CW - M, y + 24)
  ctx.textAlign = 'left'
  y += 46

  ctx.fillStyle = INK
  ctx.font = font(34, '700')
  for (const line of wrap(ctx, input.projectName, CW - M * 2)) {
    ctx.fillText(line, M, y + 34)
    y += 46
  }
  y += 14

  ctx.strokeStyle = RULE
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(M, y)
  ctx.lineTo(CW - M, y)
  ctx.stroke()
  y += 40

  // --- ตารางสเปก ---
  const rows: [string, string][] = [
    ['รูปแบบกล่อง', input.templateNameTh],
    ['วัสดุ', `${input.materialNameTh} (หนา ${fmt(input.materialThickness)} มม.)`],
    ['ขนาดภายใน (ก×ล×ส)', `${fmt(input.W)} × ${fmt(input.D)} × ${fmt(input.H)} มม.`],
    ['ขนาดแผ่นคลี่', `${Math.ceil(input.dieline.width)} × ${Math.ceil(input.dieline.height)} มม.`],
    ['รูหิ้ว', input.handle ? 'มี' : 'ไม่มี'],
    ...(input.vents && input.vents.on
      ? ([
          [
            'รูระบายอากาศ',
            `⌀${fmt(input.vents.dia)} มม. ${input.vents.rows}×${input.vents.cols} · ${
              input.vents.walls === 'ends'
                ? 'หัวท้าย'
                : input.vents.walls === 'all'
                  ? 'ทุกด้าน'
                  : 'ด้านกว้าง'
            }`,
          ],
        ] as [string, string][])
      : []),
    ...(input.finishes?.length ? ([['งานพิมพ์พิเศษ', input.finishes.join(' · ')]] as [string, string][]) : []),
    ['จำนวนสั่งผลิต', `${input.qty.toLocaleString('th-TH')} ใบ`],
    ...(hasPalette(input.palette)
      ? ([['ชุดสีในงาน', `${input.palette!.colors.length} สี (หน้า 2)`]] as [string, string][])
      : []),
  ]
  const labelX = M
  const valueX = M + 300
  for (const [label, value] of rows) {
    ctx.fillStyle = SUB
    ctx.font = font(20)
    ctx.fillText(label, labelX, y + 20)
    ctx.fillStyle = INK
    ctx.font = font(22, '600')
    ctx.fillText(value, valueX, y + 20)
    y += 44
  }
  y += 20

  // --- สิ่งที่ระบบสันนิษฐาน ---
  ctx.fillStyle = ACCENT
  ctx.font = font(22, '700')
  ctx.fillText('สิ่งที่ระบบสันนิษฐาน (โปรดตรวจ/ยืนยันกับโรงงาน)', M, y + 22)
  y += 44

  const items = [...input.assumptions]
  if (input.layoutNote && input.layoutNote !== '-') items.push(`การจัดวาง: ${input.layoutNote}`)
  ctx.font = font(19)
  if (items.length === 0) {
    ctx.fillStyle = SUB
    ctx.fillText('— ไม่มีข้อสันนิษฐานบันทึกไว้ (ตั้งค่าเอง)', M + 8, y + 19)
    y += 34
  } else {
    for (const it of items) {
      const limit = it.startsWith('ข้อจำกัด')
      ctx.fillStyle = limit ? '#a13a1c' : INK
      ctx.font = font(19, limit ? '600' : '400')
      const lines = wrap(ctx, it, CW - M * 2 - 28)
      lines.forEach((line, i) => {
        if (i === 0) {
          ctx.fillStyle = ACCENT
          ctx.fillText('•', M + 4, y + 19)
          ctx.fillStyle = limit ? '#a13a1c' : INK
        }
        ctx.fillText(line, M + 28, y + 19)
        y += 30
      })
      y += 6
    }
  }
  y += 16

  // --- แบบ dieline ย่อ ---
  ctx.strokeStyle = RULE
  ctx.beginPath()
  ctx.moveTo(M, y)
  ctx.lineTo(CW - M, y)
  ctx.stroke()
  y += 34

  ctx.fillStyle = ACCENT
  ctx.font = font(22, '700')
  ctx.fillText('แบบ dieline (ย่อส่วน — ไม่ใช่สเกลจริง)', M, y + 22)
  y += 20

  const previewH = CH - M - y - 70
  const decos = (input.decos ?? []).filter((e) => !e.hidden)
  const art =
    decos.length || input.fillColor || input.fillImage
      ? { decos, fillColor: input.fillColor, fillImage: input.fillImage, imgs }
      : undefined
  drawDielinePreview(ctx, input.dieline, M, y + 14, CW - M * 2, previewH, art)

  // --- ท้ายเอกสาร ---
  ctx.fillStyle = SUB
  ctx.font = font(16)
  const foot = 'เอกสารนี้เป็นใบสรุปสำหรับขอราคา ไม่ใช่ไฟล์ผลิต — ไฟล์ผลิตจริงคือ .dxf / .pdf สเกล 1:1 ที่ดาวน์โหลดแยก'
  wrap(ctx, foot, CW - M * 2).forEach((line, i) => ctx.fillText(line, M, CH - M + 6 + i * 22))

  return canvas
}

const hasPalette = (p?: DesignPalette) => !!p && p.colors.length > 0

// หน้าตารางรหัสสี: เฉพาะสีกับรหัส (ช่องสี · HEX · RGB · CMYK) ไม่มีคำอธิบาย — ผู้ใช้ขอให้เหลือแค่นี้ (24 พ.ย. 2026)
// แถวเกินหน้า → ขึ้นหน้าใหม่ (คืน canvas หลายหน้า)
function renderPaletteCanvases(input: SpecSheetInput, p: DesignPalette): HTMLCanvasElement[] {
  const font = (px: number, weight = '400') => `${weight} ${px}px 'Noto Sans Thai', sans-serif`
  const pages: HTMLCanvasElement[] = []
  let ctx!: CanvasRenderingContext2D
  let y = 0
  const col = { sw: M, hex: M + 120, rgb: M + 360, cmyk: M + 620 }
  const rule = (lw = 1) => {
    ctx.strokeStyle = RULE
    ctx.lineWidth = lw
    ctx.beginPath()
    ctx.moveTo(M, y)
    ctx.lineTo(CW - M, y)
    ctx.stroke()
  }
  const newPage = () => {
    const canvas = document.createElement('canvas')
    canvas.width = CW
    canvas.height = CH
    const c = canvas.getContext('2d')
    if (!c) throw new Error('เปิด canvas ไม่ได้')
    ctx = c
    pages.push(canvas)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, CW, CH)
    y = M
    ctx.fillStyle = ACCENT
    ctx.font = font(26, '700')
    ctx.fillText(pages.length === 1 ? 'ชุดสีที่ใช้ในงานออกแบบ' : 'ชุดสีที่ใช้ในงานออกแบบ (ต่อ)', M, y + 26)
    ctx.textAlign = 'right'
    ctx.fillStyle = SUB
    ctx.font = font(18)
    ctx.fillText(input.projectName, CW - M, y + 24)
    ctx.textAlign = 'left'
    y += 84
    ctx.fillStyle = SUB
    ctx.font = font(18, '600')
    ctx.fillText('สี', col.sw, y)
    ctx.fillText('HEX', col.hex, y)
    ctx.fillText('RGB', col.rgb, y)
    ctx.fillText('CMYK (%)', col.cmyk, y)
    y += 14
    rule(1.5)
    y += 12
  }
  newPage()

  for (const c of p.colors) {
    const rowH = 52
    if (y + rowH > CH - M - 40) newPage()
    // ช่องสี (ขอบบางให้สีขาว/อ่อนมองเห็น)
    ctx.fillStyle = c.hex
    ctx.fillRect(col.sw, y + 4, 64, 40)
    ctx.strokeStyle = '#b9b0a0'
    ctx.lineWidth = 1
    ctx.strokeRect(col.sw + 0.5, y + 4.5, 63, 39)
    ctx.fillStyle = INK
    ctx.font = font(21, '700')
    ctx.fillText(c.hex, col.hex, y + 31)
    ctx.font = font(19)
    ctx.fillText(c.rgb.join(', '), col.rgb, y + 31)
    ctx.fillText(c.cmyk.join(' / '), col.cmyk, y + 31)
    y += rowH
    rule()
    y += 10
  }

  pages.forEach((page, i) => {
    const c = page.getContext('2d')!
    c.fillStyle = SUB
    c.font = font(16)
    c.textAlign = 'right'
    c.fillText(`หน้า ${i + 2} / ${pages.length + 1}`, CW - M, CH - M + 6)
  })
  return pages
}

function jpegBytes(canvas: HTMLCanvasElement): Uint8Array {
  const b64 = canvas.toDataURL('image/jpeg', 0.9).split(',')[1]
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

// ประกอบ PDF หลายหน้า แต่ละหน้าฝังภาพ JPEG เต็มหน้า A4 (หน้า 1 สเปก, ถัดไปตารางรหัสสี)
// ต้องสร้างเป็น byte จริง (ไม่ใช่สตริง) เพราะ stream ของ JPEG เป็น binary
// ถ้าเก็บเป็น JS string แล้ว Blob จะ encode UTF-8 ทำให้ไบต์ภาพเพี้ยน
// วัตถุ: 1 Catalog, 2 Pages, แล้วหน้าละ 3 วัตถุ (Page, Contents, Image) เริ่มที่ 3
export function assemblePDF(pages: { jpeg: Uint8Array; w: number; h: number }[]): Uint8Array {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  let len = 0
  const push = (c: Uint8Array | string) => {
    const b = typeof c === 'string' ? enc.encode(c) : c
    parts.push(b)
    len += b.length
  }

  // A4 แนวตั้ง (point) — อัตราส่วนตรงกับ canvas 1240×1754 จึงไม่ยืด
  const PW = 595.28
  const PH = 841.89
  const offsets: number[] = []
  const obj = (s: string) => {
    offsets.push(len)
    push(s)
  }

  const pageObj = (i: number) => 3 + i * 3
  push('%PDF-1.5\n')
  obj('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  obj(`2 0 obj\n<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`)
  const content = `q\n${PW} 0 0 ${PH} 0 0 cm\n/Im0 Do\nQ\n`
  pages.forEach((pg, i) => {
    const po = pageObj(i)
    obj(
      `${po} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] ` +
        `/Resources << /XObject << /Im0 ${po + 2} 0 R >> >> /Contents ${po + 1} 0 R >>\nendobj\n`,
    )
    obj(`${po + 1} 0 obj\n<< /Length ${enc.encode(content).length} >>\nstream\n${content}endstream\nendobj\n`)
    offsets.push(len)
    push(
      `${po + 2} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pg.w} /Height ${pg.h} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.jpeg.length} >>\nstream\n`,
    )
    push(pg.jpeg)
    push('\nendstream\nendobj\n')
  })

  const size = offsets.length + 1
  const xrefPos = len
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`
  for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n \n`
  push(xref)
  push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`)

  const out = new Uint8Array(len)
  let p = 0
  for (const part of parts) {
    out.set(part, p)
    p += part.length
  }
  return out
}

export async function specSheetPDFBytes(input: SpecSheetInput): Promise<Uint8Array> {
  await ensureThaiFont(input.decos) // รอฟอนต์ที่ใบสเปกใช้ก่อน rasterize
  // โหลดรูปที่ลายอ้างถึง (โลโก้ภาพ + รูปพื้น) ก่อน rasterize ไม่งั้นพรีวิวจะขาดรูป
  const srcs = new Set<string>()
  for (const e of input.decos ?? []) if (!e.hidden && e.type === 'image') srcs.add(e.src)
  if (input.fillImage) srcs.add(input.fillImage.src)
  const imgs = new Map<string, HTMLImageElement>()
  await Promise.all(
    [...srcs].map(
      (src) =>
        new Promise<void>((res) => {
          const im = new Image()
          im.onload = () => {
            imgs.set(src, im)
            res()
          }
          im.onerror = () => res()
          im.src = src
        }),
    ),
  )
  const canvases = [renderCanvas(input, imgs)]
  if (hasPalette(input.palette)) canvases.push(...renderPaletteCanvases(input, input.palette!))
  return assemblePDF(canvases.map((c) => ({ jpeg: jpegBytes(c), w: c.width, h: c.height })))
}
