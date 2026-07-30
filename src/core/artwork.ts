import type { Dieline, Vec2 } from './types'

// องค์ประกอบที่แปะบนแผ่นคลี่ (เฟส A: พรีวิวบนจอเท่านั้น ยังไม่เข้าไฟล์ผลิต)
//
// พิกัดเก็บเป็น มม. บนแผ่นคลี่ชุดเดียวกับ dieline เพราะแผ่นคลี่ทำหน้าที่เป็น UV map
// อยู่แล้ว — วางตรงไหนบนแผ่น ก็ไปโผล่ตรงนั้นบนโมเดล 3D เองโดยไม่ต้อง unwrap
//
// image กับ text ใช้ transform ร่วมกัน (x, y มุมซ้ายบนก่อนหมุน + rot องศา หมุนรอบจุดกึ่งกลาง)
// เพื่อให้ลาก/หมุน/ปรับขนาดเขียนครั้งเดียวใช้ได้ทั้งสองชนิด
export interface BaseEl {
  id: string
  x: number // มุมซ้ายบน (ก่อนหมุน) บนแผ่นคลี่ (มม.)
  y: number
  rot: number // องศา หมุนตามเข็มรอบจุดกึ่งกลางกล่อง
}

export interface ImageEl extends BaseEl {
  type: 'image'
  src: string // data URL (PNG — รักษาพื้นหลังโปร่งใสของโลโก้)
  aspect: number // กว้าง/สูง ของรูปต้นฉบับ
  w: number // ความกว้างบนแผ่น (มม.) — สูง = w/aspect
}

export interface TextEl extends BaseEl {
  type: 'text'
  text: string
  color: string
  size: number // ความสูงฟอนต์ (มม.)
  w: number // ความกว้างที่วัดได้ (เก็บไว้เพื่อลาก/หมุน/จัดกลาง) — คำนวณใหม่เมื่อ text/size เปลี่ยน
}

// รูปทรงพื้นฐาน — สี่เหลี่ยม/วงรี/เส้น สำหรับทำแถบสี กรอบ เส้นแบ่ง
// rect,ellipse ใช้ fill (พื้น) + stroke/strokeW (เส้นขอบ); line ใช้ stroke/strokeW (h = ความหนาเส้น)
export interface ShapeEl extends BaseEl {
  type: 'shape'
  shape: 'rect' | 'ellipse' | 'line'
  w: number // ความกว้าง/ความยาว (มม.)
  h: number // ความสูง (มม.) — สำหรับ line = ความหนาเส้น
  fill: string // สีพื้น หรือ 'none'
  stroke: string // สีเส้นขอบ หรือ 'none'
  strokeW: number // ความหนาเส้น (มม.)
}

export type Deco = ImageEl | TextEl | ShapeEl

const LINE = 1.25 // อัตราส่วนความสูงบรรทัดต่อขนาดฟอนต์
export const elW = (e: Deco) => e.w
export const elH = (e: Deco) =>
  e.type === 'image' ? e.w / e.aspect : e.type === 'text' ? e.size * LINE : e.h
export const elCenter = (e: Deco): Vec2 => ({ x: e.x + elW(e) / 2, y: e.y + elH(e) / 2 })

// วัดความกว้างข้อความด้วย canvas (ในหน่วย px = มม. เพราะวัดที่สเกล 1:1)
// ใช้ฟอนต์เดียวกับที่ render จริง (Noto Sans Thai) ไม่งั้น bbox/จุดกึ่งกลาง/snap ของข้อความไทยจะเพี้ยน
let measureCtx: CanvasRenderingContext2D | null = null
export function measureText(text: string, size: number): number {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
  if (!measureCtx) return Math.max(1, (text.length || 1) * size * 0.6)
  measureCtx.font = `${size}px 'Noto Sans Thai', sans-serif`
  return Math.max(1, measureCtx.measureText(text || ' ').width)
}

