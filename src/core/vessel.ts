import type { BoxParams, Dieline, DimMark, Material, Panel, Segment, Vec2 } from './types'
import { P, fmt, rect } from './templates/shared'
import { ellipsePerimeter } from './pouch'

// ภาชนะขึ้นรูป (วัสดุกลุ่มพับไม่ได้: ขวด PET / แก้ว / กระป๋องอะลูมิเนียม)
//
// สองส่วน: (1) โปรไฟล์ revolve — เส้นรัศมีต่อความสูง หมุนรอบแกนเป็นทรง 3D (LatheGeometry)
// (2) dieline ของ "ฉลาก" ที่พันรอบตัว — เป็น Dieline ธรรมดา จึงไหลผ่านทุกระบบที่มีอยู่
// (artwork/export/guides/ใบสเปก) ได้ทันที เพราะสิ่งที่ผลิตจริงฝั่งงานพิมพ์คือฉลาก ไม่ใช่ภาชนะ
//
// ความหมายขนาดสำหรับภาชนะ: W = ⌀ตัว, D = ⌀ปาก/คอ, H = ความสูงรวม

// หลอดครีม (laminate tube) ตั้งบนฝา flip-top: ลำตัวคือท่อกลม ⌀W ที่ถูกบีบแบนเป็นตะเข็บซีลที่ยอด
// หน้าตัดเป็นวงรีที่ "เส้นรอบวงคงที่ = πW" (ท่อไม่ยืด) — ลึกลดแบบหัวกระสุนจาก R → ซีลบาง ส่วนกว้างจึงบานเอง
// จาก ⌀W (กลม) ถึง πW/2 (แบน) ที่ยอด; ซีลบนเป็นแถบแบนมีลอนกด (crimp)
// profile เก็บแค่ฝา (ทรงหมุน); ไหล่ + ลำตัว + ซีลสร้างใน VesselViewer3D จาก tubeSection
export interface TubeShape {
  R: number // รัศมีท่อ (= W/2) — หน้าตัดกลมที่ไหล่
  rcap: number // รัศมีฝา flip-top (เกือบเท่าท่อ)
  capTop: number // ความสูงยอดฝา
  bodyY0: number // ไหล่จบ → ลำตัวกลมเต็ม ⌀W เริ่มบีบ
  sealY0: number // ขอบล่างของตะเข็บซีลบน (ซีลแบนถึง H)
  sealThick: number // ความหนาตะเข็บซีล (ท่อสองชั้นประกบ)
}

export const TUBE_BULLET = 2.6 // โปรไฟล์ด้านข้าง 1 − v^n (เทียบภาพด้านข้างหลอดจริง: กลางความสูงยังหนา ~83%)
export const TUBE_SEAL = 5 // ความสูงตะเข็บซีลบน (มม.)

// หน้าตัดหลอดที่ความสูง y: ครึ่งกว้าง a (แกน x), ครึ่งลึก b (แกน z)
export function tubeSection(t: TubeShape, y: number): { a: number; b: number } {
  const { R, rcap, capTop, bodyY0, sealY0, sealThick } = t
  const half = sealThick / 2
  if (y <= bodyY0) {
    // ไหล่มนจากขอบฝาขึ้นไปเป็นท่อกลมเต็ม
    const k = Math.min(1, Math.max(0, (y - capTop) / Math.max(1e-6, bodyY0 - capTop)))
    const r = rcap * 0.96 + (R - rcap * 0.96) * Math.sin((k * Math.PI) / 2)
    return { a: r, b: r }
  }
  if (y >= sealY0) return { a: (Math.PI * R) / 2, b: half }
  const v = (y - bodyY0) / (sealY0 - bodyY0)
  const b = (R - half) * (1 - v ** TUBE_BULLET) + half
  // a ที่เส้นรอบวงรี = 2πR (ท่อไม่ยืด)
  let lo = R * 0.9
  let hi = (Math.PI * R) / 2
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2
    if (ellipsePerimeter(mid, b) > 2 * Math.PI * R) hi = mid
    else lo = mid
  }
  return { a: Math.min((lo + hi) / 2, (Math.PI * R) / 2), b }
}

