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
  zipper: boolean // มีซิปล็อก + รอยฉีกไหม
  zipY?: number // พิกัดแผ่นคลี่ y ของแนวซิป (เมื่อ zipper=true) — ใช้วางแถบซิปใน 3D
  tearY?: number // พิกัดแผ่นคลี่ y ของรอยบากฉีก (เมื่อ zipper=true)
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
export const hangHoleY = (st: number) => Math.min(st * 0.5, st - HANG_HOLE_R - 1)
export const spoutMarker = (W: number, st: number) => {
  const r = Math.min(W, 90) * 0.09
  return { r, cy: st + r + 3 }
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
  const doy = style === 'stand' || spout
  // ถุงที่ใช้ค่า D: stand/gusset/box/spout (ซองแบน/หลังกลางไม่มีก้น-จีบ)
  const gVal = flat || pillow ? 0 : Math.min(Math.max(D, 10), W)
  const sideGusset = gus || boxp ? gVal : 0 // จีบข้าง: ซองข้างจีบ + ถุงก้นแบน
  const bottomGusset = style === 'stand' || boxp || spout ? gVal : 0 // ก้น gusset: ถุงตั้ง/ก้นแบน/มีจุก
  // ตั้งได้เมื่อมีก้น — ซองข้างจีบก็ตั้งได้ (ซีลก้นพับซ่อนใต้ฐานแบบถุงกาแฟ ดู brickShape)
  const stands = bottomGusset > 0 || gus
  // ถุงรอยต่อกลางหลัง (back-seam): หน้าเป็นผืนต่อเนื่องกลางแผ่น หลังแยกไปสองข้าง (ขอบนอกมากาวกันกลางหลัง)
  // → ใน 3D หน้าสะอาดไม่มีรอยต่อขอบข้าง; ใช้กับ stand/pillow/spout (ไม่ใช้กับซองแบน/ข้างจีบ)
  const backSeam = pillow
  const fx = backSeam ? W / 2 : 0 // จุดเริ่มพื้นที่พิมพ์หน้าบนแผ่นฟิล์ม
  const fcx = fx + W / 2 // จุดกึ่งกลางหน้า (ใช้วาง marker จุก/วาล์ว/รูแขวน)
  const ss = POUCH_SIDE_SEAL
  const st = gus ? BRICK_SEAL : POUCH_TOP_SEAL
  const sb = gus ? BRICK_SEAL : flat || pillow ? POUCH_TOP_SEAL : 0 // ไม่มีก้น → ใช้ริมซีลล่างแทน
  // doypack: แต่ละแผงยาวลงไปครึ่งก้น (ก้น gusset พับ W สอดระหว่างหน้า-หลัง สูง D/2)
  const filmH = st + H + (doy ? gVal / 2 : bottomGusset) + sb
  // ความกว้างพิมพ์ = หน้า + หลัง + จีบข้างสองด้าน (ไม่มีจีบ → 2W)
  const Wp = 2 * W + 2 * sideGusset
  const width = doy ? Wp : Wp + ss // doypack ซีลข้างอยู่ในแผงเอง ไม่มีลิ้นกาว
  // ความลึก 3D ต่อรูปแบบ: ซองแบนบาง, หลังกลางพองนุ่ม, ทรงแท่ง=ครึ่งจีบเต็ม, ถุงตั้ง=ครึ่งก้น×สเกล
  const depth3D = flat
    ? Math.min(W, H) * 0.12
    : pillow
      ? Math.min(W, H) * 0.28
      : gus || boxp
        ? gVal / 2
        : (gVal / 2) * POUCH_DEPTH_SCALE
  // แนวซิป/รอยบาก: ผู้ใช้กำหนดได้ (มม. จากขอบบน) ไม่งั้นซิปใต้ปากบน 18 มม. (ไม่ต่ำเกินครึ่งลำตัว)
  const zl = zipper ? pouchZipLayout(st, H, opts.addons) : undefined
  const zipY = zl?.zipY
  const tearY = zl?.tearY

  // แผ่นฟิล์มแบน: [หน้า][…จีบ…][หลัง][…จีบ…][ลิ้นทากาว ss]; แนวตั้ง = ริมบน + ลำตัว + ก้น/ริมล่าง
  // แยกลิ้นกาวเป็นแผงต่างหาก (ขอบร่วม x=Wp เป็นรอยต่อ ไม่ใช่ขอบนอก) เหมือน dieline ฉลาก
  const panels: Panel[] = doy
    ? [
        { id: 'front', parentId: null, outline: rect(0, 0, W, filmH), stage: 0 },
        { id: 'back', parentId: 'front', outline: rect(W, 0, 2 * W, filmH), stage: 0 },
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
  const segments: Segment[] = [cut(`M 0 0 L ${width} 0 L ${width} ${filmH} L 0 ${filmH} Z`)]
  if (doy) {
    // ต่อแผง [x0, x0+W]: เส้นซีลข้างสองด้านตลอดความสูง, ซีลบนระหว่างซีลข้าง,
    // ซีลก้นโค้ง (จากแนวบนของ gusset ที่ซีลข้าง โค้งลงกลางแผง) + แนวพับ gusset ช่วงซีลข้าง
    const fold = st + H
    const sag = DOYPACK_BOTTOM_SAG * (gVal / 2)
    segments.push(cut(`M ${W} 0 L ${W} ${filmH}`)) // แผงหน้า/หลังแยกกัน
    for (const x0 of [0, W]) {
      const l = x0 + ss
      const r = x0 + W - ss
      segments.push(
        crease(`M ${l} 0 L ${l} ${filmH}`),
        crease(`M ${r} 0 L ${r} ${filmH}`),
        crease(`M ${l} ${st} L ${r} ${st}`),
        crease(`M ${l} ${fold} Q ${x0 + W / 2} ${fold + 2 * sag} ${r} ${fold}`),
        crease(`M ${x0} ${fold} L ${l} ${fold}`),
        crease(`M ${r} ${fold} L ${x0 + W} ${fold}`),
      )
    }
  } else {
    segments.push(
      vfold(Wp), // แนวทากาว/ซีลข้าง
      crease(`M 0 ${st} L ${Wp} ${st}`), // ริมซีลปากบน
      crease(`M 0 ${st + H} L ${Wp} ${st + H}`), // รอยพับก้น / ริมซีลล่าง
    )
  }
  if (doy) {
    // แผงแยก ไม่มีสันพับ/รอยต่อ
  } else if (sideGusset > 0) {
    // [หน้า W][จีบ g][หลัง W][จีบ g] — สันพับ + เส้นจีบกลางของแต่ละข้าง
    segments.push(vfold(W), vfold(W + sideGusset), vfold(2 * W + sideGusset))
    segments.push(vfold(W + sideGusset / 2), vfold(2 * W + sideGusset + sideGusset / 2)) // จีบกลาง
  } else if (backSeam) {
    // หน้าอยู่กลาง [W/2, 3W/2] → สันพับสองข้าง; รอยต่อ (กาว) ไปรวมกันกลางหลัง
    segments.push(vfold(W / 2), vfold(1.5 * W))
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
        { a: P(W + ss, filmH + 12), b: P(2 * W - ss, filmH + 12), label: `พื้นที่บรรจุ ${fmt(W - 2 * ss)}` },
        { a: P(2 * W - ss, filmH + 12), b: P(2 * W, filmH + 12), label: `ซีลข้าง ${fmt(ss)}` },
        { a: P(width + 12, 0), b: P(width + 12, st), label: `ซีลบน ${fmt(st)}` },
        { a: P(width + 12, st), b: P(width + 12, st + H), label: `สูง ${fmt(H)}` },
        { a: P(width + 12, st + H), b: P(width + 12, filmH), label: `ก้น ${fmt(gVal / 2)} (ลึก ${fmt(gVal)})` },
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
    // จุกที่กลางปากหน้า — วงกลม marker (ตำแหน่งเชื่อมจุก) + ป้าย
    const { r: sr, cy } = spoutMarker(W, st)
    const cx = fcx
    segments.push(crease(circlePath(cx, cy, sr)))
    dims.push({ a: P(cx - sr, cy - sr - 6), b: P(cx + sr, cy - sr - 6), label: `จุก ⌀${fmt(2 * sr)}` })
  }

  const addons = opts.addons ?? {}
  const hangHole = addons.hangHole === true
  const valve = addons.valve === true
  const tinTie = addons.tinTie === true
  if (hangHole) {
    // รูแขวน (euro-hole) กลางริมซีลบน — เจาะจริง (cut) ให้เครื่องปั๊มตัด
    const hr = HANG_HOLE_R
    // เจาะทะลุทั้งสองชั้น → doypack มีรูทั้งแผงหน้าและหลัง
    for (const cx of doy ? [fcx, W + W / 2] : [fcx]) segments.push(cut(circlePath(cx, hangHoleY(st), hr)))
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

  if (zipper && zipY !== undefined && tearY !== undefined) {
    // แนวซิปล็อกพาดขวางหน้า+หลัง + รอยฉีก (V) ที่ขอบซีลสองข้าง เหนือซิปเพื่อฉีกเปิดแล้วเหลือซิปไว้ปิดซ้ำ
    const nz = 4 // ความลึกรอยฉีก
    const notch = (x: number, dir: 1 | -1) =>
      cut(`M ${x} ${tearY - 2.5} L ${x + dir * nz} ${tearY} L ${x} ${tearY + 2.5}`)
    if (doy) {
      // แนวซิปต่อแผงระหว่างซีลข้าง; รอยฉีกบากที่ซีลข้างทั้งสองด้านของทั้งสองแผง (ฉีกทะลุสองชั้น)
      for (const x0 of [0, W]) segments.push(crease(`M ${x0 + ss} ${zipY} L ${x0 + W - ss} ${zipY}`))
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
      ? { x: 1.5 * W, y: st, w: W / 2, h: H }
      : { x: W + sideGusset, y: st, w: W, h: H },
    backSeam,
    ...(backSeam ? { backRectL: { x: 0, y: st, w: W / 2, h: H } } : {}),
    zipper,
    zipY,
    tearY,
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
// - stand/spout (doypack): ก้นกว้างตั้งได้ 0.9 → หนาสุดใกล้ก้น (v≈0.12) → เรียวเกือบตรงขึ้นไปจนแบนที่ปาก
//   (มองด้านข้างเป็นหยดน้ำผอมสูง ไม่ใช่หมอนพองกลาง)
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
  // stand / spout: ก้นตั้ง → หนาสุดใกล้ก้น → เรียวขึ้น (ผสมเส้นตรง+โค้งโดม) → แบนที่ปากซีล
  if (v < DOYPACK_PEAK) return lerpS(0.9, 1.0, v / DOYPACK_PEAK)
  const t = clamp01((v - DOYPACK_PEAK) / (1 - DOYPACK_PEAK))
  return 0.5 * (1 - t) + 0.5 * Math.cos((t * Math.PI) / 2) ** 1.3
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
  if (style === 'stand' || style === 'spout') return 1.0
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
  if (style === 'stand' || style === 'spout') return { cx: c, cz: Math.sign(s) * lensZ(c) }
  return { cx: c, cz: s }
}

// พื้นที่หน้าตัด ÷ (ครึ่งกว้าง × ครึ่งลึก): วงรี π, เลนส์ 4·P/(P+1), สี่เหลี่ยมมน ~3.6
export function pouchSectionArea(style: PouchStyle): number {
  if (style === 'gusset' || style === 'box') return 3.6
  if (style === 'stand' || style === 'spout') return (4 * DOYPACK_LENS) / (DOYPACK_LENS + 1)
  return Math.PI
}

// --- ทรง 3D ถุงตั้ง (doypack) แบบถุงซิปตั้งได้ทั่วไป ---
// หน้าตัดเป็น "เลนส์" ฟิล์มหน้า-หลังประกบกันเป็นตะเข็บคมสองข้าง (ไม่ใช่วงรีมน), หนาสุดใกล้ก้น
// แล้วเรียวขึ้นจนแบนที่ปาก + แถบซีลบนแบนกว้างเต็ม (ครีบ = แถบซีลบนของ dieline), ก้นแบนรูปเลนส์ มุมล่างมน
export const DOYPACK_LENS = 2.4 // เลขชี้กำลังเลนส์: z = 1 − |u|^P (มาก = หน้าอิ่มเต็ม ขอบยังคม)
export const DOYPACK_PEAK = 0.12 // ระดับ v ที่หนาสุด (ใกล้ก้น)
export const DOYPACK_FIN = 0.35 // ครึ่งความหนาแถบซีลบน (ฟิล์มสองชั้นประกบ)
export const DOYPACK_BOTTOM_SAG = 0.7 // ซีลก้นโค้งลงกลางแผง = สัดส่วนของครึ่งก้น (round-bottom)
export const lensZ = (u: number) => Math.max(0, 1 - Math.min(1, Math.abs(u)) ** DOYPACK_LENS)

export interface DoypackRow {
  y: number // ความสูงจากพื้น
  a: number // ครึ่งกว้างรวมซีลข้าง (ขอบถุงอยู่ที่ x=±a)
  ai: number // ครึ่งกว้างช่วงพอง (ระหว่างซีลข้าง) — ซีลข้างแบนกว้าง a−ai
  b: number // ผิวหน้าที่กึ่งกลาง (z) รวมความหนาซีล DOYPACK_FIN
  dly: number // พิกัด dieline แนวตั้ง (ขอบล่างแผง = ความสูงแผง, ขอบบน = 0)
}

// ความยาวโค้งของเลนส์ครึ่งกว้าง ai ลึก d (หน้าเดียว) — ฟิล์มไม่ยืด → ใช้หา ai ที่ทำให้ยาวเท่าฟิล์มจริง
export function lensArcLength(ai: number, d: number, n = 64): number {
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

// ครึ่งกว้างช่วงพองที่ความยาวโค้ง = ความกว้างฟิล์มระหว่างซีลข้าง (ถุงยิ่งป่องยิ่งแคบลง เหมือนของจริง)
export function doypackInnerHalf(Wi: number, d: number): number {
  if (d <= 1e-6) return Wi / 2
  let lo = 0.05 * Wi
  let hi = Wi / 2
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2
    if (lensArcLength(mid, d) > Wi) hi = mid
    else lo = mid
  }
  return (lo + hi) / 2
}

// แถวโปรไฟล์ doypack จากพื้น (ขอบล่างแผง) ถึงขอบบน: ช่วงพองใต้ซีลบน + ซีลบนแบน
// ซีลข้างแบนกว้าง POUCH_SIDE_SEAL ตลอดความสูง (เหมือนแผงบน dieline)
export function doypackRows(
  p: Pick<Pouch, 'W' | 'depth3D' | 'frontRect'> & { label: { height: number } },
  n = 56,
  nFin = 3,
): DoypackRow[] {
  const { W, depth3D } = p
  const st = p.frontRect.y
  const PH = p.label.height
  const Hi = PH - st // ความสูงช่วงพอง (พื้น → ใต้ซีลบน)
  const ss = POUCH_SIDE_SEAL
  const Wi = W - 2 * ss
  const dOf = (y: number) => depth3D * pouchDepthFactor(y / Hi, 'stand')
  // แถวถี่ใกล้ก้น (ช่วงหนาสุด)
  const ys = Array.from({ length: n + 1 }, (_, i) => Hi * (i / n) ** 1.25)
  // UV แนวตั้งตามความยาวผิวกลางหน้า → ลายไม่ยืดตรงช่วงเรียว
  const cum = [0]
  for (let i = 1; i <= n; i++) cum.push(cum[i - 1] + Math.hypot(ys[i] - ys[i - 1], dOf(ys[i]) - dOf(ys[i - 1])))
  const total = cum[n] || 1
  const rows: DoypackRow[] = ys.map((y, i) => {
    const d = dOf(y)
    const ai = doypackInnerHalf(Wi, d)
    return { y, a: ai + ss, ai, b: DOYPACK_FIN + d, dly: PH - (cum[i] / total) * Hi }
  })
  for (let i = 1; i <= nFin; i++) {
    const t = i / nFin
    rows.push({ y: Hi + t * st, a: W / 2, ai: Wi / 2, b: DOYPACK_FIN, dly: (1 - t) * st })
  }
  return rows
}

// ผิวหน้า (z ≥ 0) ที่ x ของแถว: ซีลข้างแบน = DOYPACK_FIN, ช่วงพองเป็นเลนส์
export const doypackZ = (r: Pick<DoypackRow, 'ai' | 'b'>, x: number) =>
  Math.abs(x) >= r.ai ? DOYPACK_FIN : DOYPACK_FIN + (r.b - DOYPACK_FIN) * lensZ(x / r.ai)

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
  const finHalf = 0.35 // ซีลเป็นฟิล์มบาง ความหนาไม่เพิ่มตามขนาดถุง
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