// รอให้ฟอนต์ไทยโหลดครบก่อน rasterize ลง canvas — ถ้าฟอนต์ยังไม่มา canvas จะ fallback ไปฟอนต์ระบบ
// ทำให้ตัวอักษรไทยในไฟล์ที่ export เพี้ยน/เมตริกไม่ตรงกับที่เห็นบนจอ
export async function ensureThaiFont(): Promise<void> {
  const fonts = document.fonts
  if (!fonts?.load) return
  try {
    // ระบุตัวอย่างอักษรไทยเพื่อบังคับโหลด subset ที่มีสระ/วรรณยุกต์จริง
    await Promise.all(
      ['400', '500', '600', '700'].map((w) => fonts.load(`${w} 16px 'Noto Sans Thai'`, 'กขคง้๊')),
    )
    await fonts.ready
  } catch {
    // โหลดฟอนต์ไม่ได้ (ออฟไลน์ครั้งแรก ฯลฯ) — ปล่อยให้ fallback ดีกว่าค้างการ export
  }
}

// อัปเดตความกว้างที่เก็บของ text element หลังแก้ข้อความหรือขนาด
export const withTextW = (e: TextEl): TextEl => ({ ...e, w: measureText(e.text, e.size) })

// --- โหลดไฟล์รูป ---
// เก็บลง localStorage รวมกับข้อมูลงาน จึงต้องคุมขนาดไม่ให้ชน quota (~5MB ทั้ง origin)
// แล้วทำให้ save ของทั้งแอปล้มเงียบ ๆ ไปด้วย — ไล่ย่อลงจนกว่าจะเข้าเกณฑ์
// เพดานสูงขึ้นเพื่อคุณภาพงานพิมพ์: โลโก้กว้าง 100 มม. ที่ 300 dpi ≈ 1180px จึงเริ่มที่ 1200
const MAX_BYTES = 700_000
const SIZES = [1200, 900, 640, 480]

export async function loadImageFile(file: File): Promise<{ src: string; aspect: number }> {
  const bmp = await createImageBitmap(file)
  const aspect = bmp.width / bmp.height
  let src = ''
  for (const max of SIZES) {
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('เปิด canvas ไม่ได้')
    ctx.drawImage(bmp, 0, 0, w, h)
    // PNG เท่านั้น — JPEG จะฆ่า alpha ทำให้โลโก้ติดกรอบขาวมาด้วย
    src = canvas.toDataURL('image/png')
    if (src.length <= MAX_BYTES) break
  }
  bmp.close()
  return { src, aspect }
}

const bbox = (pts: Vec2[]) => {
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
}

// แผงที่เป็นหน้าโชว์ของแต่ละแบบกล่อง เรียงตามลำดับความสำคัญ
// mailer ต้องเป็น lid ไม่ใช่ front เพราะ front ของ mailer คือผนังเตี้ย ๆ
// ส่วนแผงบน (lid) คือหน้าที่คนเห็นตอนกล่องปิด
const FACE_PRIORITY = ['lid', 'front', 'side-a']

function showFace(dieline: Dieline) {
  for (const id of FACE_PRIORITY) {
    const p = dieline.panels.find((q) => q.id === id)
    if (p) return p
  }
  return dieline.panels.reduce((best, p) => {
    const a = bbox(p.outline)
    const b = bbox(best.outline)
    return (a.x1 - a.x0) * (a.y1 - a.y0) > (b.x1 - b.x0) * (b.y1 - b.y0) ? p : best
  })
}

// วางกึ่งกลางหน้าโชว์ ให้กล่องขนาด w×h อยู่กลางแผง
function centerOnFace(dieline: Dieline, w: number, h: number): Vec2 {
  const b = bbox(showFace(dieline).outline)
  return { x: (b.x0 + b.x1) / 2 - w / 2, y: (b.y0 + b.y1) / 2 - h / 2 }
}

let seq = 0
const newId = () => `el-${Date.now().toString(36)}-${(seq++).toString(36)}`

export function makeImageEl(dieline: Dieline, src: string, aspect: number): ImageEl {
  const b = bbox(showFace(dieline).outline)
  const w = Math.max(5, Math.min((b.x1 - b.x0) * 0.5, (b.y1 - b.y0) * 0.5 * aspect))
  const { x, y } = centerOnFace(dieline, w, w / aspect)
  return { id: newId(), type: 'image', src, aspect, w, x, y, rot: 0 }
}

