// เอฟเฟกต์ข้อความ (pure) — แปลง effect ที่ผู้ใช้เลือกเป็น "ชั้นที่ต้องวาด" ชุดเดียว
// ให้ blueprint / ไฟล์ SVG / canvas (3D, PDF, ไดคัทตามรูป, หมึกขาว) วาดตามรายการเดียวกัน ผลจึงตรงกันทุกทาง
// ระยะ/ความหนา/เบลอ เก็บเป็น % ของขนาดฟอนต์ → ย่อขยายตัวอักษรแล้วหน้าตา effect คงเดิม

export type TextFxKind = 'drop' | 'background' | 'hollow' | 'splice' | 'double' | 'echo' | 'glow' | 'long'

export interface TextFx {
  kind: TextFxKind
  // drop: สีเงา · background: สีกล่อง · splice: สีเงาทึบ · double: สีขอบใน · echo/glow/long: ไม่ใส่ = ตามสีตัวอักษร
  color?: string
  color2?: string // double: สีขอบนอก
  dist?: number // drop/splice/echo: ระยะเยื้อง · long: ความยาวเงา (% ขนาดฟอนต์)
  angle?: number // drop/splice/echo/long: ทิศเยื้อง องศา (0 = ขวา, 90 = ลง — แกน y ลงเหมือนแผ่นคลี่)
  blur?: number // drop/glow: ความฟุ้ง σ (% ขนาดฟอนต์)
  alpha?: number // drop/background/glow: ความทึบ 0–100
  width?: number // hollow/splice: ความหนาเส้น · double: ความหนาขอบใน (% ขนาดฟอนต์)
  width2?: number // double: ความหนาขอบนอก (% ขนาดฟอนต์)
  pad?: number // background: ระยะขอบกล่อง (% ขนาดฟอนต์)
  round?: number // background: ความมนมุม 0–100 (100 = ปลายโค้งครึ่งวง)
}

export const TEXT_FX_KINDS: { id: TextFxKind; nameTh: string; nameEn: string }[] = [
  { id: 'drop', nameTh: 'เงา', nameEn: 'Drop' },
  { id: 'background', nameTh: 'พื้นหลัง', nameEn: 'Background' },
  { id: 'hollow', nameTh: 'กลวง', nameEn: 'Hollow' },
  { id: 'splice', nameTh: 'ซ้อนเหลื่อม', nameEn: 'Splice' },
  { id: 'double', nameTh: 'ขอบสองชั้น', nameEn: 'Double outline' },
  { id: 'echo', nameTh: 'เงาซ้อน', nameEn: 'Echo' },
  { id: 'glow', nameTh: 'เรืองแสง', nameEn: 'Glow' },
  { id: 'long', nameTh: 'เงายาว 3D', nameEn: 'Long shadow' },
]

type Resolved = Required<TextFx>
const BASE: Omit<Resolved, 'kind'> = {
  color: '#000000',
  color2: '#222222',
  dist: 0,
  angle: 45,
  blur: 0,
  alpha: 100,
  width: 6,
  width2: 5,
  pad: 30,
  round: 40,
}
// ค่าเริ่มต้นต่อแบบ — drop ตรงกับเงาเดิม (shadow: true = เยื้อง 5%·√2 ที่ 45°, เบลอ 5%, ทึบ 40%)
export const TEXT_FX_DEFAULTS: Record<TextFxKind, Resolved> = {
  drop: { ...BASE, kind: 'drop', color: '#000000', dist: 7, angle: 45, blur: 5, alpha: 40 },
  background: { ...BASE, kind: 'background', color: '#ffd54a', alpha: 100, pad: 30, round: 40 },
  hollow: { ...BASE, kind: 'hollow', width: 6 },
  splice: { ...BASE, kind: 'splice', color: '#f2b8cc', width: 6, dist: 10, angle: 45 },
  double: { ...BASE, kind: 'double', color: '#ffffff', width: 8, color2: '#222222', width2: 5 },
  // สี '' = อัตโนมัติจากสีตัวอักษร (echo/glow = สีเดียวกัน, long = เข้มลง) — ดู textFxAutoColor
  echo: { ...BASE, kind: 'echo', color: '', dist: 8, angle: 45 },
  glow: { ...BASE, kind: 'glow', color: '', blur: 12, alpha: 80 },
  long: { ...BASE, kind: 'long', color: '', dist: 12, angle: 45 },
}

