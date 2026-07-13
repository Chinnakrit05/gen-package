import type { BoxParams, Dieline, DimMark, Material, Panel, Segment } from '../types'
import { P, fmt, rect } from './shared'

// ปลอกสวม (sleeve): ท่อสี่เหลี่ยม 4 แผง + ปีกทากาว เปิดหัว-ท้าย
// W,D คือขนาดด้านในหน้าตัด (บวกเผื่อ 2t), H คือความยาวปลอก (ไม่ต้องเผื่อ)
export function generateSleeve(box: BoxParams, mat: Material): Dieline {
  const { W, D, H } = box
  const t = mat.thickness

  const Wp = W + 2 * t
  const Dp = D + 2 * t
  const glueW = Math.max(12, 10 + 2 * t)
  const taper = 4
  const layer = t + 0.05

  const x1 = glueW
  const x2 = x1 + Dp
  const x3 = x2 + Wp
  const x4 = x3 + Dp
  const x5 = x4 + Wp
  const top = 0
  const bot = H

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
  ]

  const cut = (d: string): Segment => ({ kind: 'cut', d })
  const crease = (d: string): Segment => ({ kind: 'crease', d })

  const segments: Segment[] = [
    cut(`M ${x1} ${top} L 0 ${top + taper} L 0 ${bot - taper} L ${x1} ${bot}`),
    cut(`M ${x1} ${top} L ${x5} ${top}`),
    cut(`M ${x1} ${bot} L ${x5} ${bot}`),
    cut(`M ${x5} ${top} L ${x5} ${bot}`),
    crease(`M ${x1} ${top} L ${x1} ${bot}`),
    crease(`M ${x2} ${top} L ${x2} ${bot}`),
    crease(`M ${x3} ${top} L ${x3} ${bot}`),
    crease(`M ${x4} ${top} L ${x4} ${bot}`),
  ]

  const dims: DimMark[] = [
    { a: P(x2, bot + 12), b: P(x3, bot + 12), label: `W ${fmt(Wp)}` },
    { a: P(x1, bot + 12), b: P(x2, bot + 12), label: `D ${fmt(Dp)}` },
    { a: P(-8, top), b: P(-8, bot), label: `H ${fmt(H)}` },
    { a: P(0, -10), b: P(x5, -10), label: fmt(x5) },
    { a: P(x5 + 10, top), b: P(x5 + 10, bot), label: fmt(bot) },
  ]

  return { width: x5, height: bot, segments, panels, dims }
}
