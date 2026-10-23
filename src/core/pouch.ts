import type { BoxParams, Dieline, DimMark, Material, Panel, Segment, Vec2 } from './types'
import { P, fmt, rect, roundedRectPath, roundedRectPts } from './templates/shared'

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
export type PouchStyle = 'stand' | 'kseal' | 'flat' | 'gusset' | 'box' | 'pillow' | 'spout'
export const POUCH_STYLES: { id: PouchStyle; nameTh: string; detail: string }[] = [
  { id: 'stand', nameTh: 'ถุงตั้งได้ (doypack)', detail: 'ก้นตั้งได้ จุเยอะ — กาแฟ ขนม ผงชง' },
  { id: 'kseal', nameTh: 'ถุงตั้งก้น K (stand up pouch)', detail: 'ก้นตรงมุมเหลี่ยม ซีลมุมก้นทแยงรูป K — ขนม ของแห้ง ผงชง' },
  { id: 'flat', nameTh: 'ซองแบน 3 ด้าน', detail: 'แบนราบ ไม่มีก้น — ของเล็ก ตัวอย่าง มาส์ก ซองซอส' },
  { id: 'gusset', nameTh: 'ซองข้างจีบ (brick)', detail: 'ถุงกาแฟคลาสสิก ทรงแท่ง มีจีบพับสองข้าง' },
  { id: 'box', nameTh: 'ถุงก้นแบนตั้งเหลี่ยม', detail: 'quad-seal ตั้งเป็นทรงกล่อง — กาแฟพรีเมียม' },
  { id: 'pillow', nameTh: 'ซองหลังกลาง (pillow)', detail: 'ถุงขนม/ชิป พองนุ่ม ซีลหลังกลาง' },
  { id: 'spout', nameTh: 'ถุงมีจุก (spout)', detail: 'ของเหลว/เครื่องดื่ม มีจุก+ฝาเกลียว' },
]

export const POUCH_SIDE_SEAL = 6 // ริมซีล/ลิ้นทากาวข้าง (มม.)
export const POUCH_TOP_SEAL = 10 // ริมซีลปากบน (มม.)
export const FLAT_SEAL = 3 // ซีลรอบซองแบน 3 ด้าน (ซ้าย/ขวา/ล่าง + ปากบนหลังบรรจุ) กว้างเท่ากัน (มม.)
// ซองแบนมีรูแขวน: ซีลบน 3 มม. ใส่รูไม่ได้ → ขยายเป็นหัวซองกว้างพอเจาะรู (รู ⌀8 + ขอบ 2 มม. บน-ล่าง)
export const DOYPACK_SEAL = 3 // ซีลข้างถุงตั้ง (มม.)
export const DOYPACK_TOP_SEAL = 5 // ซีลบนถุงตั้ง (มม.) — แคบสุดที่ยังให้รอยฉีกพ้นซีลก่อนถึงซิป
// ถุงตั้งก้น K (K-seal): มุมก้นซีลทแยงจากแนวซีลข้างที่ระดับพับก้น ลงไปถึงขอบล่างแผง — ระยะเข้าแนวนอนที่ขอบล่าง
// = สัดส่วนนี้ของครึ่งก้น (ชันกว่า 45° แบบถุงจริง); อยู่ในครึ่งก้นที่พับเข้าเป็นฐาน จึงไม่เห็นจากด้านหน้าใน 3D
export const KSEAL_REACH = 0.4
export const POUCH_FIN_SEAL = 8 // ครีบซีลหลังกลาง (fin seal) ของซองหลังกลาง — ลิ้นแต่ละข้างของแผ่น (มม.)
export const BRICK_SEAL = 20 // แถบซีลบน/ล่างของซองข้างจีบ (มม.)
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
  sideSeal: number // ซีลข้างบนแผง (แผงแยก: doypack/ซองแบน) หรือลิ้นกาว (มม.)
  zipper: boolean // มีซิปล็อก + รอยฉีกไหม
  zipY?: number // พิกัดแผ่นคลี่ y ของแนวซิป (เมื่อ zipper=true) — ใช้วางแถบซิปใน 3D
  tearY?: number // พิกัดแผ่นคลี่ y ของรอยบากฉีก (เมื่อ zipper=true)
  tearNotches: Vec2[][] // รอยบากฉีก (สามเหลี่ยม V พิกัดแผ่นคลี่) ที่ขอบแผง — dieline ตัดตามนี้, 3D เจาะผิวตามนี้ (alpha mask)
  // รูแขวน (วงกลมพิกัดแผ่นคลี่) — dieline ตัดเฉพาะ cut: true; 3D เจาะทุกวง (รวมชั้นหลังของถุงฟิล์มม้วนที่เจาะหลังขึ้นรูป)
  hangHoles: { x: number; y: number; r: number; cut: boolean }[]
  valveAt?: { x: number; y: number; r: number } // วาล์วกาแฟ (พิกัดแผ่นคลี่) — dieline เป็น marker, 3D เป็นรอยนูนบนฟิล์ม
  hangHole: boolean // รูแขวน (euro-hole) ที่ริมซีลบน
  valve: boolean // วาล์วระบายแก๊ส (กาแฟ) บนหน้าถุง
  tinTie: boolean // ที่รัดปาก (tin-tie) ใกล้ปากถุง
}

// ออปชันเสริมบนถุง (เก็บเฉพาะที่เปิด) — thread แบบเดียวกับ zipper
export interface PouchAddons {
  hangHole?: boolean
  valve?: boolean
  tinTie?: boolean
  // ตำแหน่งซิป/รอยบาก (มม. จากขอบบนถุง) — ไม่ใส่ = ค่าเริ่มต้น/อัตโนมัติ; ใช้เมื่อเปิดซิปล็อก
  zipAt?: number
  tearAt?: number
}

// ซิปล็อก + รอยบากฉีก (มม.): แนวซิปกว้างรวมปีก ~10 (±ZIP_HALF); รอยบากอัตโนมัติอยู่เหนือซิป TEAR_GAP
// ลำดับจากขอบบน: ซีลบน → รอยบาก (ต้องพ้นซีล ไม่งั้นฉีกแล้วถุงไม่เปิด) → ซิป (ฉีกแล้วเหลือซิปไว้ปิดซ้ำ)
export const ZIP_HALF = 5
export const TEAR_GAP = 8
export const TEAR_SEAL_GAP = 3 // รอยบากควรต่ำกว่าแนวซีลบนอย่างน้อยเท่านี้
export const TEAR_NOTCH_H = 2.5 // ครึ่งความสูงปากรอยบาก V (มม.)
// ความลึกรอยบาก: ต้องจบในแถบซีลข้าง (ลึกเกินซีล = ตัดเข้าช่วงบรรจุ ถุงรั่ว) — 70% ของซีล ไม่เกิน 4 มม.
export const tearNotchDepth = (sealW: number) => Math.min(4, Math.max(1.5, Math.round(sealW * 7) / 10))
export const ZIP_AT_MAX = 300
export const zipAtDefault = (st: number, H: number) => st + Math.min(POUCH_ZIP_INSET, H * 0.5)
// รอยบากอัตโนมัติ: เหนือซิป TEAR_GAP; ถ้าซิปชิดซีลจนไม่พอ → กึ่งกลางระหว่างซีลกับซิป
export const tearAtAuto = (st: number, zipY: number) =>
  zipY - TEAR_GAP >= st + TEAR_SEAL_GAP ? zipY - TEAR_GAP : (st + zipY) / 2

// ตำแหน่งจริงบน dieline (จำกัดให้วาดได้: ซิปอยู่ในลำตัว, รอยบากอยู่บนแผ่น) — ความถูกต้องเชิงผลิตตรวจใน pouchPreflight
export function pouchZipLayout(st: number, H: number, addons: PouchAddons = {}): { zipY: number; tearY: number } {
  const zipY = Math.min(st + H - 1, Math.max(st + 1, addons.zipAt ?? zipAtDefault(st, H)))
  const tearY = Math.min(st + H - 3, Math.max(3, addons.tearAt ?? tearAtAuto(st, zipY)))
  return { zipY, tearY }
}

