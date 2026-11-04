import { describe, expect, it } from 'vitest'
import { computeMatrices, to3D } from '../fold'
import { getMaterial } from '../materials'
import { checkFoldSweep, polygonsOverlap } from '../structure/validate'
import { getTemplate } from './index'
import { TAPERED_LID_BOX_ID, taperedLidWidth } from './taperedLidBox'

const template = getTemplate(TAPERED_LID_BOX_ID)

describe('tapered-lid-box', () => {
  it('folds the tea box with the side walls meeting the top corners and the tongue inside', () => {
    const material = getMaterial('carton-400')
    const { panels, segments } = template.generate(template.defaults, material)
    const matrices = computeMatrices(panels, 1)
    const corners = (id: string) => panels.find(panel => panel.id === id)!.outline.map(
      point => to3D(point).applyMatrix4(matrices.get(id)!),
    )
    const front = corners('front')
    const back = corners('back')
    const side = corners('side-left')
    const height = template.foldDepth(template.defaults, material)

    expect(taperedLidWidth(template.defaults.W)).toBeCloseTo(104)
    expect(front[3].distanceTo(front[2])).toBeCloseTo(104 + 2 * material.thickness)
    expect(back[3].distanceTo(side[0])).toBeCloseTo(0)
    expect(front[3].distanceTo(side[3])).toBeCloseTo(0)
    for (const corner of corners('lid')) expect(corner.z).toBeCloseTo(height)
    expect(corners('tongue-lid')[1].y).toBeGreaterThan(front[0].y + material.thickness)
    expect(corners('tongue-lid')[1].z).toBeLessThan(height - 12)
    expect(segments.filter(segment => segment.kind === 'crease')).toHaveLength(10)
  })

  it.each([
    ['carton-400', template.defaults],
    ['corrugated-b', { W: 30, D: 20, H: 30 }],
    ['carton-300', { W: 250, D: 150, H: 300 }],
    ['carton-300', { W: 250, D: 20, H: 30 }],
  ] as const)('keeps the panels clear on %s at %o', (materialId, dimensions) => {
    const { panels } = template.generate(dimensions, getMaterial(materialId))
    for (const [index, panel] of panels.entries()) {
      for (const other of panels.slice(index + 1)) {
        expect(polygonsOverlap(panel.outline, other.outline), `${panel.id} overlaps ${other.id}`).toBe(false)
      }
    }
    expect(checkFoldSweep(panels)).toEqual([])
  })
})
