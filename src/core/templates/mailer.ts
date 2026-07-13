import type { BoxParams, Dieline, DimMark, Material, Panel, Segment } from '../types'
import { P, arcPts, fmt, obroundPath, obroundPts, rect } from './shared'

// กล่องไปรษณีย์ (mailer, FEFCO 0427 อย่างย่อ)
// ฐานอยู่กลาง ผนังพับขึ้นสี่ด้าน ผนังหลังต่อเป็นฝา ฝามีลิ้นหน้าเสียบลงและลิ้นข้างพับลง
// ลิ้นกันฝุ่นที่ผนังข้างช่วยปิดมุม — W,D,H คือขนาดด้านใน
export function generateMailerBox(box: BoxParams, mat: Material): Dieline {
  const { W, D, H } = box
  const t = mat.thickness

  const Wp = W + 2 * t
  const Dp = D + 2 * t
  const Hp = H + t
  const layer = t + 0.05

  const tuckIn = Math.max(1, t + 0.5)
  const dustIn = Math.max(1.5, 2 * t + 0.5)
  const lipH = Math.max(10, Math.min(0.7 * Hp, 0.8 * Dp))
  const lipS = Math.max(8, Math.min(0.7 * Hp, Hp - t - 1))
  const lipIns = Math.max(2, t + 1)
  const lipSlant = Math.min(6, lipS * 0.4)
  const dustW = Math.max(8, Math.min(0.75 * Hp, Wp / 2 - 4) - t)
  const dustSlant = Math.min(5, dustW * 0.45)
  const r = Math.min(7, lipH * 0.45, (Wp - 2 * tuckIn) / 2)

  const margin = Math.max(Hp, lipS)
  const cx0 = margin
  const cx1 = cx0 + Wp
  const y1 = lipH
  const y2 = y1 + Dp
  const y3 = y2 + Hp
  const y4 = y3 + Dp
  const y5 = y4 + Hp

  const width = Wp + 2 * margin
  const height = y5

  // รูหิ้วเจาะที่ผนังข้างทั้งสองด้าน (แนวนอนหลังพับ ใกล้ขอบบนกล่อง)
  const holeLen = Math.min(90, Dp * 0.6)
  const holeThick = Math.min(22, Hp * 0.35)
  const hasHandle = !!box.handle && holeLen >= 40 && holeThick >= 10
  const holeCy = (y3 + y4) / 2
  const holeOff = Math.min(Math.max(14, 0.3 * Hp), Hp / 2)
  const holeLx = cx0 - Hp + holeOff
  const holeRx = cx1 + Hp - holeOff

  const lipOutline = [
    P(cx0 + tuckIn, y1),
    ...arcPts(cx0 + tuckIn + r, r, r, Math.PI, Math.PI * 1.5),
    ...arcPts(cx1 - tuckIn - r, r, r, Math.PI * 1.5, Math.PI * 2),
    P(cx1 - tuckIn, y1),
  ]

  const dust = (xa: number, xb: number, y: number, dir: 1 | -1) => [
    P(xa + dustIn, y),
    P(xa + dustIn + dustSlant, y + dir * dustW),
    P(xb - dustIn - dustSlant, y + dir * dustW),
    P(xb - dustIn, y),
  ]

  const panels: Panel[] = [
    { id: 'base', parentId: null, outline: rect(cx0, y3, cx1, y4), stage: 0 },
    {
      id: 'front', parentId: 'base', outline: rect(cx0, y4, cx1, y5),
      hingeA: P(cx0, y4), hingeB: P(cx1, y4), foldAngle: -90, stage: 0,
    },
    {
      id: 'back', parentId: 'base', outline: rect(cx0, y2, cx1, y3),
      hingeA: P(cx0, y3), hingeB: P(cx1, y3), foldAngle: 90, stage: 0,
    },
    {
      id: 'side-left', parentId: 'base', outline: rect(cx0 - Hp, y3, cx0, y4),
      holes: hasHandle ? [obroundPts(holeLx, holeCy, holeLen, holeThick, true)] : undefined,
      hingeA: P(cx0, y3), hingeB: P(cx0, y4), foldAngle: -90, stage: 0,
    },
    {
      id: 'side-right', parentId: 'base', outline: rect(cx1, y3, cx1 + Hp, y4),
      holes: hasHandle ? [obroundPts(holeRx, holeCy, holeLen, holeThick, true)] : undefined,
      hingeA: P(cx1, y3), hingeB: P(cx1, y4), foldAngle: 90, stage: 0,
    },
    {
      id: 'dust-lb', parentId: 'side-left', outline: dust(cx0 - Hp, cx0, y3, -1),
      hingeA: P(cx0 - Hp, y3), hingeB: P(cx0, y3), foldAngle: 90, stage: 1, zOffset: layer,
    },
    {
      id: 'dust-lf', parentId: 'side-left', outline: dust(cx0 - Hp, cx0, y4, 1),
      hingeA: P(cx0 - Hp, y4), hingeB: P(cx0, y4), foldAngle: -90, stage: 1, zOffset: layer,
    },
    {
      id: 'dust-rb', parentId: 'side-right', outline: dust(cx1, cx1 + Hp, y3, -1),
      hingeA: P(cx1, y3), hingeB: P(cx1 + Hp, y3), foldAngle: 90, stage: 1, zOffset: layer,
    },
    {
      id: 'dust-rf', parentId: 'side-right', outline: dust(cx1, cx1 + Hp, y4, 1),
      hingeA: P(cx1, y4), hingeB: P(cx1 + Hp, y4), foldAngle: -90, stage: 1, zOffset: layer,
    },
    {
      id: 'lid', parentId: 'back', outline: rect(cx0, y1, cx1, y2),
      hingeA: P(cx0, y2), hingeB: P(cx1, y2), foldAngle: 90, stage: 2,
    },
    {
      id: 'lip', parentId: 'lid', outline: lipOutline,
      hingeA: P(cx0 + tuckIn, y1), hingeB: P(cx1 - tuckIn, y1), foldAngle: 90, stage: 3, zOffset: layer,
    },
    {
      id: 'lip-left', parentId: 'lid',
      outline: [
        P(cx0, y1 + lipIns),
        P(cx0 - lipS, y1 + lipIns + lipSlant),
        P(cx0 - lipS, y2 - lipIns - lipSlant),
        P(cx0, y2 - lipIns),
      ],
      hingeA: P(cx0, y1), hingeB: P(cx0, y2), foldAngle: -90, stage: 3, zOffset: -layer,
    },
    {
      id: 'lip-right', parentId: 'lid',
      outline: [
        P(cx1, y1 + lipIns),
        P(cx1 + lipS, y1 + lipIns + lipSlant),
        P(cx1 + lipS, y2 - lipIns - lipSlant),
        P(cx1, y2 - lipIns),
      ],
      hingeA: P(cx1, y1), hingeB: P(cx1, y2), foldAngle: 90, stage: 3, zOffset: -layer,
    },
  ]

  const cut = (d: string): Segment => ({ kind: 'cut', d })
  const crease = (d: string): Segment => ({ kind: 'crease', d })

  const dustCut = (xa: number, xb: number, y: number, dir: 1 | -1) =>
    `M ${xa} ${y} L ${xa + dustIn} ${y} L ${xa + dustIn + dustSlant} ${y + dir * dustW} ` +
    `L ${xb - dustIn - dustSlant} ${y + dir * dustW} L ${xb - dustIn} ${y} L ${xb} ${y}`

  const segments: Segment[] = [
    cut(
      `M ${cx0 + tuckIn} ${y1} L ${cx0 + tuckIn} ${r} Q ${cx0 + tuckIn} 0 ${cx0 + tuckIn + r} 0 ` +
        `L ${cx1 - tuckIn - r} 0 Q ${cx1 - tuckIn} 0 ${cx1 - tuckIn} ${r} L ${cx1 - tuckIn} ${y1}`,
    ),
    cut(`M ${cx0} ${y1} L ${cx0 + tuckIn} ${y1}`),
    cut(`M ${cx1 - tuckIn} ${y1} L ${cx1} ${y1}`),
    cut(
      `M ${cx0} ${y1} L ${cx0} ${y1 + lipIns} L ${cx0 - lipS} ${y1 + lipIns + lipSlant} ` +
        `L ${cx0 - lipS} ${y2 - lipIns - lipSlant} L ${cx0} ${y2 - lipIns} L ${cx0} ${y2}`,
    ),
    cut(
      `M ${cx1} ${y1} L ${cx1} ${y1 + lipIns} L ${cx1 + lipS} ${y1 + lipIns + lipSlant} ` +
        `L ${cx1 + lipS} ${y2 - lipIns - lipSlant} L ${cx1} ${y2 - lipIns} L ${cx1} ${y2}`,
    ),
    cut(`M ${cx0} ${y2} L ${cx0} ${y3}`),
    cut(`M ${cx1} ${y2} L ${cx1} ${y3}`),
    cut(dustCut(cx0 - Hp, cx0, y3, -1)),
    cut(dustCut(cx0 - Hp, cx0, y4, 1)),
    cut(dustCut(cx1, cx1 + Hp, y3, -1)),
    cut(dustCut(cx1, cx1 + Hp, y4, 1)),
    cut(`M ${cx0 - Hp} ${y3} L ${cx0 - Hp} ${y4}`),
    cut(`M ${cx1 + Hp} ${y3} L ${cx1 + Hp} ${y4}`),
    cut(`M ${cx0} ${y4} L ${cx0} ${y5}`),
    cut(`M ${cx1} ${y4} L ${cx1} ${y5}`),
    cut(`M ${cx0} ${y5} L ${cx1} ${y5}`),
    crease(`M ${cx0 + tuckIn} ${y1} L ${cx1 - tuckIn} ${y1}`),
    crease(`M ${cx0} ${y1 + lipIns} L ${cx0} ${y2 - lipIns}`),
    crease(`M ${cx1} ${y1 + lipIns} L ${cx1} ${y2 - lipIns}`),
    crease(`M ${cx0} ${y2} L ${cx1} ${y2}`),
    crease(`M ${cx0} ${y3} L ${cx1} ${y3}`),
    crease(`M ${cx0} ${y4} L ${cx1} ${y4}`),
    crease(`M ${cx0} ${y3} L ${cx0} ${y4}`),
    crease(`M ${cx1} ${y3} L ${cx1} ${y4}`),
    crease(`M ${cx0 - Hp + dustIn} ${y3} L ${cx0 - dustIn} ${y3}`),
    crease(`M ${cx0 - Hp + dustIn} ${y4} L ${cx0 - dustIn} ${y4}`),
    crease(`M ${cx1 + dustIn} ${y3} L ${cx1 + Hp - dustIn} ${y3}`),
    crease(`M ${cx1 + dustIn} ${y4} L ${cx1 + Hp - dustIn} ${y4}`),
  ]
  if (hasHandle) {
    segments.push(cut(obroundPath(holeLx, holeCy, holeLen, holeThick, true)))
    segments.push(cut(obroundPath(holeRx, holeCy, holeLen, holeThick, true)))
  }

  const dims: DimMark[] = [
    { a: P(cx0, y5 + 12), b: P(cx1, y5 + 12), label: `W ${fmt(Wp)}` },
    { a: P(cx1 + Hp + 8, y3), b: P(cx1 + Hp + 8, y4), label: `D ${fmt(Dp)}` },
    { a: P(cx0 - Hp - 8, y4), b: P(cx0 - Hp - 8, y5), label: `H ${fmt(Hp)}` },
    { a: P(0, -10), b: P(width, -10), label: fmt(width) },
    { a: P(width + 10, 0), b: P(width + 10, height), label: fmt(height) },
  ]

  return { width, height, segments, panels, dims }
}
