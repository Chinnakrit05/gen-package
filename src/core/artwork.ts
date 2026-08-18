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
  hidden?: boolean // ซ่อน = ไม่เรนเดอร์ทุกที่ (blueprint/3D/export) แต่ยังอยู่ในรายการ
  locked?: boolean // ล็อก = ลาก/หมุน/ลบบน canvas ไม่ได้ (กันเผลอ)
  name?: string // ชื่อที่ผู้ใช้ตั้งเอง (โชว์ในแผงเลเยอร์แทนป้ายอัตโนมัติ)
  groupId?: string // ชิ้นที่ groupId เดียวกัน = กลุ่มเดียวกัน (เลือก/ย้ายพร้อมกัน)
  flipX?: boolean // พลิกแนวนอน (สะท้อนรอบแกนตั้งผ่านจุดกึ่งกลาง)
  flipY?: boolean // พลิกแนวตั้ง
  opacity?: number // ความทึบ 0..1 (ไม่ใส่ = 1 ทึบเต็ม)
}

export interface ImageEl extends BaseEl {
  type: 'image'
  src: string // data URL (PNG — รักษาพื้นหลังโปร่งใสของโลโก้)
  aspect: number // กว้าง/สูง ของรูปต้นฉบับ
  w: number // ความกว้างกรอบบนแผ่น (มม.)
  h: number // ความสูงกรอบ (มม.) — ตั้งอิสระเพื่อครอป (เริ่มต้น = w/aspect)
  fit?: 'cover' | 'contain' | 'stretch' // วิธีวางรูปในกรอบ (ไม่ใส่ = cover ครอปให้เต็ม)
  radius?: number // มุมโค้งของกรอบ (มม.)
  circle?: boolean // มาสก์เป็นวงรีตามกรอบ
  maskShape?: 'triangle' | 'polygon' | 'star' // มาสก์เป็นรูปทรง (ทับ circle/radius)
  maskSides?: number // จำนวนด้าน/แฉกของมาสก์ (polygon/star)
  preset?: string // ถ้ามาจากไลบรารีลาย = id พรีเซ็ต (เปลี่ยนสีแล้ว regen src ได้)
  presetColor?: string // สีที่ใช้สร้างลายพรีเซ็ตนี้
}

export interface TextEl extends BaseEl {
  type: 'text'
  text: string // รองรับหลายบรรทัดด้วย \n
  color: string
  size: number // ความสูงฟอนต์ (มม.)
  w: number // ความกว้างที่วัดได้ = บรรทัดที่กว้างสุด — คำนวณใหม่เมื่อ text/size/font/weight เปลี่ยน
  font?: string // id ฟอนต์ (ดู FONTS) — ไม่ใส่ = 'noto'
  weight?: number // น้ำหนัก 400/700 — ไม่ใส่ = 400
  align?: 'left' | 'center' | 'right' // จัดชิดหลายบรรทัด — ไม่ใส่ = 'left'
  lh?: number // ตัวคูณระยะบรรทัด — ไม่ใส่ = LINE (1.25)
  strokeColor?: string // สีเส้นขอบตัวอักษร (ไม่ใส่ = ไม่มีขอบ)
  strokeW?: number // ความหนาขอบ (มม.) — ต้องมี strokeColor ด้วย
  shadow?: boolean // เงาใต้ตัวอักษร (ค่าคงที่: เยื้อง+เบลอตามขนาดฟอนต์)
}

// ฟอนต์ไทยที่ให้เลือก — ต้อง import ไฟล์น้ำหนัก 400/700 ใน main.tsx ให้ครบทุกตัว
// (Noto เป็นค่าเริ่มต้น; เพิ่มฟอนต์ใหม่ต้องเพิ่มที่นี่ + import ใน main.tsx + ensureThaiFont โหลดให้)
export const FONTS: { id: string; nameTh: string; css: string }[] = [
  { id: 'noto', nameTh: 'Noto Sans Thai', css: "'Noto Sans Thai'" },
  { id: 'sarabun', nameTh: 'Sarabun', css: "'Sarabun'" },
  { id: 'prompt', nameTh: 'Prompt', css: "'Prompt'" },
  { id: 'kanit', nameTh: 'Kanit', css: "'Kanit'" },
]
export const fontCss = (id?: string) => (FONTS.find((f) => f.id === id) ?? FONTS[0]).css
// สตริง font สำหรับ canvas/measure: "<weight> <px>px <family>, sans-serif"
export const textFont = (e: { size: number; font?: string; weight?: number }, s = 1) =>
  `${e.weight ?? 400} ${e.size * s}px ${fontCss(e.font)}, sans-serif`

// รูปทรงพื้นฐาน — สี่เหลี่ยม/วงรี/เส้น สำหรับทำแถบสี กรอบ เส้นแบ่ง
// rect,ellipse ใช้ fill (พื้น) + stroke/strokeW (เส้นขอบ); line ใช้ stroke/strokeW (h = ความหนาเส้น)
// ไล่สี 2 สต็อป: from→to, angle องศา (แนวเชิงเส้น), radial=วงกลมจากกลางออก
export interface GradientDef {
  from: string
  to: string
  angle: number
  radial?: boolean
}

export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'triangle' | 'polygon' | 'star'
export interface ShapeEl extends BaseEl {
  type: 'shape'
  shape: ShapeKind
  w: number // ความกว้าง/ความยาว (มม.)
  h: number // ความสูง (มม.) — สำหรับ line = ความหนาเส้น
  fill: string // สีพื้น หรือ 'none'
  stroke: string // สีเส้นขอบ หรือ 'none'
  strokeW: number // ความหนาเส้น (มม.)
  grad?: GradientDef // ถ้ามี = ใช้ไล่สีแทนสีพื้นทึบ (เฉพาะรูปทรงมีพื้น)
  sides?: number // จำนวนด้าน/แฉก (polygon/star) — ไม่ใส่ = 6 (polygon) / 5 (star)
  dash?: boolean // เส้นขอบแบบประ
}

// จุดยอดรูปทรงหลายเหลี่ยม/สามเหลี่ยม/ดาว ในกรอบ w×h กึ่งกลางที่ (0,0) — ใช้ร่วมทุก path
// (canvas ใช้พิกัดกึ่งกลางตรง ๆ; SVG/จอ บวกจุดกึ่งกลางของชิ้นเข้าไป)
export function shapeVertices(shape: ShapeKind, w: number, h: number, sides?: number): Vec2[] {
  const rx = w / 2
  const ry = h / 2
  if (shape === 'triangle') return [{ x: 0, y: -ry }, { x: rx, y: ry }, { x: -rx, y: ry }]
  const top = -Math.PI / 2
  if (shape === 'star') {
    const n = Math.max(3, sides ?? 5)
    const inner = 0.42
    const pts: Vec2[] = []
    for (let i = 0; i < n * 2; i++) {
      const a = top + (i * Math.PI) / n
      const r = i % 2 === 0 ? 1 : inner
      pts.push({ x: Math.cos(a) * rx * r, y: Math.sin(a) * ry * r })
    }
    return pts
  }
  // polygon (n เหลี่ยม)
  const n = Math.max(3, sides ?? 6)
  const pts: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const a = top + (i * 2 * Math.PI) / n
    pts.push({ x: Math.cos(a) * rx, y: Math.sin(a) * ry })
  }
  return pts
}