export function makeTextEl(dieline: Dieline, text: string): TextEl {
  const b = bbox(showFace(dieline).outline)
  const size = Math.max(6, Math.round((b.y1 - b.y0) * 0.12))
  const w = measureText(text, size)
  const { x, y } = centerOnFace(dieline, w, size * LINE)
  return { id: newId(), type: 'text', text, color: '#222222', size, w, x, y, rot: 0 }
}

export function makeShapeEl(dieline: Dieline, shape: 'rect' | 'ellipse' | 'line'): ShapeEl {
  const b = bbox(showFace(dieline).outline)
  const fw = b.x1 - b.x0
  const fh = b.y1 - b.y0
  if (shape === 'line') {
    const w = Math.max(10, fw * 0.5)
    const strokeW = Math.max(1, Math.round(fh * 0.02))
    const { x, y } = centerOnFace(dieline, w, strokeW)
    return { id: newId(), type: 'shape', shape, w, h: strokeW, fill: 'none', stroke: '#222222', strokeW, x, y, rot: 0 }
  }
  const w = Math.max(10, fw * 0.4)
  const h = Math.max(10, fh * 0.3)
  const { x, y } = centerOnFace(dieline, w, h)
  return { id: newId(), type: 'shape', shape, w, h, fill: '#0f6e56', stroke: 'none', strokeW: 0, x, y, rot: 0 }
}

// จัดองค์ประกอบให้กลับไปกลางหน้าโชว์ (คงขนาด/มุมเดิม) — เผื่อลากหลุด
export function recenter(dieline: Dieline, e: Deco): Deco {
  const { x, y } = centerOnFace(dieline, elW(e), elH(e))
  return { ...e, x, y }
}

// สำเนาองค์ประกอบ (id ใหม่ เยื้องเล็กน้อยให้เห็นว่าเป็นชิ้นใหม่)
export function cloneDeco(e: Deco, dx = 5, dy = 5): Deco {
  return { ...e, id: newId(), x: e.x + dx, y: e.y + dy }
}

// แปลงจุดยอด shape เป็น UV บนผ้าใบขนาดเท่าแผ่นคลี่
// X = x ของแผ่น, Y = -y ของแผ่น (Viewer3D สร้าง shape ด้วย (pt.x, -pt.y))
// CanvasTexture flipY=true → v=1 คือแถวบนสุดของผ้าใบ ต้องตรงกับ y=0 ของแผ่น จึงได้ v = 1 + Y/สูง
// พลาดตรงนี้เมื่อไหร่รูปจะกลับหัวหรือเลื่อนไปคนละแผง
export function sheetUV(X: number, Y: number, width: number, height: number): [number, number] {
  return [X / width, 1 + Y / height]
}

const xmlEsc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// สีพื้นทั้งแผ่น (flood color) = เติมสีลงพื้นที่ของทุกแผงจริง (ไม่ใช่ทั้งสี่เหลี่ยม)
// เพราะช่องว่างระหว่างแฟลปไม่ใช่กระดาษ ไม่ควรมีสี — แผงต่อกันสนิทจึงคลุมทั้งชิ้นพอดี
export function fillSVGLayer(dieline: Dieline, color: string | null): string {
  if (!color) return ''
  const polys = dieline.panels
    .map(
      (p) =>
        `    <polygon points="${p.outline.map((q) => `${q.x},${q.y}`).join(' ')}" fill="${color}"/>`,
    )
    .join('\n')
  return `  <g id="fill" inkscape:groupmode="layer" inkscape:label="fill">\n${polys}\n  </g>\n`
}

// วาดพื้นสีลง canvas (พิกัดแผ่นคลี่ × s) — ใช้ทั้ง texture 3D และ export PDF
export function drawFill(
  ctx: CanvasRenderingContext2D,
  dieline: Dieline,
  color: string,
  s: number,
) {
  ctx.fillStyle = color
  for (const p of dieline.panels) {
    ctx.beginPath()
    p.outline.forEach((q, i) => (i ? ctx.lineTo(q.x * s, q.y * s) : ctx.moveTo(q.x * s, q.y * s)))
    ctx.closePath()
    ctx.fill()
  }
}