// ตำแหน่ง marker ร่วม dieline/ตรวจไฟล์
export const HANG_HOLE_R = 4
export const FLAT_HANG_HEADER = 2 * HANG_HOLE_R + 4 // หัวซองแบนเมื่อมีรูแขวน (มม.)
export const hangHoleY = (st: number) => Math.min(st * 0.5, st - HANG_HOLE_R - 1)
// จุก (spout): r = รัศมีคอจุก; "เรือ" (ส่วนเชื่อม) กว้าง bw สอดลงจากขอบบนลึก bh ระหว่างฟิล์มสองชั้น
export const spoutMarker = (W: number, st: number) => {
  const r = Math.min(W, 90) * 0.1
  return { r, bw: 3.8 * r, bh: st + 1.6 * r }
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
  // doypack (ถุงตั้ง/มีจุก): แผงหน้า-หลังแยกกัน แต่ละแผงมีซีลข้างสองด้าน + ซีลบน + ครึ่งก้น gusset
  // ที่ซีลโค้ง (round-bottom) — แบบงานพิมพ์ถุงตั้งจริง (ไม่ใช่ฟิล์มม้วนรอบมีรอยต่อหลัง)
  const kseal = style === 'kseal'
  const doy = style === 'stand' || kseal || spout
  // ซองแบน 3 ด้าน: แผงหน้า+หลังแยกกันเหมือน doypack — ซีลซ้าย/ขวา/ล่างบนแผง (รูป ⊔) ปากบนเปิดไว้บรรจุแล้วซีลทีหลัง
  const two = doy || flat
  // ถุงที่ใช้ค่า D: stand/gusset/box/spout (ซองแบน/หลังกลางไม่มีก้น-จีบ)
  const gVal = flat || pillow ? 0 : Math.min(Math.max(D, 10), W)
  const sideGusset = gus || boxp ? gVal : 0 // จีบข้าง: ซองข้างจีบ + ถุงก้นแบน
  const bottomGusset = style === 'stand' || kseal || boxp || spout ? gVal : 0 // ก้น gusset: ถุงตั้ง/ก้น K/ก้นแบน/มีจุก
  // ตั้งได้เมื่อมีก้น — ซองข้างจีบก็ตั้งได้ (ซีลก้นพับซ่อนใต้ฐานแบบถุงกาแฟ ดู brickShape)
  const stands = bottomGusset > 0 || gus
  // ถุงรอยต่อกลางหลัง (back-seam): หน้าเป็นผืนต่อเนื่องกลางแผ่น หลังแยกไปสองข้าง (ขอบนอกมากาวกันกลางหลัง)
  // → ใน 3D หน้าสะอาดไม่มีรอยต่อขอบข้าง; ใช้กับ stand/pillow/spout (ไม่ใช้กับซองแบน/ข้างจีบ)
  const backSeam = pillow
  // ซองหลังกลาง: [ลิ้นครีบ pf][หลังซ้าย W/2][หน้า W][หลังขวา W/2][ลิ้นครีบ pf] — ลิ้นสองข้างประกบกัน
  // (ด้านในชนด้านใน) เป็นครีบกลางหลัง แล้วพับแนบหลังถุง
  const pf = pillow ? POUCH_FIN_SEAL : 0
  const fx = backSeam ? pf + W / 2 : 0 // จุดเริ่มพื้นที่พิมพ์หน้าบนแผ่นฟิล์ม
  const fcx = fx + W / 2 // จุดกึ่งกลางหน้า (ใช้วาง marker จุก/วาล์ว/รูแขวน)
  const ss = POUCH_SIDE_SEAL
  const hung = opts.addons?.hangHole === true
  const flatHeader = flat && hung ? FLAT_HANG_HEADER : FLAT_SEAL
  // ถุงตั้ง: ซีลบนแคบ 5 มม. (รอยฉีกยังพ้นซีลได้) — มีรูแขวน → หัวถุงกว้างพอเจาะรู
  const standTop = hung ? Math.max(DOYPACK_TOP_SEAL, FLAT_HANG_HEADER) : DOYPACK_TOP_SEAL
  const st = gus ? BRICK_SEAL : flat ? flatHeader : style === 'stand' || kseal ? standTop : POUCH_TOP_SEAL
  const sb = gus ? BRICK_SEAL : flat ? FLAT_SEAL : pillow ? POUCH_TOP_SEAL : 0 // ไม่มีก้น → ใช้ริมซีลล่างแทน
  const pss = flat ? FLAT_SEAL : style === 'stand' || kseal ? DOYPACK_SEAL : ss // ซีลข้างบนแผง (แบบแผงแยก)
  // doypack: แต่ละแผงยาวลงไปครึ่งก้น (ก้น gusset พับ W สอดระหว่างหน้า-หลัง สูง D/2)
  const filmH = st + H + (doy ? gVal / 2 : bottomGusset) + sb
  // ความกว้างพิมพ์ = หน้า + หลัง + จีบข้างสองด้าน (ไม่มีจีบ → 2W)
  const Wp = 2 * W + 2 * sideGusset
  const width = two ? Wp : pillow ? Wp + 2 * pf : Wp + ss // doypack ซีลข้างอยู่ในแผงเอง ไม่มีลิ้นกาว
  // ความลึก 3D ต่อรูปแบบ: ซองแบนบาง, หลังกลางพองนุ่ม, ทรงแท่ง=ครึ่งจีบเต็ม, ถุงตั้ง=ครึ่งก้น×สเกล
  const depth3D = flat
    ? Math.min(W, H) * 0.045 // ซองแบนพองบางมาก หนารวม ~0.09W (เทียบภาพด้านข้างซองจริง)
    : pillow
      ? Math.min(W, H) * 0.13 // พองนุ่ม หนารวม ~0.26W (เทียบภาพด้านข้างซองขนมจริง)
      : gus || boxp
        ? gVal / 2
        : (gVal / 2) * POUCH_DEPTH_SCALE
  // แนวซิป/รอยบาก: ผู้ใช้กำหนดได้ (มม. จากขอบบน) ไม่งั้นซิปใต้ปากบน 18 มม. (ไม่ต่ำเกินครึ่งลำตัว)
  const zl = zipper ? pouchZipLayout(st, H, opts.addons) : undefined
  const zipY = zl?.zipY
  const tearY = zl?.tearY

  // แผ่นฟิล์มแบน: [หน้า][…จีบ…][หลัง][…จีบ…][ลิ้นทากาว ss]; แนวตั้ง = ริมบน + ลำตัว + ก้น/ริมล่าง
  // แยกลิ้นกาวเป็นแผงต่างหาก (ขอบร่วม x=Wp เป็นรอยต่อ ไม่ใช่ขอบนอก) เหมือน dieline ฉลาก
  const panelRect = (x0: number) =>
    spout ? roundedRectPts(x0, 0, x0 + W, filmH, SPOUT_CORNER_R) : rect(x0, 0, x0 + W, filmH)
  const panels: Panel[] = two
    ? [
        { id: 'front', parentId: null, outline: panelRect(0), stage: 0 },
        { id: 'back', parentId: 'front', outline: panelRect(W), stage: 0 },
      ]
    : pillow
      ? [
          { id: 'fin-l', parentId: 'film', outline: rect(0, 0, pf, filmH), stage: 0 },
          { id: 'film', parentId: null, outline: rect(pf, 0, pf + Wp, filmH), stage: 0 },
          { id: 'fin-r', parentId: 'film', outline: rect(pf + Wp, 0, width, filmH), stage: 0 },
        ]
      : [
          { id: 'film', parentId: null, outline: rect(0, 0, Wp, filmH), stage: 0 },
          { id: 'glue', parentId: 'film', outline: rect(Wp, 0, width, filmH), stage: 0 },
        ]

  const cut = (d: string): Segment => ({ kind: 'cut', d })
  const crease = (d: string): Segment => ({ kind: 'crease', d })
  const vfold = (x: number) => crease(`M ${x} 0 L ${x} ${filmH}`)
  const circlePath = (cx: number, cy: number, r: number) =>
    `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`
  // ถุงมีจุก: แผงหน้า/หลังไดคัทมุมมน (รัศมี = ซีลข้าง) — ตัดแยกสองชิ้น ไม่ใช่สี่เหลี่ยมรวม
  const segments: Segment[] = spout
    ? [0, W].map((x0) => cut(roundedRectPath(x0, 0, x0 + W, filmH, SPOUT_CORNER_R)))
    : [cut(`M 0 0 L ${width} 0 L ${width} ${filmH} L 0 ${filmH} Z`)]
  if (doy) {
    // ต่อแผง [x0, x0+W]: เส้นซีลข้างสองด้านตลอดความสูง, ซีลบนระหว่างซีลข้าง,
    // ซีลก้นโค้ง (จากแนวบนของ gusset ที่ซีลข้าง โค้งลงกลางแผง) + แนวพับ gusset ช่วงซีลข้าง
    const fold = st + H
    const sag = DOYPACK_BOTTOM_SAG * (gVal / 2)
    if (!spout) segments.push(cut(`M ${W} 0 L ${W} ${filmH}`)) // แผงหน้า/หลังแยกกัน
    for (const x0 of [0, W]) {
      const l = x0 + pss
      const r = x0 + W - pss
      segments.push(
        crease(`M ${l} 0 L ${l} ${filmH}`),
        crease(`M ${r} 0 L ${r} ${filmH}`),
        crease(`M ${l} ${st} L ${r} ${st}`),
        // ก้น K: แนวพับก้นตรง + ซีลมุมทแยงสองข้าง (รูป K กับซีลข้าง); doypack: ซีลก้นโค้ง (round-bottom)
        ...(kseal
          ? [
              crease(`M ${l} ${fold} L ${r} ${fold}`),
              crease(`M ${l} ${fold} L ${l + KSEAL_REACH * (gVal / 2)} ${filmH}`),
              crease(`M ${r} ${fold} L ${r - KSEAL_REACH * (gVal / 2)} ${filmH}`),
            ]
          : [crease(`M ${l} ${fold} Q ${x0 + W / 2} ${fold + 2 * sag} ${r} ${fold}`)]),
        crease(`M ${x0} ${fold} L ${l} ${fold}`),
        crease(`M ${r} ${fold} L ${x0 + W} ${fold}`),
      )
    }
  } else if (flat) {
    segments.push(cut(`M ${W} 0 L ${W} ${filmH}`)) // แผงหน้า/หลังแยกกัน
    for (const x0 of [0, W]) {
      // ซีลซ้าย-ล่าง-ขวา (⊔) — ขอบบนเปิดไว้บรรจุ แล้วซีลปิดกว้างเท่ากันหลังบรรจุ
      const l = x0 + pss
      const r = x0 + W - pss
      segments.push(crease(`M ${l} 0 L ${l} ${filmH - sb} L ${r} ${filmH - sb} L ${r} 0`))
    }
  } else if (pillow) {
    segments.push(
      vfold(pf), // แนวครีบซีล (ซ้าย)
      vfold(pf + Wp), // แนวครีบซีล (ขวา)
      crease(`M 0 ${st} L ${width} ${st}`), // ซีลบน (ขวางเต็มแผ่น รวมครีบ)
      crease(`M 0 ${st + H} L ${width} ${st + H}`), // ซีลล่าง
    )
  } else {
    segments.push(
      vfold(Wp), // แนวทากาว/ซีลข้าง
      crease(`M 0 ${st} L ${Wp} ${st}`), // ริมซีลปากบน
      crease(`M 0 ${st + H} L ${Wp} ${st + H}`), // รอยพับก้น / ริมซีลล่าง
    )
  }
  if (two) {
    // แผงแยก ไม่มีสันพับ/รอยต่อ
  } else if (sideGusset > 0) {
    // [หน้า W][จีบ g][หลัง W][จีบ g] — สันพับ + เส้นจีบกลางของแต่ละข้าง
    segments.push(vfold(W), vfold(W + sideGusset), vfold(2 * W + sideGusset))
    segments.push(vfold(W + sideGusset / 2), vfold(2 * W + sideGusset + sideGusset / 2)) // จีบกลาง
  } else if (backSeam) {
    // หน้าอยู่กลาง → สันพับสองข้าง; ลิ้นครีบสองปลายไปประกบกันกลางหลัง
    segments.push(vfold(pf + W / 2), vfold(pf + 1.5 * W))
  } else {
    segments.push(vfold(W)) // สันข้างเดียว แบ่งหน้า/หลัง (ซองแบน 3 ด้าน)
  }
  if (bottomGusset > 0 && !doy) {
    segments.push(crease(`M 0 ${st + H + bottomGusset / 2} L ${Wp} ${st + H + bottomGusset / 2}`)) // พับกลางก้น
  }

  const wLabel = flat ? 'กว้างซอง' : gus || boxp ? 'กว้างหน้า' : pillow ? 'กว้าง' : 'กว้างถุง'
  const dims: DimMark[] = doy
    ? [
        { a: P(0, filmH + 12), b: P(W, filmH + 12), label: `${wLabel} ${fmt(W)}` },
        { a: P(W + pss, filmH + 12), b: P(2 * W - pss, filmH + 12), label: `พื้นที่บรรจุ ${fmt(W - 2 * pss)}` },
        { a: P(2 * W - pss, filmH + 12), b: P(2 * W, filmH + 12), label: `ซีลข้าง ${fmt(pss)}` },
        { a: P(width + 12, 0), b: P(width + 12, st), label: `ซีลบน ${fmt(st)}` },
        { a: P(width + 12, st), b: P(width + 12, st + H), label: `สูง ${fmt(H)}` },
        { a: P(width + 12, st + H), b: P(width + 12, filmH), label: `ก้น ${fmt(gVal / 2)} (ลึก ${fmt(gVal)})` },
      ]
    : flat
      ? [
          { a: P(0, filmH + 12), b: P(W, filmH + 12), label: `${wLabel} ${fmt(W)}` },
          { a: P(W + pss, filmH + 12), b: P(2 * W - pss, filmH + 12), label: `พื้นที่บรรจุ ${fmt(W - 2 * pss)}` },
          { a: P(2 * W - pss, filmH + 12), b: P(2 * W, filmH + 12), label: `ซีล ${fmt(pss)}` },
          { a: P(width + 12, 0), b: P(width + 12, st), label: `ซีลบน ${fmt(st)}` },
          { a: P(width + 12, st), b: P(width + 12, st + H), label: `สูง ${fmt(H)}` },
          { a: P(width + 12, st + H), b: P(width + 12, filmH), label: `ซีลล่าง ${fmt(sb)}` },
        ]
      : pillow
      ? [
          { a: P(fx, filmH + 12), b: P(fx + W, filmH + 12), label: `${wLabel} ${fmt(W)}` },
          { a: P(pf + Wp, filmH + 12), b: P(width, filmH + 12), label: `ครีบซีล ${fmt(pf)}` },
          { a: P(width + 12, 0), b: P(width + 12, st), label: `ซีลบน ${fmt(st)}` },
          { a: P(width + 12, st), b: P(width + 12, st + H), label: `สูง ${fmt(H)}` },
          { a: P(width + 12, st + H), b: P(width + 12, filmH), label: `ซีลล่าง ${fmt(sb)}` },
        ]
      : [
          { a: P(fx, filmH + 12), b: P(fx + W, filmH + 12), label: `${wLabel} ${fmt(W)}` },
          { a: P(Wp, filmH + 12), b: P(width, filmH + 12), label: `ซีล ${fmt(ss)}` },
          { a: P(width + 12, st), b: P(width + 12, st + H), label: `สูง ${fmt(H)}` },
        ]
  if (bottomGusset > 0 && !doy) {
    dims.push({ a: P(width + 12, st + H), b: P(width + 12, filmH), label: `ก้น ${fmt(gVal)}` })
  }
  if (sideGusset > 0) {
    dims.push({ a: P(W, filmH + 12), b: P(W + sideGusset, filmH + 12), label: `จีบข้าง ${fmt(sideGusset)}` })
  }
  if (gus) {
    dims.push(
      { a: P(width + 12, 0), b: P(width + 12, st), label: `ซีลบน ${fmt(st)}` },
      { a: P(width + 12, st + H), b: P(width + 12, filmH), label: `ซีลล่าง ${fmt(sb)}` },
    )
  }

  if (spout) {
    // จุกกลางขอบบน: แนวเชื่อม "เรือ" ของจุกบนทั้งสองแผง (เรือสอดระหว่างฟิล์มสองชั้นจากขอบบน) + ป้าย
    const { r: sr, bw, bh } = spoutMarker(W, st)
    for (const cx of [fcx, W + W / 2]) {
      const l = cx - bw / 2
      const r = cx + bw / 2
      segments.push(crease(`M ${l} 0 L ${l} ${bh * 0.55} Q ${l} ${bh} ${cx} ${bh} Q ${r} ${bh} ${r} ${bh * 0.55} L ${r} 0`))
    }
    dims.push({ a: P(fcx - bw / 2, bh + 6), b: P(fcx + bw / 2, bh + 6), label: `จุก ⌀${fmt(2 * sr)}` })
  }

  const addons = opts.addons ?? {}
  const hangHole = addons.hangHole === true
  const valve = addons.valve === true
  const tinTie = addons.tinTie === true
  const hangHoles: Pouch['hangHoles'] = []
  if (hangHole) {
    // รูแขวน (euro-hole) กลางริมซีลบน — เจาะจริง (cut) ให้เครื่องปั๊มตัด
    const hr = HANG_HOLE_R
    // เจาะทะลุทั้งสองชั้น → doypack มีรูทั้งแผงหน้าและหลัง
    for (const cx of two ? [fcx, W + W / 2] : [fcx]) {
      segments.push(cut(circlePath(cx, hangHoleY(st), hr)))
      hangHoles.push({ x: cx, y: hangHoleY(st), r: hr, cut: true })
    }
    // ถุงฟิล์มม้วน (แผ่นเดียว ไม่ใช่ซองหลังกลาง): ชั้นหลังทะลุด้วยตอนเจาะหลังขึ้นรูป — ให้ 3D เห็นรูทะลุทั้งสองชั้น
    if (!two && !backSeam) hangHoles.push({ x: W + sideGusset + W / 2, y: hangHoleY(st), r: hr, cut: false })
    dims.push({ a: P(fcx - hr, 0), b: P(fcx + hr, 0), label: `รูแขวน ⌀${fmt(2 * hr)}` })
  }
  let valveAt: Pouch['valveAt']
  if (valve) {
    // วาล์วระบายแก๊สกลางหน้าถุงส่วนบน — marker (welded ไม่ตัด) + ป้าย
    const vr = valveR(W)
    const vy = st + (1 - VALVE_V) * H
    valveAt = { x: fcx, y: vy, r: vr }
    segments.push(crease(circlePath(fcx, vy, vr)))
    dims.push({ a: P(fcx - vr, vy - vr - 6), b: P(fcx + vr, vy - vr - 6), label: `วาล์ว ⌀${fmt(2 * vr)}` })
  }
  if (tinTie) {
    // ที่รัดปาก (tin-tie) — แถบลวดพาดขวางหน้า+หลัง ใกล้ปากถุง
    const ty = st + TINTIE_INSET
    segments.push(crease(`M 0 ${ty} L ${Wp} ${ty}`), crease(`M 0 ${ty + 6} L ${Wp} ${ty + 6}`))
    dims.push({ a: P(0, ty + 3), b: P(Wp, ty + 3), label: 'ที่รัดปาก (tin-tie)' })
  }

  const tearNotches: Vec2[][] = []
  if (zipper && zipY !== undefined && tearY !== undefined) {
    // แนวซิปล็อกพาดขวางหน้า+หลัง + รอยฉีก (V) ที่ขอบซีลสองข้าง เหนือซิปเพื่อฉีกเปิดแล้วเหลือซิปไว้ปิดซ้ำ
    const nz = tearNotchDepth(two ? pss : ss) // ลึกไม่เกินแถบซีลข้าง
    const notch = (x: number, dir: 1 | -1) => {
      const tri = [P(x, tearY - TEAR_NOTCH_H), P(x + dir * nz, tearY), P(x, tearY + TEAR_NOTCH_H)]
      tearNotches.push(tri)
      return cut(`M ${tri[0].x} ${tri[0].y} L ${tri[1].x} ${tri[1].y} L ${tri[2].x} ${tri[2].y}`)
    }
    if (two) {
      // แนวซิปต่อแผงระหว่างซีลข้าง; รอยฉีกบากที่ซีลข้างทั้งสองด้านของทั้งสองแผง (ฉีกทะลุสองชั้น)
      for (const x0 of [0, W]) segments.push(crease(`M ${x0 + pss} ${zipY} L ${x0 + W - pss} ${zipY}`))
      segments.push(notch(0, 1), notch(W, -1), notch(W, 1), notch(2 * W, -1))
    } else {
      segments.push(crease(`M 0 ${zipY} L ${Wp} ${zipY}`))
      segments.push(notch(0, 1)) // ขอบซ้าย (ริมกาว)
      segments.push(notch(width, -1)) // ขอบขวา
    }
    dims.push(
      { a: P(0, zipY), b: P(Wp, zipY), label: `ซิปล็อก ${fmt(zipY)} · รอยฉีก ${fmt(tearY)} (จากขอบบน)` },
      { a: P(-12, 0), b: P(-12, zipY), label: `ซิป ${fmt(zipY)}` },
    )
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
      ? { x: pf + 1.5 * W, y: st, w: W / 2, h: H }
      : { x: W + sideGusset, y: st, w: W, h: H },
    backSeam,
    ...(backSeam ? { backRectL: { x: pf, y: st, w: W / 2, h: H } } : {}),
    sideSeal: pss,
    zipper,
    zipY,
    tearY,
    tearNotches,
    hangHoles,
    ...(valveAt ? { valveAt } : {}),
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
// - stand/spout (doypack): 1 − v^2.8 — หนาสุดที่ก้น ข้างนูนแบบหัวกระสุน แล้วแหลมเข้าหาปาก
//   (เทียบภาพด้านข้าง doypack จริง: ที่ครึ่งความสูงยังหนา ~86% ของก้น)
// - flat: วงรีสมมาตร ซีลแบนทั้งบน-ล่าง (v→0/1 ≈ 0) พองสุดกลางลำตัว — ซองแบนไม่ตั้ง
export function pouchDepthFactor(v: number, style: PouchStyle = 'stand'): number {
  if (style === 'flat') return Math.max(0.04, Math.sin(Math.PI * clamp01(v)) ** 0.6)
  // pillow: อิ่มช่วงกลาง แล้วแหลมเข้าหาซีลบน-ล่าง (มองด้านข้างเป็นเม็ดข้าวยาว ไม่ใช่วงรีมน)
  if (style === 'pillow') return 1 - Math.abs(2 * clamp01(v) - 1) ** PILLOW_BULLET
  if (style === 'gusset' || style === 'box') {
    // ทรงเหลี่ยมก้นแบน: ฐานเต็ม (ยืนได้) ลำตัวเต็ม บีบเฉพาะปากบนซีล
    // (โดยประมาณ — ทรง 3D จริงของ gusset ใช้ brickShape ตามความยาวฟิล์ม)
    if (v < 0.05) return lerpS(0.82, 1.0, v / 0.05)
    if (v > 0.9) return lerpS(1.0, 0.12, (v - 0.9) / 0.1)
    return 1.0
  }
  // stand / spout: ทรงหัวกระสุน — หนาสุดที่ก้น (ตั้งได้เต็มฐาน) ข้างโค้งนูน แล้วบีบเป็นปลายแหลมที่ปาก
  return 1 - clamp01(v) ** DOYPACK_BULLET
}

// ครึ่งความกว้าง (สัดส่วนของ W/2): เต็มเกือบตลอด คอดเล็กน้อยที่ปลาย
export function pouchWidthFactor(v: number, style: PouchStyle = 'stand'): number {
  if (style === 'gusset' || style === 'box') {
    // ทรงเหลี่ยม: กว้างเต็มเกือบตลอด บีบเฉพาะปลายซีลเล็กน้อย
    if (v < 0.06) return lerpS(0.85, 1.0, v / 0.06)
    if (v > 0.94) return lerpS(1.0, 0.85, (v - 0.94) / 0.06)
    return 1.0
  }
  // doypack: ปากซีลกว้างเต็ม (มุมก้นมนคิดเป็นมม. ใน doypackRows)
  if (style === 'stand' || style === 'kseal' || style === 'spout') return 1.0
  if (v < 0.06) return lerpS(0.9, 1.0, v / 0.06)
  if (v > 0.9) return lerpS(1.0, 0.82, (v - 0.9) / 0.1)
  return 1.0
}

// รูปหน้าตัดรอบวงที่มุม theta: วงรี (flat/pillow), เลนส์ขอบคม (stand/spout) หรือสี่เหลี่ยมมน superellipse (gusset/box)
// คืนสัดส่วน (cx, cz) ∈ [-1,1] ก่อนคูณครึ่งกว้าง/ครึ่งลึก
export function pouchSection(theta: number, style: PouchStyle = 'stand'): { cx: number; cz: number } {
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  if (style === 'gusset' || style === 'box') {
    // superellipse เลขชี้กำลัง 0.5 → สี่เหลี่ยมมุมมน (หน้า-หลังแบน ด้านข้างเป็นสัน)
    const e = 0.5
    return { cx: Math.sign(c) * Math.abs(c) ** e, cz: Math.sign(s) * Math.abs(s) ** e }
  }
  if (style === 'stand' || style === 'kseal' || style === 'spout') return { cx: c, cz: Math.sign(s) * lensZ(c) }
  return { cx: c, cz: s }
}

// พื้นที่หน้าตัด ÷ (ครึ่งกว้าง × ครึ่งลึก): วงรี π, เลนส์ 4·P/(P+1), สี่เหลี่ยมมน ~3.6
export function pouchSectionArea(style: PouchStyle): number {
  if (style === 'gusset' || style === 'box') return 3.6
  if (style === 'stand' || style === 'kseal' || style === 'spout') return (4 * DOYPACK_LENS) / (DOYPACK_LENS + 1)
  return Math.PI
}

// --- ทรง 3D ถุงตั้ง (doypack) แบบถุงซิปตั้งได้ทั่วไป ---
// หน้าตัดเป็น "เลนส์" ฟิล์มหน้า-หลังประกบกันเป็นตะเข็บคมสองข้าง (ไม่ใช่วงรีมน), หนาสุดใกล้ก้น
// แล้วเรียวขึ้นจนแบนที่ปาก + แถบซีลบนแบนกว้างเต็ม (ครีบ = แถบซีลบนของ dieline), ก้นแบนรูปเลนส์ มุมล่างมน
export const DOYPACK_LENS = 2.4 // เลขชี้กำลังเลนส์: z = 1 − |u|^P (มาก = หน้าอิ่มเต็ม ขอบยังคม)
export const DOYPACK_BULLET = 2.8 // เลขชี้กำลังโปรไฟล์ด้านข้าง 1 − v^n (มาก = อิ่มนานแล้วค่อยบีบที่ปาก)
export const DOYPACK_PULL = 0.05 // ซีลข้างถูกดึงเข้าได้สูงสุดเท่านี้ของครึ่งกว้าง ตอนพองเต็ม (ซีลแข็ง ไม่หดตามความยาวโค้ง)
export const DOYPACK_FIN = 0.15 // ครึ่งความหนาแถบซีลบน (ฟิล์มสองชั้นประกบ)
export const SPOUT_CORNER_R = POUCH_SIDE_SEAL // มุมไดคัทมนของถุงมีจุก (≤ ซีลข้าง → ตัดเฉพาะเนื้อซีล ไม่กินช่วงพอง)
export const SPOUT_SHOULDER = 0.2 // สัดส่วนความสูงช่วงไหล่ที่ฟิล์มรวบเข้าหาเรือจุก
export const DOYPACK_BOTTOM_SAG = 0.7 // ซีลก้นโค้งลงกลางแผง = สัดส่วนของครึ่งก้น (round-bottom)
// ถุงตั้ง (doypack): ทั้งถุงเรียวเข้าหาก้น — ขอบข้าง (ซีลข้างพร้อมช่วงพอง) ร่นเข้าเป็นเส้นตรงจาก 0 ใต้ซิป
// ถึงสัดส่วนนี้ของ W ที่พื้น (ซีลก้นโค้งดึงมุมล่างเข้า) — แบบถุงตั้งจริง/ภาพอ้างอิง; ฟิล์มส่วนเกินอยู่ในความโค้งของเลนส์
export const DOYPACK_WEDGE = 0.11
// ระยะที่ขอบข้างถุงตั้งร่นเข้าที่ความสูง y (0 ที่ปลายช่วงพองใต้ซิป tipY → DOYPACK_WEDGE·W ที่พื้น); รูปแบบอื่น = 0
export const doypackTaper = (style: PouchStyle | undefined, W: number, y: number, tipY: number) =>
  style === 'stand' ? DOYPACK_WEDGE * W * Math.max(0, 1 - y / tipY) : 0
export const lensZ = (u: number) => Math.max(0, 1 - Math.min(1, Math.abs(u)) ** DOYPACK_LENS)

export interface DoypackRow {
  y: number // ความสูงจากพื้น
  a: number // ครึ่งกว้างรวมซีลข้าง (ขอบถุงอยู่ที่ x=±a)
  ai: number // ครึ่งกว้างช่วงพอง (ระหว่างซีลข้าง) — ซีลข้างแบนกว้าง a−ai
  b: number // ผิวหน้าที่กึ่งกลาง (z) รวมความหนาซีล DOYPACK_FIN
  dly: number // พิกัด dieline แนวตั้ง (ขอบล่างแผง = ความสูงแผง, ขอบบน = 0)
  cut?: number // ถุงมีจุก: ระยะที่มุมไดคัทมนกินขอบแผงเข้ามาที่แถวนี้ (ฟิล์ม u < cut ถูกตัดทิ้ง)
  flat?: number // ฟิล์มแบนรอบช่วงพอง (ไหล่ที่รวบเข้าหาเรือจุก — ฟิล์มไม่หด จึงเหลือเป็นแผ่นแบน)
  rib?: number // ร่องเกลียวเรือจุกดันฟิล์มนูน (มม.) ที่แถวนี้ ภายในครึ่งกว้าง ribW
  ribW?: number
}

// ความยาวโค้งหน้าเดียวของเลนส์ครึ่งกว้าง ai ลึก d
export function lensArc(ai: number, d: number, n = 64): number {
  let L = 0
  let px = -ai
  let pz = 0
  for (let i = 1; i <= n; i++) {
    const x = -ai + (2 * ai * i) / n
    const z = d * lensZ(x / ai)
    L += Math.hypot(x - px, z - pz)
    px = x
    pz = z
  }
  return L
}


// แถวโปรไฟล์ doypack จากพื้นถึงขอบบน:
// ช่วงพอง (พื้น → ปลายแหลมใต้ซิป) → ปากบีบแบน (ซิปแข็งหนีบปากไว้) → ซีลบน
// ซีลข้างแบนกว้าง POUCH_SIDE_SEAL ตลอดความสูง ตรงเกือบดิ่ง (ดึงเข้าเล็กน้อยตามความพอง) มุมล่างมน
// ถุงตั้ง/ก้น K: ผิวหน้าคือแผง [ซีลบน → แนวพับก้น] เท่านั้น — ครึ่งก้นใต้แนวพับพับเข้าไปเป็นฐานเลนส์บนพื้น
// (ขอบล่างผิวหน้า = ขอบฐาน, ดู `doypackFold`) แบบถุงจริง; ถุงมีจุกยังแม็พครึ่งก้นลงผิวหน้าส่วนล่าง
export function doypackRows(
  p: Pick<Pouch, 'W' | 'depth3D' | 'frontRect' | 'zipper' | 'zipY'> & {
    label: { height: number }
    sideSeal?: number
    style?: PouchStyle
    gusset?: number
  },
  n = 56,
  nFin = 3,
): DoypackRow[] {
  const { W, depth3D } = p
  const st = p.frontRect.y
  const fold = doypackFold(p) // แนวพับก้นบนแผง = ขอบล่างของผิวหน้า (ไม่มีฐานแยก = ขอบล่างแผง)
  const Hi = fold - st // พื้น → ใต้ซีลบน
  // ปลายช่วงพอง: ใต้ปีกซิป (ซิปหนีบปากแบน) ไม่มีซิป → ถึงซีลบน
  const tipY =
    p.zipper && p.zipY !== undefined ? Math.max(Hi * 0.5, Math.min(Hi, fold - p.zipY - ZIP_HALF)) : Hi
  const ss = p.sideSeal ?? POUCH_SIDE_SEAL
  const Wi = W - 2 * ss
  // มุมก้นเหลี่ยม (ขอบข้างลงมาชนแถบซีลก้นเป็นมุม ไม่มน) — ก้น K: ข้างตรงดิ่งเต็มกว้าง
  const kseal = p.style === 'kseal'
  const fOf = (y: number) => (y >= tipY ? 0 : pouchDepthFactor(y / tipY, 'stand'))
  // ฐานพับใต้ถุง: ผิวหน้ายกขึ้นเหนือพื้นเท่าแถบซีลก้น (ถุงยืนบนแถบซีล — ดู doypackBasePoint)
  const rim = fold < p.label.height ? doypackRimH(p.gusset ?? 0) : 0
  const ys = Array.from({ length: n + 1 }, (_, i) => tipY * (i / n) ** 1.15)
  if (tipY < Hi - 1e-6) ys.push(tipY + (Hi - tipY) / 2, Hi)
  // UV แนวตั้งตามความยาวผิวกลางหน้า → ลายไม่ยืดตรงช่วงโค้ง
  const dOf = (y: number) => depth3D * fOf(y)
  const cum = [0]
  for (let i = 1; i < ys.length; i++) cum.push(cum[i - 1] + Math.hypot(ys[i] - ys[i - 1], dOf(ys[i]) - dOf(ys[i - 1])))
  const total = cum[cum.length - 1] || 1
  const rows: DoypackRow[] = ys.map((y, i) => {
    // ก้น K: ซีลข้างตรงดิ่งเต็มกว้างตลอดความสูง (ไม่ดึงเข้าตามความพอง) — มองหน้าเป็นสี่เหลี่ยม
    const ai = (Wi / 2) * (1 - (kseal ? 0 : DOYPACK_PULL) * fOf(y)) - doypackTaper(p.style, W, y, tipY)
    return { y: rim + y, a: ai + ss, ai, b: DOYPACK_FIN + dOf(y), dly: fold - (cum[i] / total) * Hi }
  })
  for (let i = 1; i <= nFin; i++) {
    const t = i / nFin
    rows.push({ y: rim + Hi + t * st, a: W / 2, ai: Wi / 2, b: DOYPACK_FIN, dly: (1 - t) * st })
  }
  return rows
}

// แนวพับก้นบนแผง (พิกัด dieline แนวตั้ง): ถุงตั้ง/ก้น K พับครึ่งก้นเข้าเป็นฐาน → ผิวหน้าจบที่ซีลบน + ลำตัว;
// ถุงมีจุก/อื่น ๆ แม็พทั้งแผงลงผิวหน้า → ขอบล่างแผง
export const doypackFold = (p: { label: { height: number }; style?: PouchStyle; gusset?: number }) =>
  (p.style === 'stand' || p.style === 'kseal' || p.style === 'spout') && (p.gusset ?? 0) > 0
    ? p.label.height - (p.gusset ?? 0) / 2
    : p.label.height

// ฐานถุงตั้ง: ครึ่งก้นของแผงหน้า/หลังปูเป็นครึ่งเลนส์ — จากขอบฐาน (แนวพับก้น) เข้าหาแนวพับกลางก้น (ขอบล่างแผง)
// ตามแกนยาวของเลนส์ แบบก้น doypack จริง (ภาพอ้างอิง): แถบซีลก้น (ก้นซีลติดแผง) ห้อยลงจากขอบล่างผิวหน้าถึงพื้นสูง rim
// — มองหน้าเห็นเป็นแถบตามขอบล่าง ต่อจากซีลข้างเป็นมุมเหลี่ยม, มองใต้ถุงเห็นเป็นขอบรอบเลนส์ที่ถุงยืน —
// แล้วก้น gusset โก่งเป็นโดมเข้าในถุงจากขอบบนพื้นถึงแกนกลางสูง lift
export const DOYPACK_RIM = 0.06 // ความสูงขอบซีลก้น = สัดส่วนความลึกก้น (สูงสุด 4 มม.)
export const DOYPACK_BASE_LIFT = 0.1 // ความโก่งของโดมก้นเหนือขอบ = สัดส่วนความลึกก้น (สูงสุด 8 มม.)
export const DOYPACK_RIM_T = 0.15 // สัดส่วนฟิล์มครึ่งก้น (จากแนวพับก้น) ที่เป็นแถบขอบซีล
export const doypackRimH = (gusset: number) => Math.min(4, DOYPACK_RIM * gusset)
export const doypackBaseLift = (gusset: number) => Math.min(8, DOYPACK_BASE_LIFT * gusset)
// จุดบนฐานที่ t ∈ [0,1] (0 = ขอบล่างผิวหน้าที่ความสูง rim, 1 = แนวกลางก้น) ใต้จุดขอบ (x, zEdge):
// ช่วงแรกเป็นแถบซีลก้นห้อยดิ่งลงถึงพื้น แล้วโค้งเป็นโดมเข้าหาแกนกลาง (z = 0) ที่ความสูง lift
export const doypackBasePoint = (x: number, zEdge: number, t: number, lift: number, rim = 0) => {
  if (rim > 0 && t <= DOYPACK_RIM_T) return { x, y: rim * (1 - t / DOYPACK_RIM_T), z: zEdge }
  const s = rim > 0 ? (t - DOYPACK_RIM_T) / (1 - DOYPACK_RIM_T) : t
  return { x, y: lift * Math.sin((Math.PI / 2) * s), z: zEdge * (1 - s) }
}

// ผิวหน้า (z ≥ 0) ที่ x ของแถว: ซีลข้างแบน = DOYPACK_FIN, ช่วงพองเป็นเลนส์
// หน้าตัดช่วงพอง (0..1) ที่ u = x/ai: เลนส์ขอบคม (ตะเข็บ) — ช่วงไหล่ถุงมีจุกที่ฟิล์มแบนล้อม (flat > 0)
// ค่อย ๆ เปลี่ยนเป็นโปรไฟล์ขอบลาด (1−u²)² ให้ไหล่รวบเข้าหาเรือจุกแบบนุ่ม ไม่เป็นสันคมเหมือนขวด
export const sectionZ = (r: Pick<DoypackRow, 'flat' | 'ai'>, u: number) => {
  const w = r.flat ? Math.min(1, r.flat / Math.max(1e-6, r.ai * 0.6)) : 0
  const uu = Math.min(1, Math.abs(u))
  return w ? (1 - w) * lensZ(uu) + w * (1 - uu * uu) ** 2 : lensZ(uu)
}

export const doypackZ = (r: Pick<DoypackRow, 'ai' | 'b' | 'rib' | 'ribW' | 'flat'>, x: number) => {
  const base = DOYPACK_FIN
  const rib = r.rib && r.ribW && Math.abs(x) < r.ribW ? r.rib * lensZ(x / r.ribW) : 0
  return (Math.abs(x) >= r.ai ? base : base + (r.b - base) * sectionZ(r, x / r.ai)) + rib
}

// ถุงมีจุก (spout pouch): doypack + จุกกลางขอบบน — ฟิล์มช่วงไหล่รวบเข้าหา "เรือ" ของจุก (ปากไม่บีบแบน
// เพราะเรือค้ำไว้), มุมไดคัทมนที่ขอบบน; ครึ่งก้นพับเข้าเป็นฐานเลนส์แบบถุงตั้ง (แถบซีลก้น + โดม, `doypackBasePoint`)
// ผิวหน้าจึงแม็พแผงช่วงขอบบน → แนวพับก้น (`doypackFold`) และยกขึ้นเท่าแถบซีลก้น
export function spoutRows(
  p: Pick<Pouch, 'W' | 'H' | 'depth3D' | 'frontRect'> & { label: { height: number }; style?: PouchStyle; gusset?: number },
  n = 72,
): DoypackRow[] {
  const { W, depth3D } = p
  const st = p.frontRect.y
  const PH = doypackFold(p) // ผิวหน้า = แผงช่วง [0, แนวพับก้น]
  const rim = PH < p.label.height ? doypackRimH(p.gusset ?? 0) : 0
  const ss = POUCH_SIDE_SEAL
  const Wi = W - 2 * ss
  const sm = spoutMarker(W, st)
  const boatHalf = sm.bw / 2
  const boatT = sm.r * 0.9 // ครึ่งความหนาเรือจุก
  const ys0 = PH * (1 - SPOUT_SHOULDER)
  const Ht = PH * 1.05
  const dBody = (y: number) => depth3D * pouchDepthFactor(y / Ht, 'stand')
  const aiBody = (y: number) => (Wi / 2) * (1 - DOYPACK_PULL * (dBody(y) / depth3D))
  const rc = SPOUT_CORNER_R
  // มุมไดคัทมนเฉพาะขอบบน — มุมล่างอยู่ในครึ่งก้นที่พับเป็นฐาน
  const cutAt = (y: number) => {
    const t = y > PH - rc ? (y - (PH - rc)) / rc : 0
    return rc * (1 - Math.sqrt(Math.max(0, 1 - t * t)))
  }
  const ys = Array.from({ length: n + 1 }, (_, i) => (PH * (1 - Math.cos((Math.PI * i) / n))) / 2)
  const raw = ys.map((y) => {
    let ai = aiBody(y)
    let d = dBody(y)
    if (y > ys0) {
      const tt = (y - ys0) / (PH - ys0)
      // ความกว้างช่วงพองคงไว้นานแล้วค่อยรวบเข้าหาเรือใกล้ขอบบน (ไม่เป็นไหล่ขวด); ความลึกลดตามเร็วกว่าเล็กน้อย
      const ta = smooth(tt ** 1.6)
      const td = smooth(tt)
      ai = aiBody(ys0) + (boatHalf - aiBody(ys0)) * ta
      d = dBody(ys0) + (boatT - dBody(ys0)) * td
    }
    const flat = Math.max(0, (Wi - lensArc(ai, d)) / 2)
    const cut = cutAt(y)
    // ร่องเกลียวเรือจุกใต้ฟิล์ม: นูนเป็นลอน 3 ลอนช่วงเรือ
    const fromTop = PH - y
    const rib = fromTop < sm.bh ? 0.6 * (0.5 - 0.5 * Math.cos((2 * Math.PI * fromTop) / (sm.bh / 3))) : 0
    return { y, ai, a: ai + flat + ss - cut, b: DOYPACK_FIN + d, cut, flat, rib, ribW: boatHalf * 0.8 }
  })
  const cum = [0]
  for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + Math.hypot(raw[i].y - raw[i - 1].y, raw[i].b - raw[i - 1].b))
  const total = cum[cum.length - 1] || 1
  return raw.map((r, i) => ({ ...r, y: r.y + rim, dly: PH * (1 - cum[i] / total) }))
}

// จุดบนเส้นกึ่งกลางหน้าที่พิกัด dieline แนวตั้ง dl — ใช้วางซิป/วาล์ว/tin-tie ให้ตรง marker;
// tilt = มุมเอียงผิวจากแนวดิ่ง (ผิวเรียวเอนไปด้านหลังเมื่อสูงขึ้น)
export function doypackAt(
  rows: DoypackRow[],
  dl: number,
): { y: number; a: number; ai: number; b: number; tilt: number } {
  for (let i = 1; i < rows.length; i++) {
    const r0 = rows[i - 1]
    const r1 = rows[i]
    if (dl <= r0.dly && dl >= r1.dly) {
      const t = r0.dly === r1.dly ? 0 : (r0.dly - dl) / (r0.dly - r1.dly)
      return {
        y: r0.y + (r1.y - r0.y) * t,
        a: r0.a + (r1.a - r0.a) * t,
        ai: r0.ai + (r1.ai - r0.ai) * t,
        b: r0.b + (r1.b - r0.b) * t,
        tilt: Math.atan2(r0.b - r1.b, r1.y - r0.y),
      }
    }
  }
  const r = dl > rows[0].dly ? rows[0] : rows[rows.length - 1]
  return { y: r.y, a: r.a, ai: r.ai, b: r.b, tilt: 0 }
}

// --- ทรง 3D ซองแบน 3 ด้าน ---
// แผงหน้า/หลังแบนซีลรอบ 4 ด้าน (ปากบนซีลหลังบรรจุ) ตรงกลางพองบาง ๆ เป็นหมอนแบน: z = d·f(u)·f(v)
// (f = 1 − |t|^n ขอบช่วงพองชันจำกัด → สันคมที่แนวซีล, มุมช่วงพองมนเองจากผลคูณ)
export const FLAT_BULGE = 4 // พองเต็มเกือบถึงแนวซีล (ขอบลาดสั้น) → ซีลดูแคบเท่าที่ซีลจริง
const flatF = (t: number) => (Math.abs(t) >= 1 ? 0 : 1 - Math.abs(t) ** FLAT_BULGE)
// ผิวหน้า (z ≥ FIN) ที่พิกัดฟิล์มของแผง u ∈ [0,W] (ซ้าย→ขวา), v ∈ [0,PH] (บน→ล่าง)
export function flatZ(
  p: Pick<Pouch, 'W' | 'depth3D' | 'frontRect'> & { label: { height: number } },
  u: number,
  v: number,
): number {
  const PH = p.label.height
  const st = p.frontRect.y // ซีลบน (กว้างขึ้นเป็นหัวซองเมื่อมีรูแขวน)
  const hx = p.W / 2 - FLAT_SEAL
  const cy = (st + PH - FLAT_SEAL) / 2
  const hy = (PH - FLAT_SEAL - st) / 2
  return DOYPACK_FIN + p.depth3D * flatF((u - p.W / 2) / hx) * flatF((v - cy) / hy)
}
// จุดกลางหน้าที่พิกัด dieline แนวตั้ง dl (y จากพื้น, ผิว z, มุมเอียง) — วางวาล์ว/tin-tie
export function flatAt(p: Pick<Pouch, 'W' | 'depth3D' | 'frontRect'> & { label: { height: number } }, dl: number) {
  const PH = p.label.height
  const b = flatZ(p, p.W / 2, dl)
  return { y: PH - dl, b, tilt: Math.atan2(b - flatZ(p, p.W / 2, dl - 1), 1) }
}

// --- ทรง 3D ซองหลังกลาง (pillow) ---
// หน้าตัดวงรี (ข้างเป็นรอยพับมน ไม่ใช่ซีล) ที่เส้นรอบรูป = ฟิล์มหน้า+หลัง 2W → พองมากตรงไหนข้างคอดเข้าตรงนั้น
// (มองจากหน้าข้างเว้าเล็กน้อยแบบซองขนม) + ซีลบน/ล่างแบนเต็มกว้าง; ครีบซีลวางแนบหลังใน viewer
export const PILLOW_BULLET = 2.2
export const ellipsePerimeter = (a: number, b: number) =>
  Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)))

