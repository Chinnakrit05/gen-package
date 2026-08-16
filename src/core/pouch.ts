import type { BoxParams, Dieline, DimMark, Material, Panel, Segment } from './types'
import { P, fmt, rect } from './templates/shared'

// ถุงฟิล์มซีลขอบ : วัสดุกลุ่ม form==='pouch' — มีหลายรูปแบบ (PouchStyle)
//
// ต่างจากกล่อง (พับ) และภาชนะ (revolve) — ถุงคือ "ฟิล์มแบนซีลขอบ" ขึ้นรูป
// สองส่วน: (1) dieline = แผ่นฟิล์มแบนที่พิมพ์จริง (หน้า+หลัง เชื่อมที่รอยพับข้าง + ริมซีล [+ ก้น gusset])
// เป็น Dieline ปกติ จึงไหลผ่าน artwork/export/guides/ใบสเปก/CMYK เดิมได้ทันที
// (2) รูปทรง 3D = พื้นผิว loft (หน้าตัดวงรีเปลี่ยนตามความสูง) — โปรไฟล์ต่างตามรูปแบบ
//
// ความหมายขนาดสำหรับถุง: W = กว้างถุง, H = สูงลำตัว, D = ความลึกก้น (เฉพาะถุงตั้ง; ซองแบนไม่ใช้ D)

export const isPouch = (m: Material) => !m.foldable && m.form === 'pouch'

// รูปแบบถุง: stand = ถุงตั้งได้ (doypack, ก้น gusset), flat = ซองแบน 3 ด้าน (ไม่มีก้น),
// gusset = ซองข้างจีบ (side-gusset brick, ถุงกาแฟคลาสสิก — จีบพับสองข้าง ทรงแท่ง)
export type PouchStyle = 'stand' | 'flat' | 'gusset'
export const POUCH_STYLES: { id: PouchStyle; nameTh: string; detail: string }[] = [
  { id: 'stand', nameTh: 'ถุงตั้งได้ (doypack)', detail: 'ก้นตั้งได้ จุเยอะ — กาแฟ ขนม ผงชง' },
  { id: 'flat', nameTh: 'ซองแบน 3 ด้าน', detail: 'แบนราบ ไม่มีก้น — ของเล็ก ตัวอย่าง มาส์ก ซองซอส' },
  { id: 'gusset', nameTh: 'ซองข้างจีบ (brick)', detail: 'ถุงกาแฟคลาสสิก ทรงแท่ง มีจีบพับสองข้าง' },
]

export const POUCH_SIDE_SEAL = 6 // ริมซีล/ลิ้นทากาวข้าง (มม.)
export const POUCH_TOP_SEAL = 10 // ริมซีลปากบน (มม.)
export const POUCH_ZIP_INSET = 18 // ระยะจากปากบนลงมาถึงแนวซิปล็อก (มม.)
// ตัวคูณความลึก 3D ของถุงตั้ง: ถุงจริงพองไม่เต็ม gusset — หรี่ความป่อง (หน้า-หลัง) ให้ดูแบนสมจริง
// มีผลเฉพาะทรง 3D ไม่แตะ dieline/ก้นที่ส่งผลิต; ปรับค่านี้ตัวเดียวเพื่อเพิ่ม/ลดความป่อง
export const POUCH_DEPTH_SCALE = 0.62

export interface Pouch {
  label: Dieline // แผ่นฟิล์มแบน (เป็น Dieline ปกติ)
  style: PouchStyle
  W: number
  H: number // ความสูงลำตัว (ไม่รวมริมซีล/ก้น)
  gusset: number // ความลึกก้น (0 เมื่อเป็นซองแบน)
  depth3D: number // ครึ่งความลึกสูงสุดของทรง 3D (มม.) ต่างตามรูปแบบ
  frontRect: { x: number; y: number; w: number; h: number } // พื้นที่พิมพ์หน้าถุง (พิกัดแผ่นคลี่) สำหรับ map texture 3D
  backRect: { x: number; y: number; w: number; h: number }
  zipper: boolean // มีซิปล็อก + รอยฉีกไหม
  zipY?: number // พิกัดแผ่นคลี่ y ของแนวซิป (เมื่อ zipper=true) — ใช้วางแถบซิปใน 3D
}

export interface PouchOpts {
  style?: PouchStyle
  zipper?: boolean
}

