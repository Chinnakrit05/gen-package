import type { Vec2 } from './types'
import type { StickerSheetId } from './stickerSheet'

// ไดคัทตามรูป (contour cut) ของสติกเกอร์ — แทนขั้นตอนเตรียมไฟล์ใน Illustrator ที่โรงพิมพ์สติกเกอร์สอน
// (ทำเงาดำของชิ้นงาน → Image Trace → Offset Path ≥1 มม. แบบ Round → ลบจุดเกิน/เกลี่ยเส้นให้เรียบ)
// ทั้งหมดเป็นฟังก์ชัน pure บน mask พิกเซล (ไม่แตะ DOM) จึงทดสอบเชิงตัวเลขได้
//
// ขั้นตอน: alpha ของลาย → mask → อุดรู (ตัดเฉพาะขอบนอก) → ขยาย/หดตามระยะขอบ → ลบมุม (closing+opening)
// → เส้นขอบแบบ sub-pixel ด้วย marching squares บน signed distance → ลดจุด (Douglas–Peucker)

// ข้อจำกัดการผลิตสติกเกอร์ไดคัท (อิงเงื่อนไขโรงพิมพ์สติกเกอร์ทั่วไป เช่น Lalapix) — หน่วย มม.
export const STICKER_RULES = {
  minBorder: 1, // มีขอบขาว: เส้นตัดห่างชิ้นงานอย่างน้อย
  minBleed: 1, // ไม่มีขอบขาว: สีต้องเลยเส้นตัดออกไปอย่างน้อย
  minGap: 2, // ระยะระหว่างเส้นตัดกับเส้นตัด
  minHole: 2, // ช่องเจาะไดคัทเล็กสุด
  minRadius: 0.5, // รัศมีโค้งเล็กสุดของเส้นตัด (ต่ำกว่านี้ = หักศอก ตัดไม่สวย)
} as const

export type StickerShape = 'rect' | 'contour'
export type StickerBorder = 'white' | 'none'
export interface StickerCut {
  shape: StickerShape
  border: StickerBorder // contour เท่านั้น: มีขอบขาว (ตัดนอกชิ้นงาน) / ไม่มีขอบขาว (ตัดชิดชิ้นงาน)
  offset: number // มม. — ความกว้างขอบขาว (border='white')
  sheet?: StickerSheetId // แผ่นสติกเกอร์หลายดวง (A6/A5/A4) — ไม่ใส่ = ดวงเดียว
}
export const DEFAULT_STICKER_CUT: StickerCut = { shape: 'rect', border: 'white', offset: 2 }
export const STICKER_OFFSET_MIN = STICKER_RULES.minBorder
export const STICKER_OFFSET_MAX = 8
// ไม่มีขอบขาว: ตัดเข้าในเนื้อชิ้นงานเท่าระยะเผื่อสี → สีเลยเส้นตัดออกไปพอดีเงื่อนไข โดยไม่ต้องขยายภาพเอง
export const NO_BORDER_INSET = STICKER_RULES.minBleed
// ลบมุมเว้า/มุมแหลมของเส้นตัดด้วยรัศมีนี้ (มากกว่า minRadius เผื่อความคลาดเคลื่อนจากพิกเซล)
export const CORNER_ROUND = 1.2

export const sameStickerCut = (a?: StickerCut, b?: StickerCut) =>
  (a ?? DEFAULT_STICKER_CUT).shape === (b ?? DEFAULT_STICKER_CUT).shape &&
  (a ?? DEFAULT_STICKER_CUT).border === (b ?? DEFAULT_STICKER_CUT).border &&
  (a ?? DEFAULT_STICKER_CUT).offset === (b ?? DEFAULT_STICKER_CUT).offset &&
  (a ?? DEFAULT_STICKER_CUT).sheet === (b ?? DEFAULT_STICKER_CUT).sheet

// ค่าที่ต้องเก็บลงงาน (ค่าเริ่มต้น = ไม่เก็บ)
export const storedStickerCut = (c: StickerCut) => (sameStickerCut(c, DEFAULT_STICKER_CUT) ? undefined : c)

