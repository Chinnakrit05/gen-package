import { describe, expect, it } from 'vitest'
import { computeMatrices, to3D } from '../fold'
import { getMaterial } from '../materials'
import { polygonsOverlap } from '../structure/validate'
import { getTemplate } from './index'

const template = getTemplate('hanging-door-box')

describe('hanging-door-box', () => {
  it('preserves the prototype dimensions and cuts one slot above the closed front door', () => {
    const material = getMaterial('carton-400')
    const dieline = template.generate(template.defaults, material)
    expect(dieline.width).toBeCloseTo(258.85)
    expect(dieline.height).toBeCloseTo(228.3)

    const door = dieline.panels.find((panel) => panel.id === 'front')!
    const hanger = dieline.panels.find((panel) => panel.id === 'hanger')!
    const slot = hanger.holes![0]
    const span = (values: number[]) => Math.max(...values) - Math.min(...values)
    expect(door.parentId).toBe('side-right')
    expect(span(slot.map((point) => point.x))).toBeCloseTo(30)
    expect(span(slot.map((point) => point.y))).toBeCloseTo(8)
    expect(dieline.segments.filter((segment) => segment.kind === 'cut' && segment.d.endsWith(' Z'))).toHaveLength(1)

    const matrices = computeMatrices(dieline.panels, 1)
    const doorPoints = door.outline.map((point) => to3D(point).applyMatrix4(matrices.get(door.id)!))
    const hangerPoints = slot.map((point) => to3D(point).applyMatrix4(matrices.get(hanger.id)!))
    for (const point of [...doorPoints, ...hangerPoints]) {
      expect(point.z).toBeCloseTo(template.foldDepth(template.defaults, material))
    }
    expect(Math.min(...hangerPoints.map((point) => point.y))).toBeGreaterThan(Math.max(...doorPoints.map((point) => point.y)))
  })

  it.each([
    ['corrugated-b', { W: 30, D: 20, H: 30 }],
    ['carton-300', { W: 250, D: 150, H: 300 }],
  ] as const)('keeps the flat panels clear of one another on %s at %o', (materialId, dimensions) => {
    const { panels } = template.generate(dimensions, getMaterial(materialId))
    for (const [index, panel] of panels.entries()) {
      for (const other of panels.slice(index + 1)) {
        expect(polygonsOverlap(panel.outline, other.outline), `${panel.id} overlaps ${other.id}`).toBe(false)
      }
    }
  })
})
