// AI ออกแบบ "หน้าตา" (ลาย/ข้อความ/โลโก้) ลงบน template ที่มีอยู่ — ภาษาแผนงานศิลป์ (artwork plan)
//
// หลักเดียวกับภาษาแผง (structure/): AI เขียนแค่ "เจตนา" เป็น JSON ภายใต้ schema ที่บังคับ ไม่ได้วาดลงแผ่นคลี่เอง
// - พิกัดทุกชิ้นอ้าง "แผง" (panel id) + x,y เป็น มม. จากมุมซ้ายบนของกรอบแผงนั้น — โมเดลไม่ต้องรู้ผังแผ่นคลี่
// - ระบบ (compileArtworkPlan) แปลงเป็น Deco จริงบนพิกัดแผ่นคลี่ วัดความกว้างข้อความ ดันชิ้นให้อยู่ในแผง (เว้นขอบ safe)
//   ย่อชิ้นที่ใหญ่เกินแผง และไม่ให้พิมพ์ลงปีกทากาว — จึง "อยู่ในแผงโดยโครงสร้าง" ไม่ต้องให้ AI ไล่แก้พิกัด
// - รูปที่ AI ใช้ได้: ลายจากไลบรารี (preset:<id>:<#สี>), รูปที่ผู้ใช้อัปโหลด (asset:<id>) และ SVG ที่ AI วาดเอง (svg:<markup>)
//   ซึ่งผ่านตัวกรอง sanitizeSvg (allowlist แท็ก/แอตทริบิวต์ ไม่มี script/ลิงก์ภายนอก) ก่อนกลายเป็น data URL
// โมดูลนี้ pure (ไม่แตะ DOM) ใช้ได้ทั้ง server (ตรวจ/ประมาณความกว้าง) และ client (วัดด้วย canvas จริง)
import type { Dieline } from './types'
import type { Deco, FillImage, GradientDef, NutriRow, PathAnchor, ShapeKind, TextEl } from './artwork'
import { FONTS } from './artwork'
import { FINISHES, type FinishKind } from './finish'
import { presetById, presetDataUrl, PRESETS } from './presets'
import { TEXT_FX_KINDS, type TextFx, type TextFxKind } from './textFx'

export const ART_SAFE_MM = 3 // ระยะเว้นจากขอบแผง (เส้นพับ/เส้นตัด)
export const ART_MIN_TEXT_MM = 2.5 // ตัวอักษรเล็กสุดที่พิมพ์อ่านออก
export const ART_MAX_ELEMENTS = 80
export const ART_MAX_SVG_CHARS = 60_000 // ต่อรูป
export const ART_MAX_SVG_TOTAL = 400_000 // รวมทั้งแผน
export const ART_MAX_TEXT_CHARS = 600

const HEX = /^#[0-9a-fA-F]{6}$/
const SHAPE_KINDS: readonly ShapeKind[] = ['rect', 'ellipse', 'line', 'triangle', 'polygon', 'star']
const FONT_IDS = FONTS.map((f) => f.id)
const FINISH_IDS = FINISHES.map((f) => f.id)
const FX_KINDS = TEXT_FX_KINDS.map((k) => k.id)
export const PRESET_IDS = PRESETS.map((p) => p.id)

// ---------- แผงบนแผ่นคลี่ ----------

export interface PanelBox {
  id: string
  x0: number
  y0: number
  x1: number
  y1: number
  w: number
  h: number
  role: string // คำอธิบายให้โมเดล (ไทย)
  print: boolean // false = ปีกทากาว ห้ามพิมพ์
}

// บทบาทของแผงจาก id ที่ template ตั้ง (generator ไม่มี metadata บทบาท — เดาจากชื่อซึ่งเป็น convention เดียวกันทั้งโปรเจกต์)
export function panelRole(id: string): { role: string; print: boolean } {
  const k = id.toLowerCase()
  if (k === 'glue' || k.startsWith('glue')) return { role: 'ปีกทากาว (ห้ามพิมพ์ ระบบจะตัดชิ้นที่วางบนแผงนี้ทิ้ง)', print: false }
  if (k === 'front') return { role: 'ผนังหน้า = หน้าหลักของสินค้า (ชื่อแบรนด์ ชื่อสินค้า ภาพหลัก)', print: true }
  if (k === 'back') return { role: 'ผนังหลัง (ข้อมูลสินค้า ส่วนประกอบ ผู้ผลิต บาร์โค้ด)', print: true }
  if (k === 'side-left' || k === 'left') return { role: 'ผนังข้างซ้าย (ข้อมูลรอง/ตารางโภชนาการ)', print: true }
  if (k === 'side-right' || k === 'right') return { role: 'ผนังข้างขวา (จุดขาย/วิธีใช้)', print: true }
  if (k.startsWith('dust')) return { role: 'ลิ้นกันฝุ่น (ซ่อนตอนปิด ไม่ควรวางลายสำคัญ)', print: true }
  if (k.startsWith('tongue') || k === 'lip' || k.startsWith('lip-')) return { role: 'ลิ้นเสียบ (ซ่อนตอนปิด)', print: true }
  if (k.startsWith('tuck') || k.startsWith('lid') || k.startsWith('cap-') || k.startsWith('tip-') || k === 'door') return { role: 'ฝา (เห็นตอนปิด ใส่ชื่อแบรนด์/ลายเล็ก ๆ ได้)', print: true }
  if (k.startsWith('ear') || k.startsWith('spine') || k.startsWith('roll') || k.startsWith('fin') || k.includes('seam') || k.startsWith('grip')) return { role: 'หูมุม/สัน/ชั้นทบ/ครีบ (ซ่อนตอนประกอบ ไม่ควรวางลาย)', print: true }
  if (k.startsWith('flap')) return { role: 'ฝาปิดบน-ล่าง (ลังลูกฟูก เห็นตอนปิด)', print: true }
  if (k.startsWith('handle')) return { role: 'แผงหูหิ้ว (ตั้งขึ้น เห็นทั้งสองด้าน)', print: true }
  if (k.startsWith('gable')) return { role: 'หน้าจั่ว (เห็นตอนปิด)', print: true }
  if (k === 'base' || k === 'bottom' || k.startsWith('base-') || /^[bdls]-base$/.test(k)) return { role: 'ฐาน/ก้นกล่อง (ไม่ค่อยเห็น ใส่ข้อมูลผลิต/รีไซเคิลได้)', print: true }
  if (k === 'top') return { role: 'ด้านบน', print: true }
  if (k === 'card') return { role: 'นามบัตรด้านหน้า', print: true }
  if (k === 'card-back') return { role: 'นามบัตรด้านหลัง', print: true }
  if (k.startsWith('label')) return { role: 'ฉลาก (พันรอบภาชนะ: ซ้าย→ขวา = รอบตัว, ด้านหน้าอยู่กลาง)', print: true }
  if (k.startsWith('sticker')) return { role: 'หน้าสติกเกอร์', print: true }
  if (k === 'film') return { role: 'ฟิล์มทั้งผืน (ด้านหน้าอยู่กลาง ด้านหลังอยู่สองข้าง)', print: true }
  if (k.includes('gusset')) return { role: 'จีบข้างถุง (แคบ เห็นด้านข้าง)', print: true }
  if (/^[bdls]-(front|back|left|right)$/.test(k)) return { role: `${k.startsWith('l-') || k.startsWith('s-') ? 'ผนังฝา/ปลอก' : 'ผนังฐาน/ลิ้นชัก'} ${k.slice(2)}`, print: true }
  if (k.startsWith('s-glue') || /-glue$/.test(k)) return { role: 'ปีกทากาว (ห้ามพิมพ์ ระบบจะตัดชิ้นที่วางบนแผงนี้ทิ้ง)', print: false }
  if (/tab/.test(k)) return { role: 'ลิ้นมุม (ซ่อนตอนประกอบ)', print: true }
  return { role: `แผง ${id}`, print: true }
}

