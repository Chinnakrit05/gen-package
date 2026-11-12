import { describe, expect, it } from 'vitest'
import { generateVessel } from '../core/vessel'
import { getMaterial } from '../core/materials'
import { vesselVolumeMl } from '../core/capacity'
import { rectBodyGeometry, rectLabelGeometry } from './VesselViewer3D'

// ขวดเหลี่ยม 3D: ลำตัว loft ไม่มี NaN, normal หันออกนอก; แถบฉลากกึ่งกลาง (u = 0.5) อยู่กลางด้านหน้า (+z)
describe('rectBodyGeometry / rectLabelGeometry', () => {
  const v = generateVessel({ W: 76, D: 30, H: 300, handle: false }, getMaterial('glass'), 'body', { rectDepth: 46 })
  const rs = v.rect!

  it('ลำตัว: ทุกจุด/normal เป็นตัวเลข อยู่ในกรอบ W × ลึก และ normal ชี้ออกจากแกน', () => {
    const g = rectBodyGeometry(v.profile, rs)
    const p = g.getAttribute('position')
    const n = g.getAttribute('normal')
    for (let i = 0; i < p.count; i++) {
      const [x, y, z] = [p.getX(i), p.getY(i), p.getZ(i)]
      const [nx, ny, nz] = [n.getX(i), n.getY(i), n.getZ(i)]
      expect(Number.isFinite(x + y + z + nx + ny + nz)).toBe(true)
      expect(Math.abs(x)).toBeLessThanOrEqual(rs.a + 1e-6)
      expect(Math.abs(z)).toBeLessThanOrEqual(rs.b + 1e-6)
      // ผนังตรง (ช่วงลำตัว) normal แนวราบชี้ออก
      if (y > 20 && y < 200 && Math.hypot(x, z) > 1) expect(nx * x + nz * z).toBeGreaterThan(0)
    }
  })

  it('ฉลาก: ยาวเท่าที่หุ้ม กึ่งกลางอยู่หน้า และลอยเหนือผิว', () => {
    const L = v.labelArc * v.labelR
    const g = rectLabelGeometry(rs, v.labelY0, v.labelY1, L)
    const p = g.getAttribute('position')
    const uv = g.getAttribute('uv')
    let len = 0
    const row = p.count / 2
    for (let k = 1; k < row; k++) len += Math.hypot(p.getX(k) - p.getX(k - 1), p.getZ(k) - p.getZ(k - 1))
    expect(len).toBeGreaterThan(L * 0.99)
    expect(len).toBeLessThan(L * 1.03) // วาดบนผิวที่ลอย 0.3 มม. จึงยาวกว่าเล็กน้อย
    // พันรอบ: ปลายสองข้างชนกันที่กลางหลัง ไม่เหลือช่อง
    const end = row - 1
    expect(Math.hypot(p.getX(0) - p.getX(end), p.getZ(0) - p.getZ(end))).toBeLessThan(1e-3)
    const mid = (row - 1) / 2
    expect(uv.getX(mid)).toBeCloseTo(0.5, 9)
    expect(p.getX(mid)).toBeCloseTo(0, 4)
    expect(p.getZ(mid)).toBeCloseTo(rs.b + 0.3, 4)
  })
})

it('lofts a six-sided bottle with a round neck and a label that closes at the back', () => {
  const box = { W: 76, D: 30, H: 220, handle: false }
  const glass = getMaterial('glass')
  const vessel = generateVessel(box, glass, 'body', { polygon: true })
  const section = vessel.rect!
  expect(section.polygon).toBe(true)
  expect(vessel.circ).toBe(3 * box.W)

  const body = rectBodyGeometry(vessel.profile, section)
  const position = body.getAttribute('position')
  const stride = position.count / vessel.profile.length
  const bodyRow = vessel.profile.findIndex((p) => p.x === box.W / 2 && p.y < vessel.mouth!.neckY) * stride
  let perimeter = 0
  for (let i = bodyRow + 1; i < bodyRow + stride; i++) {
    perimeter += Math.hypot(position.getX(i) - position.getX(i - 1), position.getZ(i) - position.getZ(i - 1))
  }
  expect(perimeter).toBeCloseTo(vessel.circ, 4)
  const lip = vessel.profile.findIndex((p) => p.y >= vessel.mouth!.neckY && p.x > section.rn)
  expect(lip).toBeGreaterThanOrEqual(0)
  for (let i = lip * stride; i < (lip + 1) * stride; i++) {
    expect(Math.hypot(position.getX(i), position.getZ(i))).toBeCloseTo(vessel.profile[lip].x, 4)
  }

  const label = rectLabelGeometry(section, vessel.labelY0, vessel.labelY1, vessel.circ)
  const labelPositions = label.getAttribute('position')
  const labelUv = label.getAttribute('uv')
  const end = labelPositions.count / 2 - 1
  expect(labelUv.getX(0)).toBe(0)
  expect(labelUv.getX(end)).toBe(1)
  expect(labelPositions.getX(0)).toBeCloseTo(labelPositions.getX(end), 6)
  expect(labelPositions.getZ(0)).toBeCloseTo(labelPositions.getZ(end), 6)

  const capacity = vesselVolumeMl(vessel.profile, section)
  expect(capacity).toBeGreaterThan(0)
  expect(capacity).toBeLessThan(vesselVolumeMl(generateVessel(box, glass).profile))
  body.dispose()
  label.dispose()
})
