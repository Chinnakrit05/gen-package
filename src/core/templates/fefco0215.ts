import type { BoxParams, Dieline, DimMark, Material, Panel, Segment, Vec2 } from '../types'
import { P, TONGUE_IN, arcPts, fmt, rect, tongueDepth, tongueFlap, tuckSlit } from './shared'

// FEFCO 0215 — กล่องฝาบนเสียบ (tuck top) + ก้นล็อก 1-2-3 (snap-lock bottom) ตามผังโรงพิมพ์:
//   ปีกกาว | หลัง | ข้างซ้าย | หน้า | ข้างขวา   (ปีกกาวต่อแผงหลัง ทากาวด้านในผนังข้างขวา — ผังเดียวกับ reverse-tuck)
// ปากบน: ฝาเสียบที่แผงหลัง ลิ้นสอดลงแนบผนังหน้า; ลิ้นกันฝุ่นที่ผนังข้าง ขอบฝั่งหลังตรง ขอบฝั่งหน้าเฉียงหลบลิ้นเสียบ
// ก้น (ล็อกเองไม่ต้องทากาว) — พิกัดบนพื้นกล่อง: u = ระยะจากผนังหลังไปหน้า (0..Dp), v = ระยะตามแนวกว้าง
//   1) ลิ้นหลัง พับก่อน อยู่ในสุด: สี่เหลี่ยมลึก Dp/2 + tabL มีช่องบากกลางกว้าง ~Wp/3 ลึก tabL (ช่วง u = Dp/2..Dp/2+tabL)
//   2) ลิ้นข้างสองชิ้น (จากผนังข้าง) ทับนอกลิ้นหลัง: ขอบเฉียงจากมุมหลังถึงมุมในของช่องบาก (u = Dp/2, v = ขอบช่องบาก)
//      แล้วเป็นร่อง + ฟัน "ขอ" งอนย้อนไปทางหลัง: ร่องคร่อมขอบช่องบาก ฟันอยู่ในช่องบากเลยขอบในไป barb = ขัดกับลิ้นหลัง
//   3) ลิ้นหน้า (พับสุดท้าย อยู่นอกสุด) ชิ้นเดียว: คางหมูเฉียงจากมุมเข้าหาคอกว้าง Wp/3 ที่กลางก้น + ลิ้นปลาย tabL ตามแนวช่องบาก
//      ชั้นวัสดุจากนอกเข้าใน: ลิ้นหน้า → ลิ้นข้าง → ลิ้นหลัง (แผงแข็งทั้งชิ้น — 3D ไม่จำลองการงอฟัน/ลิ้นปลายสอดผ่านช่อง)
//      ปลายลิ้นก้นทั้ง 4 จบแนวเดียวกันเมื่อสัดส่วนกล่องเอื้อ (ดู tabL/sd)
// W,D,H = ขนาดด้านใน (+2t ต่อแกน)
// จังหวะพับ (WINDOWS_7) แบบประกอบจริง ก้นก่อนแล้วค่อยปากบน — ลำดับก้นตามที่ผู้ใช้กำหนด (17 พ.ย. 2026):
//   1 ลิ้นหลังพับเลยระนาบก้นเข้าในกล่อง ~30° → 2 ลิ้นข้างพับเลยระนาบตาม → 3 ทั้งคู่คืนกลับมาระนาบก้น (ขอเกี่ยวช่องบาก)
//   → 4 ลิ้นหน้าพับปิดสุดท้าย ลิ้นปลายงอขึ้นสอดลงร่องไปทับด้านในลิ้นหลัง → 5 ลิ้นกันฝุ่น + ฝา → 6 ลิ้นเสียบ
// ตอนพับเลยระนาบ ลิ้นข้างต้องอยู่ใต้ (นอก) ลิ้นหลังตลอด: ที่ตำแหน่งบนพื้น (u จากหลัง, v จากผนังข้าง) ลิ้นข้างสูง v·tanαs
// ลิ้นหลังสูง u·tanαb และเนื้อลิ้นข้างอยู่ที่ u ≥ v·Dp/2 ÷ vDiag → ลิ้นหลังพับเลยมากกว่าเมื่อกล่องกว้างกว่าลึก (ดู overBack)
const ST_BACK = 1
const ST_SIDES = 2
const ST_RETURN = 3
const ST_FRONT = 4
const ST_TOP = 5 // ลิ้นกันฝุ่น (ต้นช่วง) + ฝา (within)
const ST_TONGUE = 6
// ช่วงเวลา (แถบพับ 0..1) ใน WINDOWS_7: 1=0.22–0.38, 2=0.34–0.50, 3=0.46–0.62, 4=0.58–0.70, 5=0.68–0.90, 6=0.90–1
//   ลิ้นข้างพับเลยให้เสร็จก่อนเริ่มคืน (0.34–0.46) — คืนพร้อมกันด้วยสัดส่วนมุมคงที่ต้องเริ่มจากมุมเลยเต็ม
//   ลิ้นหน้าเริ่มหลังคืนเสร็จ (0.62–0.77) ลิ้นปลายงอช่วงท้าย (0.70–0.77); ปากบน ลิ้นกันฝุ่น 0.75–0.83 → ฝา 0.79–0.90 → ลิ้นเสียบ
const SIDE_WIN: [number, number] = [0, 0.75]
const FRONT_WIN: [number, number] = [(0.62 - 0.58) / 0.12, (0.77 - 0.58) / 0.12]
const TAB_WIN: [number, number] = [(0.7 - 0.58) / 0.12, (0.77 - 0.58) / 0.12]
const DUST_WIN: [number, number] = [0.3, 0.7]
const LID_WIN: [number, number] = [0.5, 1]
const OVER_SIDE = 30 // องศาที่ลิ้นข้างพับเลยระนาบก้น (กล่องกว้างกว่าลึกมากลดลง ดู overSide)