export interface Vessel {
  profile: Vec2[] // (x = รัศมี, y = ความสูงจากก้น 0..H, แกน y ขึ้น) เรียงล่าง→บน
  label: Dieline
  labelR: number // รัศมีผิวที่ติดฉลาก
  labelY0: number // ช่วงความสูงของฉลากบนตัวภาชนะ
  labelY1: number
  labelRot: number // หมุนฉลากรอบแกนตั้ง (เรเดียน) จากด้านหน้า
  mouth?: Mouth // ปากขวด (ขวด/โหล/กระป๋อง) — ตำแหน่งวางฝา
  labelArc: number // มุมที่ฉลากหุ้ม (เรเดียน) — 2π = พันรอบตัว, น้อยกว่า = ฉลากแผ่นหน้า จัดกึ่งกลางด้านหน้า
  labelRange: [number, number] // ช่วงความสูงที่ติดฉลากได้ (ลำตัวตรง) — ใช้เป็นขอบเขตช่องปรับตำแหน่ง/สูง
  circ: number // เส้นรอบวงตัว (มม.)
  H: number
  tube?: TubeShape // มีเฉพาะหลอดครีม — บอก viewer ให้สร้างลำตัว loft บีบแบน
}

// ภาชนะ = พับไม่ได้ และไม่ใช่ถุงฟิล์ม (doypack) — ถุงเป็น path แยก
export const isVessel = (m: Material) => !m.foldable && m.form !== 'pouch'

export const LABEL_OVERLAP = 8
// ฝา flip-top ของหลอดครีมกว้างเกือบเท่าท่อ (⌀ ~0.8–0.92 W); D (⌀ปาก) ปรับได้ในช่วงนี้
export const tubeCapR = (R: number, rn: number) => Math.min(Math.max(rn, R * 0.8), R * 0.92) // ระยะทับซ้อนปลายฉลากสำหรับทากาว (มม.)

// หลอดครีม: สัดส่วนความสูง (×H) ของฝา/คอกลมที่ก้น (ลำตัว loft เริ่มเหนือจุดนี้)
export const TUBE_CAP_FRAC = 0.11
export const TUBE_SHOULDER_FRAC = 0.025 // ไหล่มนเหนือฝา (×H)

// รูปแบบฉลาก = ฉลากพันรอบตัวคลุมช่วงความสูงแค่ไหน (คำนวณจากช่วงลำตัวตรงของภาชนะ)
export type LabelStyle = 'body' | 'full' | 'band' | 'neck'
export const LABEL_STYLES: { id: LabelStyle; nameTh: string; detail: string }[] = [
  { id: 'body', nameTh: 'คลุมลำตัว (มาตรฐาน)', detail: 'ฉลากคลุมช่วงลำตัวหลักของภาชนะ' },
  { id: 'full', nameTh: 'สูงเต็มตัว', detail: 'คลุมเกือบทั้งลำตัว คล้ายชริงค์สลีฟ' },
  { id: 'band', nameTh: 'แถบกลางเตี้ย', detail: 'ฉลากแถบเตี้ยกลางลำตัว' },
  { id: 'neck', nameTh: 'แถบบน (ใกล้คอ)', detail: 'ฉลากแถบเตี้ยช่วงบนของลำตัว' },
]

// เก็บจุดบนเส้นโค้งกำลังสอง ใช้ทำบ่า/ไหล่ของภาชนะให้มน
function shoulder(p0: Vec2, c: Vec2, p1: Vec2, n = 6): Vec2[] {
  const out: Vec2[] = []
  for (let i = 1; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    out.push(P(u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, u * u * p0.y + 2 * u * t * c.y + t * t * p1.y))
  }
  return out
}

// สัดส่วนทรงต่อชนิดภาชนะ (×ความสูงตัว Hb ยกเว้น neck ×H) — ค่าเริ่มต้นเท่ากับทรงเดิมก่อนแยกตัว/คอ/ไหล่
// neck = คอ, base = ขอบก้นมน, shoulder = ไหล่ (จากจุดเริ่มสอบเข้าถึงโคนคอ), ctrl = จุดคุมโค้งไหล่มน (×ไหล่),
// gap = ระยะขอบบนฉลากใต้ไหล่, band0 = ขอบล่างฉลาก, foot = รัศมีก้น (×R), lip = มีขอบปาก (PET)
interface VesselShapeSpec {
  neck: number
  base: number
  shoulder: number
  ctrl: number
  gap: number
  band0: number
  foot: number
  ring: number // รัศมีขอบปาก (×รัศมีคอ)
}
const SHAPES: Record<string, VesselShapeSpec> = {
  'pet-bottle': { neck: 0.18, base: 0.061, shoulder: 0.268, ctrl: 0.728, gap: 0.061, band0: 0.122, foot: 0.86, ring: 1.12 },
  glass: { neck: 0.16, base: 0.048, shoulder: 0.143, ctrl: 0.832, gap: 0.071, band0: 0.119, foot: 0.92, ring: 1.1 },
  aluminum: { neck: 0.06, base: 0.043, shoulder: 0.085, ctrl: 1, gap: 0.043, band0: 0.064, foot: 0.82, ring: 1.08 },
}

