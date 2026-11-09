import type { Vec2 } from '../types'

export const P = (x: number, y: number): Vec2 => ({ x, y })

export function arcPts(cx: number, cy: number, r: number, a0: number, a1: number, n = 5): Vec2[] {
  const pts: Vec2[] = []
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n
    pts.push(P(cx + r * Math.cos(a), cy + r * Math.sin(a)))
  }
  return pts
}

export const rect = (xa: number, ya: number, xb: number, yb: number): Vec2[] => [
  P(xa, ya),
  P(xb, ya),
  P(xb, yb),
  P(xa, yb),
]

// วงกลม: ริงจุด (สำหรับ THREE.Shape.holes) และ path (สำหรับ blueprint/DXF)
// ริงไม่ปิดจุดซ้ำท้าย (n จุด) — polygonizer/extruder ปิดวงให้เอง
export function circlePts(cx: number, cy: number, r: number, n = 20): Vec2[] {
  const pts: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n
    pts.push(P(cx + r * Math.cos(a), cy + r * Math.sin(a)))
  }
  return pts
}

export function circlePath(cx: number, cy: number, r: number): string {
  return (
    `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} ` +
    `A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`
  )
}

export const fmt = (v: number) => String(Math.round(v * 10) / 10)

// รูทรงแคปซูล (obround) สำหรับรูหิ้ว — length = ความยาวรวม, thick = ความกว้างรู
// vertical = แกนยาววางตามแกน y ของแผ่นคลี่
export function obroundPts(
  cx: number,
  cy: number,
  length: number,
  thick: number,
  vertical = false,
): Vec2[] {
  const r = thick / 2
  const half = Math.max(0, length / 2 - r)
  if (!vertical) {
    return [
      ...arcPts(cx - half, cy, r, Math.PI / 2, Math.PI * 1.5, 8),
      ...arcPts(cx + half, cy, r, -Math.PI / 2, Math.PI / 2, 8),
    ]
  }
  return [
    ...arcPts(cx, cy - half, r, Math.PI, Math.PI * 2, 8),
    ...arcPts(cx, cy + half, r, 0, Math.PI, 8),
  ]
}

// ขนาดตัวอักษรป้ายบอกขนาด (มม.) ตามขนาดแผ่น — แผ่นเล็ก (ซอง/สติกเกอร์) ตัวเล็กลงตามสัดส่วน
// ไม่ให้ตัวเลขใหญ่ล้นรูป; แผ่นใหญ่ (กล่อง ≥ ~270 มม.) คงเดิม 6 มม. — ใช้ร่วม blueprint/SVG/PDF
export const dimTextSize = (w: number, h: number) => Math.max(3.5, Math.min(6, Math.max(w, h) * 0.026))

export function roundedRectPts(x0: number, y0: number, x1: number, y1: number, r: number): Vec2[] {
  return [
    P(x0 + r, y0),
    ...arcPts(x1 - r, y0 + r, r, -Math.PI / 2, 0, 4),
    ...arcPts(x1 - r, y1 - r, r, 0, Math.PI / 2, 4),
    ...arcPts(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, 4),
    ...arcPts(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, 4),
  ]
}

export function roundedRectPath(x0: number, y0: number, x1: number, y1: number, r: number): string {
  return (
    `M ${x0 + r} ${y0} L ${x1 - r} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y0 + r} ` +
    `L ${x1} ${y1 - r} A ${r} ${r} 0 0 1 ${x1 - r} ${y1} L ${x0 + r} ${y1} ` +
    `A ${r} ${r} 0 0 1 ${x0} ${y1 - r} L ${x0} ${y0 + r} A ${r} ${r} 0 0 1 ${x0 + r} ${y0} Z`
  )
}