export function parseStickerCut(raw: unknown): StickerCut | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const o = raw as Record<string, unknown>
  const sheet = o.sheet === 'a6' || o.sheet === 'a5' || o.sheet === 'a4' ? o.sheet : undefined
  if (o.shape !== 'contour' && !sheet) return undefined // ค่าเริ่มต้น (สี่เหลี่ยม ดวงเดียว) ไม่ต้องเก็บ
  const off = Number(o.offset)
  return {
    shape: o.shape === 'contour' ? 'contour' : 'rect',
    border: o.border === 'none' ? 'none' : 'white',
    offset: Number.isFinite(off)
      ? Math.min(STICKER_OFFSET_MAX, Math.max(STICKER_OFFSET_MIN, Math.round(off * 2) / 2))
      : DEFAULT_STICKER_CUT.offset,
    ...(sheet ? { sheet } : {}),
  }
}

// --- distance transform (Felzenszwalb–Huttenlocher, ระยะยุคลิดแม่นยำ) ---
const INF = 1e20

function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0
  v[0] = 0
  z[0] = -INF
  z[1] = INF
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = INF
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]
  }
}

// ระยะ (พิกเซล) จากทุกพิกเซลไปหาพิกเซล "ติด" (mask=1) ที่ใกล้สุด — พิกเซลที่ติดเองได้ 0
export function distanceTo(mask: Uint8Array, w: number, h: number): Float32Array {
  const n = Math.max(w, h)
  const f = new Float64Array(n)
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  const grid = new Float64Array(w * h)
  for (let i = 0; i < w * h; i++) grid[i] = mask[i] ? 0 : INF
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x]
    edt1d(f, h, d, v, z)
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y]
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x]
    edt1d(f, w, d, v, z)
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x]
  }
  const out = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) out[i] = Math.sqrt(grid[i])
  return out
}

const invert = (m: Uint8Array) => m.map((b) => (b ? 0 : 1))
const dilate = (m: Uint8Array, w: number, h: number, r: number) => {
  const dt = distanceTo(m, w, h)
  return Uint8Array.from(dt, (x) => (x <= r ? 1 : 0))
}
const erode = (m: Uint8Array, w: number, h: number, r: number) => invert(dilate(invert(m), w, h, r))

// เบลอเกาส์เซียนแบบแยกแกน (mask 0/1 → ค่า 0..1)
export function gaussianBlur(m: Uint8Array, w: number, h: number, sigma: number): Float32Array {
  const r = Math.ceil(sigma * 3)
  const k = new Float32Array(2 * r + 1)
  let sum = 0
  for (let i = -r; i <= r; i++) sum += k[i + r] = Math.exp((-i * i) / (2 * sigma * sigma))
  for (let i = 0; i < k.length; i++) k[i] /= sum
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0
      for (let i = -r; i <= r; i++) {
        const xx = x + i
        if (xx >= 0 && xx < w) a += m[y * w + xx] * k[i + r]
      }
      tmp[y * w + x] = a
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0
      for (let i = -r; i <= r; i++) {
        const yy = y + i
        if (yy >= 0 && yy < h) a += tmp[yy * w + x] * k[i + r]
      }
      out[y * w + x] = a
    }
  }
  return out
}