// ความสูงคอ (มม.) = ช่วงตั้งแต่ปลายไหล่ (รัศมีลดถึงปาก) ถึงปาก — ตัว = ก้นถึงปลายไหล่ (H − คอ)
// หลอดครีมไม่มีคอ/ไหล่แบบนี้ (ตั้งบนฝา)
export const NECK_MIN = 3
export const BODY_MIN = 15
export const SHOULDER_MIN = 1
export const hasNeck = (matId: string) => matId in SHAPES
export const defaultNeckH = (matId: string, H: number) => Math.round((SHAPES[matId]?.neck ?? 0.18) * H * 2) / 2
// ช่วงความสูงคอที่ใช้ได้ที่ความสูงรวม H — ตัวต้องเหลืออย่างน้อย BODY_MIN
export const neckRange = (H: number): [number, number] => [NECK_MIN, Math.max(NECK_MIN, H - BODY_MIN)]
export const resolveNeckH = (matId: string, H: number, neckH?: number) => {
  const [lo, hi] = neckRange(H)
  return Math.min(hi, Math.max(lo, neckH ?? defaultNeckH(matId, H)))
}

// ไหล่ = รอยต่อตัว→คอ: ความสูง (มม. อยู่ในความสูงตัว ไม่เพิ่มสูงรวม) + รูปทรง
export type ShoulderStyle = 'round' | 'slope' | 'flat'
export const SHOULDER_STYLES: { id: ShoulderStyle; nameTh: string; nameEn: string }[] = [
  { id: 'round', nameTh: 'โค้งมน', nameEn: 'Rounded' },
  { id: 'slope', nameTh: 'ลาดตรง', nameEn: 'Sloped' },
  { id: 'flat', nameTh: 'ไหล่ตั้ง', nameEn: 'Square' },
]
export const defaultShoulderH = (matId: string, Hb: number) => Math.round((SHAPES[matId]?.shoulder ?? 0.268) * Hb * 2) / 2
// ไหล่สูงได้ถึงเหนือขอบก้นมน 2 มม. (ตัวตรงเหลือ ≥ 0)
export const shoulderMax = (matId: string, Hb: number) =>
  Math.max(SHOULDER_MIN, Hb - (SHAPES[matId]?.base ?? 0.061) * Hb - 2)
export const resolveShoulderH = (matId: string, Hb: number, shoulderH?: number) =>
  Math.min(shoulderMax(matId, Hb), Math.max(SHOULDER_MIN, shoulderH ?? defaultShoulderH(matId, Hb)))

// ฉลากกำหนดเอง (มม.): y = ขอบล่างจากก้น, h = สูงฉลาก, w = ยาวรอบตัว (≥ เส้นรอบวง = พันรอบ + ทับกาว)
// ค่าที่ไม่ใส่ใช้ตามรูปแบบฉลาก (LabelStyle); ทั้งหมดถูก clamp ให้อยู่บนลำตัวตรง
export interface LabelBox {
  y?: number
  h?: number
  w?: number
  rot?: number // หมุนฉลากรอบตัว (องศา) 0 = กึ่งกลางด้านหน้า, ±180 = ด้านหลัง
}
export const LABEL_MIN = 5

export interface VesselShape {
  neckH?: number
  shoulderH?: number
  shoulderStyle?: ShoulderStyle
  label?: LabelBox
  capStyle?: CapStyle // ฝาที่เลือก — ฝาจีบเปลี่ยนขอบปากเป็น crown finish (วงแหวนเตี้ย)
}

// เส้นไหล่จาก (R, s0) ถึงโคนคอ (rn, Hb) — ไม่รวมจุดเริ่ม
function shoulderPts(style: ShoulderStyle, R: number, rn: number, s0: number, Hb: number, ctrl: number): Vec2[] {
  const sh = Hb - s0
  if (style === 'slope') return [P(rn, Hb)] // ทรงกรวย: เส้นตรงตัว→คอ
  if (style === 'flat') {
    // ไหล่ตั้ง: มุมมนรัศมี ~ความสูงไหล่ แล้วบ่าแบนเข้าหาคอ
    const rr = Math.min(sh, R - rn)
    const pts = shoulder(P(R, s0), P(R, Hb), P(R - rr, Hb), 8)
    return R - rr > rn + 1e-6 ? [...pts, P(rn, Hb)] : pts
  }
  return shoulder(P(R, s0), P(R, s0 + ctrl * sh), P(rn, Hb), 8)
}

