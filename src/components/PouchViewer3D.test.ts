import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildPouchGeometry, getPouchSealColor } from './PouchViewer3D'
import { generatePouch, type PouchStyle } from '../core/pouch'
import { getMaterial } from '../core/materials'

describe('brick pouch seal color', () => {
  const size = { W: 80, D: 50, H: 120 }

  it.each(['pouch-foil', 'pouch-kraft', 'pouch-clear'])('matches the white print background for %s', (id) => {
    const mat = getMaterial(id)
    const pouch = generatePouch(size, mat, { style: 'gusset' })
    for (const fillColor of [undefined, null, '']) {
      expect(getPouchSealColor(pouch, mat, fillColor, true)).toBe('#ffffff')
    }
  })

  it.each(['#91b6bd', '#e94859', '#243c32'])('matches a custom print background %s', (fillColor) => {
    const mat = getMaterial('pouch-foil')
    const pouch = generatePouch(size, mat, { style: 'gusset' })
    expect(getPouchSealColor(pouch, mat, fillColor, true)).toBe(fillColor)
  })

  it('keeps the body material color while its texture is not ready', () => {
    const mat = getMaterial('pouch-kraft')
    const pouch = generatePouch(size, mat, { style: 'gusset' })
    expect(getPouchSealColor(pouch, mat, '#91b6bd', false)).toBe(mat.color)
  })

  it.each<PouchStyle>(['stand', 'flat', 'box', 'pillow', 'spout'])('does not change %s seals', (style) => {
    const mat = getMaterial('pouch-foil')
    const pouch = generatePouch(size, mat, { style })
    expect(getPouchSealColor(pouch, mat, '#91b6bd', true)).toBe(mat.color)
  })
})

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

  it('joins the body, folded base and bottom seal into one indexed surface', () => {
    const pouch = generatePouch(size, getMaterial('pouch-foil'), { style: 'gusset' })
    const geometry = buildPouchGeometry(pouch)
    const index = geometry.getIndex()!
    const neighbors = new Map<number, Set<number>>()
    for (let i = 0; i < index.count; i += 3) {
      const triangle = [index.getX(i), index.getX(i + 1), index.getX(i + 2)]
      for (const vertex of triangle) {
        if (!neighbors.has(vertex)) neighbors.set(vertex, new Set())
        for (const other of triangle) neighbors.get(vertex)!.add(other)
      }
    }
    const visited = new Set<number>()
    const pending = [index.getX(0)]
    while (pending.length) {
      const vertex = pending.pop()!
      if (visited.has(vertex)) continue
      visited.add(vertex)
      pending.push(...neighbors.get(vertex)!)
    }
    expect(visited.size).toBe(neighbors.size)
    geometry.dispose()
  })

  it('tucks the complete bottom seal inside the base footprint', () => {
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
      expect(position.getY(i)).toBeGreaterThan(-2)
      expect(Math.abs(position.getX(i))).toBeLessThanOrEqual(size.W / 2)
      expect(Math.abs(position.getZ(i))).toBeLessThanOrEqual(size.D / 2)
    }
    expect(Math.max(...folded.map((i) => uv.getY(i)))).toBeCloseTo(1, 5)
    geometry.dispose()
  })

  it('closes the folded skin without open edges or internal caps', () => {
    const pouch = generatePouch(size, getMaterial('pouch-foil'), { style: 'gusset' })
    const geometry = buildPouchGeometry(pouch)
    const position = geometry.getAttribute('position')
    const index = geometry.getIndex()!
    const vertices = new Map<string, number>()
    const welded: number[] = []
    for (let i = 0; i < position.count; i++) {
      // Only weld the duplicated UV seam for this surface-boundary check.
      const key = [position.getX(i), position.getY(i), position.getZ(i)]
        .map((value) => value.toFixed(5)).join(',')
      if (!vertices.has(key)) vertices.set(key, vertices.size)
      welded.push(vertices.get(key)!)
    }
    const edges = new Map<string, number>()
    for (let i = 0; i < index.count; i += 3) {
      const triangle = [index.getX(i), index.getX(i + 1), index.getX(i + 2)].map((v) => welded[v])
      expect(new Set(triangle).size).toBe(3)
      for (let e = 0; e < 3; e++) {
        const a = triangle[e]
        const b = triangle[(e + 1) % 3]
        const key = `${Math.min(a, b)},${Math.max(a, b)}`
        edges.set(key, (edges.get(key) ?? 0) + 1)
      }
    }
    expect(new Set(edges.values())).toEqual(new Set([2]))
    geometry.dispose()
  })
})