export function pillowRows(
  p: Pick<Pouch, 'W' | 'H' | 'depth3D' | 'frontRect'> & { label: { height: number } },
  n = 48,
): DoypackRow[] {
  const { W, H, depth3D } = p
  const st = p.frontRect.y
  const PH = p.label.height
  const sb = PH - st - H
  const halfA = (b: number) => {
    // a ที่ทำให้เส้นรอบวงรี = 2W (ฟิล์มไม่ยืด)
    let lo = 0.3 * W
    let hi = W / 2
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2
      if (ellipsePerimeter(mid, b) > 2 * W) hi = mid
      else lo = mid
    }
    return (lo + hi) / 2
  }
  const bOf = (y: number) =>
    y <= sb || y >= sb + H ? DOYPACK_FIN : DOYPACK_FIN + depth3D * pouchDepthFactor((y - sb) / H, 'pillow')
  const body = Array.from({ length: n + 1 }, (_, i) => sb + (H * (1 - Math.cos((Math.PI * i) / n))) / 2)
  const cum = [0]
  for (let i = 1; i <= n; i++) cum.push(cum[i - 1] + Math.hypot(body[i] - body[i - 1], bOf(body[i]) - bOf(body[i - 1])))
  const total = cum[n] || 1
  const row = (y: number, dly: number): DoypackRow => {
    const b = bOf(y)
    const a = halfA(b)
    return { y, a, ai: a, b, dly }
  }
  return [
    row(0, PH),
    ...body.map((y, i) => row(y, st + H * (1 - cum[i] / total))),
    row(PH, 0),
  ]
}

