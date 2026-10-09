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

// โปรไฟล์ต่อชนิดภาชนะ + ช่วงติดฉลาก (สัดส่วนอิงรูปทรงจริงของภาชนะแต่ละแบบ)
function profileFor(matId: string, R: number, rn: number, H: number): { pts: Vec2[]; band: [number, number] } {
  if (matId === 'aluminum') {
    // กระป๋อง: ตัวตรง คอดบนเล็กน้อย ฝาปิด
    return {
      pts: [
        P(0, 0),
        P(R * 0.82, 0),
        P(R, H * 0.04),
        P(R, H * 0.86),
        ...shoulder(P(R, H * 0.86), P(R, H * 0.94), P(rn, H * 0.94)),
        P(rn, H),
        P(rn * 0.94, H),
        P(0, H), // ปิดฝาบน
      ],
      band: [H * 0.06, H * 0.82],
    }
  }
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
  if (matId === 'glass') {
    // โหล/ขวดแก้วปากกว้าง: ตัวอวบ บ่าสั้น ปากกว้าง
    return {
      pts: [
        P(0, 0),
        P(R * 0.92, 0),
        P(R, H * 0.04),
        P(R, H * 0.72),
        ...shoulder(P(R, H * 0.72), P(R, H * 0.82), P(rn, H * 0.84)),
        P(rn, H),
      ],
      band: [H * 0.1, H * 0.66],
    }
  }
  // ขวด PET: ตัวทรงกระบอก ไหล่โค้งยาว คอเล็ก ปากมีขอบ
  return {
    pts: [
      P(0, 0),
      P(R * 0.86, 0),
      P(R, H * 0.05),
      P(R, H * 0.6),
      ...shoulder(P(R, H * 0.6), P(R, H * 0.76), P(rn, H * 0.82)),
      P(rn, H * 0.95),
      P(rn * 1.12, H * 0.955),
      P(rn * 1.12, H),
    ],
    band: [H * 0.1, H * 0.55],
  }
}

export function generateVessel(box: BoxParams, mat: Material, labelStyle: LabelStyle = 'body'): Vessel {
  const { W, D, H } = box
  const R = W / 2
  // ปาก/คอต้องเล็กกว่าตัวเสมอ (กันผู้ใช้/AI ใส่ D เกิน W)
  const rn = Math.min(Math.max(D / 2, 5), R * 0.9)

  const { pts, band } = profileFor(mat.id, R, rn, H)
  // ช่วงลำตัวตรง (รัศมี ~R) = ขอบเขตที่ฉลากติดได้จริง ใช้คำนวณรูปแบบฉลากแต่ละแบบ
  const straightYs = pts.filter((p) => p.x >= R * 0.98).map((p) => p.y)
  let b0 = straightYs.length ? Math.min(...straightYs) : band[0]
  let b1 = straightYs.length ? Math.max(...straightYs) : band[1]
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

  // --- dieline ฉลาก: แผ่นพันรอบตัว = เส้นรอบวง + ระยะทับซ้อน ---
  const circ = 2 * Math.PI * R
  const h = labelY1 - labelY0
  const w = circ + LABEL_OVERLAP

  const panels: Panel[] = [
    // แยกส่วนทากาวเป็นแผงต่างหาก: ขอบร่วมที่ x=circ กลายเป็นรอยต่อ (ไม่ใช่ขอบนอก)
    // เส้นไกด์ bleed จึงไม่ขึ้นตรงรอยต่อ และ safe area จัดกลางเฉพาะส่วนที่มองเห็นจริง
    { id: 'label', parentId: null, outline: rect(0, 0, circ, h), stage: 0 },
    { id: 'glue', parentId: 'label', outline: rect(circ, 0, w, h), stage: 0 },
  ]

  const cut = (d: string): Segment => ({ kind: 'cut', d })
  const crease = (d: string): Segment => ({ kind: 'crease', d })
  const segments: Segment[] = [
    cut(`M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`),
    crease(`M ${circ} 0 L ${circ} ${h}`), // แนวทับซ้อน/ทากาว
  ]

  const dims: DimMark[] = [
    { a: P(0, h + 12), b: P(circ, h + 12), label: `รอบวง ${fmt(circ)}` },
    { a: P(circ, h + 12), b: P(w, h + 12), label: `กาว ${fmt(LABEL_OVERLAP)}` },
    { a: P(w + 10, 0), b: P(w + 10, h), label: `สูงฉลาก ${fmt(h)}` },
  ]

  const vessel: Vessel = {
    profile: pts,
    label: { width: w, height: h, segments, panels, dims },
    labelR: R,
    labelY0,
    labelY1,
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
