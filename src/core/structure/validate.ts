// ตัวตรวจเรขาคณิตของโครงสร้างที่คอมไพล์แล้ว (pure, ใช้ fold engine จริง) — ทั้งคอมไพเลอร์ (เดาระยะ/ชั้นวัสดุ/ลำดับพับ)
// และผู้ใช้ปลายทาง (รายงานปัญหาให้ AI แก้) ใช้ชุดเดียวกัน
import { Matrix4, Vector3 } from 'three'
import { computeMatrices, to3D } from '../fold'
import type { Panel, Vec2 } from '../types'

export function inPoly(pt: Vec2, poly: Vec2[]): boolean {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c
  }
  return c
}

const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

// ตัดกันจริง (ไม่นับแตะปลาย/ทับแนวเดียวกัน) — ขอบที่ใช้ร่วมกันของแผงแม่-ลูกจึงไม่ถูกนับว่าทับกัน
function segmentsCross(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): boolean {
  const eps = 1e-6
  const d1 = cross(b1, b2, a1)
  const d2 = cross(b1, b2, a2)
  const d3 = cross(a1, a2, b1)
  const d4 = cross(a1, a2, b2)
  return ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const L2 = dx * dx + dy * dy
  const t = L2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

function distToBoundary(p: Vec2, poly: Vec2[]): number {
  let d = Infinity
  for (let i = 0; i < poly.length; i++) d = Math.min(d, distToSegment(p, poly[i], poly[(i + 1) % poly.length]))
  return d
}

export function centroid(poly: Vec2[]): Vec2 {
  return { x: poly.reduce((s, v) => s + v.x, 0) / poly.length, y: poly.reduce((s, v) => s + v.y, 0) / poly.length }
}

// สองรูปหลายเหลี่ยมบนแผ่นคลี่ซ้อนทับกัน (มีพื้นที่ร่วม) หรือไม่ — แตะขอบ/มุมกันไม่นับ
export function polygonsOverlap(a: Vec2[], b: Vec2[], tol = 0.05): boolean {
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (segmentsCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true
    }
  }
  const inside = (pts: Vec2[], poly: Vec2[]) => pts.some((p) => inPoly(p, poly) && distToBoundary(p, poly) > tol)
  return inside([centroid(a), ...a], b) || inside([centroid(b), ...b], a)
}

// พิกัดในระนาบของแผงอ้างอิง (x ขวา y ลง เหมือนแผ่นคลี่) + ระยะตั้งฉาก z (บวก = ฝั่ง +z ท้องถิ่น = ด้านในกล่อง)
export const toLocal = (v: Vector3, inv: Matrix4) => {
  const l = v.clone().applyMatrix4(inv)
  return { p: { x: l.x, y: -l.y }, z: l.z }
}
export const normalOf = (m: Matrix4) => new Vector3(0, 0, 1).transformDirection(m)

export interface Landing {
  p: string // แผงที่ไปนอนแนบ
  q: string // แผงที่ถูกแนบ (จุดศูนย์กลางของ p อยู่ในพื้นที่ q)
}

// คู่แผงที่สภาพพับสุดท้ายซ้อนแนบกัน (ทุกจุดของ p ห่างระนาบ q < 5 มม. และจุดตัวอย่างของ p อย่างน้อยหนึ่งจุดอยู่ใน q)
// จุดตัวอย่าง = ศูนย์กลาง + กึ่งกลางระหว่างศูนย์กลางกับแต่ละมุม — ลิ้นที่คร่อมรอยต่อฝาสองซีกจึงยังนับว่าแนบฝา
// นับรวมแม่-ลูก (พับทบ 180° ลูกนอนบนแม่) — ต่างจาก checkFoldSweep ที่ข้ามคู่แม่-ลูก
export function findLandings(panels: Panel[], end = computeMatrices(panels, 1)): Landing[] {
  const out: Landing[] = []
  for (const p of panels) {
    for (const q of panels) {
      if (p === q) continue
      const inv = end.get(q.id)!.clone().invert()
      const vs = p.outline.map((v) => toLocal(to3D(v).applyMatrix4(end.get(p.id)!), inv))
      if (!vs.every((v) => Math.abs(v.z) < 5)) continue
      const c = centroid(vs.map((v) => v.p))
      const samples = [c, ...vs.map((v) => ({ x: (v.p.x + c.x) / 2, y: (v.p.y + c.y) / 2 }))]
      if (samples.some((pt) => inPoly(pt, q.outline))) out.push({ p: p.id, q: q.id })
    }
  }
  return out
}

export interface SweepViolation {
  p: string
  q: string
}

export function isAncestor(byId: Map<string, Panel>, a: Panel, b: Panel): boolean {
  for (let c: Panel | undefined = b; c; c = c.parentId ? byId.get(c.parentId) : undefined) if (c === a) return true
  return false
}

