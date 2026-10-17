import type { Dieline, Panel, Vec2 } from './types'
import { pathToPolylines } from './dxf'

// เส้นไกด์งานพิมพ์: safe area (ระยะปลอดภัย) + bleed (เผื่อตัด)
// safe = ขยับขอบแผงเข้า SAFE มม. — เก็บลาย/ข้อความไว้ในกรอบนี้ ไม่โดนตัดหรือพับทับ
// bleed = ขยับ "เส้นตัดขอบนอก" ออก BLEED มม. — พื้นลายต้องเลยเส้นตัดถึงตรงนี้ กันขอบขาว
export const SAFE_MM = 3
export const BLEED_MM = 3
const MIN_PANEL = 15 // ข้ามแฟลป/ลิ้นเล็ก ๆ ที่ไม่ได้พิมพ์ลาย (เฉพาะ safe)
// ระยะที่ยื่นไปทดสอบว่าแต่ละฝั่งของเส้นตัดเป็นเนื้อวัสดุหรือไม่ — ต้องมากกว่าความคลาดของ
// outline แผง (แตกโค้งหยาบ ~5 จุดต่อมุม) จากเส้นตัดจริงที่เป็นโค้งละเอียด
const PROBE = 1.5
const MITER_LIMIT = 3 // มุมแหลมกว่านี้ ระยะ offset ที่มุมไม่เกิน 3×ระยะ (กันหนามยื่นยาว)

export interface Guides {
  safe: Vec2[][] // polygon ปิด (ระยะปลอดภัยต่อแผง)
  bleed: Vec2[][] // polyline ตามเส้นตัดขอบนอกที่ขยับออก (โค้งตามเส้นตัดจริง ต่อเนื่องข้ามแผง)
}

const signedArea = (p: Vec2[]) => {
  let a = 0
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length]
    a += p[i].x * q.y - q.x * p[i].y
  }
  return a / 2
}

const same = (a: Vec2, b: Vec2, eps = 1e-6) => Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps

function dedupe(pts: Vec2[]): Vec2[] {
  const out: Vec2[] = []
  for (const p of pts) if (!out.length || !same(out[out.length - 1], p)) out.push(p)
  return out
}

// normal ซ้ายของขอบ a→b (หน่วย) — ฝั่งซ้ายคือฝั่งที่ offset บวกเลื่อนไป
const leftNormal = (a: Vec2, b: Vec2): Vec2 => {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len }
}

// เลื่อน polyline ไปทางซ้ายของทิศเดิน d มม. — มุมต่อแบบ miter (จำกัดความยาว) จึงโค้งตาม
// เส้นเดิมได้ทุกจุด ไม่ต้องเดาว่ารูปนูน; closed = จุดแรกกับจุดท้ายเป็นจุดเดียวกัน
export function offsetPolyline(input: Vec2[], d: number, closed = false): Vec2[] {
  let pts = dedupe(input)
  if (closed && pts.length > 1 && same(pts[0], pts[pts.length - 1])) pts = pts.slice(0, -1)
  const n = pts.length
  if (n < 2) return pts.slice()
  const normals: Vec2[] = []
  const edges = closed ? n : n - 1
  for (let i = 0; i < edges; i++) normals.push(leftNormal(pts[i], pts[(i + 1) % n]))
  const out: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const nPrev = closed ? normals[(i - 1 + edges) % edges] : normals[i - 1]
    const nNext = closed ? normals[i % edges] : normals[i]
    const p = pts[i]
    if (!nPrev || !nNext) {
      const m = nPrev ?? nNext
      out.push({ x: p.x + m.x * d, y: p.y + m.y * d })
      continue
    }
    const sx = nPrev.x + nNext.x
    const sy = nPrev.y + nNext.y
    const sl = Math.hypot(sx, sy)
    if (sl < 1e-9) {
      out.push({ x: p.x + nNext.x * d, y: p.y + nNext.y * d })
      continue
    }
    const mx = sx / sl
    const my = sy / sl
    const cos = mx * nNext.x + my * nNext.y
    const k = Math.min(1 / Math.max(cos, 1e-9), MITER_LIMIT)
    out.push({ x: p.x + mx * d * k, y: p.y + my * d * k })
  }
  if (closed) out.push(out[0])
  return out
}

// ขยับขอบทุกด้านของ polygon เข้า d มม. (d>0 = เข้า, d<0 = ออก)
export function offsetPolygon(pts: Vec2[], d: number): Vec2[] {
  if (pts.length < 3) return pts.slice()
  // ฝั่งซ้ายของทิศเดินเป็นด้านในเมื่อพื้นที่มีเครื่องหมายเป็นบวก
  const ring = signedArea(pts) >= 0 ? pts : [...pts].reverse()
  return offsetPolyline(ring, d, true).slice(0, -1)
}

