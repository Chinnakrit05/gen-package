import { describe, expect, it } from 'vitest'
import {
  LABEL_OVERLAP,
  RECT_CORNER,
  canRectBottle,
  defaultRectDepth,
  generateVessel,
  rectDepthMin,
  rectSectionAt,
  roundedRectArea,
  roundedRectPerimeter,
  roundedRectPoint,
} from './vessel'
import { getMaterial } from './materials'
import { vesselVolumeMl } from './capacity'
import { parseProject } from './project'
import { parseProjectFile, serializeProject } from './projectFile'

// ขวดเหลี่ยม (สี่เหลี่ยมผืนผ้ามุมมน) แก้ว/PET: หน้าตัดลำตัว W × ลึก ไล่เป็นวงกลมที่คอ, ฉลากพันรอบ/หน้าเดียว
const box = { W: 70, D: 28, H: 220, handle: false }
const glass = getMaterial('glass')

describe('รูปสี่เหลี่ยมมุมมน (pure)', () => {
  const [a, b, rc] = [35, 20, 4.4]
  const P = roundedRectPerimeter(a, b, rc)

  it('เส้นรอบรูป/พื้นที่ตรงสูตร และเป็นวงกลมเมื่อ a = b = rc', () => {
    expect(P).toBeCloseTo(4 * (a - rc) + 4 * (b - rc) + 2 * Math.PI * rc, 9)
    expect(roundedRectPerimeter(10, 10, 10)).toBeCloseTo(2 * Math.PI * 10, 9)
    expect(roundedRectArea(10, 10, 10)).toBeCloseTo(Math.PI * 100, 9)
    expect(roundedRectArea(a, b, 0)).toBeCloseTo(4 * a * b, 9)
  })

  it('จุดตามระยะ: เริ่มกลางหน้า เวียนไปขวา ครึ่งรอบ = กลางหลัง ทุกจุดอยู่บนขอบรูป และต่อเนื่อง', () => {
    expect(roundedRectPoint(a, b, rc, 0)).toEqual([0, b])
    expect(roundedRectPoint(0, 0, 0, 3)).toEqual([0, 0]) // ศูนย์กลางก้น ไม่ใช่ NaN
    const back = roundedRectPoint(a, b, rc, P / 2)
    expect(back[0]).toBeCloseTo(0, 9)
    expect(back[1]).toBeCloseTo(-b, 9)
    expect(roundedRectPoint(a, b, rc, (a - rc) + (Math.PI / 4) * rc)[0]).toBeGreaterThan(a - rc) // มุมหน้าขวา
    let prev = roundedRectPoint(a, b, rc, 0)
    for (let i = 1; i <= 400; i++) {
      const p = roundedRectPoint(a, b, rc, (P * i) / 400)
      expect(Math.hypot(p[0] - prev[0], p[1] - prev[1])).toBeLessThan((P / 400) * 1.0001 + 1e-9)
      // บนขอบ: ไม่เกินกรอบ และช่วงมุมห่างศูนย์มุมเท่ารัศมี
      expect(Math.abs(p[0])).toBeLessThanOrEqual(a + 1e-9)
      expect(Math.abs(p[1])).toBeLessThanOrEqual(b + 1e-9)
      if (Math.abs(p[0]) > a - rc && Math.abs(p[1]) > b - rc) {
        expect(Math.hypot(Math.abs(p[0]) - (a - rc), Math.abs(p[1]) - (b - rc))).toBeCloseTo(rc, 6)
      }
      prev = p
    }
  })
})