// โปรไฟล์ต่อชนิดภาชนะ + ช่วงติดฉลาก (สัดส่วนอิงรูปทรงจริงของภาชนะแต่ละแบบ)
// ลำตัว/ไหล่อิงความสูงตัว Hb = H − คอ; คอเป็นทรงกระบอก ⌀ปาก จาก Hb ถึง H
function profileFor(
  matId: string,
  R: number,
  rn: number,
  H: number,
  shape: VesselShape,
): { pts: Vec2[]; band: [number, number]; straight?: [number, number]; mouth?: Mouth } {
  if (matId === 'tube-laminate') {
    // หลอดบีบคลาสสิก: ตั้งบน "ฝา/คอกลม" ที่ก้น → ลำตัวเป็น loft วงรี (กว้างคงที่ ลึกเรียว→ซีลแบน)
    // profile นี้เก็บแค่ฝา/คอ (ทรงหมุน กลม) จบแบบ "เปิด" ที่ (rcap, capH) ให้ลำตัว loft รับต่อ
    const rcap = tubeCapR(R, rn) // รัศมีฝา flip-top — ต้องตรงกับ vessel.tube.rcap
    const capH = H * TUBE_CAP_FRAC
    return {
      pts: [
        P(0, 0),
        P(rcap, 0), // ก้นฝา (ตั้งบนฝา)
        P(rcap, capH), // ยอดฝา/คอ (จบเปิด — ลำตัว loft รับต่อ)
      ],
      band: [capH + H * 0.08, H * 0.82], // ฉลากบนช่วงลำตัว (แบบ "สูงเต็มตัว" จะขึ้นถึง ~0.9H)
    }
  }
  const sp = SHAPES[matId] ?? SHAPES['pet-bottle']
  const neck = resolveNeckH(matId, H, shape.neckH)
  const Hb = H - neck
  const sh = resolveShoulderH(matId, Hb, shape.shoulderH)
  const s0 = Hb - sh // ตัวตรงสิ้นสุด / ไหล่เริ่ม
  const baseTop = sp.base * Hb
  const body = [P(0, 0), P(R * sp.foot, 0), P(R, baseTop), P(R, s0), ...shoulderPts(shape.shoulderStyle ?? 'round', R, rn, s0, Hb, sp.ctrl)]
  // ฉลากมาตรฐาน: ขอบบนใต้ไหล่เสมอ (ไหล่สูง → ฉลากเตี้ยลง)
  const band1 = Math.max(s0 - sp.gap * Hb, baseTop + 4)
  const band: [number, number] = [Math.min(sp.band0 * Hb, band1 - 3), band1]
  // ปากขวดทุกชนิดมีขอบปาก (finish/bead) เหมือนกัน: วงแหวนสูง ~28% ของคอ — ฝาครอบทับช่วงนี้
  const lip = mouthLip(neck, H, rn, shape.capStyle === 'crown')
  const rr = rn * sp.ring
  const mouthPts = [P(rn, H - lip), P(rr, H - lip * 0.9), P(rr, H)]
  // ช่วงลำตัวตรง = ขอบก้นมนถึงไหล่เริ่ม (ไม่ใช้เกณฑ์รัศมี — ขอบปากอาจกว้างเกือบเท่าตัว)
  const out = { band, straight: [baseTop, s0] as [number, number], mouth: { rn, rr, lipY: H - lip, top: H, neckY: Hb } }
  if (matId === 'aluminum') {
    // กระป๋อง/ขวดอะลูมิเนียม: ขอบม้วนที่ปาก แล้วปิดฝาบน (ฝาเปลือกกระป๋อง)
    return { ...out, pts: [...body, ...mouthPts, P(rr * 0.94, H), P(0, H)] }
  }
  // ขวด PET / ขวดแก้ว: ปากเปิด
  return { ...out, pts: [...body, ...mouthPts] }
}

// ปากขวด: rn = รัศมีคอ, rr = รัศมีขอบปาก, lipY = ขอบล่างของขอบปาก, top = ปาก (= H), neckY = โคนคอ (ปลายไหล่)
export interface Mouth {
  rn: number
  rr: number
  lipY: number
  top: number
  neckY: number
}

