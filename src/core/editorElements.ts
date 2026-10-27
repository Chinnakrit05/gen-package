import { makePathEl, makeShapeEl, type RawAnchor } from './artwork'
import type { Dieline } from './types'

// Native paths keep these library shapes editable and supported by every existing export.
export function makeLibraryShape(dieline: Dieline, kind: 'heart' | 'cross' | 'arrow') {
  const box = makeShapeEl(dieline, 'rect')
  const points = kind === 'heart'
    ? Array.from({ length: 64 }, (_, i) => {
      const a = i / 64 * Math.PI * 2
      return [(16 * Math.sin(a) ** 3 + 16) / 32, (13 - (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a))) / 30]
    })
    : kind === 'cross'
      ? [[.35, 0], [.65, 0], [.65, .35], [1, .35], [1, .65], [.65, .65], [.65, 1], [.35, 1], [.35, .65], [0, .65], [0, .35], [.35, .35]]
      : [[.5, 0], [1, .5], [.68, .5], [.68, 1], [.32, 1], [.32, .5], [0, .5]]
  const path = makePathEl(points.map(([x, y]) => ({ x: box.x + x * box.w, y: box.y + y * box.h })) as RawAnchor[], true)
  return path ? { ...path, fill: '#00a896', stroke: 'none', strokeW: 0 } : null
}