// อุดรูภายใน: พื้นหลังที่ไม่ต่อกับขอบภาพ = รูในชิ้นงาน → เติมเป็นเนื้อ (สติกเกอร์ตัดเฉพาะขอบนอก)
export function fillHoles(m: Uint8Array, w: number, h: number): Uint8Array {
  const out = Uint8Array.from(m)
  const seen = new Uint8Array(w * h)
  const stack: number[] = []
  const push = (i: number) => {
    if (!seen[i] && !m[i]) {
      seen[i] = 1
      stack.push(i)
    }
  }
  for (let x = 0; x < w; x++) {
    push(x)
    push((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    push(y * w)
    push(y * w + w - 1)
  }
  while (stack.length) {
    const i = stack.pop()!
    const x = i % w
    const y = (i - x) / w
    if (x > 0) push(i - 1)
    if (x < w - 1) push(i + 1)
    if (y > 0) push(i - w)
    if (y < h - 1) push(i + w)
  }
  for (let i = 0; i < w * h; i++) if (!m[i] && !seen[i]) out[i] = 1
  return out
}

// --- marching squares บนสนามค่า (sub-pixel ด้วย interpolate เชิงเส้น) ---
// คืน loop ปิดในพิกัดพิกเซล (กลางพิกเซล = จุดกริด) บริเวณ field > level ถือเป็นด้านใน
export function marchingSquares(field: Float32Array, w: number, h: number, level = 0): Vec2[][] {
  const val = (x: number, y: number) =>
    x < 0 || y < 0 || x >= w || y >= h ? -INF : field[y * w + x] - level
  // จุดตัดบนขอบของเซลล์ — key ไม่ขึ้นกับทิศ เพื่อเชื่อมท่อนจากเซลล์ข้างเคียง
  const edgePt = (x0: number, y0: number, x1: number, y1: number): [string, Vec2] => {
    const a = val(x0, y0)
    const b = val(x1, y1)
    const fa = a <= -INF / 2 ? -1 : a
    const fb = b <= -INF / 2 ? -1 : b
    const t = fa === fb ? 0.5 : Math.min(1, Math.max(0, fa / (fa - fb)))
    const key = x0 < x1 || y0 < y1 ? `${x0},${y0},${x1},${y1}` : `${x1},${y1},${x0},${y0}`
    return [key, { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t }]
  }
  const next = new Map<string, string>()
  const pts = new Map<string, Vec2>()
  const seg = (a: [string, Vec2], b: [string, Vec2]) => {
    pts.set(a[0], a[1])
    pts.set(b[0], b[1])
    next.set(a[0], b[0])
  }
  for (let y = -1; y < h; y++) {
    for (let x = -1; x < w; x++) {
      // มุมเซลล์: tl(x,y) tr(x+1,y) br(x+1,y+1) bl(x,y+1)
      const tl = val(x, y) > 0 ? 1 : 0
      const tr = val(x + 1, y) > 0 ? 1 : 0
      const br = val(x + 1, y + 1) > 0 ? 1 : 0
      const bl = val(x, y + 1) > 0 ? 1 : 0
      const c = tl * 8 + tr * 4 + br * 2 + bl
      if (c === 0 || c === 15) continue
      const T = () => edgePt(x, y, x + 1, y)
      const R = () => edgePt(x + 1, y, x + 1, y + 1)
      const B = () => edgePt(x, y + 1, x + 1, y + 1)
      const L = () => edgePt(x, y, x, y + 1)
      // ทิศของท่อน: เดินให้ด้านในอยู่ทางขวามือ (loop ทิศเดียวกันทั้งหมด → เชื่อมกันได้)
      switch (c) {
        case 1: seg(B(), L()); break
        case 2: seg(R(), B()); break
        case 3: seg(R(), L()); break
        case 4: seg(T(), R()); break
        case 5: seg(T(), L()); seg(B(), R()); break // อานม้า: แยกสองท่อน
        case 6: seg(T(), B()); break
        case 7: seg(T(), L()); break
        case 8: seg(L(), T()); break
        case 9: seg(B(), T()); break
        case 10: seg(L(), B()); seg(R(), T()); break
        case 11: seg(R(), T()); break
        case 12: seg(L(), R()); break
        case 13: seg(B(), R()); break
        case 14: seg(L(), B()); break
      }
    }
  }
  const loops: Vec2[][] = []
  const used = new Set<string>()
  for (const start of next.keys()) {
    if (used.has(start)) continue
    const loop: Vec2[] = []
    let k: string | undefined = start
    while (k !== undefined && !used.has(k)) {
      used.add(k)
      loop.push(pts.get(k)!)
      k = next.get(k)
    }
    if (loop.length >= 3) loops.push(loop)
  }
  return loops
}

// ลดจุดของ loop ปิด (Douglas–Peucker) — tol หน่วยเดียวกับพิกัด
export function simplifyLoop(loop: Vec2[], tol: number): Vec2[] {
  if (loop.length <= 4) return loop
  const n = loop.length
  // เริ่มจากจุดที่ไกลกันที่สุดสองจุด (แบ่ง loop เป็นสองเส้นเปิด)
  let far = 0
  let best = -1
  for (let i = 0; i < n; i++) {
    const d = (loop[i].x - loop[0].x) ** 2 + (loop[i].y - loop[0].y) ** 2
    if (d > best) {
      best = d
      far = i
    }
  }
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[far] = 1
  const dp = (i0: number, i1: number) => {
    // ช่วง i0→i1 (ไปข้างหน้าแบบวน)
    const stack: [number, number][] = [[i0, i1]]
    while (stack.length) {
      const [a, b] = stack.pop()!
      const A = loop[a]
      const B = loop[b]
      const dx = B.x - A.x
      const dy = B.y - A.y
      const len = Math.hypot(dx, dy) || 1
      let maxD = 0
      let idx = -1
      for (let i = (a + 1) % n; i !== b; i = (i + 1) % n) {
        const P = loop[i]
        const dist = Math.abs((P.x - A.x) * dy - (P.y - A.y) * dx) / len
        if (dist > maxD) {
          maxD = dist
          idx = i
        }
      }
      if (idx >= 0 && maxD > tol) {
        keep[idx] = 1
        stack.push([a, idx], [idx, b])
      }
    }
  }
  dp(0, far)
  dp(far, 0)
  return loop.filter((_, i) => keep[i])
}

// เกลี่ยเส้นให้โค้งต่อเนื่อง (Chaikin corner cutting) — หลังลดจุด เส้นโค้งเหลือเป็นคอร์ดตรงต่อกันเป็นมุม
// ซึ่งเครื่องตัดจะตัดตามเป็นหักศอกเล็ก ๆ; ตัดมุมซ้ำ n รอบได้เส้นโค้ง B-spline กำลังสองที่ลื่น
export function chaikinLoop(loop: Vec2[], iterations = 3): Vec2[] {
  let cur = loop
  for (let k = 0; k < iterations; k++) {
    const next: Vec2[] = []
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i]
      const b = cur[(i + 1) % cur.length]
      next.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y })
      next.push({ x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y })
    }
    cur = next
  }
  return cur
}