// --- ทรง 3D ซองข้างจีบ (brick) แบบถุงกาแฟซิปล็อก ---
// หน้า-หลังกว้างเต็มตั้งแต่ก้นถึงขอบบน (ไม่มีไหล่หลังคา) ก้นแบนตั้งได้ (ซีลก้นพับซ่อนใต้ฐาน) จีบข้างเปิดเต็มที่ก้น
// แล้วค่อย ๆ ปิดเรียวขึ้นไปจนแบนที่ปาก — มองด้านข้างเป็นทรงหัวกระสุน (ผนังตั้งตรงที่ก้น โค้งเข้าหาปาก)
// ซิปหนีบหน้า-หลังติดกัน: จากใต้แถบซิปถึงซีลบนแบน (`flatL`); ซีลบนมุมมน `BRICK_CORNER_R`
// ความยาวตามผิวหน้า (ผนังโค้ง + ช่วงแบน + ก้นพับ) = H และแถบซีลบน = ครีบ → ลายจาก dieline ลงผิว 3D ไม่ยืด
export const BRICK_BULLET = 2.4 // เลขชี้กำลังโปรไฟล์ด้านข้าง 1−u^p (มาก = ป่องเต็มนานแล้วค่อยปิดใกล้ปาก)
export const BRICK_ZIP_BAND = 5 // ความกว้างแถบซิปใน 3D (มม.) — ช่วงแบนใต้ซีลต้องคลุมแถบนี้
export const BRICK_CORNER_R = 6 // รัศมีมุมมนของซีลบน (ไดคัทมุมถุง)