function pointInPoly(p: Vec2, poly: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

const inMaterial = (p: Vec2, panels: Panel[]) =>
  panels.some((q) => pointInPoly(p, q.outline) && !(q.holes ?? []).some((h) => pointInPoly(p, h)))

const bbox = (pts: Vec2[]) => {
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
}

// bleed จากเส้นตัดจริง: แยกเส้นตัดเป็นขอบย่อย ดูว่าฝั่งไหนเป็นเนื้อวัสดุ เก็บเฉพาะขอบนอก
// (เนื้ออยู่ฝั่งเดียว — ร่องผ่าระหว่างแผงมีเนื้อทั้งสองฝั่งจึงตกไป) หันทุกช่วงให้ด้านนอกอยู่ซ้าย
// ต่อช่วงที่ปลายชนกันเป็นเส้นยาว แล้ว offset ออกทีเดียว — มุมระหว่าง segment คนละเส้นจึงต่อกันสนิท
function bleedFromCuts(d: Pick<Dieline, 'panels' | 'segments'>): Vec2[][] {
  const runs: Vec2[][] = []
  for (const s of d.segments) {
    if (s.kind !== 'cut') continue
    for (const raw of pathToPolylines(s.d)) {
      const pl = dedupe(raw)
      if (pl.length < 2) continue
      // 1 = ด้านนอกอยู่ซ้าย, -1 = ด้านนอกอยู่ขวา, 0 = ไม่ใช่ขอบนอก
      const cls: number[] = []
      const lens: number[] = []
      for (let i = 0; i < pl.length - 1; i++) {
        const a = pl[i]
        const b = pl[i + 1]
        const nl = leftNormal(a, b)
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const inL = inMaterial({ x: m.x + nl.x * PROBE, y: m.y + nl.y * PROBE }, d.panels)
        const inR = inMaterial({ x: m.x - nl.x * PROBE, y: m.y - nl.y * PROBE }, d.panels)
        cls.push(inL === inR ? 0 : inR ? 1 : -1)
        lens.push(Math.hypot(b.x - a.x, b.y - a.y))
      }
      // ขอบย่อยสั้น ๆ ที่จำแนกต่างจากเพื่อนบ้าน (ปลายโค้งที่ outline แผงหยาบกว่าเส้นตัด) ให้ตามเพื่อนบ้าน
      for (let i = 0; i < cls.length; i++) {
        if (lens[i] >= 2) continue
        const prev = cls[i - 1]
        const next = cls[i + 1]
        if (prev !== undefined && prev === next && prev !== cls[i]) cls[i] = prev
        else if (prev === undefined && next !== undefined && cls[i] === 0) cls[i] = next
        else if (next === undefined && prev !== undefined && cls[i] === 0) cls[i] = prev
      }
      let i = 0
      while (i < cls.length) {
        const c = cls[i]
        let j = i
        while (j + 1 < cls.length && cls[j + 1] === c) j++
        if (c !== 0) {
          const run = pl.slice(i, j + 2)
          runs.push(c === 1 ? run : run.reverse())
        }
        i = j + 1
      }
    }
  }

  // ต่อช่วงที่ปลายชนต้นของอีกช่วง (ทิศเดียวกันแล้ว เพราะหันด้านนอกไปซ้ายทุกช่วง)
  const EPS = 0.05
  const used = new Array(runs.length).fill(false)
  const chains: Vec2[][] = []
  for (let s = 0; s < runs.length; s++) {
    if (used[s]) continue
    used[s] = true
    const chain = [...runs[s]]
    let grew = true
    while (grew) {
      grew = false
      const end = chain[chain.length - 1]
      for (let k = 0; k < runs.length; k++) {
        if (used[k] || !same(runs[k][0], end, EPS)) continue
        used[k] = true
        chain.push(...runs[k].slice(1))
        grew = true
        break
      }
      if (grew) continue
      const start = chain[0]
      for (let k = 0; k < runs.length; k++) {
        if (used[k] || !same(runs[k][runs[k].length - 1], start, EPS)) continue
        used[k] = true
        chain.unshift(...runs[k].slice(0, -1))
        grew = true
        break
      }
    }
    chains.push(chain)
  }

  const offsets = chains.map((c) => {
    const closed = c.length > 2 && same(c[0], c[c.length - 1], EPS)
    return offsetPolyline(c, BLEED_MM, closed)
  })
  return trimBleed(offsets, runs, d.panels)
}

function distToSeg(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y)
}