// รูปทรงที่เป็น "รูปปิดมีพื้น" (ไม่ใช่ line) — ใช้ตัดสินใจ fill/gradient/มุมมน
export const isPolyShape = (s: ShapeKind) => s === 'triangle' || s === 'polygon' || s === 'star'

export type Deco = ImageEl | TextEl | ShapeEl

// รูปที่ใช้เป็น "พื้นแพ็กเกจ" (แทน/ทับสีพื้น) — คลุมทั้งแผ่นแล้วครอปตามรูปทรงแผงจริง
// ต่างจาก ImageEl (โลโก้แปะจุดเดียว) ตรงที่รูปนี้ยืดคลุม bounding box ของทุกแผงเป็นผืนเดียว
// fit=cover ครอปให้เต็ม (ค่าเริ่มต้น "พอดี blueprint"); zoom>1 ซูมเข้า; ox/oy เลื่อนกรอบ (-1..1)
export interface FillImage {
  src: string // data URL (JPEG ย่อแล้วฝั่ง client)
  aspect: number // กว้าง/สูง ของรูปต้นฉบับ
  fit?: 'cover' | 'contain' | 'stretch'
  zoom?: number // 1 = พอดีกรอบ; >1 ซูมเข้า (ครอปแคบลง)
  ox?: number // เลื่อนแนวนอน สัดส่วนครึ่งกรอบ (-1..1), ไม่ใส่ = 0 (กึ่งกลาง)
  oy?: number // เลื่อนแนวตั้ง
  rot?: number // องศา หมุนรอบจุดกึ่งกลางกรอบ (ไม่ใส่ = 0)
  opacity?: number // ความทึบ 0..1 (ไม่ใส่ = 1 ทึบเต็ม)
}

const LINE = 1.25 // อัตราส่วนความสูงบรรทัดต่อขนาดฟอนต์ (ค่าเริ่มต้น)
export const elW = (e: Deco) => e.w
export const elH = (e: Deco) =>
  e.type === 'image' ? e.h : e.type === 'text' ? textLinesOf(e).length * textLineH(e) : e.h
export const elCenter = (e: Deco): Vec2 => ({ x: e.x + elW(e) / 2, y: e.y + elH(e) / 2 })

// --- ข้อความหลายบรรทัด: ตัวช่วยที่ทุกเส้นทางเรนเดอร์ (blueprint/3D/SVG/PDF) ใช้ร่วมกัน ---
export const textLinesOf = (e: TextEl): string[] => e.text.split('\n')
export const textLineH = (e: TextEl): number => e.size * (e.lh ?? LINE)
// จุดยึด SVG ตามการจัดชิด (start/middle/end) + พิกัด x ของจุดยึด (มม. สัมบูรณ์)
export const textAnchor = (e: TextEl): 'start' | 'middle' | 'end' =>
  (e.align ?? 'left') === 'left' ? 'start' : (e.align ?? 'left') === 'right' ? 'end' : 'middle'
export const textAnchorX = (e: TextEl): number =>
  (e.align ?? 'left') === 'left' ? e.x : (e.align ?? 'left') === 'right' ? e.x + e.w : e.x + e.w / 2
// y กึ่งกลางของบรรทัดที่ i (ใช้กับ dominant-baseline central)
export const textLineY = (e: TextEl, i: number): number => e.y + textLineH(e) * (i + 0.5)

// id ฟิลเตอร์เงาข้อความ + สตริง <defs><filter> (SVG จอ/ส่งออกใช้ร่วมกัน)
export const textShadowId = (id: string) => `tsh-${id}`
export function textShadowSVG(e: TextEl): string {
  if (!e.shadow) return ''
  const sh = textShadow(e)
  return (
    `<defs><filter id="${textShadowId(e.id)}" x="-30%" y="-30%" width="160%" height="160%">` +
    `<feDropShadow dx="${sh.dx}" dy="${sh.dy}" stdDeviation="${sh.blur}" flood-color="black" flood-opacity="0.4"/>` +
    `</filter></defs>`
  )
}
// แอตทริบิวต์ขอบ+เงาสำหรับ <text> — ขอบวาดใต้พื้นด้วย paint-order="stroke"
export function textFxAttrs(e: TextEl): string {
  const stroke = textHasStroke(e)
    ? ` stroke="${e.strokeColor}" stroke-width="${(e.strokeW as number) * TEXT_STROKE_MUL}" paint-order="stroke" stroke-linejoin="round"`
    : ''
  const filter = e.shadow ? ` filter="url(#${textShadowId(e.id)})"` : ''
  return stroke + filter
}

// วาดข้อความ (อาจหลายบรรทัด) ลง canvas — ctx ถูก translate ไปกึ่งกลาง+หมุน+พลิกไว้แล้ว
// พิกัดท้องถิ่น: กึ่งกลางชิ้น = (0,0); ใช้ทั้ง Viewer3D และ export (drawDeco2D)
// ตัวคูณความหนาขอบ: canvas/SVG วาดขอบคร่อมเส้น (ครึ่งถูก fill ทับ) → ×2 ให้ "ความหนาที่เห็น" ≈ strokeW มม.
export const TEXT_STROKE_MUL = 2
const textHasStroke = (e: TextEl) => !!e.strokeColor && (e.strokeW ?? 0) > 0
// ค่าเงา (มม.) อิงขนาดฟอนต์ — dieline/SVG/canvas ใช้ชุดเดียวกัน
export const textShadow = (e: TextEl) => ({ dx: e.size * 0.05, dy: e.size * 0.05, blur: e.size * 0.05 })

export function drawText2D(ctx: CanvasRenderingContext2D, e: TextEl, s: number) {
  const lines = textLinesOf(e)
  const lineH = textLineH(e)
  const totalH = lines.length * lineH
  const align = e.align ?? 'left'
  ctx.font = textFont(e, s)
  ctx.textAlign = align === 'left' ? 'left' : align === 'right' ? 'right' : 'center'
  ctx.textBaseline = 'middle'
  const x = align === 'left' ? (-e.w / 2) * s : align === 'right' ? (e.w / 2) * s : 0
  const stroked = textHasStroke(e)
  const setShadow = () => {
    if (!e.shadow) return
    const sh = textShadow(e)
    ctx.shadowColor = 'rgba(0,0,0,0.4)'
    ctx.shadowBlur = sh.blur * s
    ctx.shadowOffsetX = sh.dx * s
    ctx.shadowOffsetY = sh.dy * s
  }
  const clearShadow = () => {
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0
  }
  lines.forEach((ln, i) => {
    const cy = (-totalH / 2 + lineH * (i + 0.5)) * s
    if (stroked) {
      setShadow() // เงาอยู่ใต้ขอบ (ชั้นล่างสุด)
      ctx.lineJoin = 'round'
      ctx.lineWidth = (e.strokeW as number) * TEXT_STROKE_MUL * s
      ctx.strokeStyle = e.strokeColor as string
      ctx.strokeText(ln, x, cy)
      clearShadow()
      ctx.fillStyle = e.color
      ctx.fillText(ln, x, cy) // พื้นทับกลางขอบ → ขอบเหลือครึ่งนอก
    } else {
      setShadow()
      ctx.fillStyle = e.color
      ctx.fillText(ln, x, cy)
      clearShadow()
    }
  })
}

