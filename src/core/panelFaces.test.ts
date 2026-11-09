import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { assignOuterFaceGroups, dropHingeEdges } from './panelFaces'

// สร้างแผงสี่เหลี่ยมหนา (เหมือนที่ Viewer3D ทำ) แล้วตรวจว่า group ถูกแบ่ง
// ให้ลายพิมพ์ติดเฉพาะฝาด้านนอก (z≈0) ไม่ติดฝาด้านใน (z≈depth) และผนัง
function panel(depth: number) {
  const shape = new THREE.Shape([
    new THREE.Vector2(0, 0),
    new THREE.Vector2(100, 0),
    new THREE.Vector2(100, 60),
    new THREE.Vector2(0, 60),
  ])
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false })
  assignOuterFaceGroups(geo, depth)
  return geo
}

describe('assignOuterFaceGroups', () => {
  it('ครอบคลุมทุกสามเหลี่ยม ไม่ตกหล่น/ทับซ้อน', () => {
    const geo = panel(2)
    const total = geo.groups.reduce((s, g) => s + g.count, 0)
    expect(total).toBe(geo.attributes.position.count)
  })

  it('material 0 = ฝานอกล้วน (z ทุกจุด < ครึ่งความหนา), material 1 = ฝาใน/ผนัง', () => {
    const depth = 2
    const half = depth / 2
    const geo = panel(depth)
    const pos = geo.attributes.position
    let outerTris = 0
    let innerTris = 0
    for (const g of geo.groups) {
      for (let t = g.start / 3; t < (g.start + g.count) / 3; t++) {
        const zs = [pos.getZ(t * 3), pos.getZ(t * 3 + 1), pos.getZ(t * 3 + 2)]
        const allOuter = zs.every((z) => z < half)
        if (g.materialIndex === 0) {
          expect(allOuter).toBe(true) // ฝานอกเท่านั้นที่ได้ลาย
          outerTris++
        } else {
          expect(allOuter).toBe(false) // ฝาใน/ผนังต้องไม่ถูกจัดเป็นฝานอก
          innerTris++
        }
      }
    }
    // สี่เหลี่ยมผืนผ้า 1 หน้า = 2 สามเหลี่ยม → มีฝานอกและฝาใน/ผนังครบทั้งสองฝั่ง
    expect(outerTris).toBeGreaterThanOrEqual(2)
    expect(innerTris).toBeGreaterThanOrEqual(2)
  })

  it('ฝานอกและฝาในมีจำนวนสามเหลี่ยมเท่ากัน (ฝาคู่)', () => {
    const depth = 3
    const half = depth / 2
    const geo = panel(depth)
    const pos = geo.attributes.position
    const triCount = pos.count / 3
    let outer = 0
    let inner = 0
    for (let t = 0; t < triCount; t++) {
      const zs = [pos.getZ(t * 3), pos.getZ(t * 3 + 1), pos.getZ(t * 3 + 2)]
      if (zs.every((z) => z < half)) outer++
      else if (zs.every((z) => z > half)) inner++
    }
    expect(outer).toBe(inner) // ฝาหน้า-หลังเป็นคู่กัน
  })
})

describe('dropHingeEdges', () => {
  it('ตัดเฉพาะเส้นขอบตามแนวบานพับ (ทั้งชั้นนอก z=0 และชั้นใน z=ความหนา) เส้นอื่นคงเดิม', () => {
    // แผ่นคลี่ 100×60 มม. บานพับที่ขอบล่าง (y แผ่นคลี่ = 60 → geometry y = −60)
    const shape = new THREE.Shape([
      new THREE.Vector2(0, 0),
      new THREE.Vector2(100, 0),
      new THREE.Vector2(100, -60),
      new THREE.Vector2(0, -60),
    ])
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.4, bevelEnabled: false })
    const all = new THREE.EdgesGeometry(geo, 25).attributes.position.array
    const kept = dropHingeEdges(all, { x: 0, y: 60 }, { x: 100, y: 60 })
    const onHinge = (y: number) => Math.abs(y + 60) < 1e-6
    const segs = (arr: ArrayLike<number>) => Array.from({ length: arr.length / 6 }, (_, k) => Array.from({ length: 6 }, (_, j) => arr[k * 6 + j]))
    // เส้นที่ทั้งสองปลายอยู่บนแนวบานพับ (เส้นยาวชั้นนอก/ใน + เส้นความหนาที่มุมบานพับ) ถูกตัดหมด
    expect(segs(kept).some((q) => onHinge(q[1]) && onHinge(q[4]))).toBe(false)
    expect(segs(all).filter((q) => onHinge(q[1]) && onHinge(q[4])).length).toBeGreaterThanOrEqual(2)
    // เส้นอื่นคงเดิมครบ
    expect(kept.length / 6).toBe(segs(all).filter((q) => !(onHinge(q[1]) && onHinge(q[4]))).length)
    // ขอบตรงข้ามบานพับ (y = 0) ยังอยู่ทั้งชั้นนอกและชั้นใน
    expect(segs(kept).filter((q) => Math.abs(q[1]) < 1e-6 && Math.abs(q[4]) < 1e-6 && Math.abs(q[0] - q[3]) > 50).length).toBe(2)
  })
})