// เส้น offset ของแต่ละช่วงไม่รู้จักกัน: ในร่องแคบ/มุมเว้า เส้นของสองฝั่งมุดเข้าไปไขว้กัน
// และช่วงที่ยื่นข้ามแผงอื่นก็ทับเนื้อวัสดุ — เก็บเฉพาะส่วนที่ห่างขอบนอก "ทุกเส้น" อย่างน้อย BLEED
// และไม่อยู่บนเนื้อ = เส้น offset ของรูปรวมทั้งแผ่น (แบบที่โรงพิมพ์ใช้) ตัดจุดเปลี่ยนด้วย bisection
// ให้ปลายเส้นสองฝั่งมาบรรจบกันพอดี
function trimBleed(lines: Vec2[][], boundary: Vec2[][], panels: Panel[]): Vec2[][] {
  const segs: [Vec2, Vec2][] = []
  for (const r of boundary) for (let i = 0; i < r.length - 1; i++) segs.push([r[i], r[i + 1]])
  const TOL = 0.1
  const ok = (p: Vec2) => {
    for (const [a, b] of segs) if (distToSeg(p, a, b) < BLEED_MM - TOL) return false
    return !inMaterial(p, panels)
  }
  const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  // หาจุดเปลี่ยนสถานะบนขอบ a(okA)→b ด้วย bisection
  const cross = (a: Vec2, b: Vec2, okA: boolean): Vec2 => {
    let lo = 0
    let hi = 1
    for (let k = 0; k < 20; k++) {
      const m = (lo + hi) / 2
      if (ok(lerp(a, b, m)) === okA) lo = m
      else hi = m
    }
    return lerp(a, b, (lo + hi) / 2)
  }
  const STEP = 1
  const out: Vec2[][] = []
  for (const line of lines) {
    // แตกขอบยาวให้ถี่ ~1 มม. เพื่อจับช่วงที่มุดเข้าเขตของเส้นอื่นกลางขอบ
    const dense: Vec2[] = []
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i]
      const b = line[i + 1]
      const k = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / STEP))
      for (let j = 0; j < k; j++) dense.push(lerp(a, b, j / k))
    }
    dense.push(line[line.length - 1])
    let cur: Vec2[] = []
    let prevOk = ok(dense[0])
    if (prevOk) cur.push(dense[0])
    for (let i = 1; i < dense.length; i++) {
      const p = dense[i]
      const pOk = ok(p)
      if (pOk !== prevOk) {
        const x = cross(dense[i - 1], p, prevOk)
        if (prevOk) {
          cur.push(x)
          out.push(cur)
          cur = []
        } else cur = [x]
      }
      if (pOk) cur.push(p)
      prevOk = pOk
    }
    if (cur.length > 1) out.push(cur)
  }
  // ตัดเศษสั้นทิ้ง แล้วลดจุดบนช่วงตรงที่ถูกแตกถี่กลับเหลือปลายสองข้าง
  const len = (l: Vec2[]) => l.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - l[i].x, p.y - l[i].y), 0)
  return out.filter((l) => len(l) > 0.5).map(simplifyCollinear)
}

function simplifyCollinear(pts: Vec2[]): Vec2[] {
  if (pts.length < 3) return pts
  const out = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1]
    const b = pts[i]
    const c = pts[i + 1]
    const crossZ = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    if (Math.abs(crossZ) > 1e-3 * Math.hypot(c.x - a.x, c.y - a.y)) out.push(b)
  }
  out.push(pts[pts.length - 1])
  return out
}

const f = (v: number) => String(Math.round(v * 100) / 100)

export const SAFE_COLOR = '#1b6ea8'
export const BLEED_COLOR = '#c0158a'

// เลเยอร์ <g id="guides"> สำหรับ SVG export — safe (น้ำเงินประ) + bleed (ม่วงประ)
export function guidesSVGLayer(g: Guides): string {
  if (!g.safe.length && !g.bleed.length) return ''
  const safe = g.safe
    .map(
      (poly) =>
        `    <polygon points="${poly.map((p) => `${f(p.x)},${f(p.y)}`).join(' ')}" fill="none" stroke="${SAFE_COLOR}" stroke-width="0.3" stroke-dasharray="2 2"/>`,
    )
    .join('\n')
  const bleed = g.bleed
    .map(
      (line) =>
        `    <polyline points="${line.map((p) => `${f(p.x)},${f(p.y)}`).join(' ')}" fill="none" stroke="${BLEED_COLOR}" stroke-width="0.3" stroke-dasharray="3 2"/>`,
    )
    .join('\n')
  return `  <g id="guides" inkscape:groupmode="layer" inkscape:label="guides">\n${safe}\n${bleed}\n  </g>\n`
}

export function computeGuides(d: Pick<Dieline, 'panels' | 'segments'>): Guides {
  const safe: Vec2[][] = []
  for (const p of d.panels) {
    const b = bbox(p.outline)
    if (Math.min(b.w, b.h) < MIN_PANEL) continue // ข้ามแฟลปเล็ก
    safe.push(offsetPolygon(p.outline, SAFE_MM))
  }
  return { safe, bleed: bleedFromCuts(d) }
}