// ฝาขวด (เลือกได้ — ภาพ 3D เท่านั้น ไม่อยู่ใน dieline ฉลาก)
export type CapStyle = 'none' | 'screw' | 'flip' | 'pump' | 'cork' | 'foil' | 'crown'
export const CAP_STYLES: { id: CapStyle; nameTh: string; nameEn: string; detail: string }[] = [
  { id: 'none', nameTh: 'ไม่มีฝา', nameEn: 'No cap', detail: 'แสดงปากขวดเปล่า' },
  { id: 'screw', nameTh: 'ฝาเกลียว', nameEn: 'Screw cap', detail: 'ฝาเกลียวขอบหยัก — น้ำดื่ม/เครื่องดื่ม/ซอส' },
  { id: 'flip', nameTh: 'ฝาฟลิปท็อป', nameEn: 'Flip-top cap', detail: 'ฝาเปิดพับได้ — แชมพู/ครีมอาบน้ำ/ซอส' },
  { id: 'pump', nameTh: 'หัวปั๊ม', nameEn: 'Pump', detail: 'หัวกดปั๊ม — สบู่เหลว/โลชั่น/เจล' },
  { id: 'cork', nameTh: 'จุกไวน์ (จุกก๊อก)', nameEn: 'Wine cork', detail: 'จุกก๊อกเสียบในคอขวด หัวโผล่พ้นปาก — ไวน์/สุรา/น้ำมันมะกอก' },
  { id: 'crown', nameTh: 'ฝาจีบ (crown cap)', nameEn: 'Crown cap', detail: 'ฝาโลหะขอบจีบหยัก — เบียร์/โซดา/น้ำอัดลมขวดแก้ว' },
  { id: 'foil', nameTh: 'จุกไวน์ + แคปซูลฟอยล์', nameEn: 'Cork + foil capsule', detail: 'แคปซูลฟอยล์หุ้มจุกและคอขวด — ไวน์/สปาร์กลิง' },
]
export const DEFAULT_CAP_COLOR = '#f4f4f2'
export const CORK_COLOR = '#c19a6b'
export const FOIL_COLOR = '#6e1a28'
export const CROWN_COLOR = '#c3c7cc'
// สีฝาเมื่อผู้ใช้ยังไม่เลือก — จุกก๊อกสีไม้ก๊อก, แคปซูลฟอยล์แดงไวน์, ที่เหลือขาวมาตรฐาน
export const defaultCapColor = (style: CapStyle) =>
  style === 'cork' ? CORK_COLOR : style === 'foil' ? FOIL_COLOR : style === 'crown' ? CROWN_COLOR : DEFAULT_CAP_COLOR

// ชิ้นประกอบกล่องเล็ก ๆ ของฝา (ร่องหยัก/ลิ้นเปิด/หัวฉีด) — พิกัดเดียวกับโปรไฟล์ (y จากก้น, z = ด้านหน้า)
export interface CapPart {
  x: number
  y: number
  z: number
  w: number
  h: number
  d: number
  rotY?: number
}