// echo: สำเนาจางลงตามระยะ (ไกลสุด → ใกล้สุด)
export const ECHO_ALPHAS = [0.2, 0.4, 0.6]
// long: จำนวนสำเนาเรียงต่อกันเป็นแท่งทึบ — ระยะห่างแต่ละชั้น ≈1% ขนาดฟอนต์ (ขั้นบันไดเล็กกว่าที่ตาเห็น/พิมพ์ออก)
export const LONG_MAX_COPIES = 60

// ช่วงค่าที่ UI/parse ยอมรับ (หน่วยตามคอมเมนต์ของ TextFx)
export const TEXT_FX_RANGE = {
  dist: [0, 50],
  angle: [-180, 180],
  blur: [0, 40],
  alpha: [0, 100],
  width: [1, 30],
  width2: [1, 30],
  pad: [0, 100],
  round: [0, 100],
} as const

// ช่วงที่ UI/parse/schema cloud ยอมรับของระยะห่างตัวอักษร TextEl.ls (% ขนาดฟอนต์)
export const LETTER_SPACING_RANGE = [-20, 100] as const

// เส้นบางกว่านี้หายตอนพิมพ์ (ไดคัท/ออฟเซ็ตส่วนใหญ่รับเส้นบวก ≥ 0.15 มม.)
export const MIN_PRINT_LINE_MM = 0.15

const HEX = /^#[0-9a-fA-F]{6}$/
const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.max(lo, Math.min(hi, v))

// ตรวจ/ทำความสะอาด fx จากข้อมูลที่เก็บ — เก็บเฉพาะคีย์ที่ถูกต้องและต่างจากค่าเริ่มต้นของแบบนั้น
export function parseTextFx(raw: unknown): TextFx | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const kind = TEXT_FX_KINDS.find((k) => k.id === o.kind)?.id
  if (!kind) return undefined
  const def = TEXT_FX_DEFAULTS[kind]
  const out: TextFx = { kind }
  for (const key of ['color', 'color2'] as const) {
    const v = o[key]
    if (typeof v === 'string' && HEX.test(v) && v.toLowerCase() !== def[key]) out[key] = v
  }
  for (const key of Object.keys(TEXT_FX_RANGE) as (keyof typeof TEXT_FX_RANGE)[]) {
    const v = Number(o[key])
    if (o[key] === undefined || !Number.isFinite(v)) continue
    const c = clamp(v, TEXT_FX_RANGE[key])
    if (c !== def[key]) out[key] = c
  }
  return out
}

// fx ที่ใช้จริง (เติมค่าเริ่มต้น) — งานเก่าที่มีแค่ shadow: true = เงาค่าเริ่มต้น
export function resolveTextFx(e: { fx?: TextFx; shadow?: boolean }): Resolved | null {
  if (e.fx) return { ...TEXT_FX_DEFAULTS[e.fx.kind], ...stripUndefined(e.fx) }
  if (e.shadow) return { ...TEXT_FX_DEFAULTS.drop }
  return null
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {}
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v
  return out
}

