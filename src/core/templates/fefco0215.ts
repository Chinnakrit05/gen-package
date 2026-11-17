import type { BoxParams, Dieline, DimMark, Material, Panel, Segment, Vec2 } from '../types'
import { P, TONGUE_IN, arcPts, fmt, rect, tongueDepth, tongueFlap, tuckSlit } from './shared'

// FEFCO 0215 — กล่องฝาบนเสียบ (tuck top) + ก้นล็อก 1-2-3 (snap-lock bottom) ตามผังโรงพิมพ์:
//   ปีกกาว | หลัง | ข้างซ้าย | หน้า | ข้างขวา   (ปีกกาวต่อแผงหลัง ทากาวด้านในผนังข้างขวา — ผังเดียวกับ reverse-tuck)
// ปากบน: ฝาเสียบที่แผงหลัง ลิ้นสอดลงแนบผนังหน้า; ลิ้นกันฝุ่นที่ผนังข้าง ขอบฝั่งหลังตรง ขอบฝั่งหน้าเฉียงหลบลิ้นเสียบ
// ก้น (ล็อกเองไม่ต้องทากาว) — พิกัดบนพื้นกล่อง: u = ระยะจากผนังหลังไปหน้า (0..Dp), v = ระยะตามแนวกว้าง
//   1) ลิ้นข้างสองชิ้น (จากผนังข้าง) พับก่อน อยู่ในสุด: ขอบเฉียงจากมุมหลังถึงกลางก้น (u = Dp/2, v = Wp/3)
//      แล้วบากเป็น "ขอ" ย้อนไปทางหลัง เต็มลึกฝั่งหน้า
//   2) ลิ้นหลัง: สี่เหลี่ยมลึก Dp/2 + tabL มีช่องบากกลางกว้าง ~Wp/3 ลึก tabL (ช่วง u = Dp/2..Dp/2+tabL)
//   3) ลิ้นหน้า (พับสุดท้าย อยู่นอกสุด): คางหมูเฉียงจากมุมเข้าหาคอกว้าง Wp/3 ที่กลางก้น + ลิ้นปลาย tabL
//      ลิ้นปลายสอดผ่านช่องบากของลิ้นหลังขึ้นไปทับด้านในลิ้นหลัง และถูกขอของลิ้นข้างกดไว้ = ล็อก
//      ชั้นวัสดุจากนอกเข้าใน: ลิ้นหน้า → ลิ้นหลัง → ลิ้นปลาย → ลิ้นข้าง
// W,D,H = ขนาดด้านใน (+2t ต่อแกน)
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
  const tabL = Math.min(25, Math.max(5, 0.11 * Dp)) // ลิ้นปลาย = ความลึกช่องบาก
  const neckW = Wp / 3 // คอ/ลิ้นปลายของลิ้นหน้า
  const clear = Math.max(0.5, t / 2) // ช่องบากกว้างกว่าลิ้นปลายข้างละเท่านี้
  const notchW = neckW + 2 * clear
  const rr = Math.min(4, tabL * 0.3) // มุมมนปลายลิ้น/ขอบช่องบาก
  const barb = Math.min(tabL * 0.3, Dp * 0.05) // ขอของลิ้นข้างย้อนไปทางหลัง
  const sideIn = Math.max(0.5, t) // ลิ้นหลัง/ลิ้นข้างร่นจากผนังที่ตั้งฉากกัน กันชนผนังหลังพับ
  // ความลึกลิ้นข้าง: เกือบถึงกลางก้น เว้นช่องกลางไม่ให้สองฝั่งชนกัน; ขอยาวตามลิ้นปลายแต่ไม่เกินพื้นที่ที่เหลือ (กล่องแคบ)
  const sd = Wp / 2 - Math.max(2, 2 * t + 1, Math.min(4, Wp * 0.05))
  const vDiag = Math.min(Wp / 3, sd - 1.5) // ปลายขอบเฉียง (กล่องเล็กวัสดุหนา ระยะ Wp/3 อาจเกินความลึกลิ้น)
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
  // ลิ้นหน้า: ตัวคางหมู + ลิ้นปลาย (แยกแผงใน 3D เพราะลิ้นปลายยกขึ้นไปอยู่เหนือลิ้นหลัง)
  const tL = front.x0 + Wp / 3
  const tR = front.x1 - Wp / 3
  const yn = bot + half
  const yt = yn + tabL
  const frontBody: Vec2[] = [P(front.x0, bot), P(tL, yn), P(tR, yn), P(front.x1, bot)]
  const tabPts: Vec2[] = [
    P(tL, yn),
    ...arcPts(tL + rr, yt - rr, rr, Math.PI, Math.PI / 2, 4),
    ...arcPts(tR - rr, yt - rr, rr, Math.PI / 2, 0, 4),
    P(tR, yn),
  ]
  const frontFlapLine: Vec2[] = [P(front.x0, bot), ...tabPts, P(front.x1, bot)]
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
    // --- ปากบน: ลิ้นกันฝุ่น → ฝา → ลิ้นเสียบ ---
    {
      id: 'dust-tl', parentId: 'side-left', outline: dustL,
      hingeA: P(sideL.x0, top), hingeB: P(sideL.x1, top), foldAngle: 90, stage: 1, zOffset: layer,
    },
    {
      id: 'dust-tr', parentId: 'side-right', outline: dustR,
      hingeA: P(sideR.x0, top), hingeB: P(sideR.x1, top), foldAngle: 90, stage: 1, zOffset: layer,
    },
    {
      id: 'tuck-top', parentId: 'back', outline: rect(lidL, tiTop, lidR, top),
      hingeA: P(back.x0, top), hingeB: P(back.x1, top), foldAngle: 90, stage: 2,
    },
    {
      id: 'tongue-top', parentId: 'tuck-top', outline: tg.pts,
      hingeA: P(lidL, tiTop), hingeB: P(lidR, tiTop), foldAngle: 90, stage: 3, zOffset: layer, tuck: true,
    },
    // --- ก้นล็อก 1-2-3: ลิ้นข้าง (1) → ลิ้นหลัง (2) → ลิ้นหน้า + ลิ้นปลายสอดช่องบาก (3) ---
    {
      id: 'base-left', parentId: 'side-left', outline: flapL,
      hingeA: P(sideL.x0, bot), hingeB: P(sideL.x1, bot), foldAngle: -90, stage: 1, zOffset: 3 * layer,
    },
    {
      id: 'base-right', parentId: 'side-right', outline: flapR,
      hingeA: P(sideR.x0, bot), hingeB: P(sideR.x1, bot), foldAngle: -90, stage: 1, zOffset: 3 * layer,
    },
    {
      id: 'base-back', parentId: 'back', outline: backFlap,
      hingeA: P(back.x0, bot), hingeB: P(back.x1, bot), foldAngle: -90, stage: 2, zOffset: layer,
    },
    {
      id: 'base-front', parentId: 'front', outline: frontBody,
      hingeA: P(front.x0, bot), hingeB: P(front.x1, bot), foldAngle: -90, stage: 3,
    },
    // ลิ้นปลายไม่มีรอยพับ — เนื้อเดียวกับลิ้นหน้า แต่ยกขึ้นสองชั้นไปอยู่เหนือลิ้นหลัง (สอดผ่านช่องบาก)
    { id: 'base-tab', parentId: 'base-front', outline: tabPts, stage: 3, zOffset: 2 * layer },
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
    ...frontFlapLine,
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