describe.each<PouchStyle>(['stand', 'spout'])('doypack geometry (%s)', (style) => {
  const size = { W: 120, D: 60, H: 180 }
  const pouch = generatePouch(size, getMaterial('pouch-foil'), { style })

  it('stays within the pouch footprint, stands on y=0 and reaches the top seal', () => {
    const geometry = buildPouchGeometry(pouch)
    geometry.computeBoundingBox()
    const box = geometry.boundingBox!
    expect(box.min.y).toBeCloseTo(0, 6)
    expect(box.max.y).toBeCloseTo(size.H + pouch.frontRect.y, 6)
    expect(box.max.x).toBeLessThanOrEqual(size.W / 2 + 1e-6)
    expect(box.max.z).toBeLessThanOrEqual(pouch.depth3D + 1e-6)
    geometry.dispose()
  })

  it('front skin faces +Z and covers the whole front print area', () => {
    const geometry = buildPouchGeometry(pouch)
    const uv = geometry.getAttribute('uv')
    const normal = geometry.getAttribute('normal')
    const position = geometry.getAttribute('position')
    const printGroup = geometry.groups.find((group) => group.materialIndex === 0)!
    const index = geometry.getIndex()!
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (let i = printGroup.start; i < printGroup.start + printGroup.count; i++) {
      const v = index.getX(i)
      const x = uv.getX(v) * pouch.label.width
      const y = uv.getY(v) * pouch.label.height
      if (x < pouch.frontRect.x - 1e-3 || x > pouch.frontRect.x + size.W + 1e-3) continue
      if (position.getZ(v) < -1e-6) continue
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
      // กลางหน้าช่วงลำตัว: normal ชี้ออกหน้า (+Z)
      if (Math.abs(position.getX(v)) < 10 && position.getY(v) > 20 && position.getY(v) < size.H * 0.8) {
        expect(normal.getZ(v)).toBeGreaterThan(0.5)
      }
    }
    expect(minX).toBeCloseTo(pouch.frontRect.x, 4)
    expect(maxX).toBeCloseTo(pouch.frontRect.x + size.W, 4)
    expect(minY).toBeCloseTo(0, 4) // แถบซีลบนมีลาย
    expect(maxY).toBeCloseTo(pouch.frontRect.y + size.H, 4)
    geometry.dispose()
  })

  it('keeps the side seams sharp: front and back skins meet at depth 0 with separate normals', () => {
    const geometry = buildPouchGeometry(pouch)
    const position = geometry.getAttribute('position')
    const normal = geometry.getAttribute('normal')
    let seams = 0
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i)
      if (y < 30 || y > size.H * 0.7) continue
      if (Math.abs(Math.abs(position.getX(i)) - size.W / 2) > 1e-6) continue
      expect(Math.abs(position.getZ(i))).toBeLessThan(1e-6)
      // normal ที่ตะเข็บเอียงไปด้านหน้าหรือหลังชัดเจน (ไม่ถูกเกลี่ยรวมเป็นแนวข้าง)
      if (normal.getY(i) > -0.9) {
        expect(Math.abs(normal.getZ(i))).toBeGreaterThan(0.3)
        seams++
      }
    }
    expect(seams).toBeGreaterThan(0)
    geometry.dispose()
  })
})
