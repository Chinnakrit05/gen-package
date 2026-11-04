import type { BoxParams, Dieline, Material, Panel } from '../types'
import { autoSegments, fmt, P, rect } from './shared'

export const TAPERED_LID_BOX_ID = 'tapered-lid-box'
const TAPER_RATIO = 19 / 142

export const taperedLidWidth = (width: number) => width * (1 - 2 * TAPER_RATIO)

export function generateTaperedLidBox({ W, D, H }: BoxParams, { thickness: t }: Material): Dieline {
  const width = W + 2 * t
  const depth = D + 2 * t
  const height = H + 2 * t
  const taper = W * TAPER_RATIO
  const sideHeight = Math.hypot(height, taper)
  const sideAngle = 90 + Math.atan2(taper, height) * 180 / Math.PI
  const inset = t + 0.6
  const layer = t + 0.05
  const lidDepth = depth - t - 0.55
  const lip = Math.min(15, H / 2)
  const left = sideHeight
  const right = left + width
  const topLeft = left + taper
  const topRight = right - taper
  const lidLeft = topLeft + inset
  const lidRight = topRight - inset
  const backTop = lidDepth + lip
  const backBase = backTop + height
  const frontBase = backBase + depth
  const frontTop = frontBase + height
  const sheetWidth = right + sideHeight

  // ผนังข้างเอียงเข้าหากันและพับปีกกาวด้านใน ก่อนตั้งผนังหน้า/หลังและปิดฝา
  const panels: Panel[] = [
    { id: 'base', parentId: null, outline: rect(left, backBase, right, frontBase), stage: 0 },
    { id: 'side-left', parentId: 'base', outline: rect(0, backBase, left, frontBase),
      hingeA: P(left, backBase), hingeB: P(left, frontBase), foldAngle: -sideAngle, stage: 0 },
    { id: 'side-right', parentId: 'base', outline: rect(right, backBase, sheetWidth, frontBase),
      hingeA: P(right, backBase), hingeB: P(right, frontBase), foldAngle: sideAngle, stage: 0 },
    { id: 'back', parentId: 'base', outline: [P(left, backBase), P(right, backBase), P(topRight, backTop), P(topLeft, backTop)],
      hingeA: P(left, backBase), hingeB: P(right, backBase), foldAngle: 90, stage: 2 },
    { id: 'front', parentId: 'base', outline: [P(left, frontBase), P(right, frontBase), P(topRight, frontTop), P(topLeft, frontTop)],
      hingeA: P(left, frontBase), hingeB: P(right, frontBase), foldAngle: -90, stage: 2 },
    { id: 'lid', parentId: 'back', outline: rect(lidLeft, lip, lidRight, backTop),
      hingeA: P(lidLeft, backTop), hingeB: P(lidRight, backTop), foldAngle: 90, stage: 3 },
    { id: 'tongue-lid', parentId: 'lid',
      outline: [P(lidLeft + 3, lip), P(lidLeft + 7, 0), P(lidRight - 7, 0), P(lidRight - 3, lip)],
      hingeA: P(lidLeft + 3, lip), hingeB: P(lidRight - 3, lip), foldAngle: 90, stage: 4, zOffset: layer, tuck: true },
  ]
  for (const [side, a, b] of [['side-left', 3, left - 3], ['side-right', right + 3, sheetWidth - 3]] as const) {
    for (const [edge, y, sign] of [['back', backBase, 1], ['front', frontBase, -1]] as const) {
      const tabEdge = y - 12 * sign
      panels.push({
        id: `glue-${side}-${edge}`, parentId: side, stage: 1, zOffset: layer, foldAngle: 90 * sign,
        outline: [P(a, y), P(b, y), P(b - 4, tabEdge), P(a + 4, tabEdge)],
        hingeA: P(a, y), hingeB: P(b, y),
      })
    }
  }
  return {
    width: sheetWidth, height: frontTop, panels, segments: autoSegments(panels),
    dims: [
      { a: P(left, frontTop + 8), b: P(right, frontTop + 8), label: `W ${fmt(width)}` },
      { a: P(-8, backBase), b: P(-8, frontBase), label: `D ${fmt(depth)}` },
      { a: P(sheetWidth + 8, frontBase), b: P(sheetWidth + 8, frontTop), label: `H ${fmt(height)}` },
    ],
  }
}