interface BrickSample {
  y: number // ความสูง
  b: number // ครึ่งความลึก
  s: number // ความยาวฟิล์มจากก้นผนัง (ตามผิวหน้า)
  tilt: number // มุมผิวจากแนวดิ่ง (เอียงเข้าหาแกน)
}

export interface BrickShape {
  H: number // ความยาวฟิล์มหน้าบน dieline (ผนัง + ช่วงแบน + ก้นพับ)
  a: number // ครึ่งกว้าง = W/2 คงที่ตั้งแต่ก้นถึงซีลบน
  b0: number // ครึ่งความลึกที่ก้น (จีบเปิดเต็ม)
  finHalf: number // ครึ่งความหนาช่วงที่หน้า-หลังประกบ (ฟิล์มสองชั้น)
  creaseIn: number // รอยจีบพับเข้าที่ก้น
  gussetHalf: number // ความยาวครึ่งจีบ (สันข้าง→รอยจีบกลาง) — ฟิล์มไม่ยืด จึงคงที่ทุกระดับ
  baseL: number // ความยาวฟิล์มปลายล่างของแผงที่พับเป็นก้นแบน (ลายส่วนนี้ไปอยู่ใต้ถุง)
  flatL: number // ความยาวฟิล์มใต้ซีลบนที่ซิปหนีบหน้า-หลังแบนติดกัน (ไม่มีซิป = 0)
  wallL: number // ความยาวฟิล์มของผนังโค้ง (ก้น → เริ่มช่วงแบน)
  bodyH: number // ความสูงผนังโค้ง (ก้นที่ y=0)
  finH: number // ความสูงซีลบน = แถบซีลบน
  cornerR: number // รัศมีมุมมนซีลบน
  topY: number // ความสูงรวมถึงขอบบน
  samples: BrickSample[] // โปรไฟล์ผนัง (y ขึ้น, s สะสม) ใช้วาง/สุ่มแถว
}