// กรอบของทุกแผง (bounding box ของ outline) — ชิ้นงานอ้างพิกัดจากมุมซ้ายบนของกรอบนี้
export function panelBoxes(d: Pick<Dieline, 'panels'>): PanelBox[] {
  const out: PanelBox[] = []
  for (const p of d.panels) {
    if (!p.outline.length) continue
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const q of p.outline) {
      x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y)
    }
    const r = panelRole(p.id)
    out.push({ id: p.id, x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, role: r.role, print: r.print })
  }
  return out
}

// ---------- แผนงานศิลป์ (สิ่งที่ AI เขียน) ----------

interface ArtBase {
  id?: string
  name?: string
  panel: string
  x: number // มม. จากมุมซ้ายบนของกรอบแผง
  y: number
  rot?: number
  opacity?: number
  finish?: FinishKind
}
export interface ArtText extends ArtBase {
  type: 'text'
  text: string
  size: number
  color: string
  anchor?: 'left' | 'center' | 'right' // x คือขอบซ้าย/กึ่งกลาง/ขอบขวาของข้อความ
  font?: string
  weight?: 400 | 700
  lh?: number
  strokeColor?: string
  strokeW?: number
  ls?: number
  grad?: GradientDef
  fx?: TextFx
  curve?: number
}
export interface ArtShape extends ArtBase {
  type: 'shape'
  shape: ShapeKind
  w: number
  h: number
  fill: string
  stroke: string
  strokeW: number
  grad?: GradientDef
  sides?: number
  dash?: boolean
}
export interface ArtImage extends ArtBase {
  type: 'image'
  src: string // preset:<id>:<#สี> | asset:<id> | svg:<markup>
  w: number
  h?: number
  fit?: 'cover' | 'contain' | 'stretch'
  radius?: number
  circle?: boolean
}
export interface ArtPath extends ArtBase {
  type: 'path'
  anchors: PathAnchor[]
  closed: boolean
  w: number
  h: number
  fill: string
  stroke: string
  strokeW: number
  grad?: GradientDef
  dash?: boolean
}
export interface ArtNutrition extends ArtBase {
  type: 'nutrition'
  w: number
  serving: string
  servings: string
  energy: string
  energyFat?: string
  rows: NutriRow[]
  vitamins: NutriRow[]
  footnote: string
  ink?: string
  paper?: boolean
  scale?: number
}
export type ArtElement = ArtText | ArtShape | ArtImage | ArtPath | ArtNutrition

export interface ArtworkPlan {
  name: string | null
  fillColor: string | null
  background: string | null // SVG ทั้งแผ่น (รูปพื้นแพ็กเกจ) — ผ่าน sanitizeSvg แล้ว
  elements: ArtElement[]
  explanation: string
}

export interface ArtIssue {
  severity: 'error' | 'warning'
  code: string
  index?: number // ลำดับ element ในแผน
  message: string
}

// ---------- JSON schema สำหรับ structured outputs ----------
// (ทุก object additionalProperties:false + required ครบ, ฟิลด์เลือกได้ = nullable; ห้าม keyword ที่ API ไม่รับ — ดู compile.test ของภาษาแผง)

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] })
const str = (description?: string) => ({ type: 'string', ...(description ? { description } : {}) })
const num = (description?: string) => ({ type: 'number', ...(description ? { description } : {}) })
const bool = (description?: string) => ({ type: 'boolean', ...(description ? { description } : {}) })
const en = (values: readonly string[], description?: string) => ({ type: 'string', enum: [...values], ...(description ? { description } : {}) })
const obj = (properties: Record<string, unknown>, description?: string) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
  ...(description ? { description } : {}),
})
const arr = (items: Record<string, unknown>, description?: string) => ({ type: 'array', items, ...(description ? { description } : {}) })

