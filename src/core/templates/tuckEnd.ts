import type { BoxParams, Dieline, DimMark, Material, Panel, Segment, Vec2 } from '../types'
import { P, TONGUE_IN, dustFlap, fmt, obroundPath, obroundPts, tongueDepth, tongueFlap, tuckSlit } from './shared'

// กล่องฝาเสียบ — สองผัง ใช้ตัวสร้างชุดเดียว:
// · straight tuck (tuck-end): ปีกทากาว | ข้างซ้าย | หน้า | ข้างขวา | หลัง — ฝาเสียบบน+ล่างอยู่ที่แผงหลังทั้งคู่
// · reverse tuck (reverse-tuck): ปีกทากาว | หลัง | ข้างซ้าย | หน้า | ข้างขวา — ฝาบนที่แผงหลัง ฝาล่างที่แผงหน้า (คนละฝั่ง)
//   ปีกกาวต่อจากแผงหลัง ทากาวด้านในผนังข้างขวา (ผังมาตรฐานโรงพิมพ์ ECMA A20.20.03.01)
// ลิ้นกันฝุ่นอยู่ที่ผนังข้าง มุมนอกมน + ไหล่ล็อกฝั่งผนังที่ลิ้นเสียบสอดลง; ปลายรอยพับลิ้นมีร่องล็อก (slit) เกี่ยวไหล่นั้น
// W,D,H ที่รับเข้ามาคือขนาด "ด้านใน" — แปลงเป็นระยะ score โดยบวก 2t ต่อแกน
// เพื่อให้ปริมาตรภายในหลังพับ (ผนังหนา t ทุกด้าน) เท่ากับ W×D×H พอดี
export function generateTuckEndBox(box: BoxParams, mat: Material): Dieline {
  return buildTuckBox(box, mat, false)
}

export function generateReverseTuckBox(box: BoxParams, mat: Material): Dieline {
  return buildTuckBox(box, mat, true)
}

type Col = { x0: number; x1: number }

