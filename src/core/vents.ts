import type { Dieline, Panel, Segment, Vec2 } from './types'
import { circlePts, circlePath } from './templates/shared'

// รูระบายอากาศ (vent holes) — เจาะรูกลมเป็นกริดบนผนังกล่อง สำหรับส่งผลไม้/ผัก
// เฟส 1: พรีเซ็ตง่าย — เปิด/ปิด + เลือกผนัง + ขนาดรู + จำนวนแถว×คอลัมน์
// เป็น post-process บน Dieline ที่ generator สร้างเสร็จแล้ว จึงเข้าได้ทุก template
// ที่ตั้งชื่อผนังตามแบบมาตรฐาน (front/back = ด้านกว้าง, side-left/right|left/right = หัวท้าย)
// รูเข้า Panel.holes → โผล่ใน 3D (THREE.Shape.holes) และเพิ่ม segment 'cut' → เข้า blueprint/DXF/PDF

export type VentWalls = 'sides' | 'ends' | 'all'

export interface VentConfig {
  on: boolean
  walls: VentWalls
  dia: number // เส้นผ่านศูนย์กลางรู (mm)
  rows: number
  cols: number
}

export const DEFAULT_VENTS: VentConfig = { on: false, walls: 'sides', dia: 8, rows: 3, cols: 6 }

export const VENT_DIA_MIN = 3
export const VENT_DIA_MAX = 30
export const VENT_ROWS_MAX = 10
export const VENT_COLS_MAX = 16

const clampInt = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Math.round(Number.isFinite(v) ? v : lo)))

// ผนัง "ด้านกว้าง" (front/back) vs "หัวท้าย" (side-left/right, tray/gable ใช้ left/right)
const SIDE_IDS = ['front', 'back']
const END_IDS = ['side-left', 'side-right', 'left', 'right']

function targetIds(walls: VentWalls): Set<string> {
  if (walls === 'sides') return new Set(SIDE_IDS)
  if (walls === 'ends') return new Set(END_IDS)
  return new Set([...SIDE_IDS, ...END_IDS])
}

function bbox(outline: Vec2[]) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of outline) {
    if (p.x < x0) x0 = p.x
    if (p.y < y0) y0 = p.y
    if (p.x > x1) x1 = p.x
    if (p.y > y1) y1 = p.y
  }
  return { x0, y0, x1, y1 }
}

export function applyVents(d: Dieline, v?: VentConfig): Dieline {
  if (!v || !v.on) return d
  const ids = targetIds(v.walls)
  const r = Math.max(VENT_DIA_MIN, Math.min(VENT_DIA_MAX, v.dia)) / 2
  const rows = clampInt(v.rows, 1, VENT_ROWS_MAX)
  const cols = clampInt(v.cols, 1, VENT_COLS_MAX)
  const margin = r + 6 // เว้นขอบผนัง (mm) ให้พ้นรอยพับ + เผื่อโครงสร้าง

  // ระยะพิตช์ต่ำสุดระหว่างจุดศูนย์กลาง = เส้นผ่านศูนย์กลาง + เว้นเนื้อกระดาษ ~30%
  // ป้องกันรูซ้อนทับ/ผนังฉีก เมื่อผู้ใช้ตั้งจำนวนมากเกินไปบนผนังแคบ — ลดจำนวนให้พอดีอัตโนมัติ
  const minPitch = r * 2 * 1.3
  // จำนวนรูมากสุดที่วางบนช่วง span ได้โดยไม่ซ้อน (จุดแรก-สุดท้ายห่างกันอย่างน้อย minPitch/รู)
  const fit = (span: number) => (span <= 0 ? 0 : Math.max(1, Math.floor(span / minPitch) + 1))

  const addSegs: Segment[] = []
  let touched = false

  const panels: Panel[] = d.panels.map((p) => {
    if (!ids.has(p.id)) return p
    const b = bbox(p.outline)
    const usableW = b.x1 - b.x0 - 2 * margin
    const usableH = b.y1 - b.y0 - 2 * margin
    if (usableW <= 0 || usableH <= 0) return p // ผนังเล็กเกินไป — ข้าม

    const nc = Math.min(cols, fit(usableW))
    const nr = Math.min(rows, fit(usableH))

    const rings: Vec2[][] = []
    for (let ri = 0; ri < nr; ri++) {
      const cy = b.y0 + margin + (nr === 1 ? usableH / 2 : (usableH * ri) / (nr - 1))
      for (let ci = 0; ci < nc; ci++) {
        const cx = b.x0 + margin + (nc === 1 ? usableW / 2 : (usableW * ci) / (nc - 1))
        rings.push(circlePts(cx, cy, r))
        addSegs.push({ kind: 'cut', d: circlePath(cx, cy, r) })
      }
    }
    if (!rings.length) return p
    touched = true
    return { ...p, holes: [...(p.holes ?? []), ...rings] }
  })

  if (!touched) return d
  return { ...d, panels, segments: [...d.segments, ...addSegs] }
}

// parse/validate สำหรับโหลดจาก localStorage/ไฟล์ — คืน undefined เมื่อไม่มี/ปิด (JSON ไม่บวม)
export function parseVents(raw: unknown): VentConfig | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const o = raw as Record<string, unknown>
  if (o.on !== true) return undefined
  const walls: VentWalls =
    o.walls === 'ends' || o.walls === 'all' ? o.walls : 'sides'
  return {
    on: true,
    walls,
    dia: clampInt(Number(o.dia), VENT_DIA_MIN, VENT_DIA_MAX),
    rows: clampInt(Number(o.rows), 1, VENT_ROWS_MAX),
    cols: clampInt(Number(o.cols), 1, VENT_COLS_MAX),
  }
}
