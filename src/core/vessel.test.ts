import { describe, expect, it } from 'vitest'
import { LABEL_OVERLAP, generateVessel, isVessel } from './vessel'
import { MATERIALS, getMaterial } from './materials'
import { computeGuides } from './guides'
import { dielineDXFString } from './dxf'

const VESSEL_IDS = ['pet-bottle', 'glass', 'aluminum'] as const
const box = { W: 66, D: 28, H: 210, handle: false }

describe('vessel: การจัดกลุ่มวัสดุ', () => {
  it('วัสดุพับไม่ได้ทั้งหมดคือภาชนะ และมีครบ 3 ชนิด', () => {
    const vessels = MATERIALS.filter((m) => isVessel(m)).map((m) => m.id)
    expect(vessels.sort()).toEqual([...VESSEL_IDS].sort())
  })
})

describe.each(VESSEL_IDS.map((id) => [id] as const))('vessel: โปรไฟล์ %s', (id) => {
  const v = generateVessel(box, getMaterial(id))

  it('เริ่มที่แกนกลางก้น (0,0) และสูงถึง H พอดี', () => {
    expect(v.profile[0].x).toBe(0)
    expect(v.profile[0].y).toBe(0)
    expect(Math.max(...v.profile.map((p) => p.y))).toBeCloseTo(box.H)
  })

  it('รัศมีกว้างสุด = W/2 และทุกจุด finite ไม่ติดลบ', () => {
    expect(Math.max(...v.profile.map((p) => p.x))).toBeCloseTo(
      id === 'pet-bottle' ? Math.max(box.W / 2, (box.D / 2) * 1.12) : box.W / 2,
    )
    expect(v.profile.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0)).toBe(true)
  })

  it('ความสูงไม่ย้อนกลับ (โปรไฟล์ไล่จากล่างขึ้นบน)', () => {
    for (let i = 1; i < v.profile.length; i++) {
      expect(v.profile[i].y).toBeGreaterThanOrEqual(v.profile[i - 1].y - 1e-9)
    }
  })

  it('ช่วงติดฉลากอยู่บนลำตัว (ใต้บ่า) และรัศมีฉลาก = รัศมีตัว', () => {
    expect(v.labelY0).toBeGreaterThan(0)
    expect(v.labelY1).toBeGreaterThan(v.labelY0)
    expect(v.labelY1).toBeLessThan(box.H)
    expect(v.labelR).toBeCloseTo(box.W / 2)
  })

  it('กระป๋องปิดฝาบน (จบที่แกนกลาง) ขวด/โหลปากเปิด', () => {
    const last = v.profile[v.profile.length - 1]
    if (id === 'aluminum') expect(last.x).toBe(0)
    else expect(last.x).toBeGreaterThan(0)
  })
})

describe.each(VESSEL_IDS.map((id) => [id] as const))('vessel: dieline ฉลาก %s', (id) => {
  const v = generateVessel(box, getMaterial(id))

  it('กว้าง = เส้นรอบวง π⌀ + ระยะทับกาว', () => {
    expect(v.label.width).toBeCloseTo(Math.PI * box.W + LABEL_OVERLAP)
    expect(v.label.height).toBeCloseTo(v.labelY1 - v.labelY0)
  })

  it('สองแผง (label + glue) — รอยต่อกาวเป็นขอบร่วม ไม่ใช่ขอบนอก', () => {
    expect(v.label.panels.map((p) => p.id)).toEqual(['label', 'glue'])
    const g = computeGuides(v.label.panels)
    // ขอบร่วมที่ x = เส้นรอบวง ต้องไม่มี bleed (เหมือนรอยพับของกล่อง)
    const circ = Math.PI * box.W
    const atSeam = g.bleed.filter(
      ([a, b]) => Math.abs(a.x - b.x) < 0.01 && Math.abs((a.x + b.x) / 2 - circ) < 4,
    )
    expect(atSeam).toHaveLength(0)
    expect(g.safe.length).toBeGreaterThanOrEqual(1)
  })

  it('ไหลผ่านระบบ export เดิมได้ (DXF)', () => {
    const dxf = dielineDXFString(v.label)
    expect(dxf).toContain('EOF')
    expect(dxf).not.toContain('NaN')
  })
})

describe('vessel: รูปแบบฉลาก (label style)', () => {
  const g = getMaterial('glass')
  const bodyV = generateVessel(box, g, 'body')
  const fullV = generateVessel(box, g, 'full')
  const bandV = generateVessel(box, g, 'band')
  const neckV = generateVessel(box, g, 'neck')

  it('“สูงเต็มตัว” สูงสุด, “แถบกลาง/แถบบน” เตี้ยกว่ามาตรฐาน', () => {
    const h = (v: ReturnType<typeof generateVessel>) => v.labelY1 - v.labelY0
    expect(h(fullV)).toBeGreaterThan(h(bodyV))
    expect(h(bandV)).toBeLessThan(h(bodyV))
    expect(h(neckV)).toBeLessThan(h(bodyV))
    // ความสูงฉลากใน dieline เปลี่ยนตาม (ไฟล์ที่ export ต่างกันจริง)
    expect(fullV.label.height).toBeCloseTo(h(fullV))
    expect(bandV.label.height).toBeCloseTo(h(bandV))
  })

  it('“แถบบน (ใกล้คอ)” อยู่สูงกว่า “แถบกลาง”', () => {
    const mid = (v: ReturnType<typeof generateVessel>) => (v.labelY0 + v.labelY1) / 2
    expect(mid(neckV)).toBeGreaterThan(mid(bandV))
  })

  it('ทุกแบบยังอยู่บนลำตัว (0 < y < H) และกว้าง = เส้นรอบวงเดิม', () => {
    for (const v of [bodyV, fullV, bandV, neckV]) {
      expect(v.labelY0).toBeGreaterThanOrEqual(0)
      expect(v.labelY1).toBeLessThanOrEqual(box.H)
      expect(v.labelY1).toBeGreaterThan(v.labelY0)
      expect(v.label.width).toBeCloseTo(Math.PI * box.W + LABEL_OVERLAP)
    }
  })

  it('ไม่ใส่ style = เท่ากับ body', () => {
    const def = generateVessel(box, g)
    expect(def.labelY0).toBeCloseTo(bodyV.labelY0)
    expect(def.labelY1).toBeCloseTo(bodyV.labelY1)
  })
})

describe('vessel: กันข้อมูลพิลึก', () => {
  it('D ใหญ่กว่า W ถูกบีบให้คอเล็กกว่าตัวเสมอ', () => {
    const v = generateVessel({ W: 60, D: 150, H: 100, handle: false }, getMaterial('glass'))
    const neckR = v.profile[v.profile.length - 1].x
    expect(neckR).toBeLessThan(30) // < W/2
  })
})