export const loopArea = (l: Vec2[]) => {
  let a = 0
  for (let i = 0; i < l.length; i++) {
    const p = l[i]
    const q = l[(i + 1) % l.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

export interface AlphaMask {
  data: Uint8Array | Uint8ClampedArray // alpha 0–255 ต่อพิกเซล (w*h)
  w: number
  h: number
  pxPerMm: number
  origin: Vec2 // ตำแหน่ง (มม.) ของมุมซ้ายบนพิกเซลแรก บนแผ่นคลี่
}

// เส้นตัดตามรูปจาก alpha ของลาย — คืน loop ปิด (มม. บนแผ่นคลี่) เรียงจากชิ้นใหญ่ไปเล็ก
// offset > 0 = ขยายออก (ขอบขาว), < 0 = หดเข้าในเนื้อ (ไม่มีขอบขาว ให้สีเลยเส้นตัด)
export function contourFromAlpha(
  m: AlphaMask,
  offset: number,
  opts: { round?: number; threshold?: number; minArea?: number } = {},
): Vec2[][] {
  const { w, h, pxPerMm: s } = m
  const round = opts.round ?? CORNER_ROUND
  const thr = opts.threshold ?? 128
  let mask = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) mask[i] = m.data[i] >= thr ? 1 : 0
  mask = fillHoles(mask, w, h)
  const rpx = round * s
  if (offset >= 0) {
    // ขยายเกินไปอีก round แล้วหดกลับ (closing) → มุมเว้าโค้งรัศมี round; มุมนูนโค้งจากการขยายเองแล้ว
    mask = erode(dilate(mask, w, h, offset * s + rpx), w, h, rpx)
  } else {
    // หดเข้าเนื้อ แล้ว opening ลบมุมนูนแหลม + closing ลบมุมเว้าแหลม
    mask = erode(mask, w, h, -offset * s)
    mask = dilate(erode(mask, w, h, rpx), w, h, rpx)
    mask = erode(dilate(mask, w, h, rpx), w, h, rpx)
  }
  // เบลอ mask เล็กน้อยแล้วเดินเส้นที่ระดับ 0.5 → ขอบ sub-pixel ไม่เป็นขั้นบันไดตามพิกเซล
  // (เบลอสมมาตร ขอบตรงไม่เลื่อน; มุมนูนถูกมนไปแล้วจากขั้นตอนก่อน จึงไม่เสียรูป)
  const field = gaussianBlur(mask, w, h, Math.max(0.8, 0.12 * s))
  const minArea = (opts.minArea ?? 4) * s * s // ทิ้งเศษชิ้นเล็กกว่า ~4 มม.²
  return marchingSquares(field, w, h, 0.5)
    .filter((l) => Math.abs(loopArea(l)) >= minArea)
    .sort((a, b) => Math.abs(loopArea(b)) - Math.abs(loopArea(a)))
    .map((l) =>
      // ลดจุดขั้นพิกเซล → เกลี่ยโค้ง → ตัดจุดที่เกือบเป็นเส้นตรง (0.01 มม.) ให้ไฟล์ตัดไม่บวม
      simplifyLoop(chaikinLoop(simplifyLoop(l, 0.2), 2), 0.01 * s).map((p) => ({
        x: m.origin.x + (p.x + 0.5) / s,
        y: m.origin.y + (p.y + 0.5) / s,
      })),
    )
}

export const loopPath = (l: Vec2[]) =>
  `M ${l.map((p) => `${Math.round(p.x * 1000) / 1000} ${Math.round(p.y * 1000) / 1000}`).join(' L ')} Z`