// การลงสีหนึ่งชุด: stroke = ความกว้างเต็มของเส้น (คร่อมขอบตัวอักษร) — วาด stroke ก่อน fill เสมอ
export interface TextPaint {
  fill?: string
  stroke?: string
  strokeW?: number // มม.
}
// ชั้นใต้ตัวอักษร: เยื้อง (dx, dy มม. ในพิกัดของข้อความเอง หมุนตามข้อความ) + เบลอ σ (มม.) + ความทึบ
export interface TextLayer extends TextPaint {
  dx: number
  dy: number
  blur?: number
  alpha?: number
}
export interface TextBoxFx {
  color: string
  alpha: number // 0..1
  pad: number // มม.
  round: number // 0..1 ของครึ่งด้านสั้น
}
export interface TextFxPlan {
  box: TextBoxFx | null // กล่องพื้นหลัง (วาดล่างสุด)
  under: TextLayer[] // วาดตามลำดับ ใต้ตัวอักษร
  main: TextPaint // ตัวอักษรจริง
}

// ตัวคูณความหนาขอบเดิม (strokeColor/strokeW): ขอบคร่อมเส้น ครึ่งถูก fill ทับ → ×2 ให้ "ส่วนที่เห็น" ≈ strokeW มม.
export const TEXT_STROKE_MUL = 2

// สีตัวอักษรเป็นไล่สี (TextEl.grad): ตัววาดแทนค่านี้ด้วย gradient ของข้อความ (ชั้นที่เบลอใช้สีแรกแทน
// เพราะเงา canvas รับได้แค่สีทึบ)
export const TEXT_GRAD_PAINT = '@grad'

export interface TextFxSource {
  size: number
  color: string
  grad?: { from: string }
  strokeColor?: string
  strokeW?: number
  fx?: TextFx
  shadow?: boolean
}

const pct = (size: number, v: number) => (size * v) / 100

