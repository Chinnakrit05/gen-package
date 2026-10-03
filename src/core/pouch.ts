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

// รูปแบบถุง: stand = ถุงตั้งได้ (doypack), flat = ซองแบน 3 ด้าน, gusset = ซองข้างจีบ (brick),
// box = ถุงก้นแบนตั้งเหลี่ยม (quad-seal), pillow = ซองหลังกลาง (fin seal), spout = ถุงมีจุก
export type PouchStyle = 'stand' | 'flat' | 'gusset' | 'box' | 'pillow' | 'spout'
export const POUCH_STYLES: { id: PouchStyle; nameTh: string; detail: string }[] = [
  { id: 'stand', nameTh: 'ถุงตั้งได้ (doypack)', detail: 'ก้นตั้งได้ จุเยอะ — กาแฟ ขนม ผงชง' },
  { id: 'flat', nameTh: 'ซองแบน 3 ด้าน', detail: 'แบนราบ ไม่มีก้น — ของเล็ก ตัวอย่าง มาส์ก ซองซอส' },
  { id: 'gusset', nameTh: 'ซองข้างจีบ (brick)', detail: 'ถุงกาแฟคลาสสิก ทรงแท่ง มีจีบพับสองข้าง' },
  { id: 'box', nameTh: 'ถุงก้นแบนตั้งเหลี่ยม', detail: 'quad-seal ตั้งเป็นทรงกล่อง — กาแฟพรีเมียม' },
  { id: 'pillow', nameTh: 'ซองหลังกลาง (pillow)', detail: 'ถุงขนม/ชิป พองนุ่ม ซีลหลังกลาง' },
  { id: 'spout', nameTh: 'ถุงมีจุก (spout)', detail: 'ของเหลว/เครื่องดื่ม มีจุก+ฝาเกลียว' },
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
  gusset: number // ความลึกก้น/จีบ (0 เมื่อไม่มี)
  depth3D: number // ครึ่งความลึกสูงสุดของทรง 3D (มม.) ต่างตามรูปแบบ
  stands: boolean // ตั้งได้ (ก้นแบน) — 3D วางฐานลงพื้น
  spout: boolean // มีจุก+ฝาที่ปากบนไหม (spout pouch)
  frontRect: { x: number; y: number; w: number; h: number } // พื้นที่พิมพ์หน้าถุง (พิกัดแผ่นคลี่) สำหรับ map texture 3D
  backRect: { x: number; y: number; w: number; h: number } // หลัง (back-seam: ครึ่งขวาของหลัง)
  // back-seam (stand/pillow/spout): หน้าอยู่กลางแผ่น หลังแยกซ้าย/ขวา รอยต่อกาวไปรวมกลางหลัง
  // → 3D ได้หน้าต่อเนื่องสะอาด ไม่มีรอยต่อที่ขอบข้าง; backRectL = ครึ่งซ้ายของหลัง
  backSeam: boolean
  backRectL?: { x: number; y: number; w: number; h: number }
  zipper: boolean // มีซิปล็อก + รอยฉีกไหม
  zipY?: number // พิกัดแผ่นคลี่ y ของแนวซิป (เมื่อ zipper=true) — ใช้วางแถบซิปใน 3D
  hangHole: boolean // รูแขวน (euro-hole) ที่ริมซีลบน
  valve: boolean // วาล์วระบายแก๊ส (กาแฟ) บนหน้าถุง
  tinTie: boolean // ที่รัดปาก (tin-tie) ใกล้ปากถุง
}

// ออปชันเสริมบนถุง (เก็บเฉพาะที่เปิด) — thread แบบเดียวกับ zipper
export interface PouchAddons {
  hangHole?: boolean
  valve?: boolean
  tinTie?: boolean
}

export interface PouchOpts {
  style?: PouchStyle
  zipper?: boolean
  addons?: PouchAddons
}

// ตำแหน่ง/ขนาดออปชันเสริม (คงที่เชิงสัดส่วน) — dieline กับ 3D ต้องใช้ค่าชุดเดียวกัน
export const VALVE_V = 0.72 // ระดับความสูง (v) ของวาล์วบนหน้าถุง (จากก้น)
export const TINTIE_INSET = 12 // ระยะจากปากบนลงมาถึงแถบ tin-tie (มม.)
export const valveR = (W: number) => Math.min(W, 90) * 0.11 // รัศมีวาล์ว