// รูปทรงเป็น SVG element (พิกัดแผ่นคลี่ มม.) — ใช้ทั้ง blueprint (DielineSVG อ้าง shapeSVG ไม่ได้
// เพราะเป็น JSX แยก) และ export; rot = attribute transform ที่คำนวณไว้แล้ว
export function shapeSVG(e: ShapeEl, rot: string): string {
  const stroke = e.stroke !== 'none' && e.strokeW > 0 ? ` stroke="${e.stroke}" stroke-width="${e.strokeW}"` : ''
  if (e.shape === 'line') {
    const cy = e.y + e.h / 2
    return `<line x1="${e.x}" y1="${cy}" x2="${e.x + e.w}" y2="${cy}" stroke="${e.stroke}" stroke-width="${e.strokeW}" stroke-linecap="round"${rot}/>`
  }
  const fill = e.fill !== 'none' ? e.fill : 'none'
  if (e.shape === 'ellipse') {
    return `<ellipse cx="${e.x + e.w / 2}" cy="${e.y + e.h / 2}" rx="${e.w / 2}" ry="${e.h / 2}" fill="${fill}"${stroke}${rot}/>`
  }
  return `<rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" fill="${fill}"${stroke}${rot}/>`
}

// วาดรูปทรงลง canvas 2D — ctx ถูก translate ไปจุดกึ่งกลางและหมุนไว้แล้ว (เรียกจาก drawDeco2D/Viewer3D)
export function drawShape2D(ctx: CanvasRenderingContext2D, e: ShapeEl, s: number) {
  const hw = (e.w / 2) * s
  const hh = (e.h / 2) * s
  if (e.shape === 'line') {
    ctx.strokeStyle = e.stroke
    ctx.lineWidth = Math.max(0.5, e.strokeW * s)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(-hw, 0)
    ctx.lineTo(hw, 0)
    ctx.stroke()
    return
  }
  ctx.beginPath()
  if (e.shape === 'ellipse') ctx.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2)
  else ctx.rect(-hw, -hh, hw * 2, hh * 2)
  if (e.fill !== 'none') {
    ctx.fillStyle = e.fill
    ctx.fill()
  }
  if (e.stroke !== 'none' && e.strokeW > 0) {
    ctx.strokeStyle = e.stroke
    ctx.lineWidth = e.strokeW * s
    ctx.stroke()
  }
}

// สร้างเลเยอร์ <g id="artwork"> สำหรับฝังใน SVG export — vector ล้วน คุณภาพงานพิมพ์
// รูปฝังเป็น data URI (ไฟล์ standalone), ข้อความเป็น <text> แก้ไขได้ใน Illustrator
// ไม่มิเรอร์ — SVG คือเลย์เอาต์ฝั่งพิมพ์/ด้านนอก เหมือนที่เห็นบน blueprint
export function svgArtworkLayer(decos: Deco[]): string {
  if (!decos.length) return ''
  const body = decos
    .map((e) => {
      const w = elW(e)
      const h = elH(e)
      const c = elCenter(e)
      const rot = e.rot ? ` transform="rotate(${e.rot} ${c.x} ${c.y})"` : ''
      if (e.type === 'image') {
        return `    <image href="${e.src}" x="${e.x}" y="${e.y}" width="${w}" height="${h}" preserveAspectRatio="none"${rot}/>`
      }
      if (e.type === 'shape') return `    ${shapeSVG(e, rot)}`
      return (
        `    <text x="${c.x}" y="${c.y}" font-size="${e.size}" fill="${e.color}"` +
        ` text-anchor="middle" dominant-baseline="central"` +
        ` font-family="'Noto Sans Thai', sans-serif"${rot}>${xmlEsc(e.text)}</text>`
      )
    })
    .join('\n')
  return `  <g id="artwork" inkscape:groupmode="layer" inkscape:label="artwork">\n${body}\n  </g>\n`
}

