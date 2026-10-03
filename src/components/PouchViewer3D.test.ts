import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildPouchGeometry } from './PouchViewer3D'
import { generatePouch } from '../core/pouch'
import { getMaterial } from '../core/materials'

describe.each([
  { W: 80, D: 50, H: 120 },
  { W: 250, D: 150, H: 150 },
])('brick pouch seal geometry ($W x $D x $H)', (size) => {
  it('renders both 20 mm print bands at their full length without stretching', () => {
    const pouch = generatePouch(size, getMaterial('pouch-foil'), { style: 'gusset' })
    const geometry = buildPouchGeometry(pouch)
    const uv = geometry.getAttribute('uv')
    const position = geometry.getAttribute('position')
    const index = geometry.getIndex()!
    const printGroup = geometry.groups.find((group) => group.materialIndex === 0)!
    const found = { top: 0, bottom: 0 }
    for (let i = printGroup.start; i < printGroup.start + printGroup.count; i += 3) {
      const tri = [index.getX(i), index.getX(i + 1), index.getX(i + 2)]
      const print = tri.map((v) => [uv.getX(v) * pouch.label.width, uv.getY(v) * pouch.label.height])
      if (!print.every(([x]) => x >= -0.0001 && x <= size.W + 0.0001)) continue
      const top = print.every(([, y]) => y <= 20.0001)
      const bottom = print.every(([, y]) => y >= size.H + 19.9999)
      if (!top && !bottom) continue
      found[top ? 'top' : 'bottom']++
      for (let edge = 0; edge < 3; edge++) {
        const a = edge
        const b = (edge + 1) % 3
        const printLength = Math.hypot(print[a][0] - print[b][0], print[a][1] - print[b][1])
        const surfaceLength = new THREE.Vector3().fromBufferAttribute(position, tri[a])
          .distanceTo(new THREE.Vector3().fromBufferAttribute(position, tri[b]))
        expect(surfaceLength).toBeCloseTo(printLength, 3)
      }
    }
    expect(found.top).toBeGreaterThan(0)
    expect(found.bottom).toBeGreaterThan(0)
    geometry.dispose()
  })

  it('keeps the bottom seal below the flat base and exposes its folded edge', () => {
    const pouch = generatePouch(size, getMaterial('pouch-foil'), { style: 'gusset' })
    const geometry = buildPouchGeometry(pouch)
    const uv = geometry.getAttribute('uv')
    const position = geometry.getAttribute('position')
    const folded: number[] = []
    for (let i = 0; i < uv.count; i++) {
      if (uv.getY(i) * pouch.label.height > size.H + 20.0001) folded.push(i)
    }
    expect(folded.length).toBeGreaterThan(0)
    for (const i of folded) {
      expect(position.getY(i)).toBeLessThan(0)
      expect(Math.abs(position.getX(i))).toBeLessThanOrEqual(size.W / 2)
    }
    expect(Math.min(...folded.map((i) => position.getZ(i)))).toBeLessThan(-size.D / 2)
    expect(Math.max(...folded.map((i) => uv.getY(i)))).toBeCloseTo(1, 5)
    geometry.dispose()
  })
})