// วัดความกว้างข้อความด้วย canvas (ในหน่วย px = มม. เพราะวัดที่สเกล 1:1)
// ใช้ฟอนต์/น้ำหนักเดียวกับที่ render จริง ไม่งั้น bbox/จุดกึ่งกลาง/snap ของข้อความจะเพี้ยน
let measureCtx: CanvasRenderingContext2D | null = null
export function measureText(text: string, size: number, font?: string, weight?: number): number {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
  if (!measureCtx) return Math.max(1, (text.length || 1) * size * 0.6)
  measureCtx.font = textFont({ size, font, weight })
  return Math.max(1, measureCtx.measureText(text || ' ').width)
}

// รอให้ฟอนต์ไทยโหลดครบก่อน rasterize ลง canvas — ถ้าฟอนต์ยังไม่มา canvas จะ fallback ไปฟอนต์ระบบ
// ทำให้ตัวอักษรไทยในไฟล์ที่ export เพี้ยน/เมตริกไม่ตรงกับที่เห็นบนจอ
export async function ensureThaiFont(): Promise<void> {
  const fonts = document.fonts
  if (!fonts?.load) return
  try {
    // ระบุตัวอย่างอักษรไทยเพื่อบังคับโหลด subset ที่มีสระ/วรรณยุกต์จริง — ทุกฟอนต์ที่ให้เลือก
    const jobs: Promise<unknown>[] = []
    for (const f of FONTS) {
      for (const w of ['400', '700']) jobs.push(fonts.load(`${w} 16px ${f.css}`, 'กขคง้๊'))
    }
    await Promise.all(jobs)
    await fonts.ready
  } catch {
    // โหลดฟอนต์ไม่ได้ (ออฟไลน์ครั้งแรก ฯลฯ) — ปล่อยให้ fallback ดีกว่าค้างการ export
  }
}

// อัปเดตความกว้างที่เก็บของ text element หลังแก้ข้อความ/ขนาด/ฟอนต์/น้ำหนัก
// = บรรทัดที่กว้างสุด (รองรับหลายบรรทัด)
export const withTextW = (e: TextEl): TextEl => ({
  ...e,
  w: Math.max(...e.text.split('\n').map((ln) => measureText(ln, e.size, e.font, e.weight))),
})

// --- โหลดไฟล์รูป ---
// เก็บลง localStorage รวมกับข้อมูลงาน จึงต้องคุมขนาดไม่ให้ชน quota (~5MB ทั้ง origin)
// แล้วทำให้ save ของทั้งแอปล้มเงียบ ๆ ไปด้วย — ไล่ย่อลงจนกว่าจะเข้าเกณฑ์
// เพดานสูงขึ้นเพื่อคุณภาพงานพิมพ์: โลโก้กว้าง 100 มม. ที่ 300 dpi ≈ 1180px จึงเริ่มที่ 1200
const MAX_BYTES = 700_000
const SIZES = [1200, 900, 640, 480]

export async function loadImageFile(file: File): Promise<{ src: string; aspect: number }> {
  // SVG = เวกเตอร์: เก็บเป็น data URL ตรง ๆ (คมทุกสเกล + ฝังลง .svg/.pdf ได้แบบเวกเตอร์)
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) return loadSVGFile(file)
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

// นำเข้าโลโก้แบบเวกเตอร์ (SVG): อ่าน viewBox หาสัดส่วน, ตั้ง width/height เป็นพิกเซล
// (สเกลด้านยาว ~1024) ให้ rasterize ลง canvas (3D/PDF) คมชัดแน่นอนทุก browser,
// แล้วเก็บเป็น data URL ใช้ร่วมกับระบบรูปเดิม (fit/ครอป/มาสก์/ล็อกสัดส่วน) ได้ทั้งหมด
async function loadSVGFile(file: File): Promise<{ src: string; aspect: number }> {
  const text = await file.text()
  // ตัด <script> ออกกันสคริปต์ฝัง (โหลดเป็น <image> ไม่รันอยู่แล้ว แต่กันไว้ชั้นหนึ่ง)
  const clean = text.replace(/<script[\s\S]*?<\/script>/gi, '')
  const doc = new DOMParser().parseFromString(clean, 'image/svg+xml')
  const root = doc.documentElement
  if (root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) {
    throw new Error('ไฟล์ SVG ไม่ถูกต้อง')
  }
  // หาขนาดต้นฉบับจาก viewBox ก่อน ไม่งั้นใช้ width/height (px)
  const vb = (root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number).filter((n) => !isNaN(n))
  const wAttr = parseFloat(root.getAttribute('width') || '')
  const hAttr = parseFloat(root.getAttribute('height') || '')
  let vw = vb.length === 4 && vb[2] > 0 ? vb[2] : wAttr
  let vh = vb.length === 4 && vb[3] > 0 ? vb[3] : hAttr
  if (!(vw > 0) || !(vh > 0)) {
    vw = 100
    vh = 100
  }
  const aspect = vw / vh
  // ตั้งขนาดพิกเซลให้ด้านยาว ~1024 เพื่อ raster คม (เก็บ viewBox ไว้ให้พิกัดตรง)
  const scale = 1024 / Math.max(vw, vh)
  root.setAttribute('width', String(Math.round(vw * scale)))
  root.setAttribute('height', String(Math.round(vh * scale)))
  if (vb.length !== 4) root.setAttribute('viewBox', `0 0 ${vw} ${vh}`)
  const out = new XMLSerializer().serializeToString(root)
  const src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(out)))
  if (src.length > MAX_BYTES * 3) throw new Error('ไฟล์ SVG ใหญ่เกินไป')
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
  const h = w / aspect
  const { x, y } = centerOnFace(dieline, w, h)
  return { id: newId(), type: 'image', src, aspect, w, h, x, y, rot: 0 }
}

// preserveAspectRatio (SVG) ตามโหมด fit
export const imgPAR = (fit?: string) =>
  fit === 'contain' ? 'xMidYMid meet' : fit === 'stretch' ? 'none' : 'xMidYMid slice'