const gradSchema = obj({ from: str('#rrggbb'), to: str('#rrggbb'), angle: num('องศา 0 = ซ้าย→ขวา, 90 = บน→ล่าง'), radial: nullable(bool()) })
const fxSchema = obj({
  kind: en(FX_KINDS, 'drop เงา · background กล่องพื้นหลัง · hollow กลวง · splice ซ้อนเหลื่อม · double ขอบสองชั้น · echo · glow · long เงายาว'),
  color: nullable(str()), color2: nullable(str()), dist: nullable(num()), angle: nullable(num()), blur: nullable(num()),
  alpha: nullable(num('0-100')), width: nullable(num('% ขนาดฟอนต์')), width2: nullable(num()), pad: nullable(num()), round: nullable(num()),
})
const baseProps = {
  id: nullable(str('ตัวระบุสั้น a-z0-9- (ไม่ซ้ำ) ใช้อ้างตอนแก้ไข')),
  name: nullable(str('ชื่อชั้นในแผงเลเยอร์ (ไทย)')),
  panel: str('id ของแผงที่วาง (ต้องตรงกับรายการแผงที่ระบบให้)'),
  x: num('มม. จากขอบซ้ายของแผง'),
  y: num('มม. จากขอบบนของแผง'),
  rot: nullable(num('องศา ตามเข็ม (0 = ไม่หมุน)')),
  opacity: nullable(num('0-1')),
  finish: nullable(en(FINISH_IDS, 'งานพิมพ์พิเศษ (ฟอยล์/spot UV/ปั๊มนูน-จม) ใช้เฉพาะชิ้นเด่น')),
}
const textSchema = obj({
  type: en(['text']),
  ...baseProps,
  text: str('ข้อความ หลายบรรทัดด้วย \\n'),
  size: num(`ความสูงตัวอักษร มม. (อ่านออกตั้งแต่ ${ART_MIN_TEXT_MM})`),
  color: str('#rrggbb'),
  anchor: nullable(en(['left', 'center', 'right'], 'x เป็นขอบซ้าย/กึ่งกลาง/ขอบขวาของข้อความ (center สะดวกสำหรับจัดกลางแผง)')),
  font: nullable(en(FONT_IDS)),
  weight: nullable(en(['400', '700'])),
  lh: nullable(num('ตัวคูณระยะบรรทัด (ค่าเริ่มต้น 1.25)')),
  strokeColor: nullable(str()),
  strokeW: nullable(num('มม.')),
  ls: nullable(num('ระยะห่างตัวอักษร % ขนาดฟอนต์ (-20..100)')),
  grad: nullable(gradSchema),
  fx: nullable(fxSchema),
  curve: nullable(num('ดัดโค้ง องศา (+ โก่งขึ้น) — ห้ามใช้กับภาษาไทย')),
})
const shapeSchema = obj({
  type: en(['shape']),
  ...baseProps,
  shape: en(SHAPE_KINDS),
  w: num('มม.'), h: num('มม. (line = ความหนาเส้น)'),
  fill: str('#rrggbb หรือ none'), stroke: str('#rrggbb หรือ none'), strokeW: num('มม.'),
  grad: nullable(gradSchema), sides: nullable(num('polygon/star: จำนวนด้าน/แฉก 3-12')), dash: nullable(bool()),
})
const imageSchema = obj({
  type: en(['image']),
  ...baseProps,
  src: str('preset:<id>:<#rrggbb> ลายจากไลบรารี · asset:<id> รูปที่ลูกค้าอัปโหลด · svg:<markup> ภาพเวกเตอร์ที่คุณวาดเอง (มี viewBox)'),
  w: num('ความกว้าง มม.'), h: nullable(num('ความสูง มม. (ไม่ใส่ = ตามสัดส่วนรูป)')),
  fit: nullable(en(['cover', 'contain', 'stretch'])), radius: nullable(num('มุมโค้ง มม.')), circle: nullable(bool()),
})
const anchorSchema = obj({ nx: num('0-1'), ny: num('0-1'), ox: nullable(num()), oy: nullable(num()), ix: nullable(num()), iy: nullable(num()) })
const pathSchema = obj({
  type: en(['path']),
  ...baseProps,
  anchors: arr(anchorSchema, 'จุดยอด normalized 0..1 ในกรอบ w×h, ox/oy แขนเบซิเยร์ออก ix/iy แขนเข้า'),
  closed: bool(), w: num(), h: num(), fill: str(), stroke: str(), strokeW: num(), grad: nullable(gradSchema), dash: nullable(bool()),
})
const rowSchema = obj({ label: str(), value: str(), rdi: nullable(str('% Thai RDI ตัวเลขล้วน')), indent: nullable(bool()), bold: nullable(bool()) })
const nutritionSchema = obj({
  type: en(['nutrition']),
  ...baseProps,
  w: num('ความกว้างตาราง มม. (ความสูงคำนวณเอง ~1.2×w)'),
  serving: str('หนึ่งหน่วยบริโภค'), servings: str('จำนวนหน่วยบริโภคต่อภาชนะ'), energy: str('กิโลแคลอรี'), energyFat: nullable(str()),
  rows: arr(rowSchema), vitamins: arr(rowSchema), footnote: str(), ink: nullable(str()), paper: nullable(bool()), scale: nullable(num()),
})

export const ARTWORK_SCHEMA: Record<string, unknown> = obj({
  name: nullable(str('ชื่อแนวคิดงานออกแบบ (ไทย สั้น)')),
  fillColor: nullable(str('สีพื้นทั้งแพ็กเกจ #rrggbb (null = ไม่มี/ขาว)')),
  background: nullable(str('SVG รูปพื้นทั้งแผ่น (ยืดคลุมทุกแผง) เช่น ลายพื้นหลัง/ไล่สี — ใส่เฉพาะเมื่อจำเป็น')),
  elements: arr({ anyOf: [textSchema, shapeSchema, imageSchema, pathSchema, nutritionSchema] }, `ชิ้นงาน 1-${ART_MAX_ELEMENTS} ชิ้น เรียงจากชั้นล่างสุดขึ้นบน`),
  explanation: str('อธิบายแนวคิดให้ลูกค้า 1-3 ประโยค (ไทย) และสิ่งที่ลูกค้าต้องกรอกเอง'),
})

// ---------- parse (JSON จากโมเดล → ArtworkPlan ที่สะอาด) ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const finite = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const strOf = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined)
const color = (v: unknown): string | undefined => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : undefined)
const paint = (v: unknown): string | undefined => (v === 'none' ? 'none' : color(v))

function parseGrad(v: unknown): GradientDef | undefined {
  if (!isObj(v)) return undefined
  const from = color(v.from), to = color(v.to)
  if (!from || !to) return undefined
  return { from, to, angle: finite(v.angle) ?? 90, ...(v.radial === true ? { radial: true } : {}) }
}

function parseFx(v: unknown): TextFx | undefined {
  if (!isObj(v) || !FX_KINDS.includes(v.kind as TextFxKind)) return undefined
  const fx: TextFx = { kind: v.kind as TextFxKind }
  const c = color(v.color), c2 = color(v.color2)
  if (c) fx.color = c
  if (c2) fx.color2 = c2
  for (const k of ['dist', 'angle', 'blur', 'alpha', 'width', 'width2', 'pad', 'round'] as const) {
    const n = finite(v[k])
    if (n !== undefined) fx[k] = n
  }
  return fx
}

function parseRows(v: unknown): NutriRow[] {
  if (!Array.isArray(v)) return []
  return v.filter(isObj).slice(0, 30).map((r) => ({
    label: strOf(r.label, 60) ?? '',
    value: strOf(r.value, 30) ?? '',
    ...(strOf(r.rdi, 6) ? { rdi: strOf(r.rdi, 6) } : {}),
    ...(r.indent === true ? { indent: true } : {}),
    ...(r.bold === true ? { bold: true } : {}),
  }))
}

function parseBase(o: Record<string, unknown>, i: number, issues: ArtIssue[]): ArtBase | null {
  const panel = strOf(o.panel, 40)
  const x = finite(o.x), y = finite(o.y)
  if (!panel || x === undefined || y === undefined) {
    issues.push({ severity: 'error', code: 'element-invalid', index: i, message: `ชิ้นที่ ${i + 1}: ต้องมี panel, x, y` })
    return null
  }
  const id = strOf(o.id, 40)
  const name = strOf(o.name, 60)
  const rot = finite(o.rot)
  const opacity = finite(o.opacity)
  return {
    panel, x, y,
    ...(id ? { id: id.replace(/[^\w-]/g, '-') } : {}),
    ...(name ? { name } : {}),
    ...(rot ? { rot: ((rot % 360) + 360) % 360 } : {}),
    ...(opacity !== undefined && opacity < 1 ? { opacity: clamp(opacity, 0, 1) } : {}),
    ...(FINISH_IDS.includes(o.finish as FinishKind) ? { finish: o.finish as FinishKind } : {}),
  }
}