// ลำดับพับ (ตรรกะเดียวกับ foldOrder.test): แผง p ที่จบลงแนบแผง q ห้ามไปอยู่ผิดฝั่งของ q ภายในพื้นที่ q
// ขณะที่ q เข้าที่แล้ว (เอียงไม่เกิน 20°) — คืนคู่ที่ละเมิด (p ควรพับก่อน q หรือ p ยาวเกิน)
export function checkFoldSweep(panels: Panel[], step = 0.01): SweepViolation[] {
  const by = new Map(panels.map((p) => [p.id, p]))
  const end = computeMatrices(panels, 1)
  const pairs: [Panel, Panel, number][] = []
  for (const p of panels) {
    for (const q of panels) {
      if (p === q || isAncestor(by, p, q) || isAncestor(by, q, p)) continue
      const inv = end.get(q.id)!.clone().invert()
      const vs = p.outline.map((v) => toLocal(to3D(v).applyMatrix4(end.get(p.id)!), inv))
      if (!vs.every((v) => Math.abs(v.z) < 5)) continue
      const c = centroid(vs.map((v) => v.p))
      const cz = vs.reduce((s, v) => s + v.z, 0) / vs.length
      if (Math.abs(cz) > 0.01 && inPoly(c, q.outline)) pairs.push([p, q, Math.sign(cz)])
    }
  }
  const bad = new Map<string, SweepViolation>()
  if (!pairs.length) return []
  const cos20 = Math.cos((20 * Math.PI) / 180)
  for (let f = 0; f <= 1.0001; f += step) {
    const M = computeMatrices(panels, f)
    for (const [p, q, side] of pairs) {
      const key = `${p.id}→${q.id}`
      if (bad.has(key)) continue
      if (normalOf(M.get(q.id)!).dot(normalOf(end.get(q.id)!)) < cos20) continue
      const inv = M.get(q.id)!.clone().invert()
      for (const v of p.outline) {
        const l = toLocal(to3D(v).applyMatrix4(M.get(p.id)!), inv)
        if (l.z * side < -1 && inPoly(l.p, q.outline)) {
          bad.set(key, { p: p.id, q: q.id })
          break
        }
      }
    }
  }
  return [...bad.values()]
}

// ระยะจากจุด origin ตามทิศ dir (โลก 3D) จนชนแผงอื่น (ข้าม skip) — ใช้วัดช่องเปิดเพื่อตั้งความลึกลิ้นอัตโนมัติ
export function rayExtent(
  panels: Panel[],
  end: Map<string, Matrix4>,
  origin: Vector3,
  dir: Vector3,
  skip: ReadonlySet<string>,
  maxDist = 600,
): number | null {
  let best: number | null = null
  for (const q of panels) {
    if (skip.has(q.id)) continue
    const inv = end.get(q.id)!.clone().invert()
    const o = origin.clone().applyMatrix4(inv)
    const d = dir.clone().transformDirection(inv)
    if (Math.abs(d.z) < 1e-6) continue
    const t = -o.z / d.z
    if (t < 0.5 || t > maxDist) continue
    const hit = { x: o.x + d.x * t, y: -(o.y + d.y * t) }
    if (inPoly(hit, q.outline) && (best === null || t < best)) best = t
  }
  return best
}

export type Face = 'top' | 'bottom' | 'left' | 'right' | 'front' | 'back'
export const FACES: readonly Face[] = ['top', 'bottom', 'left', 'right', 'front', 'back']

// สัดส่วนพื้นที่ที่ถูกปิดของแต่ละด้านของกล่อง (กล่องล้อมรอบจากแผง boxPanelIds = body/lid ตอนพับสุด)
// นับเฉพาะแผงใน boxPanelIds เป็นตัวปิด — ลิ้นกันฝุ่น/ลิ้นมุมอย่างเดียวไม่นับว่าปิดด้าน (ไม่ได้ยึดและมีช่องกลาง)
// orientation front: แผงรากคือผนังหน้า (z เข้ากล่อง = ไปด้านหลัง, y ขึ้น = บน); base: แผงรากคือฐาน (z ขึ้น = บน)
export function coverageByFace(
  panels: Panel[],
  boxPanelIds: ReadonlySet<string>,
  orientation: 'front' | 'base',
  thickness: number,
  end = computeMatrices(panels, 1),
): Record<Face, number> {
  const min = new Vector3(Infinity, Infinity, Infinity)
  const max = new Vector3(-Infinity, -Infinity, -Infinity)
  for (const p of panels) {
    if (!boxPanelIds.has(p.id)) continue
    for (const v of p.outline) {
      const w = to3D(v).applyMatrix4(end.get(p.id)!)
      min.min(w)
      max.max(w)
    }
  }
  const inv = new Map(panels.map((p) => [p.id, end.get(p.id)!.clone().invert()]))
  const tol = 2 * thickness + 0.6
  const covered = (w: Vector3) => {
    for (const p of panels) {
      if (!boxPanelIds.has(p.id)) continue
      const l = toLocal(w, inv.get(p.id)!)
      if (Math.abs(l.z) <= tol && inPoly(l.p, p.outline)) return true
    }
    return false
  }
  // ด้าน → แกนคงที่ + ค่า
  const axisOf: Record<Face, [axis: 'x' | 'y' | 'z', value: number]> =
    orientation === 'front'
      ? { left: ['x', min.x], right: ['x', max.x], bottom: ['y', min.y], top: ['y', max.y], front: ['z', min.z], back: ['z', max.z] }
      : { left: ['x', min.x], right: ['x', max.x], front: ['y', min.y], back: ['y', max.y], bottom: ['z', min.z], top: ['z', max.z] }
  const result = {} as Record<Face, number>
  const N = 6
  const inset = 1.5
  for (const face of FACES) {
    const [axis, value] = axisOf[face]
    const others = (['x', 'y', 'z'] as const).filter((a) => a !== axis)
    let hit = 0
    let total = 0
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const w = new Vector3()
        w[axis] = value
        const [a, b] = others
        w[a] = min[a] + inset + ((max[a] - min[a] - 2 * inset) * (i + 0.5)) / N
        w[b] = min[b] + inset + ((max[b] - min[b] - 2 * inset) * (j + 0.5)) / N
        if (max[a] - min[a] < 2 * inset || max[b] - min[b] < 2 * inset) continue
        total++
        if (covered(w)) hit++
      }
    }
    result[face] = total ? hit / total : 0
  }
  return result
}