export const maskId = (id: string) => `mask-${id}`
// clipPath (มุมโค้ง/วงรี) เป็นสตริงใส่ใน <defs> — พิกัดจริงบนแผ่น (userSpaceOnUse)
export function imageMaskSVG(e: ImageEl): string {
  let inner: string
  if (e.maskShape) {
    const cx = e.x + e.w / 2
    const cy = e.y + e.h / 2
    const pts = shapeVertices(e.maskShape, e.w, e.h, e.maskSides)
      .map((p) => `${cx + p.x},${cy + p.y}`)
      .join(' ')
    inner = `<polygon points="${pts}"/>`
  } else if (e.circle) {
    inner = `<ellipse cx="${e.x + e.w / 2}" cy="${e.y + e.h / 2}" rx="${e.w / 2}" ry="${e.h / 2}"/>`
  } else if (e.radius && e.radius > 0) {
    inner = `<rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" rx="${e.radius}" ry="${e.radius}"/>`
  } else return ''
  return `<clipPath id="${maskId(e.id)}">${inner}</clipPath>`
}

// วาดรูปลง canvas ตามกรอบ+โหมด fit+มาสก์ — ctx ถูก translate ไปกึ่งกลาง+หมุน+พลิกไว้แล้ว
export function drawImageFit(ctx: CanvasRenderingContext2D, img: CanvasImageSource, e: ImageEl, s: number) {
  const hw = (e.w / 2) * s
  const hh = (e.h / 2) * s
  ctx.save()
  // มาสก์
  if (e.maskShape) {
    ctx.beginPath()
    shapeVertices(e.maskShape, e.w, e.h, e.maskSides).forEach((p, i) =>
      i ? ctx.lineTo(p.x * s, p.y * s) : ctx.moveTo(p.x * s, p.y * s),
    )
    ctx.closePath()
    ctx.clip()
  } else if (e.circle) {
    ctx.beginPath()
    ctx.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2)
    ctx.clip()
  } else if (e.radius && e.radius > 0 && ctx.roundRect) {
    ctx.beginPath()
    ctx.roundRect(-hw, -hh, hw * 2, hh * 2, Math.min(e.radius * s, hw, hh))
    ctx.clip()
  }
  const fit = e.fit ?? 'cover'
  if (fit === 'stretch') {
    ctx.drawImage(img, -hw, -hh, hw * 2, hh * 2)
  } else {
    const frameAspect = e.w / e.h
    const wide = fit === 'cover' ? e.aspect > frameAspect : e.aspect < frameAspect
    const dw = wide ? hh * 2 * e.aspect : hw * 2
    const dh = wide ? hh * 2 : (hw * 2) / e.aspect
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh)
  }
  ctx.restore()
}

export function makeTextEl(dieline: Dieline, text: string): TextEl {
  const b = bbox(showFace(dieline).outline)
  const size = Math.max(6, Math.round((b.y1 - b.y0) * 0.12))
  const w = measureText(text, size)
  const { x, y } = centerOnFace(dieline, w, size * LINE)
  return { id: newId(), type: 'text', text, color: '#222222', size, w, x, y, rot: 0 }
}

// ชื่อที่โชว์ในแผงเลเยอร์ — ใช้ชื่อที่ตั้งเองก่อน ไม่งั้น fallback ตามชนิด
export function decoLabel(e: Deco): string {
  if (e.name && e.name.trim()) return e.name
  if (e.type === 'image') return 'รูป'
  if (e.type === 'text') return e.text || 'ข้อความ'
  const names: Record<ShapeKind, string> = {
    rect: 'สี่เหลี่ยม',
    ellipse: 'วงกลม',
    line: 'เส้น',
    triangle: 'สามเหลี่ยม',
    polygon: 'หลายเหลี่ยม',
    star: 'ดาว',
  }
  return names[e.shape] ?? 'รูปทรง'
}

export function makeShapeEl(dieline: Dieline, shape: ShapeKind): ShapeEl {
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
  // รูปหลายเหลี่ยม/ดาว/สามเหลี่ยม ใช้กรอบจัตุรัสให้ดูสมส่วน (regular)
  const h = isPolyShape(shape) ? w : Math.max(10, fh * 0.3)
  const { x, y } = centerOnFace(dieline, w, h)
  const base = { id: newId(), type: 'shape' as const, shape, w, h, fill: '#0f6e56', stroke: 'none', strokeW: 0, x, y, rot: 0 }
  return shape === 'star' ? { ...base, sides: 5 } : shape === 'polygon' ? { ...base, sides: 6 } : base
}

// จัดองค์ประกอบให้กลับไปกลางหน้าโชว์ (คงขนาด/มุมเดิม) — เผื่อลากหลุด
export function recenter(dieline: Dieline, e: Deco): Deco {
  const { x, y } = centerOnFace(dieline, elW(e), elH(e))
  return { ...e, x, y }
}