function buildTuckBox(box: BoxParams, mat: Material, reverse: boolean): Dieline {
  const { W, D, H } = box
  const t = mat.thickness

  const Wp = W + 2 * t
  const Dp = D + 2 * t
  const Hp = H + 2 * t

  const glueW = Math.max(12, 10 + 2 * t)
  const taper = 4
  const cover = Math.max(6, Dp - t)
  const tongue = tongueDepth(Dp)
  // ระยะหลบข้างของ flap ต้องกันเนื้อวัสดุหนา t ชนผนัง/ลิ้นข้างเคียงหลังพับ
  const dustIn = Math.max(1.5, 2 * t + 0.5)
  const tuckIn = Math.max(1, t + 0.5)
  const dustH = Math.max(8, Math.min(0.75 * Dp, Wp / 2 - dustIn - 2) - t)
  const layer = t + 0.05

  // คอลัมน์ของผนังตามผัง (x เริ่มหลังปีกกาว)
  const x1 = glueW
  const seq: [string, number][] = reverse
    ? [['back', Wp], ['side-left', Dp], ['front', Wp], ['side-right', Dp]]
    : [['side-left', Dp], ['front', Wp], ['side-right', Dp], ['back', Wp]]
  const col: Record<string, Col> = {}
  let x = x1
  for (const [id, w] of seq) {
    col[id] = { x0: x, x1: x + w }
    x += w
  }
  const x5 = x
  const top = cover + tongue
  const bot = top + Hp

  const width = x5
  const height = bot + cover + tongue

  const back = col['back']
  const front = col['front']
  const sideL = col['side-left']
  const sideR = col['side-right']
  const topHost = back // ฝาบนอยู่แผงหลังทั้งสองผัง (เปิดฝาจากด้านหน้า)
  const botHost = reverse ? front : back
  const botHostId = reverse ? 'front' : 'back'
  // ลิ้นเสียบสอดลงแนบผนังฝั่งตรงข้ามบานพับฝา: ฝาบน (ที่แผงหลัง) → ผนังหน้า; ฝาล่าง → ผนังหน้า (straight) / ผนังหลัง (reverse)
  // ไหล่ล็อกของลิ้นกันฝุ่นจึงอยู่ปลายที่ติดผนังนั้น ('a' = ปลายซ้ายบนแผ่นคลี่)
  // ผนังข้างขวาของผัง reverse ติดผนังหลังผ่านปีกกาว (ขอบขวาสุด) → ปลาย 'b'
  const lockTop: Record<'side-left' | 'side-right', 'a' | 'b'> = { 'side-left': 'b', 'side-right': 'a' }
  const lockBot: Record<'side-left' | 'side-right', 'a' | 'b'> = reverse
    ? { 'side-left': 'a', 'side-right': 'b' }
    : { 'side-left': 'b', 'side-right': 'a' }

  // รูหิ้วเจาะ (die-cut handle) บนฝาเสียบบน — เจาะจริงทั้งใน 3D และ blueprint
  const holeLen = Math.min(90, (Wp - 2 * tuckIn) * 0.6)
  const holeThick = Math.min(22, cover * 0.45)
  const hasHandle = !!box.handle && holeLen >= 40 && holeThick >= 10
  const holeCx = (topHost.x0 + topHost.x1) / 2
  const holeCy = top - cover / 2

  const tiTop = top - cover
  const tiBot = bot + cover

  const rect = (xa: number, ya: number, xb: number, yb: number): Vec2[] => [P(xa, ya), P(xb, ya), P(xb, yb), P(xa, yb)]
  const up = P(0, -1)
  const down = P(0, 1)

  const dust = (c: Col, y: number, dir: 1 | -1, lock: 'a' | 'b') =>
    dustFlap(P(c.x0 + dustIn, y), P(c.x1 - dustIn, y), dir === -1 ? up : down, dustH, lock)
  const tongueOf = (c: Col, y: number, dir: 1 | -1) =>
    tongueFlap(P(c.x0 + tuckIn + TONGUE_IN, y), P(c.x1 - tuckIn - TONGUE_IN, y), dir === -1 ? up : down, tongue)

  const dTL = dust(sideL, top, -1, lockTop['side-left'])
  const dTR = dust(sideR, top, -1, lockTop['side-right'])
  const dBL = dust(sideL, bot, 1, lockBot['side-left'])
  const dBR = dust(sideR, bot, 1, lockBot['side-right'])
  const tgTop = tongueOf(topHost, tiTop, -1)
  const tgBot = tongueOf(botHost, tiBot, 1)

  // --- panels สำหรับ 3D (มุมโค้งถูกแตกเป็นเส้นตรงสั้นๆ) ---
  const body: Panel[] = reverse
    ? [
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
      ]
    : [
        { id: 'front', parentId: null, outline: rect(front.x0, top, front.x1, bot), stage: 0 },
        {
          id: 'side-left', parentId: 'front', outline: rect(sideL.x0, top, sideL.x1, bot),
          hingeA: P(front.x0, top), hingeB: P(front.x0, bot), foldAngle: -90, stage: 0,
        },
        {
          id: 'glue', parentId: 'side-left',
          outline: [P(x1, top), P(0, top + taper), P(0, bot - taper), P(x1, bot)],
          hingeA: P(x1, top), hingeB: P(x1, bot), foldAngle: -90, stage: 0, zOffset: layer,
        },
        {
          id: 'side-right', parentId: 'front', outline: rect(sideR.x0, top, sideR.x1, bot),
          hingeA: P(front.x1, top), hingeB: P(front.x1, bot), foldAngle: 90, stage: 0,
        },
        {
          id: 'back', parentId: 'side-right', outline: rect(back.x0, top, back.x1, bot),
          hingeA: P(sideR.x1, top), hingeB: P(sideR.x1, bot), foldAngle: 90, stage: 0,
        },
      ]

  const panels: Panel[] = [
    ...body,
    {
      id: 'dust-tl', parentId: 'side-left', outline: dTL.pts,
      hingeA: P(sideL.x0, top), hingeB: P(sideL.x1, top), foldAngle: 90, stage: 1, zOffset: layer,
    },
    {
      id: 'dust-tr', parentId: 'side-right', outline: dTR.pts,
      hingeA: P(sideR.x0, top), hingeB: P(sideR.x1, top), foldAngle: 90, stage: 1, zOffset: layer,
    },
    {
      id: 'dust-bl', parentId: 'side-left', outline: dBL.pts,
      hingeA: P(sideL.x0, bot), hingeB: P(sideL.x1, bot), foldAngle: -90, stage: 1, zOffset: layer,
    },
    {
      id: 'dust-br', parentId: 'side-right', outline: dBR.pts,
      hingeA: P(sideR.x0, bot), hingeB: P(sideR.x1, bot), foldAngle: -90, stage: 1, zOffset: layer,
    },
    {
      id: 'tuck-top', parentId: 'back', outline: rect(topHost.x0 + tuckIn, tiTop, topHost.x1 - tuckIn, top),
      holes: hasHandle ? [obroundPts(holeCx, holeCy, holeLen, holeThick)] : undefined,
      hingeA: P(topHost.x0, top), hingeB: P(topHost.x1, top), foldAngle: 90, stage: 2,
    },
    {
      id: 'tongue-top', parentId: 'tuck-top', outline: tgTop.pts,
      hingeA: P(topHost.x0 + tuckIn, tiTop), hingeB: P(topHost.x1 - tuckIn, tiTop), foldAngle: 90, stage: 3, zOffset: 0.15, tuck: true,
    },
    {
      id: 'tuck-bot', parentId: botHostId, outline: rect(botHost.x0 + tuckIn, bot, botHost.x1 - tuckIn, tiBot),
      hingeA: P(botHost.x0, bot), hingeB: P(botHost.x1, bot), foldAngle: -90, stage: 2,
    },
    {
      id: 'tongue-bot', parentId: 'tuck-bot', outline: tgBot.pts,
      hingeA: P(botHost.x0 + tuckIn, tiBot), hingeB: P(botHost.x1 - tuckIn, tiBot), foldAngle: -90, stage: 3, zOffset: 0.15, tuck: true,
    },
  ]

  // --- เส้นสำหรับ blueprint (มุมโค้งใช้ Q curve จริง) ---
  // เส้นตัดของ flap รวม "ไหล่" (ช่วงหลบข้าง) ไว้ในเส้นเดียว เพื่อให้ตัดชิ้นงานขาดครบวง
  // ส่วนเส้นพับยาวเท่าช่วงที่ flap เกาะจริงเท่านั้น
  const cut = (d: string): Segment => ({ kind: 'cut', d })
  const crease = (d: string): Segment => ({ kind: 'crease', d })

  const dustCut = (c: Col, y: number, f: { d: string }) =>
    `M ${c.x0} ${y} L ${c.x0 + dustIn} ${y} ${f.d} L ${c.x1} ${y}`

  // ฝาเสียบ: ขอบข้างฝา → ร่องล็อกตามแนวพับลิ้น → ลิ้นมุมมน → ร่องล็อกฝั่งขวา → ขอบข้างฝา (แยกเป็น 3 เส้นตัด)
  const lidCuts = (c: Col, y: number, dir: 1 | -1, tg: { d: string }): Segment[] => {
    const yi = y - dir * cover
    const l = c.x0 + tuckIn
    const r = c.x1 - tuckIn
    const tl = l + TONGUE_IN
    const slit = tuckSlit(r - l)
    return [
      cut(`M ${c.x0} ${y} L ${l} ${y} L ${l} ${yi} L ${l + slit} ${yi}`),
      cut(`M ${tl} ${yi} ${tg.d}`),
      cut(`M ${r - slit} ${yi} L ${r} ${yi} L ${r} ${y} L ${c.x1} ${y}`),
    ]
  }
  const tongueCrease = (c: Col, yi: number) => {
    const l = c.x0 + tuckIn
    const r = c.x1 - tuckIn
    const slit = tuckSlit(r - l)
    return crease(`M ${l + slit} ${yi} L ${r - slit} ${yi}`)
  }

  // ขอบบน/ล่างของผนังที่ไม่มีฝา = เส้นตัดตรง
  const plainTop = [front]
  const plainBot = reverse ? [back] : [front]

  const segments: Segment[] = [
    cut(`M ${x1} ${top} L 0 ${top + taper} L 0 ${bot - taper} L ${x1} ${bot}`),
    ...plainTop.map((c) => cut(`M ${c.x0} ${top} L ${c.x1} ${top}`)),
    ...plainBot.map((c) => cut(`M ${c.x0} ${bot} L ${c.x1} ${bot}`)),
    cut(`M ${x5} ${top} L ${x5} ${bot}`),
    cut(dustCut(sideL, top, dTL)),
    cut(dustCut(sideR, top, dTR)),
    cut(dustCut(sideL, bot, dBL)),
    cut(dustCut(sideR, bot, dBR)),
    ...lidCuts(topHost, top, 1, tgTop),
    ...lidCuts(botHost, bot, -1, tgBot),
    // รอยพับแนวตั้งระหว่างผนัง (ปีกกาว + 3 รอยระหว่าง 4 ผนัง)
    ...[x1, ...seq.slice(0, 3).map(([id]) => col[id].x1)].map((xc) => crease(`M ${xc} ${top} L ${xc} ${bot}`)),
    crease(`M ${sideL.x0 + dustIn} ${top} L ${sideL.x1 - dustIn} ${top}`),
    crease(`M ${sideR.x0 + dustIn} ${top} L ${sideR.x1 - dustIn} ${top}`),
    crease(`M ${topHost.x0 + tuckIn} ${top} L ${topHost.x1 - tuckIn} ${top}`),
    crease(`M ${sideL.x0 + dustIn} ${bot} L ${sideL.x1 - dustIn} ${bot}`),
    crease(`M ${sideR.x0 + dustIn} ${bot} L ${sideR.x1 - dustIn} ${bot}`),
    crease(`M ${botHost.x0 + tuckIn} ${bot} L ${botHost.x1 - tuckIn} ${bot}`),
    tongueCrease(topHost, tiTop),
    tongueCrease(botHost, tiBot),
  ]
  if (hasHandle) segments.push(cut(obroundPath(holeCx, holeCy, holeLen, holeThick)))

  // เส้นบอก W ใต้ผนังกว้างที่ไม่มีฝาล่าง (straight = หน้า, reverse = หลัง)
  const wCol = plainBot[0]
  const dims: DimMark[] = [
    { a: P(wCol.x0, bot + 12), b: P(wCol.x1, bot + 12), label: `W ${fmt(Wp)}` },
    { a: P(sideL.x0, top - dustH - 8), b: P(sideL.x1, top - dustH - 8), label: `D ${fmt(Dp)}` },
    { a: P(-8, top), b: P(-8, bot), label: `H ${fmt(Hp)}` },
    { a: P(0, -10), b: P(x5, -10), label: fmt(width) },
    { a: P(x5 + 10, 0), b: P(x5 + 10, height), label: fmt(height) },
  ]

  return { width, height, segments, panels, dims }
}
