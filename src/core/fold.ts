import { Matrix4, Vector3 } from 'three'
import type { Panel, Vec2 } from './types'

// พิกัดแผ่นคลี่ (x ขวา, y ลง, หน่วย mm) → พิกัด 3D (x ขวา, y ขึ้น, z ออกจากแผ่น)
export const to3D = (p: Vec2) => new Vector3(p.x, -p.y, 0)

// หน้าต่างเวลาของแต่ละ stage — เลือกชุดตามจำนวน stage ที่ template นั้นใช้จริง
// เพื่อให้ทุกแบบไล่พับเต็มช่วง 0..1 ไม่ว่าจะมีกี่จังหวะ
// (แยกชุดไว้แทนที่จะคำนวณสด เพราะ template 4 จังหวะถูกจูนด้วยตาไว้แล้ว ห้ามเปลี่ยน)
const WINDOWS_4: [number, number][] = [
  [0, 0.5], // ลำตัว
  [0.42, 0.68], // ลิ้นกันฝุ่น
  [0.62, 0.86], // ฝาเสียบ
  [0.82, 1], // ลิ้นเสียบ
]

// 5 จังหวะ (เช่น FEFCO 0427): ผนัง → หูมุม → แผ่นม้วนทับ → ฝา → ลิ้น
// หูมุมต้องพับเกือบเสร็จก่อนแผ่นม้วนเริ่ม ไม่งั้นสองแผงกวาดเฉียดกันกลางทาง
const WINDOWS_5: [number, number][] = [
  [0, 0.4],
  [0.32, 0.54],
  [0.52, 0.74],
  [0.7, 0.9],
  [0.86, 1],
]

// 6 จังหวะ (FEFCO 0217): ผนัง → ลิ้นก้นข้าง → ลิ้นก้นหน้า → ลิ้นก้นหลัง → ฝาแบน+หูหิ้ว → หน้าจั่วเอนเข้าล็อก
// หน้าจั่วต้องรอหูหิ้วเข้ากลางเสร็จก่อนค่อยเอน (หูหิ้วสอดผ่านร่องตอนหน้าจั่วเอน)
const WINDOWS_6: [number, number][] = [
  [0, 0.3],
  [0.25, 0.44],
  [0.4, 0.57],
  [0.53, 0.68],
  [0.64, 0.86],
  [0.86, 1],
]

function stageProgress(windows: [number, number][], stage: number, fold: number): number {
  const [s, e] = windows[Math.min(stage, windows.length - 1)]
  const u = Math.min(1, Math.max(0, (fold - s) / (e - s)))
  return u * u * (3 - 2 * u)
}

// ระยะตั้งฉากจากจุด q ถึงเส้นตรงผ่าน a→b (พิกัดแผ่นคลี่)
function distToLine(q: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.abs((q.x - a.x) * dy - (q.y - a.y) * dx) / Math.hypot(dx, dy)
}

// มุมพับ (เรเดียน มีเครื่องหมายตาม foldAngle) ของลิ้นเสียบที่ต่อจากฝา
// มองหน้าตัดตั้งฉากบานพับ: บานพับฝาอยู่ที่ขอบบนผนังหลัง, ฝายาว L หมุนลงมุม φ (0 = ตั้งตรง, 90° = ปิด)
// ลิ้นยาว T ต่อจากปลายฝา ทิศรวม α = φ + ψ (วัดจากแนวตั้ง กวาดไปทางผนังหน้า)
// เงื่อนไข: ปลายลิ้นห่างแนวผนังหลังได้ไม่เกิน L (= ตำแหน่งบานพับลิ้นตอนปิดสนิท ซึ่งอยู่ในผนังหน้า)
//   L·sinφ + T·sinα ≤ L  →  α ≥ π − asin(s), s = L(1 − sinφ)/T  (ใช้ได้เมื่อ s < 1)
// ช่วง s ≥ 1 (ฝายังเปิดกว้าง ปลายลิ้นยังไม่ถึงแนวผนัง) ลาด α ขึ้นเชิงเส้นจาก 0 ถึง 90° ที่ s = 1
// ให้ลิ้นค่อย ๆ งอเข้าเหมือนมือพับ ไม่กระโดด; จังหวะพับเดิมของลิ้น (stage) ยังใช้ถ้ามากกว่า
function tuckAngle(p: Panel, lid: Panel | undefined, progress: number, lidProgress: number): number {
  const fa = ((p.foldAngle ?? 0) * Math.PI) / 180
  const natural = fa * progress
  if (!lid?.hingeA || !lid.hingeB || lid.foldAngle === undefined || !p.hingeA || !p.hingeB) return natural
  const L = distToLine(p.hingeA, lid.hingeA, lid.hingeB)
  const T = Math.max(...p.outline.map((q) => distToLine(q, p.hingeA!, p.hingeB!)))
  if (L <= 0 || T <= 0) return natural
  const phi = (Math.abs(lid.foldAngle) * Math.PI * lidProgress) / 180
  const s = (L * (1 - Math.sin(phi))) / T
  const s0 = L / T // ค่า s ตอนฝายังไม่ขยับ
  let req: number
  if (s < 1) req = Math.PI - Math.asin(s)
  else req = s0 > 1 ? (Math.PI / 2) * ((s0 - s) / (s0 - 1)) : Math.PI / 2
  req *= Math.min(1, phi / (Math.PI / 18)) // กันกระโดดตอนฝาเพิ่งเริ่ม (ลิ้นยาวเกินฝา)
  const psi = Math.min(Math.PI - 0.01, Math.max(Math.abs(natural), req - phi))
  return Math.sign(fa) * psi
}