function parseElement(v: unknown, i: number, issues: ArtIssue[], svgBudget: { left: number }): ArtElement | null {
  if (!isObj(v)) {
    issues.push({ severity: 'error', code: 'element-invalid', index: i, message: `ชิ้นที่ ${i + 1} ไม่ใช่ object` })
    return null
  }
  const base = parseBase(v, i, issues)
  if (!base) return null
  const t = v.type
  if (t === 'text') {
    const text = strOf(v.text, ART_MAX_TEXT_CHARS)?.replace(/\r/g, '') ?? ''
    const size = finite(v.size)
    if (!text.trim() || size === undefined || size <= 0) {
      issues.push({ severity: 'error', code: 'text-invalid', index: i, message: `ชิ้นที่ ${i + 1} (text): ต้องมี text และ size > 0` })
      return null
    }
    const e: ArtText = { ...base, type: 'text', text, size: clamp(size, 1, 200), color: color(v.color) ?? '#222222' }
    if (v.anchor === 'center' || v.anchor === 'right') e.anchor = v.anchor
    if (FONT_IDS.includes(v.font as string)) e.font = v.font as string
    if (v.weight === 700 || v.weight === '700') e.weight = 700
    const lh = finite(v.lh)
    if (lh && lh > 0 && lh !== 1.25) e.lh = clamp(lh, 0.8, 3)
    const sc = color(v.strokeColor), sw = finite(v.strokeW)
    if (sc && sw && sw > 0) { e.strokeColor = sc; e.strokeW = clamp(sw, 0, 10) }
    const ls = finite(v.ls)
    if (ls) e.ls = clamp(ls, -20, 100)
    const grad = parseGrad(v.grad)
    if (grad) e.grad = grad
    const fx = parseFx(v.fx)
    if (fx) e.fx = fx
    const curve = finite(v.curve)
    if (curve && Math.abs(curve) >= 1) {
      // ข้อความโค้งกับสระบน/วรรณยุกต์ไทยวางทีละอักขระแล้วหลุดตำแหน่ง — ปิดให้ภาษาไทย (ข้อสังเกตจาก showcase)
      if (/[฀-๿]/.test(text)) issues.push({ severity: 'warning', code: 'curve-thai', index: i, message: `ชิ้นที่ ${i + 1}: ตัด curve ออกเพราะเป็นข้อความไทย` })
      else e.curve = clamp(curve, -300, 300)
    }
    return e
  }
  if (t === 'shape') {
    const w = finite(v.w), h = finite(v.h)
    if (!SHAPE_KINDS.includes(v.shape as ShapeKind) || w === undefined || h === undefined || w <= 0 || h <= 0) {
      issues.push({ severity: 'error', code: 'shape-invalid', index: i, message: `ชิ้นที่ ${i + 1} (shape): shape ต้องเป็น ${SHAPE_KINDS.join('/')} และ w,h > 0` })
      return null
    }
    const e: ArtShape = { ...base, type: 'shape', shape: v.shape as ShapeKind, w, h, fill: paint(v.fill) ?? '#2f8a99', stroke: paint(v.stroke) ?? 'none', strokeW: clamp(finite(v.strokeW) ?? 0, 0, 20) }
    const grad = parseGrad(v.grad)
    if (grad && e.shape !== 'line') e.grad = grad
    const sides = finite(v.sides)
    if (sides && (e.shape === 'polygon' || e.shape === 'star')) e.sides = clamp(Math.round(sides), 3, 12)
    if (v.dash === true) e.dash = true
    return e
  }
  if (t === 'image') {
    const src = typeof v.src === 'string' ? v.src : ''
    const w = finite(v.w)
    if (w === undefined || w <= 0 || !/^(preset:|asset:|svg:)/.test(src)) {
      issues.push({ severity: 'error', code: 'image-invalid', index: i, message: `ชิ้นที่ ${i + 1} (image): src ต้องขึ้นต้น preset:/asset:/svg: และ w > 0` })
      return null
    }
    let cleanSrc = src
    if (src.startsWith('svg:')) {
      const markup = src.slice(4)
      if (markup.length > ART_MAX_SVG_CHARS || markup.length > svgBudget.left) {
        issues.push({ severity: 'error', code: 'svg-too-large', index: i, message: `ชิ้นที่ ${i + 1}: SVG ยาวเกิน (จำกัด ${ART_MAX_SVG_CHARS} ตัวอักษรต่อรูป) — วาดให้เรียบง่ายลง` })
        return null
      }
      const clean = sanitizeSvg(markup)
      if (!clean) {
        issues.push({ severity: 'error', code: 'svg-invalid', index: i, message: `ชิ้นที่ ${i + 1}: SVG ไม่ถูกต้อง (ต้องเป็น <svg> มี viewBox ใช้แท็กพื้นฐาน path/rect/circle/text/gradient)` })
        return null
      }
      svgBudget.left -= clean.svg.length
      cleanSrc = 'svg:' + clean.svg
    } else if (src.startsWith('preset:')) {
      const [, id, c] = src.split(':')
      if (!presetById(id)) {
        issues.push({ severity: 'error', code: 'preset-unknown', index: i, message: `ชิ้นที่ ${i + 1}: ไม่มีลาย preset "${id}" (ใช้ได้: ${PRESET_IDS.join(', ')})` })
        return null
      }
      cleanSrc = `preset:${id}:${color(c) ?? '#2f8a99'}`
    } else {
      const id = src.slice(6).replace(/[^\w-]/g, '')
      if (!id) {
        issues.push({ severity: 'error', code: 'asset-invalid', index: i, message: `ชิ้นที่ ${i + 1}: asset id ว่าง` })
        return null
      }
      cleanSrc = `asset:${id}`
    }
    const e: ArtImage = { ...base, type: 'image', src: cleanSrc, w }
    const h = finite(v.h)
    if (h && h > 0) e.h = h
    if (v.fit === 'contain' || v.fit === 'stretch') e.fit = v.fit
    const radius = finite(v.radius)
    if (radius && radius > 0) e.radius = radius
    if (v.circle === true) e.circle = true
    return e
  }
  if (t === 'path') {
    const w = finite(v.w), h = finite(v.h)
    const anchors: PathAnchor[] = []
    if (Array.isArray(v.anchors)) {
      for (const a of v.anchors.slice(0, 200)) {
        if (!isObj(a)) continue
        const nx = finite(a.nx), ny = finite(a.ny)
        if (nx === undefined || ny === undefined) continue
        const ox = finite(a.ox), oy = finite(a.oy), ix = finite(a.ix), iy = finite(a.iy)
        anchors.push({ nx: clamp(nx, -0.5, 1.5), ny: clamp(ny, -0.5, 1.5), ...(ox !== undefined && oy !== undefined ? { ox, oy } : {}), ...(ix !== undefined && iy !== undefined ? { ix, iy } : {}) })
      }
    }
    if (w === undefined || h === undefined || w <= 0 || h <= 0 || anchors.length < 2) {
      issues.push({ severity: 'error', code: 'path-invalid', index: i, message: `ชิ้นที่ ${i + 1} (path): ต้องมี anchors ≥ 2 จุด และ w,h > 0` })
      return null
    }
    const e: ArtPath = { ...base, type: 'path', anchors, closed: v.closed === true, w, h, fill: paint(v.fill) ?? 'none', stroke: paint(v.stroke) ?? '#222222', strokeW: clamp(finite(v.strokeW) ?? 0.5, 0, 20) }
    const grad = parseGrad(v.grad)
    if (grad) e.grad = grad
    if (v.dash === true) e.dash = true
    return e
  }
  if (t === 'nutrition') {
    const w = finite(v.w)
    if (w === undefined || w <= 0) {
      issues.push({ severity: 'error', code: 'nutrition-invalid', index: i, message: `ชิ้นที่ ${i + 1} (nutrition): ต้องมี w > 0` })
      return null
    }
    const e: ArtNutrition = {
      ...base, type: 'nutrition', w,
      serving: strOf(v.serving, 60) ?? '', servings: strOf(v.servings, 30) ?? '', energy: strOf(v.energy, 20) ?? '',
      rows: parseRows(v.rows), vitamins: parseRows(v.vitamins), footnote: strOf(v.footnote, 300) ?? '',
    }
    const ef = strOf(v.energyFat, 20)
    if (ef) e.energyFat = ef
    const ink = color(v.ink)
    if (ink) e.ink = ink
    if (v.paper === false) e.paper = false
    const scale = finite(v.scale)
    if (scale && scale > 0 && scale !== 1) e.scale = clamp(scale, 0.5, 3)
    return e
  }
  issues.push({ severity: 'error', code: 'type-unknown', index: i, message: `ชิ้นที่ ${i + 1}: type "${String(t)}" ไม่รู้จัก (text/shape/image/path/nutrition)` })
  return null
}