describe('generateVessel: ขวดเหลี่ยม', () => {
  const v = generateVessel(box, glass, 'body', { rectDepth: 40 })
  const rs = v.rect!

  it('เฉพาะแก้ว/PET; ลำตัวกว้าง W × ลึกที่ตั้ง มุมมนตามสัดส่วน', () => {
    expect(canRectBottle('glass')).toBe(true)
    expect(canRectBottle('pet-bottle')).toBe(true)
    expect(canRectBottle('aluminum')).toBe(false)
    expect(generateVessel(box, getMaterial('aluminum'), 'body', { rectDepth: 40 }).rect).toBeUndefined()
    expect(generateVessel(box, glass).rect).toBeUndefined() // ไม่ตั้ง = ขวดกลม
    expect(rs.a).toBe(35)
    expect(rs.b).toBe(20)
    expect(rs.rc).toBeCloseTo(RECT_CORNER * 20, 9)
  })

  it('ความลึกไม่ต่ำกว่าคอ + เผื่อ (คอต้องผ่านได้) และค่าเริ่มต้น ≈ 0.6W', () => {
    expect(generateVessel(box, glass, 'body', { rectDepth: 5 }).rect!.b * 2).toBe(rectDepthMin(box.D))
    expect(defaultRectDepth(70, 28)).toBe(42)
  })

  it('หน้าตัดไล่จากสี่เหลี่ยมมุมมน (ลำตัว) เป็นวงกลม (คอ)', () => {
    expect(rectSectionAt(rs, rs.R)).toEqual({ a: rs.a, b: rs.b, rc: rs.rc })
    expect(rectSectionAt(rs, rs.rn)).toEqual({ a: rs.rn, b: rs.rn, rc: rs.rn })
    const mid = rectSectionAt(rs, (rs.R + rs.rn) / 2)
    expect(mid.a).toBeGreaterThan(rs.rn)
    expect(mid.a).toBeLessThan(rs.a)
    expect(mid.rc).toBeLessThanOrEqual(Math.min(mid.a, mid.b))
  })

  it('ฉลากพันรอบ = เส้นรอบรูปจริง + ทับกาว; ความยาวที่หุ้มบน 3D (labelArc·labelR) = เส้นรอบรูป', () => {
    expect(v.circ).toBeCloseTo(roundedRectPerimeter(rs.a, rs.b, rs.rc), 9)
    expect(v.label.width).toBeCloseTo(v.circ + LABEL_OVERLAP, 9)
    expect(v.labelArc * v.labelR).toBeCloseTo(v.circ, 9)
  })

  it('ฉลากหน้าเดียว: สั้นกว่าเส้นรอบรูป ไม่มีกาว ความยาวที่หุ้ม = ความยาวฉลาก', () => {
    const f = generateVessel(box, glass, 'body', { rectDepth: 40, label: { w: 50 } })
    expect(f.label.width).toBe(50)
    expect(f.label.panels).toHaveLength(1)
    expect(f.labelArc * f.labelR).toBeCloseTo(50, 9)
  })

  it('ความจุน้อยกว่าขวดกลม ⌀ เท่ากัน (ลึกแคบกว่า) แต่มากกว่าครึ่ง', () => {
    const round = vesselVolumeMl(generateVessel(box, glass).profile)
    const rect = vesselVolumeMl(v.profile, v.rect)
    expect(rect).toBeLessThan(round)
    expect(rect).toBeGreaterThan(round * 0.5)
  })
})

describe('บันทึก/นำเข้า rectDepth', () => {
  it('parseProject เก็บค่า (clamp/ปัด 0.5) และไฟล์งานพาไปด้วย', () => {
    const p = parseProject({
      id: 'x',
      name: 'n',
      live: { template: 'tuck-end', materialId: 'glass', W: 70, D: 28, H: 220, handle: false },
      decos: [],
      rectDepth: 41.3,
    }, 0)!
    expect(p.rectDepth).toBe(41.5)
    const back = parseProjectFile(serializeProject(p))
    expect(back.ok && back.project.rectDepth).toBe(41.5)
  })
})

describe('ขวดเหลี่ยม: คอ/ปากกลมเสมอ', () => {
  for (const id of ['glass', 'pet-bottle'] as const) {
    it(`${id}: ทุกจุดของโปรไฟล์ตั้งแต่โคนคอขึ้นไป (รวมขอบปากวงแหวนที่กว้างกว่าคอ) หน้าตัดเป็นวงกลม`, () => {
      const v = generateVessel(box, getMaterial(id), 'body', { rectDepth: 40 })
      const rs = v.rect!
      expect(rs.yn).toBe(v.mouth!.neckY)
      const neck = v.profile.filter((p) => p.y >= rs.yn!)
      expect(neck.some((p) => p.x > rs.rn)).toBe(true) // มีขอบปากที่กว้างกว่าคอจริง (เคสที่เคยเหลี่ยม)
      for (const p of neck) expect(rectSectionAt(rs, p.x, p.y)).toEqual({ a: p.x, b: p.x, rc: p.x })
      // ลำตัวยังเหลี่ยม
      const body = rectSectionAt(rs, rs.R, (v.labelY0 + v.labelY1) / 2)
      expect(body.a).not.toBe(body.b)
    })
  }
})
