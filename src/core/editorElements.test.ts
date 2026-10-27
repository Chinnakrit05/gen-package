import { describe, expect, it } from 'vitest'
import { makeLibraryShape } from './editorElements'
import { parseDeco, pathDataString, svgArtworkLayer } from './artwork'
import { TEMPLATES } from './templates'
import { getMaterial } from './materials'

describe('V2 element library exports', () => {
  const dieline = TEMPLATES[0].generate({ W: 80, D: 50, H: 120, handle: false }, getMaterial('carton-300'))
  it.each(['heart', 'cross', 'arrow'] as const)('%s remains a native editable path after saving', kind => {
    const shape = makeLibraryShape(dieline, kind)!
    expect(shape.closed).toBe(true)
    expect(shape.w).toBeGreaterThan(0)
    expect(shape.h).toBeGreaterThan(0)
    expect(shape.x).toBeGreaterThanOrEqual(0)
    expect(shape.y).toBeGreaterThanOrEqual(0)
    expect(shape.x + shape.w).toBeLessThanOrEqual(dieline.width)
    expect(shape.y + shape.h).toBeLessThanOrEqual(dieline.height)
    const restored = parseDeco(JSON.parse(JSON.stringify(shape)))
    expect(restored).toEqual(shape)
    expect(pathDataString(shape, (nx, ny) => [shape.x + nx * shape.w, shape.y + ny * shape.h])).not.toMatch(/NaN|Infinity/)
    expect(svgArtworkLayer([shape])).toContain('fill="#00a896"')
  })
})
