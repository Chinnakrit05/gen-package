import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ovalFlipCapGeometry, TUBE_LID_FRAC } from './tubeCapGeometry'

describe('ฝาเหลี่ยมหลอดครีม: รอยต่อฝาพับ + ร่องงัดรูปซุ้ม', () => {
  const ca = 26
  const cb = 13
  const h = 25
  const g = ovalFlipCapGeometry(ca, cb, h)
  const pos = g.getAttribute('position')
  const pts = Array.from({ length: pos.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(pos, i))

  it('อยู่ในกรอบฝา ก้นที่ y=0 ยอดที่ h, ไม่มี NaN', () => {
    expect(pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))).toBe(true)
    g.computeBoundingBox()
    const bb = g.boundingBox!
    expect(bb.min.y).toBeCloseTo(0, 3)
    expect(bb.max.y).toBeCloseTo(h, 3)
    expect(bb.max.x).toBeCloseTo(ca, 3)
    expect(bb.max.z).toBeCloseTo(cb, 3)
    expect(g.getAttribute('normal').count).toBe(pos.count)
  })

  it('ร่องงัด: มีพื้นร่องยุบจากหน้าแบนด้านหน้า กลางหน้า เหนือรอยต่อฝาพับ', () => {
    const gL = h * TUBE_LID_FRAC
    const floor = pts.filter((p) => p.z < cb - 0.5 && p.z > cb - 2 && Math.abs(p.x) < ca * 0.3 && p.y > gL + 0.5)
    expect(floor.length).toBeGreaterThan(10)
    // หน้าแบนด้านหน้าไม่มีเนื้อทับช่องร่อง: จุดที่ z = cb กลางหน้าเหนือรอยต่อเล็กน้อย = ขอบร่องเท่านั้น
    const archTop = Math.max(...floor.map((p) => p.y))
    expect(archTop).toBeGreaterThan(gL + (h - gL) * 0.4)
  })
})