export function parseArtworkPlan(raw: unknown): { ok: true; plan: ArtworkPlan; issues: ArtIssue[] } | { ok: false; issues: ArtIssue[] } {
  const issues: ArtIssue[] = []
  if (!isObj(raw)) return { ok: false, issues: [{ severity: 'error', code: 'not-object', message: 'คำตอบไม่ใช่ JSON object' }] }
  if (!Array.isArray(raw.elements) || raw.elements.length === 0) {
    return { ok: false, issues: [{ severity: 'error', code: 'no-elements', message: 'ต้องมี elements อย่างน้อย 1 ชิ้น' }] }
  }
  if (raw.elements.length > ART_MAX_ELEMENTS) {
    issues.push({ severity: 'warning', code: 'too-many', message: `ชิ้นงานเกิน ${ART_MAX_ELEMENTS} ชิ้น — ใช้ ${ART_MAX_ELEMENTS} ชิ้นแรก` })
  }
  const svgBudget = { left: ART_MAX_SVG_TOTAL }
  const elements: ArtElement[] = []
  const seen = new Set<string>()
  raw.elements.slice(0, ART_MAX_ELEMENTS).forEach((v, i) => {
    const e = parseElement(v, i, issues, svgBudget)
    if (!e) return
    if (e.id && seen.has(e.id)) delete e.id
    if (e.id) seen.add(e.id)
    elements.push(e)
  })
  if (!elements.length) return { ok: false, issues }
  let background: string | null = null
  if (typeof raw.background === 'string' && raw.background.trim()) {
    const clean = raw.background.length <= ART_MAX_SVG_CHARS ? sanitizeSvg(raw.background) : null
    if (clean) background = clean.svg
    else issues.push({ severity: 'warning', code: 'background-invalid', message: 'รูปพื้น SVG ไม่ถูกต้องหรือยาวเกิน — ไม่ใช้' })
  }
  const plan: ArtworkPlan = {
    name: strOf(raw.name, 80) ?? null,
    fillColor: color(raw.fillColor) ?? null,
    background,
    elements,
    explanation: strOf(raw.explanation, 1000) ?? '',
  }
  return { ok: true, plan, issues }
}

// ตรวจกับผังแผงจริง: แผงที่ไม่มี = error (ส่งกลับให้ AI แก้) — ที่เหลือ compile ซ่อมเองได้
export function checkArtworkPlan(plan: ArtworkPlan, panels: PanelBox[]): ArtIssue[] {
  const issues: ArtIssue[] = []
  const ids = new Set(panels.map((p) => p.id))
  plan.elements.forEach((e, i) => {
    if (!ids.has(e.panel)) {
      issues.push({ severity: 'error', code: 'panel-unknown', index: i, message: `ชิ้นที่ ${i + 1}: ไม่มีแผง "${e.panel}" (ใช้ได้: ${[...ids].join(', ')})` })
    }
  })
  return issues
}

export function describeArtIssues(issues: ArtIssue[]): string {
  return issues.map((i) => `- [${i.severity}] ${i.message}`).join('\n')
}

// ---------- ประมาณ/วัดขนาดข้อความ ----------

export type MeasureText = (text: string, size: number, font?: string, weight?: number) => number

