import type { BoxParams, Dieline, DimMark, Material, Panel, Segment, Vec2 } from '../types'
import { P, arcPts, fmt, obroundPath, obroundPts } from './shared'

// กล่องฝาเสียบ (straight tuck end)
// ผังแผ่นคลี่เรียงซ้าย→ขวา: ปีกทากาว | ข้างซ้าย | หน้า | ข้างขวา | หลัง
// ฝาเสียบ+ลิ้น อยู่บน-ล่างของแผงหลัง, ลิ้นกันฝุ่นอยู่บน-ล่างของแผงข้าง
// W,D,H ที่รับเข้ามาคือขนาด "ด้านใน" — แปลงเป็นระยะ score โดยบวก 2t ต่อแกน
// เพื่อให้ปริมาตรภายในหลังพับ (ผนังหนา t ทุกด้าน) เท่ากับ W×D×H พอดี
export function generateTuckEndBox(box: BoxParams, mat: Material): Dieline {
  const { W, D, H } = box
  const t = mat.thickness

  const Wp = W + 2 * t
  const Dp = D + 2 * t
  const Hp = H + 2 * t

  const glueW = Math.max(12, 10 + 2 * t)
  const taper = 4
  const cover = Math.max(6, Dp - t)
  const tongue = Math.min(22, Math.max(10, 0.6 * Dp))
  // ระยะหลบข้างของ flap ต้องกันเนื้อวัสดุหนา t ชนผนัง/ลิ้นข้างเคียงหลังพับ
  const dustIn = Math.max(1.5, 2 * t + 0.5)
  const tuckIn = Math.max(1, t + 0.5)
  const dustH = Math.max(8, Math.min(0.75 * Dp, Wp / 2 - dustIn - 2) - t)
  const slant = Math.min(5, dustH * 0.45)
  const layer = t + 0.05

  const x1 = glueW
  const x2 = x1 + Dp
  const x3 = x2 + Wp
  const x4 = x3 + Dp
  const x5 = x4 + Wp
  const top = cover + tongue
  const bot = top + Hp

  const width = x5
  const height = bot + cover + tongue

  // รูหิ้วเจาะ (die-cut handle) บนฝาเสียบบน — เจาะจริงทั้งใน 3D และ blueprint
  const holeLen = Math.min(90, (Wp - 2 * tuckIn) * 0.6)
  const holeThick = Math.min(22, cover * 0.45)
  const hasHandle = !!box.handle && holeLen >= 40 && holeThick >= 10
  const holeCx = (x4 + x5) / 2
  const holeCy = top - cover / 2

  // --- panels สำหรับ 3D (มุมโค้งถูกแตกเป็นเส้นตรงสั้นๆ) ---
  const r = Math.min(7, tongue * 0.45, (Wp - 2 * tuckIn) / 2)
  const tiTop = top - cover
  const tiBot = bot + cover

  const tongueTopOutline: Vec2[] = [
    P(x4 + tuckIn, tiTop),
    ...arcPts(x4 + tuckIn + r, tiTop - tongue + r, r, Math.PI, Math.PI * 1.5),
    ...arcPts(x5 - tuckIn - r, tiTop - tongue + r, r, Math.PI * 1.5, Math.PI * 2),
    P(x5 - tuckIn, tiTop),
  ]
  const tongueBotOutline: Vec2[] = [
    P(x4 + tuckIn, tiBot),
    ...arcPts(x4 + tuckIn + r, tiBot + tongue - r, r, Math.PI, Math.PI * 0.5),
    ...arcPts(x5 - tuckIn - r, tiBot + tongue - r, r, Math.PI * 0.5, 0),
    P(x5 - tuckIn, tiBot),
  ]

  const rect = (xa: number, ya: number, xb: number, yb: number): Vec2[] => [
    P(xa, ya),
    P(xb, ya),
    P(xb, yb),
    P(xa, yb),
  ]

  const dust = (xa: number, xb: number, y: number, dir: 1 | -1): Vec2[] => [
    P(xa + dustIn, y),
    P(xa + dustIn + slant, y + dir * dustH),
    P(xb - dustIn - slant, y + dir * dustH),
    P(xb - dustIn, y),
  ]

  const panels: Panel[] = [
    { id: 'front', parentId: null, outline: rect(x2, top, x3, bot), stage: 0 },
    {
      id: 'side-left', parentId: 'front', outline: rect(x1, top, x2, bot),
      hingeA: P(x2, top), hingeB: P(x2, bot), foldAngle: -90, stage: 0,
    },
    {
      id: 'glue', parentId: 'side-left',
      outline: [P(x1, top), P(0, top + taper), P(0, bot - taper), P(x1, bot)],
      hingeA: P(x1, top), hingeB: P(x1, bot), foldAngle: -90, stage: 0, zOffset: layer,
    },
    {
      id: 'side-right', parentId: 'front', outline: rect(x3, top, x4, bot),
      hingeA: P(x3, top), hingeB: P(x3, bot), foldAngle: 90, stage: 0,
    },
    {
      id: 'back', parentId: 'side-right', outline: rect(x4, top, x5, bot),
      hingeA: P(x4, top), hingeB: P(x4, bot), foldAngle: 90, stage: 0,
    },
    {
      id: 'dust-tl', parentId: 'side-left', outline: dust(x1, x2, top, -1),
      hingeA: P(x1, top), hingeB: P(x2, top), foldAngle: 90, stage: 1, zOffset: layer,
    },
    {
      id: 'dust-tr', parentId: 'side-right', outline: dust(x3, x4, top, -1),
      hingeA: P(x3, top), hingeB: P(x4, top), foldAngle: 90, stage: 1, zOffset: layer,
    },
    {
      id: 'dust-bl', parentId: 'side-left', outline: dust(x1, x2, bot, 1),
      hingeA: P(x1, bot), hingeB: P(x2, bot), foldAngle: -90, stage: 1, zOffset: layer,
    },
    {
      id: 'dust-br', parentId: 'side-right', outline: dust(x3, x4, bot, 1),
      hingeA: P(x3, bot), hingeB: P(x4, bot), foldAngle: -90, stage: 1, zOffset: layer,
    },
    {
      id: 'tuck-top', parentId: 'back', outline: rect(x4 + tuckIn, tiTop, x5 - tuckIn, top),
      holes: hasHandle ? [obroundPts(holeCx, holeCy, holeLen, holeThick)] : undefined,
      hingeA: P(x4, top), hingeB: P(x5, top), foldAngle: 90, stage: 2,
    },
    {
      id: 'tongue-top', parentId: 'tuck-top', outline: tongueTopOutline,
      hingeA: P(x4 + tuckIn, tiTop), hingeB: P(x5 - tuckIn, tiTop), foldAngle: 90, stage: 3, zOffset: 0.15,
    },
    {
      id: 'tuck-bot', parentId: 'back', outline: rect(x4 + tuckIn, bot, x5 - tuckIn, tiBot),
      hingeA: P(x4, bot), hingeB: P(x5, bot), foldAngle: -90, stage: 2,
    },
    {
      id: 'tongue-bot', parentId: 'tuck-bot', outline: tongueBotOutline,
      hingeA: P(x4 + tuckIn, tiBot), hingeB: P(x5 - tuckIn, tiBot), foldAngle: -90, stage: 3, zOffset: 0.15,
    },
  ]

  // --- เส้นสำหรับ blueprint (มุมโค้งใช้ Q curve จริง) ---
  // เส้นตัดของ flap รวม "ไหล่" (ช่วงหลบข้าง) ไว้ในเส้นเดียว เพื่อให้ตัดชิ้นงานขาดครบวง
  // ส่วนเส้นพับยาวเท่าช่วงที่ flap เกาะจริงเท่านั้น
  const cut = (d: string): Segment => ({ kind: 'cut', d })
  const crease = (d: string): Segment => ({ kind: 'crease', d })

  const dustCut = (xa: number, xb: number, y: number, dir: 1 | -1) =>
    `M ${xa} ${y} L ${xa + dustIn} ${y} L ${xa + dustIn + slant} ${y + dir * dustH} ` +
    `L ${xb - dustIn - slant} ${y + dir * dustH} L ${xb - dustIn} ${y} L ${xb} ${y}`

  const tuckCut = (y: number, dir: 1 | -1) => {
    const yi = y - dir * cover
    const yt = yi - dir * tongue
    return (
      `M ${x4} ${y} L ${x4 + tuckIn} ${y} L ${x4 + tuckIn} ${yi} L ${x4 + tuckIn} ${yt + dir * r} ` +
      `Q ${x4 + tuckIn} ${yt} ${x4 + tuckIn + r} ${yt} L ${x5 - tuckIn - r} ${yt} ` +
      `Q ${x5 - tuckIn} ${yt} ${x5 - tuckIn} ${yt + dir * r} L ${x5 - tuckIn} ${yi} ` +
      `L ${x5 - tuckIn} ${y} L ${x5} ${y}`
    )
  }

  const segments: Segment[] = [
    cut(`M ${x1} ${top} L 0 ${top + taper} L 0 ${bot - taper} L ${x1} ${bot}`),
    cut(`M ${x2} ${top} L ${x3} ${top}`),
    cut(`M ${x2} ${bot} L ${x3} ${bot}`),
    cut(`M ${x5} ${top} L ${x5} ${bot}`),
    cut(dustCut(x1, x2, top, -1)),
    cut(dustCut(x3, x4, top, -1)),
    cut(dustCut(x1, x2, bot, 1)),
    cut(dustCut(x3, x4, bot, 1)),
    cut(tuckCut(top, 1)),
    cut(tuckCut(bot, -1)),
    crease(`M ${x1} ${top} L ${x1} ${bot}`),
    crease(`M ${x2} ${top} L ${x2} ${bot}`),
    crease(`M ${x3} ${top} L ${x3} ${bot}`),
    crease(`M ${x4} ${top} L ${x4} ${bot}`),
    crease(`M ${x1 + dustIn} ${top} L ${x2 - dustIn} ${top}`),
    crease(`M ${x3 + dustIn} ${top} L ${x4 - dustIn} ${top}`),
    crease(`M ${x4 + tuckIn} ${top} L ${x5 - tuckIn} ${top}`),
    crease(`M ${x1 + dustIn} ${bot} L ${x2 - dustIn} ${bot}`),
    crease(`M ${x3 + dustIn} ${bot} L ${x4 - dustIn} ${bot}`),
    crease(`M ${x4 + tuckIn} ${bot} L ${x5 - tuckIn} ${bot}`),
    crease(`M ${x4 + tuckIn} ${tiTop} L ${x5 - tuckIn} ${tiTop}`),
    crease(`M ${x4 + tuckIn} ${tiBot} L ${x5 - tuckIn} ${tiBot}`),
  ]
  if (hasHandle) segments.push(cut(obroundPath(holeCx, holeCy, holeLen, holeThick)))

  const dims: DimMark[] = [
    { a: P(x2, bot + 12), b: P(x3, bot + 12), label: `W ${fmt(Wp)}` },
    { a: P(x1, top - dustH - 8), b: P(x2, top - dustH - 8), label: `D ${fmt(Dp)}` },
    { a: P(-8, top), b: P(-8, bot), label: `H ${fmt(Hp)}` },
    { a: P(0, -10), b: P(x5, -10), label: fmt(width) },
    { a: P(x5 + 10, 0), b: P(x5 + 10, height), label: fmt(height) },
  ]

  return { width, height, segments, panels, dims }
}