// วาด deco ลง canvas 2D ในพิกัดแผ่นคลี่ (สเกล s) — ไม่มิเรอร์ (สำหรับ export/proof)
// ต่างจากตัวใน Viewer3D ที่มิเรอร์ให้ผิวนอกกล่องอ่านถูก
export function drawDeco2D(
  ctx: CanvasRenderingContext2D,
  e: Deco,
  s: number,
  imgOf: (src: string) => HTMLImageElement | undefined,
) {
  const w = elW(e)
  const h = elH(e)
  ctx.save()
  ctx.translate((e.x + w / 2) * s, (e.y + h / 2) * s)
  ctx.rotate((e.rot * Math.PI) / 180)
  if (e.type === 'image') {
    const img = imgOf(e.src)
    if (img) ctx.drawImage(img, (-w / 2) * s, (-h / 2) * s, w * s, h * s)
  } else if (e.type === 'shape') {
    drawShape2D(ctx, e, s)
  } else {
    ctx.fillStyle = e.color
    ctx.font = `${e.size * s}px 'Noto Sans Thai', sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(e.text, 0, 0)
  }
  ctx.restore()
}

// เรนเดอร์ลายทั้งหมดลง canvas ขนาดเท่าแผ่นคลี่ที่ dpi กำหนด
// ใช้ฝังเป็นภาพในไฟล์ PDF — คืน null ถ้าไม่มีลาย
// พื้นขาว เพราะ JPEG ไม่มี alpha (โปร่งใสจะกลายเป็นดำ) และ PDF หน้าขาวอยู่แล้ว จึงกลืนกัน
export async function renderArtworkCanvas(
  decos: Deco[],
  sheetW: number,
  sheetH: number,
  dpi: number,
): Promise<HTMLCanvasElement | null> {
  if (!decos.length) return null
  await ensureThaiFont() // ให้ตัวอักษรไทยที่ฝังลง PDF ตรงกับที่เห็นบนจอ
  const s = dpi / 25.4
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sheetW * s))
  canvas.height = Math.max(1, Math.round(sheetH * s))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const srcs = [...new Set(decos.filter((d) => d.type === 'image').map((d) => d.src))]
  const imgs = new Map<string, HTMLImageElement>()
  await Promise.all(
    srcs.map(
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
  for (const e of decos) drawDeco2D(ctx, e, s, (src) => imgs.get(src))
  return canvas
}

// --- persistence ---
function parseBase(o: Record<string, unknown>): { x: number; y: number; rot: number } | null {
  const x = Number(o.x)
  const y = Number(o.y)
  const rot = Number(o.rot)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x, y, rot: Number.isFinite(rot) ? rot : 0 }
}

export function parseDeco(v: unknown): Deco | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const base = parseBase(o)
  if (!base) return null
  const id = typeof o.id === 'string' && o.id ? o.id : newId()

  // ข้อมูลรุ่นเก่า (โลโก้ชิ้นเดียว ไม่มี type) → ตีความเป็น image
  if (o.type === 'image' || (o.type === undefined && typeof o.src === 'string')) {
    const src = typeof o.src === 'string' ? o.src : ''
    const aspect = Number(o.aspect)
    const w = Number(o.w)
    if (!src.startsWith('data:image/') || !(aspect > 0) || !(w > 0)) return null
    return { id, type: 'image', src, aspect, w, ...base }
  }
  if (o.type === 'text') {
    const text = typeof o.text === 'string' ? o.text : ''
    const size = Number(o.size)
    const color = typeof o.color === 'string' ? o.color : '#222222'
    if (!(size > 0)) return null
    const w = Number(o.w) > 0 ? Number(o.w) : measureText(text, size)
    return { id, type: 'text', text, size, color, w, ...base }
  }
  if (o.type === 'shape') {
    const shape = o.shape === 'ellipse' || o.shape === 'line' ? o.shape : 'rect'
    const w = Number(o.w)
    const h = Number(o.h)
    if (!(w > 0) || !(h > 0)) return null
    const fill = typeof o.fill === 'string' ? o.fill : '#0f6e56'
    const stroke = typeof o.stroke === 'string' ? o.stroke : 'none'
    const strokeW = Number(o.strokeW) >= 0 ? Number(o.strokeW) : 0
    return { id, type: 'shape', shape, w, h, fill, stroke, strokeW, ...base }
  }
  return null
}

// รับได้ทั้งรายการใหม่ (decos: []) และของเก่า (artwork: {} ชิ้นเดียว)
export function parseDecos(v: unknown, legacyArtwork?: unknown): Deco[] {
  if (Array.isArray(v)) {
    return v.map(parseDeco).filter((d): d is Deco => d !== null)
  }
  const one = parseDeco(legacyArtwork)
  return one ? [one] : []
}