export function obroundPath(
  cx: number,
  cy: number,
  length: number,
  thick: number,
  vertical = false,
): string {
  const r = thick / 2
  const half = Math.max(0, length / 2 - r)
  if (!vertical) {
    return (
      `M ${cx - half} ${cy - r} L ${cx + half} ${cy - r} A ${r} ${r} 0 0 1 ${cx + half} ${cy + r} ` +
      `L ${cx - half} ${cy + r} A ${r} ${r} 0 0 1 ${cx - half} ${cy - r} Z`
    )
  }
  return (
    `M ${cx - r} ${cy - half} A ${r} ${r} 0 0 1 ${cx + r} ${cy - half} L ${cx + r} ${cy + half} ` +
    `A ${r} ${r} 0 0 1 ${cx - r} ${cy + half} Z`
  )
}

// สร้างเส้นตัด/รอยพับจาก outline + hinge ของแผงโดยตรง (dieline กับ 3D มาจากเรขาคณิตชุดเดียวกันเสมอ)
// - ขอบ outline ช่วงที่ทับ hinge ของแผงใดก็ตาม = รอยพับ (ใส่ครั้งเดียวต่อ hinge) ส่วนที่เหลือ = เส้นตัด
// - ขอบที่ซ้ำกันระหว่างสองแผง (ไม่ใช่ hinge) วาดครั้งเดียว; รู (holes) เป็นเส้นตัดวงปิด
// ต่อจุดเรียงกันในแนวเดียว (เช่นโค้งที่ประมาณด้วย polyline) เป็น path เดียวต่อแผง ลดจำนวนเส้น
export function autoSegments(
  panels: { outline: Vec2[]; holes?: Vec2[][]; hingeA?: Vec2; hingeB?: Vec2 }[],
): { kind: 'cut' | 'crease'; d: string }[] {
  const eps = 1e-6
  const hinges = panels.filter((p) => p.hingeA && p.hingeB).map((p) => [p.hingeA!, p.hingeB!] as const)
  const out: { kind: 'cut' | 'crease'; d: string }[] = []
  const seen = new Set<string>()
  const key = (a: Vec2, b: Vec2) => {
    const r = (v: number) => Math.round(v * 1000)
    const k1 = `${r(a.x)},${r(a.y)}`
    const k2 = `${r(b.x)},${r(b.y)}`
    return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`
  }
  // ช่วงพารามิเตอร์ [0,1] ของขอบ p→q ที่ถูก hinge ทับ
  const covered = (p: Vec2, q: Vec2): [number, number][] => {
    const dx = q.x - p.x
    const dy = q.y - p.y
    const L2 = dx * dx + dy * dy
    if (L2 < eps) return []
    const L = Math.sqrt(L2)
    const res: [number, number][] = []
    for (const [a, b] of hinges) {
      const ca = ((a.x - p.x) * dy - (a.y - p.y) * dx) / L
      const cb = ((b.x - p.x) * dy - (b.y - p.y) * dx) / L
      if (Math.abs(ca) > 1e-4 || Math.abs(cb) > 1e-4) continue
      const ta = ((a.x - p.x) * dx + (a.y - p.y) * dy) / L2
      const tb = ((b.x - p.x) * dx + (b.y - p.y) * dy) / L2
      const lo = Math.max(0, Math.min(ta, tb))
      const hi = Math.min(1, Math.max(ta, tb))
      if (hi - lo > 1e-6) res.push([lo, hi])
    }
    return res.sort((u, v) => u[0] - v[0])
  }
  const lerp = (p: Vec2, q: Vec2, t: number): Vec2 => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t })
  const f = (v: number) => String(Math.round(v * 1000) / 1000)
  for (const p of panels) {
    const ring = p.outline
    let path: Vec2[] = []
    const flush = () => {
      if (path.length > 1) out.push({ kind: 'cut', d: 'M ' + path.map((v) => `${f(v.x)} ${f(v.y)}`).join(' L ') })
      path = []
    }
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      const k = key(a, b)
      if (seen.has(k)) {
        flush()
        continue
      }
      seen.add(k)
      // ส่วนที่ไม่ถูก hinge ทับ
      let t0 = 0
      const pieces: [number, number][] = []
      for (const [lo, hi] of covered(a, b)) {
        if (lo > t0 + 1e-6) pieces.push([t0, lo])
        t0 = Math.max(t0, hi)
      }
      if (t0 < 1 - 1e-6) pieces.push([t0, 1])
      if (pieces.length === 1 && pieces[0][0] === 0 && pieces[0][1] === 1) {
        if (!path.length) path.push(a)
        path.push(b)
        continue
      }
      flush()
      for (const [lo, hi] of pieces) {
        const s = lerp(a, b, lo)
        const e = lerp(a, b, hi)
        out.push({ kind: 'cut', d: `M ${f(s.x)} ${f(s.y)} L ${f(e.x)} ${f(e.y)}` })
      }
    }
    flush()
    for (const h of p.holes ?? []) {
      out.push({ kind: 'cut', d: 'M ' + h.map((v) => `${f(v.x)} ${f(v.y)}`).join(' L ') + ' Z' })
    }
  }
  const hk = new Set<string>()
  for (const [a, b] of hinges) {
    const k = key(a, b)
    if (hk.has(k)) continue
    hk.add(k)
    out.push({ kind: 'crease', d: `M ${f(a.x)} ${f(a.y)} L ${f(b.x)} ${f(b.y)}` })
  }
  return out
}

// --- ลิ้นของกล่องฝาเสียบ (ใช้ร่วม template tuck-end/reverse-tuck กับคอมไพเลอร์ภาษาแผง ให้รูปทรงตรงกันเป๊ะ) ---
// ทุกฟังก์ชันรับแนวบานพับ a→b (หัก inset แล้ว) + ทิศยื่นออก out (unit) → คืนจุด (3D) และ path ต่อจาก a ถึง b (ไม่มี M; โค้งเป็น Q)

type Flap = { pts: Vec2[]; d: string }
const along2 = (a: Vec2, b: Vec2) => {
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  return { len, u: P((b.x - a.x) / len, (b.y - a.y) / len) }
}
const num = (v: number) => String(Math.round(v * 1000) / 1000)

// ลิ้นเสียบ (tuck tongue): ปลายมุมมนรัศมีใหญ่ ลึก 10–15 มม. ตามความลึกฝา
export const tongueDepth = (lidSpan: number) => Math.min(15, Math.max(10, 0.25 * lidSpan))
export const TONGUE_IN = 0.5 // ลิ้นแคบกว่าฝาข้างละเท่านี้ (ขั้นเล็กที่ปลายร่องล็อก ให้ลิ้นสอดผ่านไหล่ลิ้นกันฝุ่น)
export const tuckSlit = (lidWidth: number) => Math.min(4.5, lidWidth * 0.12) // ร่องล็อกที่ปลายรอยพับลิ้น

export function tongueFlap(a: Vec2, b: Vec2, out: Vec2, depth: number): Flap {
  const { len, u } = along2(a, b)
  const r = Math.min(6, depth * 0.5, len / 2)
  const at = (s: number, h: number) => P(a.x + u.x * s + out.x * h, a.y + u.y * s + out.y * h)
  const arc = (cs: number, s0: number, s1: number): Vec2[] => {
    const pts: Vec2[] = []
    for (let i = 0; i <= 5; i++) {
      const th = s0 + ((s1 - s0) * i) / 5
      pts.push(at(cs + r * Math.cos(th), depth - r + r * Math.sin(th)))
    }
    return pts
  }
  const pts = [a, ...arc(r, Math.PI, Math.PI / 2), ...arc(len - r, Math.PI / 2, 0), b]
  const p = (s: number, h: number) => { const v = at(s, h); return `${num(v.x)} ${num(v.y)}` }
  const d =
    `L ${p(0, depth - r)} Q ${p(0, depth)} ${p(r, depth)} L ${p(len - r, depth)} ` +
    `Q ${p(len, depth)} ${p(len, depth - r)} L ${p(len, 0)}`
  return { pts, d }
}

// ลิ้นกันฝุ่น: มุมนอกมน + ด้านที่ติดผนังซึ่งลิ้นเสียบสอดลง (lock) มี "ไหล่" บากเข้าที่โคน — ร่องล็อกปลายรอยพับลิ้นเกี่ยวไหล่นี้
// ไว้ (friction lock แบบกล่องฝาเสียบมาตรฐาน); อีกด้านเกือบตรง เอียงเข้าเล็กน้อย; lock null = มีไหล่ทั้งสองด้าน
export function dustFlap(a: Vec2, b: Vec2, out: Vec2, depth: number, lock: 'a' | 'b' | null): Flap {
  const { len, u } = along2(a, b)
  const at = (s: number, h: number) => P(a.x + u.x * s + out.x * h, a.y + u.y * s + out.y * h)
  const sh = Math.min(4, len * 0.12) // ไหล่: บากเข้า
  const shY = sh * 1.1 // สูงจากโคน
  const plain = Math.min(1.5, len * 0.05)
  const isLock = (e: 'a' | 'b') => lock === null || lock === e
  const cs = (e: 'a' | 'b') => (isLock(e) ? sh : plain) // ระยะเข้าของมุมบนจากปลาย
  const csA = cs('a')
  const csB = cs('b')
  const R = Math.max(0, Math.min(4, depth * 0.35, (len - csA - csB) / 2 - 0.5, (depth - shY) * 0.8))
  // ด้าน a ขึ้น → มุม a → ขอบบน → มุม b → ด้าน b ลง (พิกัด s ตามแนวบานพับ, h ตามทิศยื่น)
  const sideA: [number, number][] = isLock('a') ? [[0, 0], [sh, shY]] : [[0, 0]]
  const sideB: [number, number][] = isLock('b') ? [[len - sh, shY], [len, 0]] : [[len, 0]]
  // จุดเริ่มโค้งบนด้านข้าง = ถอยจากมุมตามด้านนั้น R
  const back = (from: [number, number], c: [number, number]): [number, number] => {
    const dx = from[0] - c[0]
    const dy = from[1] - c[1]
    const l = Math.hypot(dx, dy) || 1
    return [c[0] + (dx / l) * R, c[1] + (dy / l) * R]
  }
  const cA: [number, number] = [csA, depth]
  const cB: [number, number] = [len - csB, depth]
  const a1 = back(sideA[sideA.length - 1], cA)
  const a2: [number, number] = [csA + R, depth]
  const b1: [number, number] = [len - csB - R, depth]
  const b2 = back(sideB[0], cB)
  const quad = (p0: [number, number], c: [number, number], p1: [number, number]): Vec2[] => {
    const pts: Vec2[] = []
    for (let i = 1; i <= 4; i++) {
      const t = i / 4
      const m = (k: 0 | 1) => (1 - t) * (1 - t) * p0[k] + 2 * (1 - t) * t * c[k] + t * t * p1[k]
      pts.push(at(m(0), m(1)))
    }
    return pts
  }
  const v = (q: [number, number]) => at(q[0], q[1])
  const pts = [
    ...sideA.map(v),
    v(a1),
    ...quad(a1, cA, a2),
    v(b1),
    ...quad(b1, cB, b2),
    ...sideB.map(v),
  ]
  const p = (q: [number, number]) => { const w = v(q); return `${num(w.x)} ${num(w.y)}` }
  const d =
    sideA.slice(1).map((q) => `L ${p(q)} `).join('') +
    `L ${p(a1)} Q ${p(cA)} ${p(a2)} L ${p(b1)} Q ${p(cB)} ${p(b2)} ` +
    sideB.map((q) => `L ${p(q)}`).join(' ')
  return { pts, d }
}