// คำนวณ transform ของทุก panel ที่ค่าการพับ fold ∈ [0,1]
// แต่ละ panel หมุนรอบเส้น crease ของตัวเอง (นิยามในพิกัดแผ่นคลี่)
// แล้วส่งผ่าน transform ของ panel แม่แบบลูกโซ่
export function computeMatrices(panels: Panel[], fold: number): Map<string, Matrix4> {
  const byId = new Map(panels.map((p) => [p.id, p]))
  const cache = new Map<string, Matrix4>()
  const stages = panels.reduce((m, p) => Math.max(m, p.stage), 0) + 1
  const windows = stages >= 6 ? WINDOWS_6 : stages >= 5 ? WINDOWS_5 : WINDOWS_4

  const get = (id: string): Matrix4 => {
    const hit = cache.get(id)
    if (hit) return hit
    const p = byId.get(id)
    if (!p) throw new Error(`unknown panel: ${id}`)
    const m = p.parentId ? get(p.parentId).clone() : new Matrix4()
    let progress = stageProgress(windows, p.stage, fold)
    if (p.hingeA && p.hingeB && p.foldAngle !== undefined) {
      const a = to3D(p.hingeA)
      const b = to3D(p.hingeB)
      const axis = b.clone().sub(a).normalize()
      let theta = (p.foldAngle * Math.PI * progress) / 180
      if (p.tuck && p.foldAngle !== 0) {
        const lid = p.parentId ? byId.get(p.parentId) : undefined
        theta = tuckAngle(p, lid, progress, stageProgress(windows, lid?.stage ?? 0, fold))
        // ชั้นวัสดุ (zOffset) ดันตามมุมที่พับไปจริง — ลิ้นถูกพับนำจังหวะ stage ของตัวเอง
        // ถ้าใช้ progress เดิม ลิ้นจะเบียดผนังหน้าเกินความหนาชั้นช่วงที่ไถลลง
        progress = Math.min(1, (theta * 180) / Math.PI / p.foldAngle)
      }
      const local = new Matrix4()
        .makeTranslation(a.x, a.y, a.z)
        .multiply(new Matrix4().makeRotationAxis(axis, theta))
        .multiply(new Matrix4().makeTranslation(-a.x, -a.y, -a.z))
      m.multiply(local)
    }
    // ดันชั้นวัสดุที่ซ้อนกัน (ปีกทากาว/ลิ้นกันฝุ่น/ลิ้นเสียบ) ตามแนวแกน z
    // ท้องถิ่นของ panel ซึ่งหลังพับจะชี้เข้าหากองชั้นวัสดุ — กัน z-fighting
    if (p.zOffset) {
      m.multiply(new Matrix4().makeTranslation(0, 0, p.zOffset * progress))
    }
    cache.set(id, m)
    return m
  }

  panels.forEach((p) => get(p.id))
  return cache
}

// สันโค้งของรอยพับ 180° (roll/ม้วนทบ): กล่องจริงพับทบไม่ได้เป็นขอบมีดคม แต่ม้วนเป็นสัน
// รัศมี ≈ ครึ่งของระยะห่างสองชั้น ตามแนวเส้นพับ — สร้างเป็นทรงกระบอกบาง ๆ อุดร่องที่สันบน
// คำนวณจาก matrices โดยตรง: จุด hinge เดียวกันถูกแผงแม่(ผนัง)กับแผงลูก(ม้วน) พาไปคนละ z
// (ต่างกันตาม zOffset*progress) — สันจึงโตจาก 0 ตอนกางเป็นเต็มตอนพับ เข้าจังหวะ animation เอง
export interface FoldBead {
  id: string
  a: Vector3 // ปลายสันด้านหนึ่ง (กึ่งกลางระหว่างขอบผนังกับขอบม้วน)
  b: Vector3
  r: number // รัศมีสัน
}

export function rollBeads(panels: Panel[], matrices: Map<string, Matrix4>): FoldBead[] {
  const out: FoldBead[] = []
  for (const p of panels) {
    if (Math.abs(p.foldAngle ?? 0) !== 180 || p.assemble || !p.parentId || !p.hingeA || !p.hingeB) continue
    const pm = matrices.get(p.parentId)
    const rm = matrices.get(p.id)
    if (!pm || !rm) continue
    const wallA = to3D(p.hingeA).applyMatrix4(pm)
    const rollA = to3D(p.hingeA).applyMatrix4(rm)
    const wallB = to3D(p.hingeB).applyMatrix4(pm)
    const rollB = to3D(p.hingeB).applyMatrix4(rm)
    const r = wallA.distanceTo(rollA) / 2
    if (r < 0.03) continue // ยังกางอยู่ (สันแทบไม่มี) — ข้าม
    out.push({
      id: p.id,
      a: wallA.add(rollA).multiplyScalar(0.5),
      b: wallB.add(rollB).multiplyScalar(0.5),
      r,
    })
  }
  return out
}
