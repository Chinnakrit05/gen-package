import type { Panel, Vec2 } from './types'

// เส้นไกด์งานพิมพ์: safe area (ระยะปลอดภัย) + bleed (เผื่อตัด)
// safe = ขยับขอบแผงเข้า SAFE มม. — เก็บลาย/ข้อความไว้ในกรอบนี้ ไม่โดนตัดหรือพับทับ
// bleed = ขยับ "ขอบนอก" (เส้นตัด) ออก BLEED มม. — พื้นลายต้องเลยเส้นตัดถึงตรงนี้ กันขอบขาว
export const SAFE_MM = 3
export const BLEED_MM = 3
const MIN_PANEL = 15 // ข้ามแฟลป/ลิ้นเล็ก ๆ ที่ไม่ได้พิมพ์ลาย

const signedArea = (p: Vec2[]) => {
  let a = 0
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length]
    a += p[i].x * q.y - q.x * p[i].y
  }
  return a / 2
}

// จุดตัดของเส้นตรง (infinite) สองเส้น — คืน null ถ้าขนาน
function lineIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const r = { x: b.x - a.x, y: b.y - a.y }
  const s = { x: d.x - c.x, y: d.y - c.y }
  const denom = r.x * s.y - r.y * s.x
  if (Math.abs(denom) < 1e-9) return null
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denom
  return { x: a.x + t * r.x, y: a.y + t * r.y }
}

// ขยับขอบทุกด้านของ polygon เข้า d มม. (d>0 = เข้า, d<0 = ออก) แล้วหาจุดยอดใหม่
// จากจุดตัดของขอบที่ขยับแล้ว — ใช้ได้ดีกับรูปนูน (แผงกล่องหลักเป็นสี่เหลี่ยม/คางหมู)
export function offsetPolygon(pts: Vec2[], d: number): Vec2[] {
  const n = pts.length
  if (n < 3) return pts.slice()
  const orient = signedArea(pts) >= 0 ? 1 : -1
  const lines: [Vec2, Vec2][] = []
  for (let i = 0; i < n; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % n]
    let nx = -(q.y - p.y)
    let ny = q.x - p.x
    const len = Math.hypot(nx, ny) || 1
    nx /= len
    ny /= len
    const k = -d * orient // d>0 = เข้าด้านใน (inset), d<0 = ออก (outset)
    lines.push([
      { x: p.x - nx * k, y: p.y - ny * k },
      { x: q.x - nx * k, y: q.y - ny * k },
    ])
  }
  const out: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const prev = lines[(i - 1 + n) % n]
    const cur = lines[i]
    out.push(lineIntersect(prev[0], prev[1], cur[0], cur[1]) ?? pts[i])
  }
  return out
}

const bbox = (pts: Vec2[]) => {
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
}

// key ของขอบแบบไม่สนทิศ (ปัดพิกัดกันคลาดเคลื่อน) เพื่อนับว่าขอบถูกใช้ร่วมกี่แผง
function edgeKey(a: Vec2, b: Vec2): string {
  const r = (v: number) => Math.round(v * 100) / 100
  const ka = `${r(a.x)},${r(a.y)}`
  const kb = `${r(b.x)},${r(b.y)}`
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
}

export interface Guides {
  safe: Vec2[][] // polygon ปิด (ระยะปลอดภัยต่อแผง)
  bleed: [Vec2, Vec2][] // เส้นตรง (เผื่อตัด เฉพาะขอบนอก)
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
      ([a, b]) =>
        `    <line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}" stroke="${BLEED_COLOR}" stroke-width="0.3" stroke-dasharray="3 2"/>`,
    )
    .join('\n')
  return `  <g id="guides" inkscape:groupmode="layer" inkscape:label="guides">\n${safe}\n${bleed}\n  </g>\n`
}

export function computeGuides(panels: Panel[]): Guides {
  // นับการใช้ขอบร่วม: ขอบที่ 2 แผงใช้ร่วม = รอยพับ (count 2), ขอบนอก = count 1
  const count = new Map<string, number>()
  for (const p of panels) {
    const o = p.outline
    for (let i = 0; i < o.length; i++) {
      const k = edgeKey(o[i], o[(i + 1) % o.length])
      count.set(k, (count.get(k) ?? 0) + 1)
    }
  }

  const safe: Vec2[][] = []
  const bleed: [Vec2, Vec2][] = []
  for (const p of panels) {
    const o = p.outline
    const b = bbox(o)
    if (Math.min(b.w, b.h) < MIN_PANEL) continue // ข้ามแฟลปเล็ก

    safe.push(offsetPolygon(o, SAFE_MM))

    const out = offsetPolygon(o, -BLEED_MM)
    for (let i = 0; i < o.length; i++) {
      // วาด bleed เฉพาะขอบนอก (ไม่มีแผงอื่นใช้ร่วม)
      if ((count.get(edgeKey(o[i], o[(i + 1) % o.length])) ?? 0) <= 1) {
        bleed.push([out[i], out[(i + 1) % out.length]])
      }
    }
  }
  return { safe, bleed }
}