// รูปฝา: lathe = โปรไฟล์ทรงหมุน (x = รัศมี, y) จากขอบล่างนอกขึ้นไปจบกลางยอด; ฝาครอบขอบปากลงมาถึงใต้วงแหวน
// inner = ชิ้นทรงหมุนด้านใน (ก้านจุกก๊อกใต้แคปซูลฟอยล์) วาดด้วยสีไม้ก๊อก
export function capShape(
  style: CapStyle,
  m: Mouth,
): { lathe: Vec2[]; parts: CapPart[]; top: number; inner?: Vec2[] } | null {
  if (style === 'none') return null
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  const lipH = m.top - m.lipY
  const rc = m.rr + 0.6 // ผนังฝาครอบนอกวงแหวน
  if (style === 'screw') {
    const hc = clamp(m.rn * 1.1, 8, 40)
    const yb = m.top - Math.max(lipH + 1, hc * 0.55)
    const yt = yb + hc
    const b = Math.min(1.2, hc * 0.1)
    const parts: CapPart[] = []
    const n = Math.max(24, Math.round((2 * Math.PI * rc) / 2.2)) // ร่องหยักกันลื่นทุก ~2 มม.
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI
      parts.push({ x: Math.sin(a) * rc, y: yb + hc * 0.45, z: Math.cos(a) * rc, w: 0.7, h: hc * 0.72, d: 0.7, rotY: a })
    }
    return { lathe: [P(m.rr + 0.05, yb), P(rc, yb), P(rc, yt - b), P(rc - b, yt), P(0, yt)], parts, top: yt }
  }
  if (style === 'flip') {
    const rf = rc + Math.max(0.8, m.rn * 0.12)
    const hf = clamp(m.rn * 1.25, 10, 45)
    const yb = m.top - Math.max(lipH + 1, hf * 0.45)
    const yg = yb + hf * 0.62 // แนวแยกฝาพับ (ร่อง)
    const yt = yb + hf
    const g = 0.5
    const dome = Math.min(2, hf * 0.08)
    return {
      lathe: [
        P(m.rr + 0.05, yb),
        P(rf, yb),
        P(rf, yg - g),
        P(rf - g, yg - g / 2),
        P(rf, yg),
        P(rf, yt - dome),
        P(rf * 0.7, yt - dome * 0.2),
        P(0, yt),
      ],
      parts: [
        // ลิ้นเปิดฝาด้านหน้า + บานพับด้านหลัง
        { x: 0, y: yg + 0.8, z: rf + 0.6, w: rf * 0.55, h: 1.6, d: 1.4 },
        { x: 0, y: yg, z: -rf - 0.4, w: rf * 0.5, h: 2.2, d: 1 },
      ],
      top: yt,
    }
  }
  if (style === 'crown') {
    // ฝาจีบ: แผ่นโลหะเตี้ย ยอดนูนเล็กน้อย กระโปรงบานออกจีบเป็นหยัก 21 จีบ — ขอบปากเตี้ยครอบลงใต้วงแหวน (ล็อกใต้ขอบ),
    // ขอบปากสูงกว่าฝาครอบแค่ช่วงบน (ฝาจีบจริงสูง ~6 มม. ไม่ยืดตามวงแหวน)
    const hc = clamp(m.rn * 0.45, 4, 9)
    const yt = m.top + Math.max(0.8, hc * 0.25)
    const yb = Math.max(m.lipY - 0.5, yt - hc)
    const rc = m.rr + 0.5
    const rf = m.rr + Math.max(1, m.rn * 0.1) // ขอบล่างบานออก
    const b = Math.min(0.8, (yt - yb) * 0.15)
    const parts: CapPart[] = []
    const n = 21
    const fh = (yt - yb) * 0.62
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI
      const r = (rc + rf) / 2 + 0.25
      parts.push({ x: Math.sin(a) * r, y: yb + fh / 2, z: Math.cos(a) * r, w: Math.max(0.8, (2 * Math.PI * rc) / n / 2.4), h: fh, d: 0.9, rotY: a })
    }
    return {
      lathe: [P(m.rr + 0.05, yb), P(rf, yb), P(rc, yb + (yt - yb) * 0.45), P(rc, yt - b), P(rc - b, yt), P(rc * 0.55, yt + 0.25), P(0, yt + 0.3)],
      parts,
      top: yt + 0.3,
    }
  }
  if (style === 'cork' || style === 'foil') {
    // จุกก๊อก (T-cork): ก้านเสียบในคอแน่นพอดีรู ลึก ~2×⌀คอ (ไม่เลยโคนคอ) + หัวจุกโผล่พ้นปาก กว้างกว่าขอบปากเล็กน้อย
    const rk = m.rn * 0.96
    const depth = Math.min(clamp(m.rn * 2.2, 12, 45), m.top - m.neckY - 1)
    const yb = m.top - Math.max(depth, lipH + 1)
    const rh = m.rr + 0.4
    const hh = clamp(m.rn * 0.75, 4, 18)
    const yt = m.top + hh
    const b = Math.min(1.5, hh * 0.25)
    const cork = [P(0, yb), P(rk - 0.6, yb), P(rk, yb + 0.6), P(rk, m.top), P(rh, m.top), P(rh, yt - b), P(rh - b, yt), P(0, yt)]
    if (style === 'cork') return { lathe: cork, parts: [], top: yt }
    // แคปซูลฟอยล์: หุ้มแนบหัวจุก + ขอบปาก แล้วรัดแนบคอลงมา ~3×รัศมีคอ (ไม่เลยโคนคอ — ฟอยล์ไม่หุ้มไหล่)
    // ฟอยล์หนาตามจริงบางมาก — เผื่อผิว f กันซ้อนทับผิวขวด/จุก; ก้านจุกในคอยังเห็นผ่านแก้ว (inner)
    const f = 0.3
    const yf = Math.max(m.neckY + 1, m.top - clamp(m.rn * 3, 18, 60))
    const ytf = yt + f
    return {
      lathe: [
        P(m.rn + f, Math.min(yf, m.lipY - 1)),
        P(m.rn + f, m.lipY - 0.5),
        P(m.rr + f, m.lipY),
        P(m.rr + f, m.top),
        P(rh + f, m.top + 0.2),
        P(rh + f, ytf - b),
        P(rh + f - b, ytf),
        P(0, ytf),
      ],
      parts: [],
      top: ytf,
      inner: [P(0, yb), P(rk - 0.6, yb), P(rk, yb + 0.6), P(rk, m.top), P(0, m.top)], // ก้านจุกในคอ (ไม่รวมหัว)
    }
  }
  // หัวปั๊ม: ปลอกเกลียว → ก้านกด → หัวกด + หัวฉีดยื่นไปด้านหน้า
  const hcol = clamp(m.rn * 0.8, 6, 25)
  const yb = m.top - Math.max(lipH + 1, hcol * 0.6)
  const yc = yb + hcol
  const rs = Math.max(1.5, m.rn * 0.22)
  const ys = yc + clamp(m.rn * 0.9, 6, 30)
  const ra = Math.max(5, m.rn * 0.8)
  const ha = clamp(m.rn * 0.75, 6, 22)
  const yt = ys + ha
  const b = Math.min(2, ha * 0.2)
  const nozL = Math.max(8, m.rn * 1.5)
  return {
    lathe: [
      P(m.rr + 0.05, yb),
      P(rc, yb),
      P(rc, yc - 0.8),
      P(rc - 0.8, yc),
      P(rs, yc),
      P(rs, ys),
      P(ra, ys),
      P(ra, yt - b),
      P(ra - b, yt),
      P(0, yt),
    ],
    parts: [{ x: 0, y: ys + ha * 0.62, z: ra + nozL / 2 - 1, w: Math.max(2.5, ra * 0.38), h: Math.max(2.5, ha * 0.35), d: nozL }],
    top: yt,
  }
}