// ผสมสีกับดำ (t = สัดส่วนดำ) — ค่าเริ่มต้นเงายาวให้เข้ากับสีตัวอักษร
export function darkenHex(hex: string, t = 0.45): string {
  if (!HEX.test(hex)) return '#333333'
  const n = parseInt(hex.slice(1), 16)
  const ch = (v: number) => Math.round(v * (1 - t)).toString(16).padStart(2, '0')
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`
}

// สีที่ใช้จริงเมื่อผู้ใช้ยังไม่ได้เลือกสีของเอฟเฟกต์ (fx.color = '') — UI ใช้โชว์ในช่องสี
export function textFxAutoColor(kind: TextFxKind, e: { color: string; grad?: { from: string } }): string {
  const solid = e.grad?.from ?? e.color
  return kind === 'long' ? darkenHex(solid) : solid
}
const line = (size: number, v: number) => Math.max(MIN_PRINT_LINE_MM, pct(size, v))

export function textFxPlan(e: TextFxSource): TextFxPlan {
  const fx = resolveTextFx(e)
  const userStroke: TextPaint =
    e.strokeColor && (e.strokeW ?? 0) > 0 ? { stroke: e.strokeColor, strokeW: (e.strokeW as number) * TEXT_STROKE_MUL } : {}
  const ink = e.grad ? TEXT_GRAD_PAINT : e.color // สีตัวอักษร (อาจเป็นไล่สี)
  const plain: TextPaint = { fill: ink, ...userStroke }
  if (!fx) return { box: null, under: [], main: plain }
  const rad = (fx.angle * Math.PI) / 180
  const off = pct(e.size, fx.dist)
  const dx = off * Math.cos(rad)
  const dy = off * Math.sin(rad)
  switch (fx.kind) {
    case 'drop':
      return {
        box: null,
        under: [
          {
            dx,
            dy,
            fill: fx.color,
            ...(userStroke.stroke ? { stroke: fx.color, strokeW: userStroke.strokeW } : {}),
            blur: pct(e.size, fx.blur),
            alpha: fx.alpha / 100,
          },
        ],
        main: plain,
      }
    case 'background':
      return {
        box: { color: fx.color, alpha: fx.alpha / 100, pad: pct(e.size, fx.pad), round: fx.round / 100 },
        under: [],
        main: plain,
      }
    case 'hollow':
      return { box: null, under: [], main: { stroke: ink, strokeW: line(e.size, fx.width) } }
    case 'splice':
      return {
        box: null,
        under: [{ dx, dy, fill: fx.color }],
        main: { stroke: ink, strokeW: line(e.size, fx.width) },
      }
    case 'double': {
      // ขอบในกว้าง w1 รอบตัวอักษร แล้วขอบนอก w2 รอบขอบใน — stroke คร่อมขอบ จึงกว้างเต็ม = 2×ระยะจากขอบตัวอักษร
      const w1 = line(e.size, fx.width)
      const w2 = line(e.size, fx.width2)
      return {
        box: null,
        under: [
          { dx: 0, dy: 0, stroke: fx.color2, strokeW: 2 * (w1 + w2) },
          { dx: 0, dy: 0, stroke: fx.color, strokeW: 2 * w1 },
        ],
        main: { fill: ink },
      }
    }
    case 'echo': {
      // สำเนาสีเดียวกับตัวอักษร (หรือสีที่เลือก) จางลงตามระยะ — วาดไกลสุดก่อน
      const c = fx.color || ink
      const n = ECHO_ALPHAS.length
      return {
        box: null,
        under: ECHO_ALPHAS.map((alpha, i) => {
          const k = n - i
          return { dx: dx * k, dy: dy * k, fill: c, ...(userStroke.stroke ? { stroke: c, strokeW: userStroke.strokeW } : {}), alpha }
        }),
        main: plain,
      }
    }
    case 'glow': {
      const c = fx.color || textFxAutoColor('glow', e)
      const blur = pct(e.size, fx.blur)
      return {
        box: null,
        under: [
          // แสงฟุ้งรอบตัวอักษร: เส้นหนาใต้ตัว (ดันแสงออกพ้นขอบ ไม่จมใต้ตัวอักษร) + เบลอ
          { dx: 0, dy: 0, fill: c, stroke: c, strokeW: Math.max(userStroke.strokeW ?? 0, blur * 0.6), blur, alpha: fx.alpha / 100 },
        ],
        main: plain,
      }
    }
    case 'long': {
      // แท่งทึบต่อเนื่อง: สำเนาถี่ ๆ ตามทิศ จากปลายเงา (ไกลสุด) เข้ามาหาตัวอักษร
      const c = fx.color || textFxAutoColor('long', e)
      const n = Math.max(1, Math.min(LONG_MAX_COPIES, Math.ceil(off / Math.max(0.05, e.size * 0.01))))
      const under: TextLayer[] = []
      for (let k = n; k >= 1 && off > 0; k--) {
        under.push({ dx: (dx * k) / n, dy: (dy * k) / n, fill: c, ...(userStroke.stroke ? { stroke: c, strokeW: userStroke.strokeW } : {}) })
      }
      return { box: null, under, main: plain }
    }
  }
}

// ระยะที่ effect ยื่นเลยกรอบตัวอักษร (มม.) — ใช้ขยายพื้นที่ filter/ตรวจขอบ
export function textFxReach(e: TextFxSource): number {
  const p = textFxPlan(e)
  let r = (p.main.strokeW ?? 0) / 2
  for (const l of p.under) r = Math.max(r, Math.hypot(l.dx, l.dy) + (l.strokeW ?? 0) / 2 + 3 * (l.blur ?? 0))
  if (p.box) r = Math.max(r, p.box.pad)
  return r
}

// สีอ่อนลงจากสีตัวอักษร (ผสมขาว) — ค่าเริ่มต้นของเงาทึบแบบ splice ให้เข้ากับสีข้อความ
export function lightenHex(hex: string, t = 0.6): string {
  if (!HEX.test(hex)) return TEXT_FX_DEFAULTS.splice.color
  const n = parseInt(hex.slice(1), 16)
  const ch = (v: number) => Math.round(v + (255 - v) * t).toString(16).padStart(2, '0')
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`
}
