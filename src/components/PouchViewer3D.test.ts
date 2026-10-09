import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildPouchGeometry, getPouchSealColor } from './PouchViewer3D'
import { generatePouch, DOYPACK_FIN, FLAT_SEAL, POUCH_FIN_SEAL, type PouchStyle } from '../core/pouch'
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
  const PH = pouch.label.height
  const printed = (geometry: THREE.BufferGeometry) => {
    const group = geometry.groups.find((g) => g.materialIndex === 0)!
    const index = geometry.getIndex()!
    const set = new Set<number>()
    for (let i = group.start; i < group.start + group.count; i++) set.add(index.getX(i))
    return [...set]
  }

  it('stands on y=0, reaches the top edge of the panel and stays within the bag width', () => {
    const geometry = buildPouchGeometry(pouch)
    geometry.computeBoundingBox()
    const box = geometry.boundingBox!
    expect(box.min.y).toBeCloseTo(0, 6)
    expect(box.max.y).toBeCloseTo(PH, 4) // ทั้งแผงรวมครึ่งก้น
    expect(box.max.x).toBeLessThanOrEqual(size.W / 2 + 1e-4)
    expect(box.max.z).toBeLessThanOrEqual(pouch.depth3D + DOYPACK_FIN + 1e-4)
    geometry.dispose()
  })

  it('maps each whole dieline panel (seals included) onto its own face; front faces +Z', () => {
    const geometry = buildPouchGeometry(pouch)
    const uv = geometry.getAttribute('uv')
    const normal = geometry.getAttribute('normal')
    const position = geometry.getAttribute('position')
    const ext = { f: [Infinity, -Infinity, Infinity, -Infinity], b: [Infinity, -Infinity, Infinity, -Infinity] }
    for (const v of printed(geometry)) {
      const x = uv.getX(v) * pouch.label.width
      const y = uv.getY(v) * pouch.label.height
      const e = position.getZ(v) > 0 ? ext.f : ext.b
      e[0] = Math.min(e[0], x); e[1] = Math.max(e[1], x); e[2] = Math.min(e[2], y); e[3] = Math.max(e[3], y)
      if (Math.abs(position.getX(v)) < 10 && position.getY(v) > 20 && position.getY(v) < PH * 0.7) {
        expect(Math.sign(normal.getZ(v))).toBe(Math.sign(position.getZ(v)))
        expect(Math.abs(normal.getZ(v))).toBeGreaterThan(0.5)
      }
    }
    for (const [e, x0] of [[ext.f, 0], [ext.b, size.W]] as const) {
      expect(e[0]).toBeCloseTo(x0, 3)
      expect(e[1]).toBeCloseTo(x0 + size.W, 3)
      expect(e[2]).toBeCloseTo(0, 3)
      expect(e[3]).toBeCloseTo(PH, 3)
    }
    geometry.dispose()
  })

  // ถุงมีจุก: ปากค้ำด้วยเรือจุก + ซีลข้างแยกเป็น Λ เหนือก้น — ตรวจแยกใน pouch.test (spoutRows)
  it.skipIf(style === 'spout')('keeps the side seals and top seal flat (film pressed together), like the dieline seal strips', () => {
    const geometry = buildPouchGeometry(pouch)
    const uv = geometry.getAttribute('uv')
    const position = geometry.getAttribute('position')
    let seal = 0
    for (const v of printed(geometry)) {
      const x = (uv.getX(v) * pouch.label.width) % size.W
      const y = uv.getY(v) * pouch.label.height
      const inSideSeal = x < pouch.sideSeal - 1e-3 || x > size.W - pouch.sideSeal + 1e-3
      const inTopSeal = y < pouch.frontRect.y - 1e-3
      if (!inSideSeal && !inTopSeal) continue
      expect(Math.abs(position.getZ(v))).toBeCloseTo(DOYPACK_FIN, 4)
      seal++
    }
    expect(seal).toBeGreaterThan(0)
    geometry.dispose()
  })
})

describe('pillow geometry', () => {
  const size = { W: 120, D: 60, H: 160 }
  const pouch = generatePouch(size, getMaterial('pouch-foil'), { style: 'pillow' })

  it('lays the fin seal flat on the back centre, textured from the right fin flap', () => {
    const geometry = buildPouchGeometry(pouch)
    const uv = geometry.getAttribute('uv')
    const position = geometry.getAttribute('position')
    const finX0 = POUCH_FIN_SEAL + 2 * size.W
    let fin = 0
    for (let i = 0; i < uv.count; i++) {
      const x = uv.getX(i) * pouch.label.width
      if (x < finX0 + 1e-3) continue
      fin++
      expect(position.getZ(i)).toBeLessThan(0) // หลังถุง
      expect(position.getX(i)).toBeLessThanOrEqual(1e-6)
      expect(position.getX(i)).toBeGreaterThanOrEqual(-POUCH_FIN_SEAL - 1e-6)
    }
    expect(fin).toBeGreaterThan(0)
    geometry.dispose()
  })

  it('maps the front panel onto +Z and keeps the top/bottom seals flat', () => {
    const geometry = buildPouchGeometry(pouch)
    const uv = geometry.getAttribute('uv')
    const position = geometry.getAttribute('position')
    const fx = pouch.frontRect.x
    const st = pouch.frontRect.y
    for (let i = 0; i < uv.count; i++) {
      const x = uv.getX(i) * pouch.label.width
      const y = uv.getY(i) * pouch.label.height
      if (x > fx + 1 && x < fx + size.W - 1 && y > 0) expect(position.getZ(i)).toBeGreaterThan(0)
      if (y < st - 1e-3 && x > fx && x < fx + size.W) expect(Math.abs(position.getZ(i))).toBeLessThan(DOYPACK_FIN + 1e-4)
    }
    geometry.dispose()
  })
})

describe('flat 3-side-seal geometry', () => {
  const size = { W: 100, D: 60, H: 150 }
  const pouch = generatePouch(size, getMaterial('pouch-foil'), { style: 'flat' })
  const PH = pouch.label.height

  it('maps each whole panel to its own face with flat seals on all four edges', () => {
    const geometry = buildPouchGeometry(pouch)
    const uv = geometry.getAttribute('uv')
    const position = geometry.getAttribute('position')
    const group = geometry.groups.find((g) => g.materialIndex === 0)!
    const index = geometry.getIndex()!
    let seal = 0
    for (let i = group.start; i < group.start + group.count; i++) {
      const v = index.getX(i)
      const x = uv.getX(v) * pouch.label.width
      const y = uv.getY(v) * pouch.label.height
      const local = x % size.W
      expect(Math.sign(position.getZ(v))).toBe(x < size.W - 1e-3 ? 1 : x > size.W + 1e-3 ? -1 : Math.sign(position.getZ(v)))
      if (local < FLAT_SEAL - 1e-3 || local > size.W - FLAT_SEAL + 1e-3 || y < FLAT_SEAL - 1e-3 || y > PH - FLAT_SEAL + 1e-3) {
        expect(Math.abs(position.getZ(v))).toBeCloseTo(DOYPACK_FIN, 4)
        seal++
      }
    }
    expect(seal).toBeGreaterThan(0)
    geometry.computeBoundingBox()
    expect(geometry.boundingBox!.max.y).toBeCloseTo(PH, 4)
    expect(geometry.boundingBox!.max.x).toBeCloseTo(size.W / 2, 4)
    geometry.dispose()
  })
})
