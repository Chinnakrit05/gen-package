import type { BoxParams, Dieline, DimMark, Material, Panel, Segment } from './types'
import { P, fmt, rect } from './templates/shared'

// ถุงฟิล์มซีลขอบ (doypack — ก้นตั้งได้) : วัสดุกลุ่ม form==='pouch'
//
// ต่างจากกล่อง (พับ) และภาชนะ (revolve) — ถุงคือ "ฟิล์มแบนซีลขอบ" ขึ้นรูป
// สองส่วน: (1) dieline = แผ่นฟิล์มแบนที่พิมพ์จริง (หน้า+หลัง เชื่อมที่รอยพับข้าง + ก้น gusset + ริมซีล)
// เป็น Dieline ปกติ จึงไหลผ่าน artwork/export/guides/ใบสเปก/CMYK เดิมได้ทันที
// (2) รูปทรง 3D = พื้นผิว loft (หน้าตัดวงรีเปลี่ยนตามความสูง) — ก้นแบนตั้งได้ ปากบนซีลแบน
//
// ความหมายขนาดสำหรับถุง: W = กว้างถุง, H = สูงลำตัว, D = ความลึกก้น (ยิ่งมากยิ่งตั้งมั่น/จุมาก)

export const isPouch = (m: Material) => !m.foldable && m.form === 'pouch'

export const POUCH_SIDE_SEAL = 6 // ริมซีล/ลิ้นทากาวข้าง (มม.)
export const POUCH_TOP_SEAL = 10 // ริมซีลปากบน (มม.)
export const POUCH_ZIP_INSET = 18 // ระยะจากปากบนลงมาถึงแนวซิปล็อก (มม.)
// ตัวคูณความลึก 3D: ถุงจริงพองไม่เต็ม gusset — หรี่ความป่อง (หน้า-หลัง) ให้ดูแบนสมจริง
// มีผลเฉพาะทรง 3D ไม่แตะ dieline/ก้นที่ส่งผลิต; ปรับค่านี้ตัวเดียวเพื่อเพิ่ม/ลดความป่อง
export const POUCH_DEPTH_SCALE = 0.62

export interface Pouch {
  label: Dieline // แผ่นฟิล์มแบน (เป็น Dieline ปกติ)
  W: number
  H: number // ความสูงลำตัว (ไม่รวมริมซีล/ก้น)
  gusset: number // ความลึกก้น
  frontRect: { x: number; y: number; w: number; h: number } // พื้นที่พิมพ์หน้าถุง (พิกัดแผ่นคลี่) สำหรับ map texture 3D
  backRect: { x: number; y: number; w: number; h: number }
  zipper: boolean // มีซิปล็อก + รอยฉีกไหม
  zipY?: number // พิกัดแผ่นคลี่ y ของแนวซิป (เมื่อ zipper=true) — ใช้วางแถบซิปใน 3D
}