// ขอบเขต (bbox) ของหน้าโชว์ — ใช้เป็น "อาร์ตบอร์ด" อ้างอิงตอนจัดแนว
export function faceBounds(dieline: Dieline): { x0: number; x1: number; y0: number; y1: number } {
  return bbox(showFace(dieline).outline)
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'

// จัดแนวชิ้นเทียบขอบหน้าโชว์ (แบบ Illustrator "Align to Artboard") — คงขนาด/มุมเดิม
// อ้าง bbox ที่ยังไม่หมุน (x,y,w,h) เหมือน snap/recenter เพื่อให้ผลตรงกันทั้งระบบ
export function alignToFace(dieline: Dieline, e: Deco, mode: AlignMode): Deco {
  const b = faceBounds(dieline)
  const w = elW(e)
  const h = elH(e)
  let { x, y } = e
  if (mode === 'left') x = b.x0
  else if (mode === 'hcenter') x = (b.x0 + b.x1) / 2 - w / 2
  else if (mode === 'right') x = b.x1 - w
  else if (mode === 'top') y = b.y0
  else if (mode === 'vcenter') y = (b.y0 + b.y1) / 2 - h / 2
  else if (mode === 'bottom') y = b.y1 - h
  return { ...e, x, y }
}

// --- เลือกหลายชิ้น + จัดกลุ่ม ---

export const newGroupId = (): string => `g-${newId()}`

// ขยายชุด id ที่เลือกให้ครอบ "ทั้งกลุ่ม" ของแต่ละชิ้น (คงลำดับตาม decos)
export function expandGroups(decos: Deco[], ids: Iterable<string>): string[] {
  const picked = new Set(ids)
  const groups = new Set<string>()
  for (const d of decos) if (picked.has(d.id) && d.groupId) groups.add(d.groupId)
  return decos
    .filter((d) => picked.has(d.id) || (d.groupId !== undefined && groups.has(d.groupId)))
    .map((d) => d.id)
}

// กรอบรวม (bbox) ของชิ้นที่เลือก — null ถ้าไม่มี
export function selectionBounds(
  decos: Deco[],
  ids: Iterable<string>,
): { x0: number; x1: number; y0: number; y1: number } | null {
  const sel = new Set(ids)
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  let n = 0
  for (const e of decos) {
    if (!sel.has(e.id)) continue
    n++
    const w = elW(e)
    const h = elH(e)
    x0 = Math.min(x0, e.x)
    x1 = Math.max(x1, e.x + w)
    y0 = Math.min(y0, e.y)
    y1 = Math.max(y1, e.y + h)
  }
  return n ? { x0, x1, y0, y1 } : null
}

// จัดแนวชิ้นที่เลือกเทียบ "กรอบรวมของสิ่งที่เลือก" (Illustrator align-to-selection)
export function alignInSelection(decos: Deco[], ids: Iterable<string>, mode: AlignMode): Deco[] {
  const b = selectionBounds(decos, ids)
  if (!b) return decos
  const sel = new Set(ids)
  return decos.map((e) => {
    if (!sel.has(e.id)) return e
    const w = elW(e)
    const h = elH(e)
    let { x, y } = e
    if (mode === 'left') x = b.x0
    else if (mode === 'hcenter') x = (b.x0 + b.x1) / 2 - w / 2
    else if (mode === 'right') x = b.x1 - w
    else if (mode === 'top') y = b.y0
    else if (mode === 'vcenter') y = (b.y0 + b.y1) / 2 - h / 2
    else if (mode === 'bottom') y = b.y1 - h
    return { ...e, x, y }
  })
}

// ทำซ้ำเป็นแพตเทิร์นกริด (step & repeat) — คืนเฉพาะ "สำเนา" (ไม่รวมเซลล์ต้นฉบับ 0,0)
// สำเนาทั้งหมด (และควรรวมต้นฉบับ) ใช้ groupId เดียวกัน = เป็นกลุ่มเดียว ย้าย/ลบทั้งชุดได้
export interface StepRepeatOpt {
  cols: number
  rows: number
  dx: number // ระยะห่างแนวนอน (มม.)
  dy: number // ระยะห่างแนวตั้ง (มม.)
  brick?: boolean // สลับฟันปลา: แถวคี่เยื้อง dx/2
  groupId?: string // บังคับ groupId (ไม่ใส่ = สร้างใหม่)
}
export function stepRepeat(decos: Deco[], ids: Iterable<string>, opt: StepRepeatOpt): Deco[] {
  const sel = new Set(ids)
  const src = decos.filter((d) => sel.has(d.id))
  if (!src.length) return []
  const cols = Math.min(40, Math.max(1, Math.floor(opt.cols)))
  const rows = Math.min(40, Math.max(1, Math.floor(opt.rows)))
  const gid = opt.groupId ?? newGroupId()
  const copies: Deco[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === 0 && c === 0) continue // เซลล์ต้นฉบับ ไม่ทำซ้ำ
      const ox = c * opt.dx + (opt.brick && r % 2 === 1 ? opt.dx / 2 : 0)
      const oy = r * opt.dy
      for (const e of src) copies.push({ ...cloneDeco(e, ox, oy), groupId: gid })
      if (copies.length > 600) return copies // กันสร้างเยอะเกิน
    }
  }
  return copies
}

// กระจายให้กึ่งกลางห่างเท่ากันตามแกน (ต้องเลือก ≥ 3 ชิ้น) — ชิ้นหัว-ท้ายอยู่กับที่
export function distribute(decos: Deco[], ids: Iterable<string>, axis: 'h' | 'v'): Deco[] {
  const sel = new Set(ids)
  const chosen = decos.filter((d) => sel.has(d.id))
  if (chosen.length < 3) return decos
  const centerOf = (e: Deco) => (axis === 'h' ? e.x + elW(e) / 2 : e.y + elH(e) / 2)
  const sorted = [...chosen].sort((a, b) => centerOf(a) - centerOf(b))
  const first = centerOf(sorted[0])
  const step = (centerOf(sorted[sorted.length - 1]) - first) / (sorted.length - 1)
  const target = new Map<string, number>()
  sorted.forEach((e, i) => target.set(e.id, first + step * i))
  return decos.map((e) => {
    const c = target.get(e.id)
    if (c === undefined) return e
    return axis === 'h' ? { ...e, x: c - elW(e) / 2 } : { ...e, y: c - elH(e) / 2 }
  })
}

// สำเนาองค์ประกอบ (id ใหม่ เยื้องเล็กน้อยให้เห็นว่าเป็นชิ้นใหม่) — สำเนาแสดง+แก้ได้เสมอ
export function cloneDeco(e: Deco, dx = 5, dy = 5): Deco {
  return { ...e, id: newId(), x: e.x + dx, y: e.y + dy, hidden: false, locked: false }
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

// กรอบครอบทุกแผงจริง (พิกัดแผ่นคลี่ มม.) — พื้นที่ที่รูปพื้นต้องคลุม
export function panelsBBox(dieline: Dieline): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  for (const p of dieline.panels)
    for (const q of p.outline) {
      if (q.x < x0) x0 = q.x
      if (q.y < y0) y0 = q.y
      if (q.x > x1) x1 = q.x
      if (q.y > y1) y1 = q.y
    }
  if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: dieline.width, y1: dieline.height }
  return { x0, y0, x1, y1 }
}

// สี่เหลี่ยมที่จะวางรูปพื้นลงไป (พิกัดแผ่นคลี่ มม.) ตามโหมด fit + zoom + pan
// อัตราส่วน w/h = aspect เสมอ (ยกเว้น stretch) → วาดด้วย preserveAspectRatio="none"/drawImage
// ลงกรอบนี้ได้โดยรูปไม่บิด และผลตรงกันทั้ง canvas (3D/PDF) และ SVG export
export function fillImageRect(
  box: { x0: number; y0: number; x1: number; y1: number },
  fi: FillImage,
): { x: number; y: number; w: number; h: number } {
  const TW = box.x1 - box.x0
  const TH = box.y1 - box.y0
  const boxAspect = TW / TH
  const fit = fi.fit ?? 'cover'
  const zoom = fi.zoom ?? 1
  let w: number
  let h: number
  if (fit === 'stretch') {
    w = TW
    h = TH
  } else {
    // cover = ให้ด้านที่ล้นออก, contain = ให้ด้านที่พอดี
    const wide = fit === 'cover' ? fi.aspect > boxAspect : fi.aspect < boxAspect
    w = wide ? TH * fi.aspect : TW
    h = wide ? TH : TW / fi.aspect
  }
  w *= zoom
  h *= zoom
  const cx = box.x0 + TW / 2 + (fi.ox ?? 0) * (TW / 2)
  const cy = box.y0 + TH / 2 + (fi.oy ?? 0) * (TH / 2)
  return { x: cx - w / 2, y: cy - h / 2, w, h }
}