const THAI_MARK = /[ัิ-ฺ็-๎]/
// ประมาณความกว้างบรรทัดเมื่อไม่มี canvas (server): ไทยฐาน ~0.58em, ละติน ~0.55em, ช่องว่าง 0.3em, สระบน/วรรณยุกต์ 0
export function estimateTextWidth(text: string, size: number, _font?: string, weight?: number): number {
  let w = 0
  for (const ch of text) {
    if (ch === ' ') w += 0.3
    else if (THAI_MARK.test(ch)) w += 0
    else if (/[฀-๿]/.test(ch)) w += 0.58
    else if (/[A-Z0-9]/.test(ch)) w += 0.62
    else if (/[a-z]/.test(ch)) w += 0.52
    else if (/[.,:;'!|]/.test(ch)) w += 0.28
    else w += 0.55
  }
  return Math.max(1, w * size * (weight === 700 ? 1.06 : 1))
}

export function textBlockSize(e: Pick<ArtText, 'text' | 'size' | 'font' | 'weight' | 'lh' | 'ls'>, measure: MeasureText): { w: number; h: number } {
  const lines = e.text.split('\n')
  const ls = e.ls ? 1 + e.ls / 100 : 1
  const w = Math.max(...lines.map((ln) => measure(ln, e.size, e.font, e.weight) * ls))
  return { w, h: lines.length * e.size * (e.lh ?? 1.25) }
}

// ตัดคำเป็นหน่วยสำหรับขึ้นบรรทัดใหม่: ไทยไม่มีช่องว่าง → ใช้ Intl.Segmenter (พจนานุกรม ICU) ถ้ามี ไม่งั้นตัดทีละอักขระ
type Segmenter = { segment(s: string): Iterable<{ segment: string }> }
let segmenter: Segmenter | null | undefined
function segments(line: string): string[] {
  if (segmenter === undefined) {
    const I = (globalThis as { Intl?: { Segmenter?: new (loc: string, o: { granularity: string }) => Segmenter } }).Intl
    segmenter = I?.Segmenter ? new I.Segmenter('th', { granularity: 'word' }) : null
  }
  if (!segmenter) return [...line]
  return [...segmenter.segment(line)].map((s) => s.segment)
}

// ขึ้นบรรทัดใหม่ให้แต่ละบรรทัดกว้างไม่เกิน maxW (บรรทัดที่ผู้เขียนขึ้นเองคงไว้) — ตัดที่ขอบคำ/ช่องว่าง
export function wrapText(text: string, maxW: number, measureLine: (line: string) => number): string {
  const out: string[] = []
  for (const para of text.split('\n')) {
    if (measureLine(para) <= maxW) {
      out.push(para)
      continue
    }
    let cur = ''
    for (const seg of segments(para)) {
      const next = cur + seg
      if (cur && measureLine(next.trimEnd()) > maxW) {
        out.push(cur.trimEnd())
        cur = seg.trimStart()
      } else cur = next
    }
    if (cur.trim()) out.push(cur.trimEnd())
  }
  return out.join('\n')
}

// จัดข้อความให้พอดีกรอบ: ตัดบรรทัดที่ขนาดเดิมก่อน ถ้าสูงเกินค่อยลดขนาด (ไม่ต่ำกว่า ART_MIN_TEXT_MM)
export function fitText(
  e: Pick<ArtText, 'text' | 'size' | 'font' | 'weight' | 'lh' | 'ls'>,
  maxW: number,
  maxH: number,
  measure: MeasureText,
): { text: string; size: number; w: number; h: number } {
  const ls = e.ls ? 1 + e.ls / 100 : 1
  let size = Math.max(ART_MIN_TEXT_MM, e.size)
  for (;;) {
    const line = (ln: string) => measure(ln, size, e.font, e.weight) * ls
    const text = wrapText(e.text, maxW, line)
    const dim = textBlockSize({ ...e, text, size }, measure)
    if ((dim.w <= maxW + 1e-6 && dim.h <= maxH + 1e-6) || size <= ART_MIN_TEXT_MM) return { text, size, ...dim }
    size = Math.max(ART_MIN_TEXT_MM, size * 0.9)
  }
}

// ---------- compile: แผน → Deco บนแผ่นคลี่ ----------

export interface ArtAsset {
  src: string // data URL
  aspect: number
}
export interface CompileArtworkOptions {
  measure?: MeasureText // client ส่ง measureText จริง (canvas); ไม่ส่ง = ประมาณ
  assets?: Record<string, ArtAsset> // asset id → รูปที่ผู้ใช้อัปโหลด
  idPrefix?: string
  safe?: number
}
export interface CompiledArtwork {
  decos: Deco[]
  fillColor: string | null
  fillImage: FillImage | null
  warnings: ArtIssue[]
}

export function compileArtworkPlan(plan: ArtworkPlan, panels: PanelBox[], opts: CompileArtworkOptions = {}): CompiledArtwork {
  const measure = opts.measure ?? estimateTextWidth
  const prefix = opts.idPrefix ?? `ai${Date.now().toString(36)}`
  const warnings: ArtIssue[] = []
  const byId = new Map(panels.map((p) => [p.id, p]))
  const decos: Deco[] = []
  const used = new Set<string>()

  plan.elements.forEach((e, i) => {
    const panel = byId.get(e.panel)
    if (!panel) {
      warnings.push({ severity: 'warning', code: 'panel-unknown', index: i, message: `ชิ้นที่ ${i + 1}: ไม่มีแผง "${e.panel}" — ตัดทิ้ง` })
      return
    }
    if (!panel.print) {
      warnings.push({ severity: 'warning', code: 'glue-panel', index: i, message: `ชิ้นที่ ${i + 1}: วางบนปีกทากาว "${panel.id}" — ตัดทิ้ง` })
      return
    }
    // ระยะเว้นขอบ: แผงเล็ก (ลิ้น) เว้นน้อยลง; แถบสี/เส้น (shape, path) ชนขอบแผงได้ (ลายพื้นถึงรอยพับเป็นเรื่องปกติ)
    const safe = e.type === 'shape' || e.type === 'path' ? 0 : Math.min(opts.safe ?? ART_SAFE_MM, Math.max(0.5, Math.min(panel.w, panel.h) / 6))
    const box = { x0: panel.x0 + safe, y0: panel.y0 + safe, x1: panel.x1 - safe, y1: panel.y1 - safe }
    const boxW = box.x1 - box.x0, boxH = box.y1 - box.y0

    let id = e.id ? `${prefix}-${e.id}` : `${prefix}-${i + 1}`
    while (used.has(id)) id += '_'
    used.add(id)
    const base = { id, rot: e.rot ?? 0, ...(e.name ? { name: e.name } : {}), ...(e.opacity !== undefined ? { opacity: e.opacity } : {}), ...(e.finish ? { finish: e.finish } : {}) }
    const fit = (w: number, h: number, left: number, top: number, shrink: (k: number) => void) => {
      // ย่อเมื่อใหญ่เกินกรอบ แล้วดันเข้ากรอบ
      const k = Math.min(1, boxW / w, boxH / h)
      if (k < 1) {
        shrink(k)
        w *= k
        h *= k
        warnings.push({ severity: 'warning', code: 'shrunk', index: i, message: `ชิ้นที่ ${i + 1}: ใหญ่เกินแผง "${panel.id}" — ย่อเหลือ ${Math.round(k * 100)}%` })
      }
      const x = clamp(left, box.x0, Math.max(box.x0, box.x1 - w))
      const y = clamp(top, box.y0, Math.max(box.y0, box.y1 - h))
      // เลื่อนเข้าแค่ระยะ safe (วางชิดขอบแผง) ไม่ถือเป็นเรื่องต้องเตือน
      if (Math.abs(x - left) > safe + 0.01 || Math.abs(y - top) > safe + 0.01) {
        warnings.push({ severity: 'warning', code: 'moved', index: i, message: `ชิ้นที่ ${i + 1}: ล้นแผง "${panel.id}" — เลื่อนเข้ากรอบ` })
      }
      return { x, y, w, h }
    }

    if (e.type === 'text') {
      if (e.size < ART_MIN_TEXT_MM) warnings.push({ severity: 'warning', code: 'text-min', index: i, message: `ชิ้นที่ ${i + 1}: ตัวอักษรเล็กกว่า ${ART_MIN_TEXT_MM} มม. — ขยายให้อ่านออก` })
      // ข้อความกว้าง/สูงเกินแผง → ตัดบรรทัดที่ขอบคำก่อน แล้วค่อยลดขนาด (ไม่ต่ำกว่าขั้นต่ำ)
      const fitted = fitText(e, boxW, boxH, measure)
      const size = fitted.size
      const dim = { w: fitted.w, h: fitted.h }
      if (fitted.text !== e.text || size < Math.max(ART_MIN_TEXT_MM, e.size) - 1e-9) {
        warnings.push({ severity: 'warning', code: 'text-shrunk', index: i, message: `ชิ้นที่ ${i + 1}: ข้อความเกินแผง "${panel.id}" — ${fitted.text !== e.text ? 'ตัดบรรทัดใหม่' : ''}${fitted.text !== e.text && size < e.size ? 'และ' : ''}${size < e.size ? `ลดขนาดเป็น ${size.toFixed(1)} มม.` : ''}` })
      }
      const anchor = e.anchor ?? 'left'
      const left = panel.x0 + e.x - (anchor === 'center' ? dim.w / 2 : anchor === 'right' ? dim.w : 0)
      const pos = fit(dim.w, dim.h, left, panel.y0 + e.y, () => {})
      const text: TextEl = {
        ...base, type: 'text', text: fitted.text, size, color: e.color, w: dim.w, x: pos.x, y: pos.y,
        ...(e.font ? { font: e.font } : {}),
        ...(e.weight === 700 ? { weight: 700 } : {}),
        ...(anchor !== 'left' ? { align: anchor } : {}),
        ...(e.lh ? { lh: e.lh } : {}),
        ...(e.strokeColor && e.strokeW ? { strokeColor: e.strokeColor, strokeW: e.strokeW } : {}),
        ...(e.ls ? { ls: e.ls } : {}),
        ...(e.grad ? { grad: e.grad } : {}),
        ...(e.fx ? { fx: e.fx } : {}),
        ...(e.curve ? { curve: e.curve } : {}),
      }
      decos.push(text)
      return
    }
    if (e.type === 'shape') {
      const pos = fit(e.w, e.h, panel.x0 + e.x, panel.y0 + e.y, () => {})
      decos.push({ ...base, type: 'shape', shape: e.shape, x: pos.x, y: pos.y, w: pos.w, h: pos.h, fill: e.fill, stroke: e.stroke, strokeW: e.strokeW, ...(e.grad ? { grad: e.grad } : {}), ...(e.sides ? { sides: e.sides } : {}), ...(e.dash ? { dash: true } : {}) })
      return
    }
    if (e.type === 'path') {
      const pos = fit(e.w, e.h, panel.x0 + e.x, panel.y0 + e.y, () => {})
      decos.push({ ...base, type: 'path', anchors: e.anchors, closed: e.closed, x: pos.x, y: pos.y, w: pos.w, h: pos.h, fill: e.fill, stroke: e.stroke, strokeW: e.strokeW, ...(e.grad ? { grad: e.grad } : {}), ...(e.dash ? { dash: true } : {}) })
      return
    }
    if (e.type === 'nutrition') {
      const h = e.w * 1.2 * (e.scale ?? 1)
      const pos = fit(e.w, h, panel.x0 + e.x, panel.y0 + e.y, () => {})
      decos.push({ ...base, type: 'nutrition', x: pos.x, y: pos.y, w: pos.w, serving: e.serving, servings: e.servings, energy: e.energy, ...(e.energyFat ? { energyFat: e.energyFat } : {}), rows: e.rows, vitamins: e.vitamins, footnote: e.footnote, ...(e.ink ? { ink: e.ink } : {}), ...(e.paper === false ? { paper: false } : {}), ...(e.scale ? { scale: e.scale } : {}) })
      return
    }
    // image
    const resolved = resolveImageSrc(e.src, opts.assets)
    if (!resolved) {
      warnings.push({ severity: 'warning', code: 'image-unresolved', index: i, message: `ชิ้นที่ ${i + 1}: หารูป "${e.src.slice(0, 40)}" ไม่พบ — ตัดทิ้ง` })
      return
    }
    const h = e.h ?? e.w / resolved.aspect
    const pos = fit(e.w, h, panel.x0 + e.x, panel.y0 + e.y, () => {})
    decos.push({
      ...base, type: 'image', src: resolved.src, aspect: resolved.aspect, x: pos.x, y: pos.y, w: pos.w, h: pos.h,
      ...(e.fit ? { fit: e.fit } : {}),
      ...(e.radius ? { radius: e.radius } : {}),
      ...(e.circle ? { circle: true } : {}),
      ...(resolved.preset ? { preset: resolved.preset, presetColor: resolved.presetColor } : {}),
    })
  })

  let fillImage: FillImage | null = null
  if (plan.background) {
    const clean = sanitizeSvg(plan.background)
    if (clean) fillImage = { src: presetDataUrl(clean.svg), aspect: clean.aspect, fit: 'stretch' }
  }
  return { decos, fillColor: plan.fillColor, fillImage, warnings }
}

export function resolveImageSrc(src: string, assets?: Record<string, ArtAsset>): { src: string; aspect: number; preset?: string; presetColor?: string } | null {
  if (src.startsWith('preset:')) {
    const [, id, c] = src.split(':')
    const p = presetById(id)
    if (!p) return null
    const presetColor = color(c) ?? '#2f8a99'
    return { src: presetDataUrl(p.svg(presetColor)), aspect: p.aspect, preset: id, presetColor }
  }
  if (src.startsWith('asset:')) {
    const a = assets?.[src.slice(6)]
    return a && a.aspect > 0 ? { src: a.src, aspect: a.aspect } : null
  }
  if (src.startsWith('svg:')) {
    const clean = sanitizeSvg(src.slice(4))
    return clean ? { src: presetDataUrl(clean.svg), aspect: clean.aspect } : null
  }
  return null
}

// ---------- ตัวกรอง SVG (allowlist) ----------
// SVG จากโมเดลคือ markup ที่ไม่น่าเชื่อถือ: เก็บเฉพาะแท็ก/แอตทริบิวต์วาดรูปพื้นฐาน ตัด script/style/ลิงก์/รูปภายนอก/
// event handler ทิ้ง และอ้างอิงได้เฉพาะ url(#id) ภายในไฟล์ — ผลลัพธ์กลายเป็น data URL ของ ImageEl เหมือน preset

const SVG_TAGS = new Set([
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan',
  'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'pattern', 'title', 'desc',
  'filter', 'fegaussianblur', 'feoffset', 'femerge', 'femergenode', 'feblend', 'fecolormatrix', 'feflood', 'fecomposite', 'fedropshadow',
])
const SVG_TEXT_TAGS = new Set(['text', 'tspan', 'title', 'desc'])
const SVG_ATTRS = new Set([
  'id', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'width', 'height', 'd', 'points', 'transform',
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-opacity', 'stroke-miterlimit', 'opacity', 'viewbox', 'xmlns', 'version', 'preserveaspectratio',
  'clip-path', 'clip-rule', 'mask', 'filter', 'gradientunits', 'gradienttransform', 'spreadmethod', 'offset', 'stop-color',
  'stop-opacity', 'patternunits', 'patterntransform', 'patterncontentunits', 'maskunits', 'maskcontentunits', 'clippathunits',
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing', 'dx', 'dy',
  'rotate', 'textlength', 'lengthadjust', 'stddeviation', 'in', 'in2', 'result', 'mode', 'type', 'values', 'flood-color',
  'flood-opacity', 'operator', 'k1', 'k2', 'k3', 'k4', 'color', 'display', 'visibility', 'overflow', 'vector-effect',
  'paint-order', 'shape-rendering', 'text-rendering', 'filterunits', 'primitiveunits',
])
// ชื่อแอตทริบิวต์ที่ต้องคงตัวพิมพ์ (SVG ไวต่อ case)
const SVG_ATTR_CASE: Record<string, string> = {
  viewbox: 'viewBox', preserveaspectratio: 'preserveAspectRatio', gradientunits: 'gradientUnits', gradienttransform: 'gradientTransform',
  spreadmethod: 'spreadMethod', patternunits: 'patternUnits', patterntransform: 'patternTransform', patterncontentunits: 'patternContentUnits',
  maskunits: 'maskUnits', maskcontentunits: 'maskContentUnits', clippathunits: 'clipPathUnits', textlength: 'textLength',
  lengthadjust: 'lengthAdjust', stddeviation: 'stdDeviation', filterunits: 'filterUnits', primitiveunits: 'primitiveUnits',
}
const SVG_TAG_CASE: Record<string, string> = {
  lineargradient: 'linearGradient', radialgradient: 'radialGradient', clippath: 'clipPath', fegaussianblur: 'feGaussianBlur',
  feoffset: 'feOffset', femerge: 'feMerge', femergenode: 'feMergeNode', feblend: 'feBlend', fecolormatrix: 'feColorMatrix',
  feflood: 'feFlood', fecomposite: 'feComposite', fedropshadow: 'feDropShadow',
}
const TAG_RE = /<\/?([A-Za-z][\w:.-]*)([^<>]*?)(\/?)>/g
const ATTR_RE = /([A-Za-z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g

function escapeText(s: string): string {
  return s.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function safeAttrValue(v: string): string | null {
  const s = v.replace(/[\u0000-\u001f]/g, '').trim()
  if (/javascript:|data:|<|expression\(/i.test(s)) return null
  if (/url\(/i.test(s) && !/^url\(['"]?#[\w-]+['"]?\)$/i.test(s)) return null
  return s.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;').replace(/"/g, '&quot;')
}

export function sanitizeSvg(markup: string): { svg: string; aspect: number } | null {
  if (typeof markup !== 'string' || markup.length > ART_MAX_SVG_CHARS) return null
  let src = markup.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[^>]*>/gi, '').trim()
  const start = src.indexOf('<svg')
  if (start < 0) return null
  src = src.slice(start)
  const out: string[] = []
  const stack: string[] = [] // แท็กที่เปิดอยู่ (เฉพาะที่เก็บไว้)
  let skipDepth = 0 // >0 = กำลังอยู่ในแท็กที่ตัดทิ้ง
  let pos = 0
  let rootSeen = false
  let viewBox: string | null = null
  let rootW: number | null = null
  let rootH: number | null = null
  TAG_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TAG_RE.exec(src))) {
    const text = src.slice(pos, m.index)
    pos = m.index + m[0].length
    if (text && skipDepth === 0 && stack.length && SVG_TEXT_TAGS.has(stack[stack.length - 1])) out.push(escapeText(text))
    const closing = m[0].startsWith('</')
    const name = m[1].toLowerCase()
    const selfClose = m[3] === '/'
    if (skipDepth > 0) {
      if (closing) skipDepth--
      else if (!selfClose) skipDepth++
      continue
    }
    if (closing) {
      // ปิดแท็กที่ไม่ตรงกับที่เปิดไว้ = markup พัง
      if (stack[stack.length - 1] !== name) return null
      stack.pop()
      out.push(`</${SVG_TAG_CASE[name] ?? name}>`)
      if (stack.length === 0) break // จบ root
      continue
    }
    if (!SVG_TAGS.has(name) || (name === 'svg' && rootSeen) || (!rootSeen && name !== 'svg')) {
      if (!selfClose) skipDepth = 1
      continue
    }
    const attrs: string[] = []
    ATTR_RE.lastIndex = 0
    let a: RegExpExecArray | null
    while ((a = ATTR_RE.exec(m[2]))) {
      const key = a[1].toLowerCase()
      if (!SVG_ATTRS.has(key)) continue
      const val = safeAttrValue(a[2] ?? a[3] ?? a[4] ?? '')
      if (val === null) continue
      if (name === 'svg') {
        if (key === 'viewbox') viewBox = val
        if (key === 'width') rootW = parseFloat(val)
        if (key === 'height') rootH = parseFloat(val)
        if (key === 'xmlns' || key === 'width' || key === 'height' || key === 'viewbox') continue
      }
      attrs.push(`${SVG_ATTR_CASE[key] ?? key}="${val}"`)
    }
    if (name === 'svg') {
      rootSeen = true
      let vb: string | null = viewBox && /^-?[\d.]+(\s+|,)-?[\d.]+(\s+|,)[\d.]+(\s+|,)[\d.]+$/.test(viewBox.trim()) ? viewBox.trim().replace(/,/g, ' ') : null
      if (!vb && rootW && rootH && rootW > 0 && rootH > 0) vb = `0 0 ${rootW} ${rootH}`
      if (!vb) vb = '0 0 100 100'
      const [, , vw, vh] = vb.split(/\s+/).map(Number)
      if (!(vw > 0) || !(vh > 0)) return null
      const s = 512 / Math.max(vw, vh)
      attrs.unshift(`xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${Math.round(vw * s)}" height="${Math.round(vh * s)}"`)
      viewBox = vb
    }
    out.push(`<${SVG_TAG_CASE[name] ?? name}${attrs.length ? ' ' + attrs.join(' ') : ''}${selfClose ? '/' : ''}>`)
    if (!selfClose) stack.push(name)
  }
  if (!rootSeen || stack.length) return null
  const svg = out.join('')
  if (!/<(path|rect|circle|ellipse|line|polyline|polygon|text)\b/.test(svg)) return null // รูปว่าง
  const [, , vw, vh] = (viewBox as string).split(/\s+/).map(Number)
  return { svg, aspect: vw / vh }
}