const brickB = (b0: number, finHalf: number, u: number) => finHalf + (b0 - finHalf) * (1 - Math.max(0, Math.min(1, u)) ** BRICK_BULLET)

export function brickShape(p: Pick<Pouch, 'W' | 'H' | 'depth3D' | 'frontRect' | 'zipY'>): BrickShape {
  const a = p.W / 2
  const b0 = p.depth3D
  const finHalf = 0.35 // ซีลเป็นฟิล์มบาง ความหนาไม่เพิ่มตามขนาดถุง
  const creaseIn = Math.min(a * 0.14, b0 * 0.28)
  const flatL =
    p.zipY === undefined ? 0 : Math.min(p.H * 0.45, Math.max(0, p.zipY - p.frontRect.y + BRICK_ZIP_BAND / 2 + 1))
  const baseL = Math.min(b0, (p.H - flatL) * 0.25)
  const wallL = Math.max(1, p.H - flatL - baseL)
  // หาความสูงผนัง hw ที่ความยาวโค้ง z = b(y/hw) เท่ากับฟิล์ม wallL (ฟิล์มไม่ยืด)
  const N = 64
  const build = (hw: number): BrickSample[] => {
    const out: BrickSample[] = []
    let s = 0
    for (let i = 0; i <= N; i++) {
      const u = i / N
      const y = u * hw
      const b = brickB(b0, finHalf, u)
      if (i) s += Math.hypot(y - out[i - 1].y, b - out[i - 1].b)
      const slope = ((b0 - finHalf) * BRICK_BULLET * u ** (BRICK_BULLET - 1)) / hw // −db/dy
      out.push({ y, b, s, tilt: Math.atan(slope) })
    }
    return out
  }
  let lo = 0
  let hi = wallL
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2
    const t = build(mid)
    if (t[N].s > wallL) hi = mid
    else lo = mid
  }
  const samples = build(lo)
  const bodyH = lo
  const finH = p.frontRect.y
  return {
    H: p.H,
    a,
    b0,
    finHalf,
    creaseIn,
    gussetHalf: Math.hypot(b0, creaseIn),
    baseL,
    flatL,
    wallL: samples[N].s,
    bodyH,
    finH,
    cornerR: Math.max(0, Math.min(BRICK_CORNER_R, finH * 0.6, a * 0.3)),
    topY: bodyH + flatL + finH,
    samples,
  }
}