// เลเยอร์รูปพื้นสำหรับ SVG export — clipPath = ทุกแผงจริง, <image> วางตาม fillImageRect
export function fillImageSVGLayer(dieline: Dieline, fi: FillImage): string {
  const box = panelsBBox(dieline)
  const r = fillImageRect(box, fi)
  const clip = dieline.panels
    .map((p) => `<polygon points="${p.outline.map((q) => `${q.x},${q.y}`).join(' ')}"/>`)
    .join('')
  const href = xmlEsc(fi.src)
  // หมุนรอบจุดกึ่งกลางกรอบ (clip อยู่บน <g> ชั้นนอกจึงไม่หมุนตาม), ความทึบบนเลเยอร์
  const cx = (box.x0 + box.x1) / 2
  const cy = (box.y0 + box.y1) / 2
  const rot = fi.rot ? ` transform="rotate(${fi.rot} ${cx} ${cy})"` : ''
  const op = fi.opacity !== undefined && fi.opacity < 1 ? ` opacity="${fi.opacity}"` : ''
  return (
    `  <g id="fill" inkscape:groupmode="layer" inkscape:label="fill"${op}>\n` +
    `    <clipPath id="fillclip" clipPathUnits="userSpaceOnUse">${clip}</clipPath>\n` +
    `    <g clip-path="url(#fillclip)">\n` +
    `      <image${rot} x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"` +
    ` preserveAspectRatio="none" xlink:href="${href}" href="${href}"/>\n` +
    `    </g>\n` +
    `  </g>\n`
  )
}

// วาดรูปพื้นลง canvas (พิกัดแผ่นคลี่ × s) — clip ตามทุกแผงจริงแล้ววางตาม fillImageRect
// ใช้ทั้ง texture 3D และ raster ของ PDF; img ต้องโหลดเสร็จแล้ว
export function drawFillImage(
  ctx: CanvasRenderingContext2D,
  dieline: Dieline,
  img: CanvasImageSource,
  fi: FillImage,
  s: number,
) {
  const box = panelsBBox(dieline)
  const r = fillImageRect(box, fi)
  ctx.save()
  ctx.beginPath()
  for (const p of dieline.panels) {
    p.outline.forEach((q, i) => (i ? ctx.lineTo(q.x * s, q.y * s) : ctx.moveTo(q.x * s, q.y * s)))
    ctx.closePath()
  }
  ctx.clip() // clip อยู่ในพิกัดตอนนี้ ไม่หมุนตาม transform ที่ตามมา
  if (fi.opacity !== undefined && fi.opacity < 1) ctx.globalAlpha = fi.opacity
  if (fi.rot) {
    const cx = ((box.x0 + box.x1) / 2) * s
    const cy = ((box.y0 + box.y1) / 2) * s
    ctx.translate(cx, cy)
    ctx.rotate((fi.rot * Math.PI) / 180)
    ctx.translate(-cx, -cy)
  }
  ctx.drawImage(img, r.x * s, r.y * s, r.w * s, r.h * s)
  ctx.restore()
}

// id ของ gradient สำหรับ SVG defs
export const gradientId = (id: string) => `grad-${id}`

// เวกเตอร์เส้นไล่สีเชิงเส้นบน unit box (objectBoundingBox 0..1) จากมุมองศา
export function gradVec(angle: number): { x1: number; y1: number; x2: number; y2: number } {
  const r = (angle * Math.PI) / 180
  const cx = Math.cos(r) / 2
  const cy = Math.sin(r) / 2
  return { x1: 0.5 - cx, y1: 0.5 - cy, x2: 0.5 + cx, y2: 0.5 + cy }
}

// สตริง <linearGradient>/<radialGradient> สำหรับใส่ใน <defs> ของ SVG
export function gradientSVGString(e: ShapeEl): string {
  if (!e.grad) return ''
  const id = gradientId(e.id)
  const stops = `<stop offset="0" stop-color="${e.grad.from}"/><stop offset="1" stop-color="${e.grad.to}"/>`
  if (e.grad.radial) return `<radialGradient id="${id}">${stops}</radialGradient>`
  const v = gradVec(e.grad.angle)
  return `<linearGradient id="${id}" x1="${v.x1}" y1="${v.y1}" x2="${v.x2}" y2="${v.y2}">${stops}</linearGradient>`
}

// สร้าง CanvasGradient ในพิกัดท้องถิ่นของชิ้น (กึ่งกลาง = origin, ครึ่งกว้าง=hw ครึ่งสูง=hh)
export function shapeGradient(
  ctx: CanvasRenderingContext2D,
  e: ShapeEl,
  hw: number,
  hh: number,
): CanvasGradient | null {
  if (!e.grad) return null
  let g: CanvasGradient
  if (e.grad.radial) {
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(hw, hh))
  } else {
    const v = gradVec(e.grad.angle)
    const lx = (u: number) => (u - 0.5) * 2 * hw
    const ly = (u: number) => (u - 0.5) * 2 * hh
    g = ctx.createLinearGradient(lx(v.x1), ly(v.y1), lx(v.x2), ly(v.y2))
  }
  g.addColorStop(0, e.grad.from)
  g.addColorStop(1, e.grad.to)
  return g
}

// รูปทรงเป็น SVG element (พิกัดแผ่นคลี่ มม.) — ใช้ทั้ง blueprint (DielineSVG อ้าง shapeSVG ไม่ได้
// เพราะเป็น JSX แยก) และ export; rot = attribute transform ที่คำนวณไว้แล้ว
// ระยะเส้นประตามความหนาเส้น (มม.) — ให้จังหวะประสม่ำเสมอทุกขนาด
export const dashArray = (strokeW: number) => {
  const d = Math.max(1.5, strokeW * 2.5)
  return `${d} ${d * 0.7}`
}

export function shapeSVG(e: ShapeEl, rot: string): string {
  const dash = e.dash && e.strokeW > 0 ? ` stroke-dasharray="${dashArray(e.strokeW)}"` : ''
  const stroke =
    e.stroke !== 'none' && e.strokeW > 0 ? ` stroke="${e.stroke}" stroke-width="${e.strokeW}"${dash}` : ''
  if (e.shape === 'line') {
    const cy = e.y + e.h / 2
    return `<line x1="${e.x}" y1="${cy}" x2="${e.x + e.w}" y2="${cy}" stroke="${e.stroke}" stroke-width="${e.strokeW}" stroke-linecap="round"${dash}${rot}/>`
  }
  const defs = e.grad ? `<defs>${gradientSVGString(e)}</defs>` : ''
  const fill = e.grad ? `url(#${gradientId(e.id)})` : e.fill !== 'none' ? e.fill : 'none'
  let body: string
  if (isPolyShape(e.shape)) {
    const cx = e.x + e.w / 2
    const cy = e.y + e.h / 2
    const pts = shapeVertices(e.shape, e.w, e.h, e.sides)
      .map((p) => `${cx + p.x},${cy + p.y}`)
      .join(' ')
    body = `<polygon points="${pts}" fill="${fill}"${stroke} stroke-linejoin="round"${rot}/>`
  } else if (e.shape === 'ellipse') {
    body = `<ellipse cx="${e.x + e.w / 2}" cy="${e.y + e.h / 2}" rx="${e.w / 2}" ry="${e.h / 2}" fill="${fill}"${stroke}${rot}/>`
  } else {
    body = `<rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" fill="${fill}"${stroke}${rot}/>`
  }
  return defs + body
}

