import type { BoxParams, Dieline, Material, Panel } from '../types'
import { arcPts, autoSegments, fmt, obroundPts, P, rect } from './shared'

export function generateHangingDoorBox({ W, D, H }: BoxParams, { thickness: t }: Material): Dieline {
  const width = W + 2 * t
  const depth = D + 2 * t
  const height = H + 2 * t
  const hangerHeight = 25
  const tabDepth = 15
  const inset = Math.max(1, t + 0.5)
  const layer = t + 0.05

  const left = depth
  const right = left + width
  const doorHinge = right + depth
  const doorEdge = doorHinge + width - t
  const top = hangerHeight + depth
  const bottom = top + height
  const doorTop = top + inset
  const doorBottom = bottom - inset
  const tongueEdge = doorEdge + tabDepth
  const radius = tabDepth * 0.45

  // ตั้งผนังข้าง พับลิ้นมุม แล้วประกอบผนังบนและล่างก่อนปิดฝาหน้า
  const panels: Panel[] = [
    { id: 'back', parentId: null, outline: rect(left, top, right, bottom), stage: 0 },
    { id: 'side-left', parentId: 'back', outline: rect(0, top, left, bottom),
      hingeA: P(left, top), hingeB: P(left, bottom), foldAngle: -90, stage: 0 },
    { id: 'side-right', parentId: 'back', outline: rect(right, top, doorHinge, bottom),
      hingeA: P(right, top), hingeB: P(right, bottom), foldAngle: 90, stage: 0 },
    { id: 'top', parentId: 'back', outline: rect(left, hangerHeight, right, top),
      hingeA: P(left, top), hingeB: P(right, top), foldAngle: 90, stage: 2 },
    { id: 'bottom', parentId: 'back', outline: rect(left, bottom, right, bottom + depth),
      hingeA: P(left, bottom), hingeB: P(right, bottom), foldAngle: -90, stage: 2 },
    { id: 'front', parentId: 'side-right', outline: rect(doorHinge, doorTop, doorEdge, doorBottom),
      hingeA: P(doorHinge, doorTop), hingeB: P(doorHinge, doorBottom), foldAngle: 90, stage: 3 },
    { id: 'hanger', parentId: 'top', outline: rect(left, 0, right, hangerHeight),
      holes: [obroundPts(left + width / 2, hangerHeight / 2, Math.min(30, width - 8), 8)],
      hingeA: P(left, hangerHeight), hingeB: P(right, hangerHeight), foldAngle: -90, stage: 2 },
  ]

  for (const [side, start] of [['left', 0], ['right', right]] as const) {
    const a = start + inset
    const b = start + depth - inset
    for (const [edge, y, angle] of [['top', top, 90], ['bottom', bottom, -90]] as const) {
      const end = y - Math.sign(angle) * tabDepth
      panels.push({
        id: `glue-${side}-${edge}`, parentId: `side-${side}`,
        outline: [P(a, y), P(a + 4, end), P(b - 4, end), P(b, y)],
        hingeA: P(a, y), hingeB: P(b, y), foldAngle: angle, stage: 1, zOffset: layer,
      })
    }
  }

  panels.push({
    id: 'door-tuck', parentId: 'front',
    outline: [
      P(doorEdge, doorTop),
      ...arcPts(tongueEdge - radius, doorTop + radius, radius, -Math.PI / 2, 0),
      ...arcPts(tongueEdge - radius, doorBottom - radius, radius, 0, Math.PI / 2),
      P(doorEdge, doorBottom),
    ],
    hingeA: P(doorEdge, doorTop), hingeB: P(doorEdge, doorBottom),
    foldAngle: 90, stage: 4, zOffset: layer, tuck: true,
  })

  return {
    width: tongueEdge, height: bottom + depth, panels, segments: autoSegments(panels),
    dims: [
      { a: P(left, bottom + depth + 8), b: P(right, bottom + depth + 8), label: `W ${fmt(width)}` },
      { a: P(0, top - tabDepth - 8), b: P(left, top - tabDepth - 8), label: `D ${fmt(depth)}` },
      { a: P(-8, top), b: P(-8, bottom), label: `H ${fmt(height)}` },
    ],
  }
}
