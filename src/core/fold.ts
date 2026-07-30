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

function stageProgress(windows: [number, number][], stage: number, fold: number): number {
  const [s, e] = windows[Math.min(stage, windows.length - 1)]
  const u = Math.min(1, Math.max(0, (fold - s) / (e - s)))
  return u * u * (3 - 2 * u)
}

// คำนวณ transform ของทุก panel ที่ค่าการพับ fold ∈ [0,1]
// แต่ละ panel หมุนรอบเส้น crease ของตัวเอง (นิยามในพิกัดแผ่นคลี่)
// แล้วส่งผ่าน transform ของ panel แม่แบบลูกโซ่
export function computeMatrices(panels: Panel[], fold: number): Map<string, Matrix4> {
  const byId = new Map(panels.map((p) => [p.id, p]))
  const cache = new Map<string, Matrix4>()
  const stages = panels.reduce((m, p) => Math.max(m, p.stage), 0) + 1
  const windows = stages >= 5 ? WINDOWS_5 : WINDOWS_4

  const get = (id: string): Matrix4 => {
    const hit = cache.get(id)
    if (hit) return hit
    const p = byId.get(id)
    if (!p) throw new Error(`unknown panel: ${id}`)
    const m = p.parentId ? get(p.parentId).clone() : new Matrix4()
    const progress = stageProgress(windows, p.stage, fold)
    if (p.hingeA && p.hingeB && p.foldAngle !== undefined) {
      const a = to3D(p.hingeA)
      const b = to3D(p.hingeB)
      const axis = b.clone().sub(a).normalize()
      const theta = (p.foldAngle * Math.PI * progress) / 180
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
    if (Math.abs(p.foldAngle ?? 0) !== 180 || !p.parentId || !p.hingeA || !p.hingeB) continue
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