export function generateFefco0215(box: BoxParams, mat: Material): Dieline {
  const { W, D, H } = box
  const t = mat.thickness

  const Wp = W + 2 * t
  const Dp = D + 2 * t
  const Hp = H + 2 * t

  const glueW = Math.max(12, 10 + 2 * t)
  const taper = 4
  const cover = Math.max(6, Dp - t)
  const tongue = tongueDepth(Dp)
  const tuckIn = Math.max(1, t + 0.5)
  // ลิ้นกันฝุ่น: ฝั่งหลังร่นหลบความหนาฝาที่พับทับ, ฝั่งหน้าชิดมุม (หลบแค่ผนังหน้า) แล้วเฉียงเข้าหลบลิ้นเสียบ
  const dustBackIn = Math.max(1.5, 2 * t + 0.5)
  const dustFrontIn = Math.max(1, t + 0.5)
  const dustH = Math.max(8, Math.min(0.75 * Dp, Wp / 2 - dustBackIn - 2) - t)
  const dustSlant = Math.min(0.24 * dustH, 0.3 * Dp)
  const layer = t + 0.05

  // ก้นล็อก 1-2-3
  const half = Dp / 2
  // ลิ้นข้างลึกได้เกือบถึงกลางก้น (เว้นช่องกลางไม่ให้สองฝั่งชนกัน)
  const sdMax = Wp / 2 - Math.max(2, 2 * t + 1, Math.min(4, Wp * 0.05))
  // ปลายลิ้นก้นทั้ง 4 จบแนวเดียวกัน (แบบมาตรฐาน — ลิ้นหลัง/หน้าลึก Dp/2 + tabL): เลือก tabL ให้เท่าความลึกลิ้นข้าง
  // ในช่วงที่ลิ้นปลายยังสมส่วน; เกินช่วง (กล่องลึกกว่ากว้างมาก) ลิ้นข้างสั้นกว่าเพราะยาวเกินกลางก้นไม่ได้
  const tabL = Math.min(Math.min(25, 0.2 * Dp), Math.max(Math.max(5, 0.08 * Dp), sdMax - half)) // = ความลึกช่องบาก
  const neckW = Wp / 3 // คอ/ลิ้นปลายของลิ้นหน้า
  const clear = Math.max(0.5, t / 2) // ช่องบากกว้างกว่าลิ้นปลายข้างละเท่านี้
  const notchW = neckW + 2 * clear
  const rr = Math.min(4, tabL * 0.3) // มุมมนปลายลิ้น/ขอบช่องบาก
  const barb = Math.min(tabL * 0.3, Dp * 0.05) // ขอของลิ้นข้างย้อนไปทางหลัง
  const sideIn = Math.max(0.5, t) // ลิ้นหลัง/ลิ้นข้างร่นจากผนังที่ตั้งฉากกัน กันชนผนังหลังพับ
  // ความลึกลิ้นข้าง: ตัดให้เสมอแนวลิ้นหลัง/หน้า แต่ยังต้องยาวถึงแถบลิ้นปลาย (v ≥ Wp/3 + tabL) ให้ขอทับลิ้นปลายได้ (กล่องกว้างกว่าลึกมาก)
  const sd = Math.max(Math.min(sdMax, half + tabL), Math.min(sdMax, Wp / 3 + tabL))
  // ปลายขอบเฉียง = มุมในของช่องบากลิ้นหลัง (u = Dp/2, v = ขอบช่องบาก) — ร่องขอของลิ้นข้างคร่อมขอบช่องบากพอดี
  // ฟันขอยื่นเข้าในช่องบากแล้วงอนไปทางหลังเลยขอบในช่องบาก barb = ขัดลิ้นหลังไว้ (กล่องเล็กวัสดุหนา: ไม่เกินความลึกลิ้น)
  const vDiag = Math.min(Wp / 2 - notchW / 2, sd - 1.5)
  const hookV = vDiag + Math.min(1.2 * tabL, 0.6 * (sd - vDiag))
  const hr = Math.min(rr, sd - hookV)
  const backDepth = half + tabL

  const x1 = glueW
  const back = { x0: x1, x1: x1 + Wp }
  const sideL = { x0: back.x1, x1: back.x1 + Dp }
  const front = { x0: sideL.x1, x1: sideL.x1 + Wp }
  const sideR = { x0: front.x1, x1: front.x1 + Dp }
  const x5 = sideR.x1

  const top = cover + tongue
  const bot = top + Hp
  const width = x5
  const height = bot + Math.max(backDepth, sd)
  const tiTop = top - cover

  // ---------- รูปทรงลิ้นก้น (เรียงจุดตามแนวบานพับ ซ้าย → ขวาบนแผ่นคลี่) ----------
  // ลิ้นหลัง + ช่องบากกลาง
  const bcx = (back.x0 + back.x1) / 2
  const nL = bcx - notchW / 2
  const nR = bcx + notchW / 2
  const yb = bot + backDepth
  const backFlap: Vec2[] = [
    P(back.x0 + sideIn, bot),
    P(back.x0 + sideIn, yb),
    P(nL - rr, yb),
    ...arcPts(nL - rr, yb - rr, rr, Math.PI / 2, 0, 4).slice(1),
    P(nL, bot + half),
    P(nR, bot + half),
    ...arcPts(nR + rr, yb - rr, rr, Math.PI, Math.PI / 2, 4).slice(0, -1),
    P(nR + rr, yb),
    P(back.x1 - sideIn, yb),
    P(back.x1 - sideIn, bot),
  ]
  // ลิ้นหน้า: ตัวคางหมู + ลิ้นปลาย เป็นชิ้นเดียว (ไม่มีรอยพับคั่น)
  const tL = front.x0 + Wp / 3
  const tR = front.x1 - Wp / 3
  const yn = bot + half
  const yt = yn + tabL
  const tabPts: Vec2[] = [
    P(tL, yn),
    ...arcPts(tL + rr, yt - rr, rr, Math.PI, Math.PI / 2, 4),
    ...arcPts(tR - rr, yt - rr, rr, Math.PI / 2, 0, 4),
    P(tR, yn),
  ]
  const frontFlap: Vec2[] = [P(front.x0, bot), ...tabPts, P(front.x1, bot)]
  const frontBody: Vec2[] = [P(front.x0, bot), P(tL, yn), P(tR, yn), P(front.x1, bot)]
  // ลิ้นปลายงอจนปลายสูงกว่าผิวในลิ้นหลัง (ชั้น 3·layer) อีกหนึ่งชั้น
  const tabBend = (Math.asin(Math.min(0.9, (4 * layer) / tabL)) * 180) / Math.PI
  // ลิ้นข้าง: xb = ปลายฝั่งผนังหลัง, dir = ทิศจากหลังไปหน้าบนแผ่นคลี่
  const sideFlap = (xb: number, dir: 1 | -1): Vec2[] => {
    const at = (u: number, v: number) => P(xb + dir * u, bot + v)
    const u0 = half - barb
    const pts = [
      at(0, 0),
      at(half, vDiag),
      at(u0, hookV),
      ...(sd - hr > hookV + 0.01 ? [at(u0, sd - hr)] : []),
      ...arcPts(0, 0, hr, Math.PI, Math.PI / 2, 4).slice(1).map((q) => at(u0 + hr + q.x, sd - hr + q.y)),
      at(Dp - sideIn, sd),
      at(Dp - sideIn, 0),
    ]
    return dir === 1 ? pts : pts.reverse()
  }
  const flapL = sideFlap(sideL.x0, 1)
  // ลิ้นหลังพับเลยระนาบมากพอให้อยู่เหนือลิ้นข้างทุกจุดที่ซ้อนกัน: ลิ้นข้างสูง v·tanαs, ลิ้นหลังสูง u·tanαb
  // → tanαb > tanαs · max(v/u) ของจุดลิ้นข้างในพื้นที่ลิ้นหลัง (ขอที่งอนไปทางหลังให้ v/u สูงสุด) เผื่อ 25% ไม่เกิน 70°
  const steep = Math.max(1, ...flapL.map((q) => ({ u: q.x - sideL.x0, v: q.y - bot })).filter((q) => q.u > 0.5 && q.u <= backDepth).map((q) => q.v / q.u))
  // กล่องกว้างกว่าลึกมาก (ขอชัน): ลดมุมเลยของลิ้นข้างลงให้ลิ้นหลังไม่ต้องเกิน 70°
  const deg = (r: number) => (r * 180) / Math.PI
  const rad = (a: number) => (a * Math.PI) / 180
  const overSide = Math.min(OVER_SIDE, deg(Math.atan(Math.tan(rad(70)) / (steep * 1.25))))
  const overBack = Math.min(70, Math.max(overSide, deg(Math.atan(Math.tan(rad(overSide)) * steep * 1.25))))
  const flapR = sideFlap(sideR.x1, -1)

  // ---------- ปากบน ----------
  const dustL: Vec2[] = [
    P(sideL.x0 + dustBackIn, top),
    P(sideL.x0 + dustBackIn, top - dustH),
    P(sideL.x1 - dustFrontIn - dustSlant, top - dustH),
    P(sideL.x1 - dustFrontIn, top),
  ]
  const dustR: Vec2[] = [
    P(sideR.x0 + dustFrontIn, top),
    P(sideR.x0 + dustFrontIn + dustSlant, top - dustH),
    P(sideR.x1 - dustBackIn, top - dustH),
    P(sideR.x1 - dustBackIn, top),
  ]
  const lidL = back.x0 + tuckIn
  const lidR = back.x1 - tuckIn
  const tg = tongueFlap(P(lidL + TONGUE_IN, tiTop), P(lidR - TONGUE_IN, tiTop), P(0, -1), tongue)

  const panels: Panel[] = [
    { id: 'front', parentId: null, outline: rect(front.x0, top, front.x1, bot), stage: 0 },
    {
      id: 'side-left', parentId: 'front', outline: rect(sideL.x0, top, sideL.x1, bot),
      hingeA: P(front.x0, top), hingeB: P(front.x0, bot), foldAngle: -90, stage: 0,
    },
    {
      id: 'back', parentId: 'side-left', outline: rect(back.x0, top, back.x1, bot),
      hingeA: P(sideL.x0, top), hingeB: P(sideL.x0, bot), foldAngle: -90, stage: 0,
    },
    {
      id: 'glue', parentId: 'back',
      outline: [P(x1, top), P(0, top + taper), P(0, bot - taper), P(x1, bot)],
      hingeA: P(x1, top), hingeB: P(x1, bot), foldAngle: -90, stage: 0, zOffset: layer,
    },
    {
      id: 'side-right', parentId: 'front', outline: rect(sideR.x0, top, sideR.x1, bot),
      hingeA: P(front.x1, top), hingeB: P(front.x1, bot), foldAngle: 90, stage: 0,
    },
    // --- ปากบน (หลังก้นเสร็จ): ลิ้นกันฝุ่น → ฝา → ลิ้นเสียบ ---
    {
      id: 'dust-tl', parentId: 'side-left', outline: dustL,
      hingeA: P(sideL.x0, top), hingeB: P(sideL.x1, top), foldAngle: 90, stage: ST_TOP, within: DUST_WIN, zOffset: layer,
    },
    {
      id: 'dust-tr', parentId: 'side-right', outline: dustR,
      hingeA: P(sideR.x0, top), hingeB: P(sideR.x1, top), foldAngle: 90, stage: ST_TOP, within: DUST_WIN, zOffset: layer,
    },
    {
      id: 'tuck-top', parentId: 'back', outline: rect(lidL, tiTop, lidR, top),
      hingeA: P(back.x0, top), hingeB: P(back.x1, top), foldAngle: 90, stage: ST_TOP, within: LID_WIN,
    },
    {
      id: 'tongue-top', parentId: 'tuck-top', outline: tg.pts,
      hingeA: P(lidL, tiTop), hingeB: P(lidR, tiTop), foldAngle: 90, stage: ST_TONGUE, zOffset: layer, tuck: true,
    },
    // --- ก้นล็อก 1-2-3: ลิ้นหลัง (1) → ลิ้นข้าง (2) ขอคร่อมขอบช่องบาก → ลิ้นหน้า (3) ชิ้นเดียว ลิ้นปลายลงแนวช่องบาก ---
    // พับเลยระนาบ (foldAngle −90 − เกิน) แล้ว refold คืน +เกิน ที่จังหวะ ST_RETURN พร้อมกัน (สัดส่วนมุมคงที่ ลิ้นข้างจึงอยู่ใต้ลิ้นหลังตลอด)
    {
      id: 'base-left', parentId: 'side-left', outline: flapL,
      hingeA: P(sideL.x0, bot), hingeB: P(sideL.x1, bot), foldAngle: -90 - overSide, stage: ST_SIDES, within: SIDE_WIN,
      refold: { angle: overSide, stage: ST_RETURN }, zOffset: 2 * layer,
    },
    {
      id: 'base-right', parentId: 'side-right', outline: flapR,
      hingeA: P(sideR.x0, bot), hingeB: P(sideR.x1, bot), foldAngle: -90 - overSide, stage: ST_SIDES, within: SIDE_WIN,
      refold: { angle: overSide, stage: ST_RETURN }, zOffset: 2 * layer,
    },
    {
      id: 'base-back', parentId: 'back', outline: backFlap,
      hingeA: P(back.x0, bot), hingeB: P(back.x1, bot), foldAngle: -90 - overBack, stage: ST_BACK,
      refold: { angle: overBack, stage: ST_RETURN }, zOffset: 3 * layer,
    },
    {
      id: 'base-front', parentId: 'front', outline: frontBody,
      hingeA: P(front.x0, bot), hingeB: P(front.x1, bot), foldAngle: -90, stage: ST_FRONT, within: FRONT_WIN,
    },
    // ลิ้นปลาย: เนื้อเดียวกับลิ้นหน้า (บานพับที่คอ ไม่มีรอยพับบนแผ่นคลี่ — viewer ไม่วาดเส้นตามบานพับ จึงดูเป็นชิ้นเดียวงอ)
    // งอขึ้นท้ายจังหวะ ให้ปลายลอดร่องขึ้นไปพักบนผิวในลิ้นหลัง = สอดลงร่อง
    {
      id: 'base-tab', parentId: 'base-front', outline: tabPts,
      hingeA: P(tL, yn), hingeB: P(tR, yn), foldAngle: -tabBend, stage: ST_FRONT, within: TAB_WIN,
    },
  ]

  // ---------- เส้น blueprint ----------
  const cut = (d: string): Segment => ({ kind: 'cut', d })
  const crease = (d: string): Segment => ({ kind: 'crease', d })
  const n = (v: number) => Math.round(v * 1000) / 1000
  const poly = (pts: Vec2[]) => pts.map((q, i) => `${i ? 'L' : 'M'} ${n(q.x)} ${n(q.y)}`).join(' ')
  const slit = tuckSlit(lidR - lidL)

  const bottomLine: Vec2[] = [
    P(back.x0, bot), ...backFlap, P(back.x1, bot),
    ...flapL, P(sideL.x1, bot),
    ...frontFlap,
    ...flapR,
  ]

  const segments: Segment[] = [
    cut(`M ${x1} ${top} L 0 ${top + taper} L 0 ${bot - taper} L ${x1} ${bot}`),
    cut(`M ${x5} ${top} L ${x5} ${bot}`),
    // ปากบน: ฝา (ขอบข้าง + ร่องล็อก) → ลิ้นเสียบ → ลิ้นกันฝุ่นซ้าย → ขอบปากผนังหน้า → ลิ้นกันฝุ่นขวา
    cut(`M ${back.x0} ${top} L ${lidL} ${top} L ${lidL} ${tiTop} L ${lidL + slit} ${tiTop}`),
    cut(`M ${lidL + TONGUE_IN} ${tiTop} ${tg.d}`),
    cut(`M ${lidR - slit} ${tiTop} L ${lidR} ${tiTop} L ${lidR} ${top} L ${back.x1} ${top} ${poly(dustL).replace(/^M/, 'L')} L ${sideL.x1} ${top}`),
    cut(`M ${front.x0} ${top} L ${front.x1} ${top} ${poly(dustR).replace(/^M/, 'L')} L ${x5} ${top}`),
    cut(poly(bottomLine)),
    // รอยพับแนวตั้งระหว่างผนัง
    ...[x1, back.x1, sideL.x1, front.x1].map((xc) => crease(`M ${xc} ${top} L ${xc} ${bot}`)),
    crease(`M ${dustL[0].x} ${top} L ${dustL[3].x} ${top}`),
    crease(`M ${dustR[0].x} ${top} L ${dustR[3].x} ${top}`),
    crease(`M ${lidL} ${top} L ${lidR} ${top}`),
    crease(`M ${lidL + slit} ${tiTop} L ${lidR - slit} ${tiTop}`),
    crease(`M ${back.x0 + sideIn} ${bot} L ${back.x1 - sideIn} ${bot}`),
    crease(`M ${sideL.x0} ${bot} L ${sideL.x1 - sideIn} ${bot}`),
    crease(`M ${front.x0} ${bot} L ${front.x1} ${bot}`),
    crease(`M ${sideR.x0 + sideIn} ${bot} L ${sideR.x1} ${bot}`),
  ]

  const dims: DimMark[] = [
    { a: P(front.x0, top - 10), b: P(front.x1, top - 10), label: `W ${fmt(Wp)}` },
    { a: P(sideL.x0, top - dustH - 8), b: P(sideL.x1, top - dustH - 8), label: `D ${fmt(Dp)}` },
    { a: P(-8, top), b: P(-8, bot), label: `H ${fmt(Hp)}` },
    { a: P(0, -10), b: P(x5, -10), label: fmt(width) },
    { a: P(x5 + 10, 0), b: P(x5 + 10, height), label: fmt(height) },
  ]

  return { width, height, segments, panels, dims }
}