// รอยจีบพับเข้าเมื่อหน้า-หลังบีบเหลือครึ่งลึก b (ครึ่งจีบยาวคงที่ → d = √(ครึ่งจีบ² − b²))
const brickFold = (s: BrickShape, b: number) => Math.min(s.a, Math.sqrt(Math.max(0, s.gussetHalf ** 2 - b * b)))

export interface BrickRow {
  y: number // ความสูง
  b: number // ครึ่งความลึก
  d: number // รอยจีบพับเข้า
  dly: number // พิกัดแนวตั้งบน dieline (UV)
  cut?: number // มุมมนซีลบน: ขอบซ้าย-ขวาหดเข้ามาเท่านี้ (มม.) ตามส่วนโค้งวงกลมของมุม
}

// แถวโปรไฟล์ก้น → ขอบบน พร้อมพิกัด dieline: ผนัง = ส่วนล่างของแผงหน้า (เว้นปลาย baseL ที่พับเป็นก้น),
// ช่วงแบนที่ซิปหนีบ (flatL) = ใต้ซีลบน, ซีลบน = แถบซีลบน [0..st] (แถวถี่ช่วงมุมมน)
export function brickRows(s: BrickShape, st: number, nBody = 40, nFin = 3): BrickRow[] {
  const rows: BrickRow[] = []
  const top = st + s.flatL
  const step = Math.max(1, Math.round((s.samples.length - 1) / nBody))
  for (let i = 0; i < s.samples.length; i += step) {
    const q = s.samples[i]
    rows.push({ y: q.y, b: q.b, d: brickFold(s, q.b), dly: top + (s.wallL - q.s) })
  }
  const last = s.samples[s.samples.length - 1]
  if (rows[rows.length - 1].y < last.y) rows.push({ y: last.y, b: last.b, d: brickFold(s, last.b), dly: top })
  const flatY = s.bodyH
  const nFlat = s.flatL > 0 ? 3 : 0
  const dFlat = brickFold(s, s.finHalf)
  for (let i = 1; i <= nFlat; i++) {
    const t = i / nFlat
    rows.push({ y: flatY + t * s.flatL, b: s.finHalf, d: dFlat, dly: st + (1 - t) * s.flatL })
  }
  // ซีลบน: ตรงจนถึงโคนมุมมน แล้วแถวถี่ไล่ตามส่วนโค้งวงกลมของมุม
  const y0 = flatY + s.flatL
  const r = s.cornerR
  const straight = Math.max(0, s.finH - r)
  for (let i = 1; i <= nFin; i++) {
    const t = i / nFin
    rows.push({ y: y0 + t * straight, b: s.finHalf, d: dFlat, dly: st - t * straight })
  }
  const nArc = r > 0 ? 6 : 0
  for (let i = 1; i <= nArc; i++) {
    const t = i / nArc
    const h = t * r // สูงเหนือโคนมุม
    rows.push({ y: y0 + straight + h, b: s.finHalf, d: dFlat, dly: st - straight - h, cut: r - Math.sqrt(Math.max(0, r * r - h * h)) })
  }
  return rows
}