// วาดรูปทรงลง canvas 2D — ctx ถูก translate ไปจุดกึ่งกลางและหมุนไว้แล้ว (เรียกจาก drawDeco2D/Viewer3D)
export function drawShape2D(ctx: CanvasRenderingContext2D, e: ShapeEl, s: number) {
  const hw = (e.w / 2) * s
  const hh = (e.h / 2) * s
  if (e.shape === 'line') {
    ctx.strokeStyle = e.stroke
    ctx.lineWidth = Math.max(0.5, e.strokeW * s)
    ctx.lineCap = 'round'
    if (e.dash) ctx.setLineDash(dashArray(e.strokeW).split(' ').map((n) => Number(n) * s))
    ctx.beginPath()
    ctx.moveTo(-hw, 0)
    ctx.lineTo(hw, 0)
    ctx.stroke()
    ctx.setLineDash([])
    return
  }
  ctx.beginPath()
  if (isPolyShape(e.shape)) {
    const pts = shapeVertices(e.shape, e.w, e.h, e.sides)
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x * s, p.y * s) : ctx.moveTo(p.x * s, p.y * s)))
    ctx.closePath()
    ctx.lineJoin = 'round'
  } else if (e.shape === 'ellipse') ctx.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2)
  else ctx.rect(-hw, -hh, hw * 2, hh * 2)
  const grad = shapeGradient(ctx, e, hw, hh)
  if (grad || e.fill !== 'none') {
    ctx.fillStyle = grad ?? e.fill
    ctx.fill()
  }
  if (e.stroke !== 'none' && e.strokeW > 0) {
    ctx.strokeStyle = e.stroke
    ctx.lineWidth = e.strokeW * s
    if (e.dash) ctx.setLineDash(dashArray(e.strokeW).split(' ').map((n) => Number(n) * s))
    ctx.stroke()
    ctx.setLineDash([])
  }
}

// transform พลิก (สะท้อนรอบจุดกึ่งกลาง) สำหรับ SVG — ต่อท้าย rotate; ว่างถ้าไม่พลิก
export function flipTransform(e: Deco): string {
  if (!e.flipX && !e.flipY) return ''
  const c = elCenter(e)
  return ` translate(${c.x} ${c.y}) scale(${e.flipX ? -1 : 1} ${e.flipY ? -1 : 1}) translate(${-c.x} ${-c.y})`
}