// ความสูงขอบปาก (มม.) — ใช้ร่วมโปรไฟล์ขวดและตำแหน่งฝา
// ฝาจีบใช้ปากแบบ crown finish: วงแหวนเตี้ย (~0.3×รัศมีคอ, 2.5–5 มม.) ให้กระโปรงฝาจีบครอบลงล็อกใต้วงแหวนได้เหมือนขวดเบียร์
const mouthLip = (neck: number, H: number, rn: number, crown = false) =>
  Math.min(neck * 0.28, crown ? Math.min(5, Math.max(2.5, rn * 0.3)) : Math.max(1.5, H * 0.05))

export function generateVessel(box: BoxParams, mat: Material, labelStyle: LabelStyle = 'body', shape: VesselShape = {}): Vessel {
  const { W, D, H } = box
  const R = W / 2
  // ปาก/คอต้องเล็กกว่าตัวเสมอ (กันผู้ใช้/AI ใส่ D เกิน W)
  const rn = Math.min(Math.max(D / 2, 5), R * 0.9)

  const { pts, band, straight, mouth } = profileFor(mat.id, R, rn, H, shape)
  // ช่วงลำตัวตรง = ขอบเขตที่ฉลากติดได้จริง ใช้คำนวณรูปแบบฉลากแต่ละแบบ
  const straightYs = pts.filter((p) => p.x >= R * 0.98).map((p) => p.y)
  let b0 = straight ? straight[0] : straightYs.length ? Math.min(...straightYs) : band[0]
  let b1 = straight ? straight[1] : straightYs.length ? Math.max(...straightYs) : band[1]
  // หลอดครีม: ลำตัวพิมพ์ได้ทั้งตัว (profile เป็นแค่ฝา) — กำหนดขอบพิมพ์เองให้ "สูงเต็มตัว" ขึ้นถึงใกล้ซีล
  if (mat.id === 'tube-laminate') {
    // พิมพ์ได้ทั้งตัวหลอด: จากไหล่ถึงใต้ตะเข็บซีล
    b0 = (TUBE_CAP_FRAC + TUBE_SHOULDER_FRAC) * H
    b1 = H - Math.min(TUBE_SEAL, H * 0.06)
  }
  const span = Math.max(1, b1 - b0)
  let labelY0: number
  let labelY1: number
  if (labelStyle === 'full') {
    labelY0 = b0 + span * 0.03
    labelY1 = b1
  } else if (labelStyle === 'band') {
    const m = (b0 + b1) / 2
    labelY0 = m - span * 0.2
    labelY1 = m + span * 0.2
  } else if (labelStyle === 'neck') {
    labelY1 = b1 - span * 0.05
    labelY0 = labelY1 - span * 0.26
  } else if (mat.id === 'tube-laminate') {
    // หลอดพิมพ์รอบตัวทั้งท่อ (ไม่ใช่ฉลากแปะ) — มาตรฐาน = เต็มลำตัว
    labelY0 = b0
    labelY1 = b1
  } else {
    ;[labelY0, labelY1] = band
  }

  // ฉลากกำหนดเอง: สูง/ตำแหน่งแทนค่าตามรูปแบบ (อยู่บนลำตัวตรงเสมอ — ฉลากแบนพันบนไหล่โค้งไม่ได้)
  const lb = mat.id === 'tube-laminate' ? undefined : shape.label
  if (lb?.h !== undefined || lb?.y !== undefined) {
    const hh = Math.min(span, Math.max(Math.min(LABEL_MIN, span), lb.h ?? labelY1 - labelY0))
    labelY0 = Math.min(b1 - hh, Math.max(b0, lb.y ?? labelY0))
    labelY1 = labelY0 + hh
  }

  // --- dieline ฉลาก: พันรอบตัว = เส้นรอบวง + ระยะทับซ้อน / สั้นกว่าเส้นรอบวง = ฉลากแผ่นหน้า ---
  const circ = 2 * Math.PI * R
  const h = labelY1 - labelY0
  const wrapW = lb?.w === undefined ? circ : Math.min(circ, Math.max(LABEL_MIN, lb.w))
  const wrap = wrapW >= circ - 0.25
  const w = wrap ? circ + LABEL_OVERLAP : wrapW

  const cut = (d: string): Segment => ({ kind: 'cut', d })
  const crease = (d: string): Segment => ({ kind: 'crease', d })
  // พันรอบ: แยกส่วนทากาวเป็นแผงต่างหาก — ขอบร่วมที่ x=circ เป็นรอยต่อ (ไม่ใช่ขอบนอก)
  // เส้นไกด์ bleed จึงไม่ขึ้นตรงรอยต่อ และ safe area จัดกลางเฉพาะส่วนที่มองเห็นจริง
  const panels: Panel[] = wrap
    ? [
        { id: 'label', parentId: null, outline: rect(0, 0, circ, h), stage: 0 },
        { id: 'glue', parentId: 'label', outline: rect(circ, 0, w, h), stage: 0 },
      ]
    : [{ id: 'label', parentId: null, outline: rect(0, 0, w, h), stage: 0 }]
  const segments: Segment[] = [
    cut(`M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`),
    ...(wrap ? [crease(`M ${circ} 0 L ${circ} ${h}`)] : []), // แนวทับซ้อน/ทากาว
  ]

  const dims: DimMark[] = wrap
    ? [
        { a: P(0, h + 12), b: P(circ, h + 12), label: `รอบวง ${fmt(circ)}` },
        { a: P(circ, h + 12), b: P(w, h + 12), label: `กาว ${fmt(LABEL_OVERLAP)}` },
        { a: P(w + 10, 0), b: P(w + 10, h), label: `สูงฉลาก ${fmt(h)}` },
      ]
    : [
        { a: P(0, h + 12), b: P(w, h + 12), label: `ยาวฉลาก ${fmt(w)}` },
        { a: P(w + 10, 0), b: P(w + 10, h), label: `สูงฉลาก ${fmt(h)}` },
      ]

  const vessel: Vessel = {
    profile: pts,
    label: { width: w, height: h, segments, panels, dims },
    labelR: R,
    labelY0,
    labelY1,
    labelArc: wrap ? 2 * Math.PI : w / R,
    labelRot: (((lb?.rot ?? 0) % 360) * Math.PI) / 180,
    ...(mouth ? { mouth } : {}),
    labelRange: [b0, b1],
    circ,
    H,
  }
  if (mat.id === 'tube-laminate') {
    // ลำตัวหลอดเป็น loft วงรีบีบแบน (viewer สร้างจากพารามิเตอร์นี้ ต่อจากฝา/คอที่ capTop)
    vessel.tube = {
      R,
      rcap: tubeCapR(R, rn),
      capTop: TUBE_CAP_FRAC * H,
      bodyY0: (TUBE_CAP_FRAC + TUBE_SHOULDER_FRAC) * H,
      sealY0: H - Math.min(TUBE_SEAL, H * 0.06),
      sealThick: Math.max(0.8, mat.thickness * 2.5),
    }
  }
  return vessel
}