// จุดบนเส้นกึ่งกลางหน้าที่ระยะ dl ตามผิวฟิล์ม นับจากแนวซีลบน (โคนซีล) ลงมา — ใช้วางซิป/วาล์ว/tin-tie
// ให้ตรงตำแหน่งบน dieline; tilt = มุมเอียงของผิวจากแนวดิ่ง (ผนังโค้งเข้าหาปาก)
export function brickAt(s: BrickShape, dl: number): { y: number; b: number; d: number; tilt: number } {
  if (dl < s.flatL) return { y: s.bodyH + (s.flatL - Math.max(0, dl)), b: s.finHalf, d: brickFold(s, s.finHalf), tilt: 0 }
  const sw = Math.max(0, Math.min(s.wallL, s.wallL - (dl - s.flatL))) // ระยะจากก้นผนังตามผิว
  const t = s.samples
  let i = 1
  while (i < t.length - 1 && t[i].s < sw) i++
  const p = t[i - 1]
  const q = t[i]
  const f = q.s > p.s ? (sw - p.s) / (q.s - p.s) : 0
  const y = p.y + (q.y - p.y) * f
  const b = p.b + (q.b - p.b) * f
  return { y, b, d: brickFold(s, b), tilt: p.tilt + (q.tilt - p.tilt) * f }
}