// สร้างเลเยอร์ <g id="artwork"> สำหรับฝังใน SVG export — vector ล้วน คุณภาพงานพิมพ์
// รูปฝังเป็น data URI (ไฟล์ standalone), ข้อความเป็น <text> แก้ไขได้ใน Illustrator
// ไม่มิเรอร์ — SVG คือเลย์เอาต์ฝั่งพิมพ์/ด้านนอก เหมือนที่เห็นบน blueprint
export function svgArtworkLayer(decos: Deco[]): string {
  const visible = decos.filter((e) => !e.hidden)
  if (!visible.length) return ''
  const body = visible
    .map((e) => {
      const w = elW(e)
      const h = elH(e)
      const c = elCenter(e)
      const ft = flipTransform(e)
      const rot = e.rot || ft ? ` transform="rotate(${e.rot} ${c.x} ${c.y})${ft}"` : ''
      let el: string
      if (e.type === 'image') {
        const mask = imageMaskSVG(e)
        const clip = mask ? ` clip-path="url(#${maskId(e.id)})"` : ''
        el =
          (mask ? `<defs>${mask}</defs>` : '') +
          `<image href="${e.src}" x="${e.x}" y="${e.y}" width="${w}" height="${h}" preserveAspectRatio="${imgPAR(e.fit)}"${clip}${rot}/>`
      } else if (e.type === 'shape') {
        el = shapeSVG(e, rot)
      } else {
        const tspans = textLinesOf(e)
          .map((ln, i) => `<tspan x="${textAnchorX(e)}" y="${textLineY(e, i)}">${xmlEsc(ln)}</tspan>`)
          .join('')
        el = textShadowSVG(e) + `<text font-size="${e.size}" fill="${e.color}"${textFxAttrs(e)}` +
          ` text-anchor="${textAnchor(e)}" dominant-baseline="central" font-weight="${e.weight ?? 400}"` +
          ` font-family="${fontCss(e.font)}, sans-serif"${rot}>${tspans}</text>`
      }
      // ความทึบ: ครอบด้วย <g opacity> เมื่อ < 1
      return e.opacity !== undefined && e.opacity < 1 ? `    <g opacity="${e.opacity}">${el}</g>` : `    ${el}`
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
  if (e.opacity !== undefined && e.opacity < 1) ctx.globalAlpha = e.opacity
  ctx.translate((e.x + w / 2) * s, (e.y + h / 2) * s)
  ctx.rotate((e.rot * Math.PI) / 180)
  if (e.flipX || e.flipY) ctx.scale(e.flipX ? -1 : 1, e.flipY ? -1 : 1)
  if (e.type === 'image') {
    const img = imgOf(e.src)
    if (img) drawImageFit(ctx, img, e, s)
  } else if (e.type === 'shape') {
    drawShape2D(ctx, e, s)
  } else {
    drawText2D(ctx, e, s)
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
  base?: { dieline: Dieline; fillImage: FillImage } | null,
): Promise<HTMLCanvasElement | null> {
  const visible = decos.filter((d) => !d.hidden)
  // ไม่มีทั้งลายและรูปพื้น → ไม่ต้อง raster (สีพื้นทึบวาดเป็น vector ใน PDF เอง)
  if (!visible.length && !base) return null
  await ensureThaiFont() // ให้ตัวอักษรไทยที่ฝังลง PDF ตรงกับที่เห็นบนจอ
  const s = dpi / 25.4
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sheetW * s))
  canvas.height = Math.max(1, Math.round(sheetH * s))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const srcs = [...new Set(visible.filter((d) => d.type === 'image').map((d) => (d as { src: string }).src))]
  if (base) srcs.push(base.fillImage.src)
  const imgs = new Map<string, HTMLImageElement>()
  await Promise.all(
    [...new Set(srcs)].map(
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
  // รูปพื้นเป็นชั้นล่างสุด (ครอปตามแผงจริง) แล้วค่อยลายทับ
  if (base) {
    const img = imgs.get(base.fillImage.src)
    if (img) drawFillImage(ctx, base.dieline, img, base.fillImage, s)
  }
  for (const e of visible) drawDeco2D(ctx, e, s, (src) => imgs.get(src))
  return canvas
}

// --- persistence ---
function parseBase(
  o: Record<string, unknown>,
): { x: number; y: number; rot: number; hidden?: boolean; locked?: boolean } | null {
  const x = Number(o.x)
  const y = Number(o.y)
  const rot = Number(o.rot)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  // เก็บ flag เฉพาะเมื่อ true — กันบวม JSON และให้ round-trip เหมือนเดิมสำหรับชิ้นปกติ
  return {
    x,
    y,
    rot: Number.isFinite(rot) ? rot : 0,
    ...(o.hidden === true ? { hidden: true } : {}),
    ...(o.locked === true ? { locked: true } : {}),
    ...(typeof o.name === 'string' && o.name.trim() ? { name: o.name.slice(0, 40) } : {}),
    ...(typeof o.groupId === 'string' && o.groupId ? { groupId: o.groupId.slice(0, 40) } : {}),
    ...(o.flipX === true ? { flipX: true } : {}),
    ...(o.flipY === true ? { flipY: true } : {}),
    ...(Number.isFinite(Number(o.opacity)) && Number(o.opacity) < 1
      ? { opacity: Math.min(1, Math.max(0, Number(o.opacity))) }
      : {}),
  }
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
    const h = Number(o.h) > 0 ? Number(o.h) : w / aspect // ข้อมูลเก่าไม่มี h → สัดส่วนเดิม
    const fit = o.fit === 'contain' || o.fit === 'stretch' ? o.fit : undefined
    const radius = Number(o.radius) > 0 ? Number(o.radius) : undefined
    const preset = typeof o.preset === 'string' && o.preset ? o.preset.slice(0, 40) : undefined
    const presetColor =
      typeof o.presetColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.presetColor) ? o.presetColor : undefined
    const maskShape =
      o.maskShape === 'triangle' || o.maskShape === 'polygon' || o.maskShape === 'star' ? o.maskShape : undefined
    const maskSides = Number.isFinite(Number(o.maskSides))
      ? Math.max(3, Math.min(12, Math.round(Number(o.maskSides))))
      : undefined
    return {
      id, type: 'image', src, aspect, w, h,
      ...(fit ? { fit } : {}),
      ...(radius ? { radius } : {}),
      ...(o.circle === true ? { circle: true } : {}),
      ...(maskShape ? { maskShape } : {}),
      ...(maskShape && maskSides ? { maskSides } : {}),
      ...(preset ? { preset } : {}),
      ...(presetColor ? { presetColor } : {}),
      ...base,
    }
  }
  if (o.type === 'text') {
    const text = typeof o.text === 'string' ? o.text : ''
    const size = Number(o.size)
    const color = typeof o.color === 'string' ? o.color : '#222222'
    if (!(size > 0)) return null
    const font = FONTS.some((f) => f.id === o.font) ? (o.font as string) : undefined
    const weight = Number(o.weight) === 700 ? 700 : undefined
    const align = o.align === 'center' || o.align === 'right' ? o.align : undefined
    const lh = Number(o.lh) > 0 && Number(o.lh) !== LINE ? clampNum(Number(o.lh), 0.8, 3) : undefined
    const w =
      Number(o.w) > 0
        ? Number(o.w)
        : Math.max(...text.split('\n').map((ln) => measureText(ln, size, font, weight)))
    const strokeColor = typeof o.strokeColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.strokeColor) ? o.strokeColor : undefined
    const strokeW = strokeColor && Number(o.strokeW) > 0 ? clampNum(Number(o.strokeW), 0, 10) : undefined
    return {
      id,
      type: 'text',
      text,
      size,
      color,
      w,
      ...(font ? { font } : {}),
      ...(weight ? { weight } : {}),
      ...(align ? { align } : {}),
      ...(lh ? { lh } : {}),
      ...(strokeColor && strokeW ? { strokeColor, strokeW } : {}),
      ...(o.shadow === true ? { shadow: true } : {}),
      ...base,
    }
  }
  if (o.type === 'shape') {
    const KINDS: ShapeKind[] = ['rect', 'ellipse', 'line', 'triangle', 'polygon', 'star']
    const shape: ShapeKind = KINDS.includes(o.shape as ShapeKind) ? (o.shape as ShapeKind) : 'rect'
    const w = Number(o.w)
    const h = Number(o.h)
    if (!(w > 0) || !(h > 0)) return null
    const fill = typeof o.fill === 'string' ? o.fill : '#0f6e56'
    const stroke = typeof o.stroke === 'string' ? o.stroke : 'none'
    const strokeW = Number(o.strokeW) >= 0 ? Number(o.strokeW) : 0
    const gr = o.grad as Record<string, unknown> | undefined
    const grad =
      shape !== 'line' && gr && typeof gr.from === 'string' && typeof gr.to === 'string'
        ? {
            from: gr.from,
            to: gr.to,
            angle: Number.isFinite(Number(gr.angle)) ? Number(gr.angle) : 90,
            ...(gr.radial === true ? { radial: true } : {}),
          }
        : undefined
    const sides = Number.isFinite(Number(o.sides)) ? Math.max(3, Math.min(12, Math.round(Number(o.sides)))) : undefined
    return {
      id,
      type: 'shape',
      shape,
      w,
      h,
      fill,
      stroke,
      strokeW,
      ...(grad ? { grad } : {}),
      ...((shape === 'polygon' || shape === 'star') && sides ? { sides } : {}),
      ...(o.dash === true ? { dash: true } : {}),
      ...base,
    }
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

// ตรวจ/ซ่อมรูปพื้นแพ็กเกจจาก store/ไฟล์ — เก็บเฉพาะฟิลด์ที่ไม่ใช่ค่าเริ่มต้น (กัน JSON บวม)
export function parseFillImage(v: unknown): FillImage | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (typeof o.src !== 'string' || !o.src) return null
  const aspect = Number(o.aspect)
  if (!Number.isFinite(aspect) || aspect <= 0) return null
  const fit = o.fit === 'contain' || o.fit === 'stretch' ? o.fit : undefined
  const zoom = Number(o.zoom)
  const ox = Number(o.ox)
  const oy = Number(o.oy)
  const rot = Number(o.rot)
  const opacity = Number(o.opacity)
  return {
    src: o.src,
    aspect,
    ...(fit ? { fit } : {}),
    ...(Number.isFinite(zoom) && zoom !== 1 ? { zoom: clampNum(zoom, 1, 5) } : {}),
    ...(Number.isFinite(ox) && ox !== 0 ? { ox: clampNum(ox, -1, 1) } : {}),
    ...(Number.isFinite(oy) && oy !== 0 ? { oy: clampNum(oy, -1, 1) } : {}),
    ...(Number.isFinite(rot) && rot !== 0 ? { rot: clampNum(rot, -180, 180) } : {}),
    ...(Number.isFinite(opacity) && opacity < 1 ? { opacity: clampNum(opacity, 0, 1) } : {}),
  }
}

const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