export function generatePouch(box: BoxParams, _mat: Material, opts: PouchOpts = {}): Pouch {
  const { W, D, H } = box
  const style = opts.style ?? 'stand'
  const zipper = opts.zipper ?? false
  const flat = style === 'flat'
  const gus = style === 'gusset'
  const gVal = flat ? 0 : Math.min(Math.max(D, 10), W) // ก้น (stand) หรือ จีบข้าง (gusset): 10..W
  const bottomGusset = style === 'stand' ? gVal : 0 // เฉพาะถุงตั้งที่มีก้น gusset
  const sideGusset = gus ? gVal : 0 // เฉพาะซองข้างจีบ
  const ss = POUCH_SIDE_SEAL
  const st = POUCH_TOP_SEAL
  const sb = flat || gus ? POUCH_TOP_SEAL : 0 // ซองแบน/ซองข้างจีบมีริมซีลล่างแทนก้น
  const filmH = st + H + bottomGusset + sb
  // ความกว้างพิมพ์ = หน้า + หลัง + จีบข้างสองด้าน (stand/flat: sideGusset=0 → 2W)
  const Wp = 2 * W + 2 * sideGusset
  const width = Wp + ss
  // ความลึก 3D: ถุงตั้ง = ครึ่งก้น × สเกล; ซองแบน = พองบาง; ซองข้างจีบ = ทรงแท่งลึกเท่าจีบ
  const depth3D = flat ? Math.min(W, H) * 0.12 : gus ? gVal / 2 : (gVal / 2) * POUCH_DEPTH_SCALE
  // แนวซิปอยู่ใต้ปากบน แต่ต้องไม่ต่ำเกินครึ่งลำตัว (ถุงเตี้ยมาก ๆ)
  const zipY = zipper ? st + Math.min(POUCH_ZIP_INSET, H * 0.5) : undefined

  // แผ่นฟิล์มแบน: [หน้า][…จีบ…][หลัง][…จีบ…][ลิ้นทากาว ss]; แนวตั้ง = ริมบน + ลำตัว + ก้น/ริมล่าง
  // แยกลิ้นกาวเป็นแผงต่างหาก (ขอบร่วม x=Wp เป็นรอยต่อ ไม่ใช่ขอบนอก) เหมือน dieline ฉลาก
  const panels: Panel[] = [
    { id: 'film', parentId: null, outline: rect(0, 0, Wp, filmH), stage: 0 },
    { id: 'glue', parentId: 'film', outline: rect(Wp, 0, width, filmH), stage: 0 },
  ]

  const cut = (d: string): Segment => ({ kind: 'cut', d })
  const crease = (d: string): Segment => ({ kind: 'crease', d })
  const vfold = (x: number) => crease(`M ${x} 0 L ${x} ${filmH}`)
  const segments: Segment[] = [
    cut(`M 0 0 L ${width} 0 L ${width} ${filmH} L 0 ${filmH} Z`),
    vfold(Wp), // แนวทากาว/ซีลข้าง
    crease(`M 0 ${st} L ${Wp} ${st}`), // ริมซีลปากบน
    crease(`M 0 ${st + H} L ${Wp} ${st + H}`), // รอยพับก้น (stand) / ริมซีลล่าง (flat/gusset)
  ]
  if (gus) {
    // [หน้า W][จีบ g][หลัง W][จีบ g] — สันพับ + เส้นจีบกลางของแต่ละข้าง
    segments.push(vfold(W), vfold(W + sideGusset), vfold(2 * W + sideGusset))
    segments.push(vfold(W + sideGusset / 2), vfold(2 * W + sideGusset + sideGusset / 2)) // จีบกลาง
  } else {
    segments.push(vfold(W)) // สันข้างเดียว แบ่งหน้า/หลัง
  }
  if (style === 'stand') {
    segments.push(crease(`M 0 ${st + H + bottomGusset / 2} L ${Wp} ${st + H + bottomGusset / 2}`)) // พับกลางก้น
  }

  const wLabel = flat ? 'กว้างซอง' : gus ? 'กว้างหน้า' : 'กว้างถุง'
  const dims: DimMark[] = [
    { a: P(0, filmH + 12), b: P(W, filmH + 12), label: `${wLabel} ${fmt(W)}` },
    { a: P(Wp, filmH + 12), b: P(width, filmH + 12), label: `ซีล ${fmt(ss)}` },
    { a: P(width + 12, st), b: P(width + 12, st + H), label: `สูง ${fmt(H)}` },
  ]
  if (style === 'stand') {
    dims.push({ a: P(width + 12, st + H), b: P(width + 12, filmH), label: `ก้น ${fmt(gVal)}` })
  } else if (gus) {
    dims.push({ a: P(W, filmH + 12), b: P(W + sideGusset, filmH + 12), label: `จีบข้าง ${fmt(sideGusset)}` })
  }

  if (zipper && zipY !== undefined) {
    // แนวซิปล็อกพาดขวางหน้า+หลัง + รอยฉีก (V) ที่ขอบซีลสองข้าง เหนือซิปเล็กน้อยเพื่อฉีกเปิด
    segments.push(crease(`M 0 ${zipY} L ${Wp} ${zipY}`))
    const tearY = zipY - 4
    const nz = 4 // ความลึกรอยฉีก
    segments.push(cut(`M 0 ${tearY - 2.5} L ${nz} ${tearY} L 0 ${tearY + 2.5}`)) // ขอบซ้าย (ริมกาว)
    segments.push(cut(`M ${width} ${tearY - 2.5} L ${width - nz} ${tearY} L ${width} ${tearY + 2.5}`)) // ขอบขวา
    dims.push({ a: P(0, zipY), b: P(Wp, zipY), label: 'ซิปล็อก + รอยฉีก' })
  }

  return {
    label: { width, height: filmH, segments, panels, dims },
    style,
    W,
    H,
    gusset: gVal,
    depth3D,
    frontRect: { x: 0, y: st, w: W, h: H },
    backRect: { x: W + sideGusset, y: st, w: W, h: H },
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

// ครึ่งความลึก (สัดส่วนของ depth3D) ตามรูปแบบ:
// - stand: ก้นตั้ง 0.82 → พุงป่อง 1.0 (v~0.4) → เรียวขึ้นปาก → ซีลแบน 0.05 (ก้นกว้างเพื่อยืน)
// - flat: วงรีสมมาตร ซีลแบนทั้งบน-ล่าง (v→0/1 ≈ 0) พองสุดกลางลำตัว — ซองแบนไม่ตั้ง
export function pouchDepthFactor(v: number, style: PouchStyle = 'stand'): number {
  if (style === 'flat') return Math.max(0.04, Math.sin(Math.PI * clamp01(v)) ** 0.6)
  if (style === 'gusset') {
    // ทรงแท่ง: ลำตัวเต็มเกือบตลอด บีบแบนเฉพาะที่ริมซีลบน-ล่าง (brick)
    if (v < 0.08) return lerpS(0.12, 1.0, v / 0.08)
    if (v > 0.92) return lerpS(1.0, 0.12, (v - 0.92) / 0.08)
    return 1.0
  }
  if (v < 0.4) return lerpS(0.82, 1.0, v / 0.4)
  if (v < 0.85) return lerpS(1.0, 0.35, (v - 0.4) / 0.45)
  return lerpS(0.35, 0.05, (v - 0.85) / 0.15)
}

// ครึ่งความกว้าง (สัดส่วนของ W/2): เต็มเกือบตลอด คอดเล็กน้อยที่ปลาย
export function pouchWidthFactor(v: number, style: PouchStyle = 'stand'): number {
  if (style === 'gusset') {
    // ทรงแท่ง: กว้างเต็มเกือบตลอด บีบเฉพาะปลายซีลบน-ล่างเล็กน้อย
    if (v < 0.06) return lerpS(0.85, 1.0, v / 0.06)
    if (v > 0.94) return lerpS(1.0, 0.85, (v - 0.94) / 0.06)
    return 1.0
  }
  if (v < 0.06) return lerpS(0.9, 1.0, v / 0.06)
  if (v > 0.9) return lerpS(1.0, 0.82, (v - 0.9) / 0.1)
  return 1.0
}

// รูปหน้าตัดรอบวงที่มุม theta: วงรี (stand/flat) หรือสี่เหลี่ยมมน superellipse (gusset = ทรงแท่ง)
// คืนสัดส่วน (cx, cz) ∈ [-1,1] ก่อนคูณครึ่งกว้าง/ครึ่งลึก
export function pouchSection(theta: number, style: PouchStyle = 'stand'): { cx: number; cz: number } {
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  if (style === 'gusset') {
    // superellopse เลขชี้กำลัง 0.5 → สี่เหลี่ยมมุมมน (หน้า-หลังแบน ด้านข้างเป็นสัน = แนวจีบ)
    const e = 0.5
    return { cx: Math.sign(c) * Math.abs(c) ** e, cz: Math.sign(s) * Math.abs(s) ** e }
  }
  return { cx: c, cz: s }
}