export function generatePouch(box: BoxParams, _mat: Material, zipper = false): Pouch {
  const { W, D, H } = box
  const g = Math.min(Math.max(D, 10), W) // ก้นไม่ลึกเกินความกว้างถุง และไม่ต่ำกว่า 10
  const ss = POUCH_SIDE_SEAL
  const st = POUCH_TOP_SEAL
  const filmH = st + H + g
  // แนวซิปอยู่ใต้ปากบน แต่ต้องไม่ต่ำเกินครึ่งลำตัว (ถุงเตี้ยมาก ๆ)
  const zipY = zipper ? st + Math.min(POUCH_ZIP_INSET, H * 0.5) : undefined

  // แผ่นฟิล์มแบน: [หน้า W][หลัง W][ลิ้นทากาว ss] แนวนอน; แนวตั้ง = ริมซีลบน + ลำตัว + ก้น
  // แยกลิ้นกาวเป็นแผงต่างหาก (ขอบร่วม x=2W เป็นรอยต่อ ไม่ใช่ขอบนอก) เหมือน dieline ฉลาก
  const panels: Panel[] = [
    { id: 'film', parentId: null, outline: rect(0, 0, 2 * W, filmH), stage: 0 },
    { id: 'glue', parentId: 'film', outline: rect(2 * W, 0, 2 * W + ss, filmH), stage: 0 },
  ]

  const cut = (d: string): Segment => ({ kind: 'cut', d })
  const crease = (d: string): Segment => ({ kind: 'crease', d })
  const segments: Segment[] = [
    cut(`M 0 0 L ${2 * W + ss} 0 L ${2 * W + ss} ${filmH} L 0 ${filmH} Z`),
    crease(`M ${W} 0 L ${W} ${filmH}`), // พับข้าง (สันข้างถุง) แบ่งหน้า/หลัง
    crease(`M ${2 * W} 0 L ${2 * W} ${filmH}`), // แนวทากาว/ซีลข้าง
    crease(`M 0 ${st} L ${2 * W} ${st}`), // ริมซีลปากบน
    crease(`M 0 ${st + H} L ${2 * W} ${st + H}`), // รอยพับก้น (ลำตัว↔gusset)
    crease(`M 0 ${st + H + g / 2} L ${2 * W} ${st + H + g / 2}`), // พับกลางก้น (gusset ยืดออกให้ตั้ง)
  ]

  const dims: DimMark[] = [
    { a: P(0, filmH + 12), b: P(W, filmH + 12), label: `กว้างถุง ${fmt(W)}` },
    { a: P(2 * W, filmH + 12), b: P(2 * W + ss, filmH + 12), label: `ซีล ${fmt(ss)}` },
    { a: P(2 * W + ss + 12, st), b: P(2 * W + ss + 12, st + H), label: `สูงลำตัว ${fmt(H)}` },
    { a: P(2 * W + ss + 12, st + H), b: P(2 * W + ss + 12, filmH), label: `ก้น ${fmt(g)}` },
  ]

  if (zipper && zipY !== undefined) {
    // แนวซิปล็อกพาดขวางหน้า+หลัง + รอยฉีก (V) ที่ขอบซีลสองข้าง เหนือซิปเล็กน้อยเพื่อฉีกเปิด
    segments.push(crease(`M 0 ${zipY} L ${2 * W} ${zipY}`))
    const tearY = zipY - 4
    const nz = 4 // ความลึกรอยฉีก
    segments.push(cut(`M 0 ${tearY - 2.5} L ${nz} ${tearY} L 0 ${tearY + 2.5}`)) // ขอบซ้าย (ริมกาว)
    segments.push(cut(`M ${2 * W + ss} ${tearY - 2.5} L ${2 * W + ss - nz} ${tearY} L ${2 * W + ss} ${tearY + 2.5}`)) // ขอบขวา
    dims.push({ a: P(0, zipY), b: P(2 * W, zipY), label: 'ซิปล็อก + รอยฉีก' })
  }

  return {
    label: { width: 2 * W + ss, height: filmH, segments, panels, dims },
    W,
    H,
    gusset: g,
    frontRect: { x: 0, y: st, w: W, h: H },
    backRect: { x: W, y: st, w: W, h: H },
    zipper,
    zipY,
  }
}

// --- รูปทรง 3D : หน้าตัดวงรี a(v)=ครึ่งกว้าง, b(v)=ครึ่งลึก เปลี่ยนตามความสูง v∈[0,1] (ก้น→ปาก) ---
// แยกเป็นฟังก์ชัน pure เพื่อทดสอบเชิงตัวเลข (ก้นแบนตั้งได้, พุงกลางป่อง, ปากซีลแบน)
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)
const smooth = (t: number) => {
  const u = clamp01(t)
  return u * u * u * (u * (u * 6 - 15) + 10) // smootherstep
}
const lerpS = (a: number, b: number, t: number) => a + (b - a) * smooth(t)

// ครึ่งความลึก (สัดส่วนของ gusset/2): ก้นตั้ง 0.82 → พุงป่อง 1.0 (v~0.4) → เรียวขึ้นปาก → ซีลแบน 0.05
export function pouchDepthFactor(v: number): number {
  if (v < 0.4) return lerpS(0.82, 1.0, v / 0.4)
  if (v < 0.85) return lerpS(1.0, 0.35, (v - 0.4) / 0.45)
  return lerpS(0.35, 0.05, (v - 0.85) / 0.15)
}

// ครึ่งความกว้าง (สัดส่วนของ W/2): เต็มเกือบตลอด คอดเล็กน้อยที่ก้นและปากซีล
export function pouchWidthFactor(v: number): number {
  if (v < 0.06) return lerpS(0.9, 1.0, v / 0.06)
  if (v > 0.9) return lerpS(1.0, 0.82, (v - 0.9) / 0.1)
  return 1.0
}