export function generatePouch(box: BoxParams, _mat: Material, opts: PouchOpts = {}): Pouch {
  const { W, D, H } = box
  const style = opts.style ?? 'stand'
  const zipper = opts.zipper ?? false
  const flat = style === 'flat'
  const pillow = style === 'pillow'
  const gus = style === 'gusset'
  const boxp = style === 'box'
  const spout = style === 'spout'
  // ถุงที่ใช้ค่า D: stand/gusset/box/spout (ซองแบน/หลังกลางไม่มีก้น-จีบ)
  const gVal = flat || pillow ? 0 : Math.min(Math.max(D, 10), W)
  const sideGusset = gus || boxp ? gVal : 0 // จีบข้าง: ซองข้างจีบ + ถุงก้นแบน
  const bottomGusset = style === 'stand' || boxp || spout ? gVal : 0 // ก้น gusset: ถุงตั้ง/ก้นแบน/มีจุก
  // ตั้งได้เมื่อมีก้น — ซองข้างจีบก็ตั้งได้ (ซีลก้นพับซ่อนใต้ฐานแบบถุงกาแฟ ดู brickShape)
  const stands = bottomGusset > 0 || gus
  // ถุงรอยต่อกลางหลัง (back-seam): หน้าเป็นผืนต่อเนื่องกลางแผ่น หลังแยกไปสองข้าง (ขอบนอกมากาวกันกลางหลัง)
  // → ใน 3D หน้าสะอาดไม่มีรอยต่อขอบข้าง; ใช้กับ stand/pillow/spout (ไม่ใช้กับซองแบน/ข้างจีบ)
  const backSeam = style === 'stand' || pillow || spout
  const fx = backSeam ? W / 2 : 0 // จุดเริ่มพื้นที่พิมพ์หน้าบนแผ่นฟิล์ม
  const fcx = fx + W / 2 // จุดกึ่งกลางหน้า (ใช้วาง marker จุก/วาล์ว/รูแขวน)
  const ss = POUCH_SIDE_SEAL
  const st = POUCH_TOP_SEAL
  const sb = flat || gus || pillow ? POUCH_TOP_SEAL : 0 // ไม่มีก้น → ใช้ริมซีลล่างแทน
  const filmH = st + H + bottomGusset + sb
  // ความกว้างพิมพ์ = หน้า + หลัง + จีบข้างสองด้าน (ไม่มีจีบ → 2W)
  const Wp = 2 * W + 2 * sideGusset
  const width = Wp + ss
  // ความลึก 3D ต่อรูปแบบ: ซองแบนบาง, หลังกลางพองนุ่ม, ทรงแท่ง=ครึ่งจีบเต็ม, ถุงตั้ง=ครึ่งก้น×สเกล
  const depth3D = flat
    ? Math.min(W, H) * 0.12
    : pillow
      ? Math.min(W, H) * 0.28
      : gus || boxp
        ? gVal / 2
        : (gVal / 2) * POUCH_DEPTH_SCALE
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
  const circlePath = (cx: number, cy: number, r: number) =>
    `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`
  const segments: Segment[] = [
    cut(`M 0 0 L ${width} 0 L ${width} ${filmH} L 0 ${filmH} Z`),
    vfold(Wp), // แนวทากาว/ซีลข้าง
    crease(`M 0 ${st} L ${Wp} ${st}`), // ริมซีลปากบน
    crease(`M 0 ${st + H} L ${Wp} ${st + H}`), // รอยพับก้น / ริมซีลล่าง
  ]
  if (sideGusset > 0) {
    // [หน้า W][จีบ g][หลัง W][จีบ g] — สันพับ + เส้นจีบกลางของแต่ละข้าง
    segments.push(vfold(W), vfold(W + sideGusset), vfold(2 * W + sideGusset))
    segments.push(vfold(W + sideGusset / 2), vfold(2 * W + sideGusset + sideGusset / 2)) // จีบกลาง
  } else if (backSeam) {
    // หน้าอยู่กลาง [W/2, 3W/2] → สันพับสองข้าง; รอยต่อ (กาว) ไปรวมกันกลางหลัง
    segments.push(vfold(W / 2), vfold(1.5 * W))
  } else {
    segments.push(vfold(W)) // สันข้างเดียว แบ่งหน้า/หลัง (ซองแบน 3 ด้าน)
  }
  if (bottomGusset > 0) {
    segments.push(crease(`M 0 ${st + H + bottomGusset / 2} L ${Wp} ${st + H + bottomGusset / 2}`)) // พับกลางก้น
  }

  const wLabel = flat ? 'กว้างซอง' : gus || boxp ? 'กว้างหน้า' : pillow ? 'กว้าง' : 'กว้างถุง'
  const dims: DimMark[] = [
    { a: P(fx, filmH + 12), b: P(fx + W, filmH + 12), label: `${wLabel} ${fmt(W)}` },
    { a: P(Wp, filmH + 12), b: P(width, filmH + 12), label: `ซีล ${fmt(ss)}` },
    { a: P(width + 12, st), b: P(width + 12, st + H), label: `สูง ${fmt(H)}` },
  ]
  if (bottomGusset > 0) {
    dims.push({ a: P(width + 12, st + H), b: P(width + 12, filmH), label: `ก้น ${fmt(gVal)}` })
  }
  if (sideGusset > 0) {
    dims.push({ a: P(W, filmH + 12), b: P(W + sideGusset, filmH + 12), label: `จีบข้าง ${fmt(sideGusset)}` })
  }

  if (spout) {
    // จุกที่กลางปากหน้า — วงกลม marker (ตำแหน่งเชื่อมจุก) + ป้าย
    const sr = Math.min(W, 90) * 0.09
    const cx = fcx
    const cy = st + sr + 3
    segments.push(crease(circlePath(cx, cy, sr)))
    dims.push({ a: P(cx - sr, cy - sr - 6), b: P(cx + sr, cy - sr - 6), label: `จุก ⌀${fmt(2 * sr)}` })
  }

  const addons = opts.addons ?? {}
  const hangHole = addons.hangHole === true
  const valve = addons.valve === true
  const tinTie = addons.tinTie === true
  if (hangHole) {
    // รูแขวน (euro-hole) กลางริมซีลบน — เจาะจริง (cut) ให้เครื่องปั๊มตัด
    const hr = 4
    segments.push(cut(circlePath(fcx, Math.min(st * 0.5, st - hr - 1), hr)))
    dims.push({ a: P(fcx - hr, 0), b: P(fcx + hr, 0), label: `รูแขวน ⌀${fmt(2 * hr)}` })
  }
  if (valve) {
    // วาล์วระบายแก๊สกลางหน้าถุงส่วนบน — marker (welded ไม่ตัด) + ป้าย
    const vr = valveR(W)
    const vy = st + (1 - VALVE_V) * H
    segments.push(crease(circlePath(fcx, vy, vr)))
    dims.push({ a: P(fcx - vr, vy - vr - 6), b: P(fcx + vr, vy - vr - 6), label: `วาล์ว ⌀${fmt(2 * vr)}` })
  }
  if (tinTie) {
    // ที่รัดปาก (tin-tie) — แถบลวดพาดขวางหน้า+หลัง ใกล้ปากถุง
    const ty = st + TINTIE_INSET
    segments.push(crease(`M 0 ${ty} L ${Wp} ${ty}`), crease(`M 0 ${ty + 6} L ${Wp} ${ty + 6}`))
    dims.push({ a: P(0, ty + 3), b: P(Wp, ty + 3), label: 'ที่รัดปาก (tin-tie)' })
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
    stands,
    spout,
    frontRect: { x: fx, y: st, w: W, h: H },
    // back-seam: หลังแยกซ้าย [0,W/2] + ขวา [3W/2,2W]; อื่น ๆ: หลังต่อเนื่องถัดจากหน้า(+จีบ)
    backRect: backSeam
      ? { x: 1.5 * W, y: st, w: W / 2, h: H }
      : { x: W + sideGusset, y: st, w: W, h: H },
    backSeam,
    ...(backSeam ? { backRectL: { x: 0, y: st, w: W / 2, h: H } } : {}),
    zipper,
    zipY,
    hangHole,
    valve,
    tinTie,
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
  if (style === 'flat' || style === 'pillow') return Math.max(0.04, Math.sin(Math.PI * clamp01(v)) ** 0.6)
  if (style === 'gusset' || style === 'box') {
    // ทรงเหลี่ยมก้นแบน: ฐานเต็ม (ยืนได้) ลำตัวเต็ม บีบเฉพาะปากบนซีล
    // (โดยประมาณ — ทรง 3D จริงของ gusset ใช้ brickShape ตามความยาวฟิล์ม)
    if (v < 0.05) return lerpS(0.82, 1.0, v / 0.05)
    if (v > 0.9) return lerpS(1.0, 0.12, (v - 0.9) / 0.1)
    return 1.0
  }
  // stand / spout: ก้นตั้ง → พุงป่อง → เรียวขึ้นปาก → ซีลแบน
  if (v < 0.4) return lerpS(0.82, 1.0, v / 0.4)
  if (v < 0.85) return lerpS(1.0, 0.35, (v - 0.4) / 0.45)
  return lerpS(0.35, 0.05, (v - 0.85) / 0.15)
}

// ครึ่งความกว้าง (สัดส่วนของ W/2): เต็มเกือบตลอด คอดเล็กน้อยที่ปลาย
export function pouchWidthFactor(v: number, style: PouchStyle = 'stand'): number {
  if (style === 'gusset' || style === 'box') {
    // ทรงเหลี่ยม: กว้างเต็มเกือบตลอด บีบเฉพาะปลายซีลเล็กน้อย
    if (v < 0.06) return lerpS(0.85, 1.0, v / 0.06)
    if (v > 0.94) return lerpS(1.0, 0.85, (v - 0.94) / 0.06)
    return 1.0
  }
  if (v < 0.06) return lerpS(0.9, 1.0, v / 0.06)
  if (v > 0.9) return lerpS(1.0, 0.82, (v - 0.9) / 0.1)
  return 1.0
}

// รูปหน้าตัดรอบวงที่มุม theta: วงรี (stand/flat/pillow/spout) หรือสี่เหลี่ยมมน superellipse (gusset/box)
// คืนสัดส่วน (cx, cz) ∈ [-1,1] ก่อนคูณครึ่งกว้าง/ครึ่งลึก
export function pouchSection(theta: number, style: PouchStyle = 'stand'): { cx: number; cz: number } {
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  if (style === 'gusset' || style === 'box') {
    // superellipse เลขชี้กำลัง 0.5 → สี่เหลี่ยมมุมมน (หน้า-หลังแบน ด้านข้างเป็นสัน)
    const e = 0.5
    return { cx: Math.sign(c) * Math.abs(c) ** e, cz: Math.sign(s) * Math.abs(s) ** e }
  }
  return { cx: c, cz: s }
}

// --- ทรง 3D ซองข้างจีบ (brick) แบบถุงกาแฟ/ถุงข้าวสุญญากาศ ---
// ลำตัวเหลี่ยมก้นแบน (ตั้งได้; ซีลก้นพับซ่อนใต้ฐาน) → "ไหล่" หน้า-หลังลาดเข้าหากัน จีบข้างพับเข้าเป็นสามเหลี่ยม
// → ครีบซีลบนแบนตั้งตรง กว้างเต็มหน้า. ความยาวตามผิวหน้า (ลำตัว+ไหล่) = H, ครีบ = แถบซีลบนของ dieline
// → ลายจาก dieline ลงผิว 3D ตามความยาวฟิล์มจริง ไม่ยืด
export const BRICK_SHOULDER = 0.9 // ความสูงไหล่ ÷ ครึ่งความลึกลำตัว (มาก = ไหล่ชัน)

export interface BrickShape {
  H: number // ความยาวฟิล์มหน้า (ลำตัว+ไหล่) = ความสูงลำตัวบน dieline
  a: number // ครึ่งกว้าง = W/2 คงที่ตั้งแต่ก้นถึงปลายครีบ
  b0: number // ครึ่งความลึกลำตัว
  finHalf: number // ครึ่งความหนาครีบ (ฟิล์มสองชั้นประกบ)
  creaseIn: number // รอยจีบกลางลำตัวพับเข้า
  gussetHalf: number // ความยาวครึ่งจีบ (สันข้าง→รอยจีบกลาง) — ฟิล์มไม่ยืด จึงคงที่ทุกระดับ
  bodyH: number // ความสูงลำตัวตั้งตรง (ก้นที่ y=0)
  shoulderH: number // ความสูงไหล่ (แนวดิ่ง)
  shoulderL: number // ความยาวไหล่ตามผิวฟิล์ม
  finH: number // ความสูงครีบ = แถบซีลบน
  topY: number // ความสูงรวมถึงปลายครีบ
}

export function brickShape(p: Pick<Pouch, 'W' | 'H' | 'depth3D' | 'frontRect'>): BrickShape {
  const a = p.W / 2
  const b0 = p.depth3D
  const finHalf = Math.max(0.35, b0 * 0.025)
  const creaseIn = Math.min(a * 0.14, b0 * 0.28)
  const drop = b0 - finHalf
  // ไหล่ไม่กินเกิน 60% ของความยาวหน้า (ถุงเตี้ย-จีบลึก → ไหล่ราบลง)
  const shoulderH = Math.min(b0 * BRICK_SHOULDER, Math.sqrt(Math.max(0, (p.H * 0.6) ** 2 - drop * drop)))
  const shoulderL = Math.hypot(shoulderH, drop)
  const bodyH = Math.max(p.H * 0.4, p.H - shoulderL)
  const finH = p.frontRect.y
  return {
    H: p.H,
    a,
    b0,
    finHalf,
    creaseIn,
    gussetHalf: Math.hypot(b0, creaseIn),
    bodyH,
    shoulderH,
    shoulderL,
    finH,
    topY: bodyH + shoulderH + finH,
  }
}

// รอยจีบพับเข้าเมื่อหน้า-หลังบีบเหลือครึ่งลึก b (ครึ่งจีบยาวคงที่ → d = √(ครึ่งจีบ² − b²))
const brickFold = (s: BrickShape, b: number) => Math.min(s.a, Math.sqrt(Math.max(0, s.gussetHalf ** 2 - b * b)))

export interface BrickRow {
  y: number // ความสูง
  b: number // ครึ่งความลึก
  d: number // รอยจีบพับเข้า
  dly: number // พิกัดแนวตั้งบน dieline (UV)
}

// แถวโปรไฟล์ก้น → ปลายครีบ พร้อมพิกัด dieline: ลำตัว = ส่วนล่างของแผงหน้า, ไหล่ = ส่วนบน, ครีบ = แถบซีลบน [0..st]
export function brickRows(s: BrickShape, st: number, nBody = 12, nShoulder = 16, nFin = 3): BrickRow[] {
  const rows: BrickRow[] = []
  for (let i = 0; i <= nBody; i++) {
    const t = i / nBody
    rows.push({ y: t * s.bodyH, b: s.b0, d: s.creaseIn, dly: st + s.shoulderL + (1 - t) * (s.H - s.shoulderL) })
  }
  for (let i = 1; i <= nShoulder; i++) {
    const t = i / nShoulder
    const b = s.b0 + (s.finHalf - s.b0) * t
    rows.push({ y: s.bodyH + t * s.shoulderH, b, d: brickFold(s, b), dly: st + (1 - t) * s.shoulderL })
  }
  for (let i = 1; i <= nFin; i++) {
    const t = i / nFin
    rows.push({ y: s.bodyH + s.shoulderH + t * s.finH, b: s.finHalf, d: brickFold(s, s.finHalf), dly: (1 - t) * st })
  }
  return rows
}

// จุดบนเส้นกึ่งกลางหน้าที่ระยะ dl ตามผิวฟิล์ม นับจากแนวซีลบน (โคนครีบ) ลงมา — ใช้วางซิป/วาล์ว/tin-tie
// ให้ตรงตำแหน่งบน dieline; tilt = มุมเอียงของผิวจากแนวดิ่ง (ไหล่เอียงไปด้านหลัง)
export function brickAt(s: BrickShape, dl: number): { y: number; b: number; d: number; tilt: number } {
  const L = s.shoulderL
  if (dl < L) {
    const t = Math.max(0, dl) / L // 0 = โคนครีบ, 1 = ขอบบนลำตัว
    const b = s.finHalf + (s.b0 - s.finHalf) * t
    return { y: s.bodyH + s.shoulderH * (1 - t), b, d: brickFold(s, b), tilt: Math.atan2(s.b0 - s.finHalf, s.shoulderH) }
  }
  const t = Math.min(1, (dl - L) / Math.max(1e-6, s.H - L))
  return { y: s.bodyH * (1 - t), b: s.b0, d: s.creaseIn, tilt: 0 }
}
