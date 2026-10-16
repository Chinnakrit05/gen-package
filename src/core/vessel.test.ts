import { describe, expect, it } from 'vitest'
import { BODY_MIN, CAP_STYLES, capShape, LABEL_MIN, LABEL_OVERLAP, NECK_MIN, SHOULDER_MIN, defaultShoulderH, resolveShoulderH, shoulderMax, TUBE_CAP_FRAC, TUBE_SEAL, defaultNeckH, generateVessel, isVessel, resolveNeckH, tubeSection } from './vessel'
import { ellipsePerimeter } from './pouch'
import { MATERIALS, getMaterial } from './materials'
import { computeGuides } from './guides'
import { dielineDXFString } from './dxf'

// โปรไฟล์ภาชนะปากเปิด/กระป๋อง (ตรวจแบบทั่วไป) — หลอดครีมมีเงื่อนไขก้นซีล/ฝาปิด จึงแยกเทสต์
const VESSEL_IDS = ['pet-bottle', 'glass', 'aluminum'] as const
const box = { W: 66, D: 28, H: 210, handle: false }

describe('vessel: การจัดกลุ่มวัสดุ', () => {
  it('วัสดุ revolve ทั้งหมด (ภาชนะ + หลอดครีม) ถูกจัดเป็น vessel', () => {
    const vessels = MATERIALS.filter((m) => isVessel(m)).map((m) => m.id)
    expect(vessels.sort()).toEqual([...VESSEL_IDS, 'tube-laminate'].sort())
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

describe('vessel: หลอดครีม (tube-laminate)', () => {
  const tbox = { W: 40, D: 16, H: 150, handle: false }
  const v = generateVessel(tbox, getMaterial('tube-laminate'))

  it('profile = ฝา/คอกลม (ทรงหมุน) เริ่มแกนกลางก้น จบเปิดที่ยอดฝา (rcap, capTop)', () => {
    expect(v.profile[0].x).toBe(0)
    expect(v.profile[0].y).toBe(0)
    const last = v.profile[v.profile.length - 1]
    // จบ "เปิด" ที่ยอดฝา/คอ — ลำตัว loft วงรีรับต่อใน viewer จากจุดนี้
    expect(last.x).toBeCloseTo(v.tube!.rcap)
    expect(last.y).toBeCloseTo(TUBE_CAP_FRAC * tbox.H)
  })

  it('tube params ส่งให้ viewer: ท่อ ⌀W, ฝา flip-top กว้างเกือบเท่าท่อ, ไหล่ → ลำตัว → ซีลบน', () => {
    const t = v.tube!
    expect(t.R).toBeCloseTo(tbox.W / 2)
    expect(t.rcap).toBeGreaterThanOrEqual(t.R * 0.8) // ฝากว้าง (ไม่ใช่คอแคบ)
    expect(t.rcap).toBeLessThan(t.R)
    expect(t.capTop).toBeCloseTo(TUBE_CAP_FRAC * tbox.H)
    expect(t.bodyY0).toBeGreaterThan(t.capTop)
    expect(t.sealY0).toBeCloseTo(tbox.H - TUBE_SEAL)
    expect(t.sealThick).toBeGreaterThan(0)
  })

  it('หน้าตัด: กลม ⌀W ที่ไหล่ → แบนกว้าง πW/2 ที่ซีล; เส้นรอบวงคงที่ (ท่อไม่ยืด); ด้านข้างหัวกระสุน', () => {
    const t = v.tube!
    const round = tubeSection(t, t.bodyY0)
    expect(round.a).toBeCloseTo(t.R, 6)
    expect(round.b).toBeCloseTo(t.R, 6)
    const seal = tubeSection(t, tbox.H)
    expect(seal.a).toBeCloseTo((Math.PI * t.R) / 2, 6)
    expect(seal.b).toBeCloseTo(t.sealThick / 2, 6)
    for (let k = 1; k < 10; k++) {
      const y = t.bodyY0 + ((t.sealY0 - t.bodyY0) * k) / 10
      const s = tubeSection(t, y)
      expect(Math.abs(ellipsePerimeter(s.a, s.b) - 2 * Math.PI * t.R)).toBeLessThan(0.5)
    }
    // ครึ่งความสูงลำตัวยังหนา ~83% (ไม่ใช่ลิ่มสามเหลี่ยม)
    const mid = tubeSection(t, (t.bodyY0 + t.sealY0) / 2)
    expect(mid.b / t.R).toBeGreaterThan(0.75)
  })

  it('หลอดพิมพ์รอบตัวทั้งท่อ: ค่ามาตรฐานคลุมจากไหล่ถึงใต้ซีล (เท่าแบบสูงเต็มตัว)', () => {
    const full = generateVessel(tbox, getMaterial('tube-laminate'), 'full')
    const body = generateVessel(tbox, getMaterial('tube-laminate'), 'body')
    expect(body.labelY0).toBeCloseTo(v.tube!.bodyY0)
    expect(body.labelY1).toBeCloseTo(v.tube!.sealY0)
    expect(full.labelY1).toBeCloseTo(body.labelY1)
    expect(full.labelY1).toBeLessThan(tbox.H)
  })

  it('profile (ฝา/คอ) finite ไม่ติดลบ + ความสูงไม่ย้อนกลับ (รัศมีลำตัวเต็มอยู่ใน tube.R)', () => {
    expect(Math.max(...v.profile.map((p) => p.x))).toBeCloseTo(v.tube!.rcap)
    expect(v.profile.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0)).toBe(true)
    for (let i = 1; i < v.profile.length; i++) {
      expect(v.profile[i].y).toBeGreaterThanOrEqual(v.profile[i - 1].y - 1e-9)
    }
  })

  it('ฉลากพันรอบตัวหลอด + dieline ไหลผ่าน export เดิม (DXF ไม่มี NaN)', () => {
    expect(v.labelR).toBeCloseTo(tbox.W / 2)
    expect(v.labelY0).toBeGreaterThan(0)
    expect(v.labelY1).toBeLessThan(tbox.H)
    expect(v.label.width).toBeCloseTo(Math.PI * tbox.W + LABEL_OVERLAP)
    const dxf = dielineDXFString(v.label)
    expect(dxf).toContain('EOF')
    expect(dxf).not.toContain('NaN')
  })
})

describe('vessel: กันข้อมูลพิลึก', () => {
  it('D ใหญ่กว่า W ถูกบีบให้คอเล็กกว่าตัวเสมอ', () => {
    const v = generateVessel({ W: 60, D: 150, H: 100, handle: false }, getMaterial('glass'))
    const neckR = v.profile[v.profile.length - 1].x
    expect(neckR).toBeLessThan(30) // < W/2
  })
})

// ขวด/โหล/กระป๋อง: ปรับตัวกับคอแยกกัน — ตัว = ก้นถึงปลายไหล่ (รัศมีถึง ⌀คอ), คอ = ปลายไหล่ถึงปาก
describe.each(VESSEL_IDS.map((id) => [id] as const))('vessel: แยกความสูงตัว/คอ %s', (id) => {
  const mat = getMaterial(id)
  const rn = box.D / 2
  // ระดับที่รัศมีลดถึง ⌀คอ ครั้งแรก = ปลายไหล่ (เริ่มคอ)
  const neckBase = (neckH?: number) => generateVessel(box, mat, 'body', { neckH }).profile.find((p) => p.y > 0 && Math.abs(p.x - rn) < 1e-6)!.y

  it('ตั้งความสูงคอ → คอเริ่มที่ H − คอ, สูงรวมยังเป็น H', () => {
    for (const nh of [8, 30, 60]) {
      expect(neckBase(nh)).toBeCloseTo(box.H - nh, 6)
      const v = generateVessel(box, mat, 'body', { neckH: nh })
      expect(Math.max(...v.profile.map((p) => p.y))).toBeCloseTo(box.H)
    }
  })

  it('ไม่ตั้งค่า = สัดส่วนมาตรฐานของวัสดุ', () => {
    expect(neckBase()).toBeCloseTo(box.H - defaultNeckH(id, box.H), 6)
  })

  it('คอยาวขึ้น → ตัวเตี้ยลง ฉลากย้ายลงตาม (ยังอยู่บนตัว)', () => {
    const short = generateVessel(box, mat, 'body', { neckH: 10 })
    const long = generateVessel(box, mat, 'body', { neckH: 80 })
    expect(long.labelY1).toBeLessThan(short.labelY1)
    expect(long.labelY1).toBeLessThan(box.H - 80)
  })

  it('คอถูกจำกัดให้ตัวเหลืออย่างน้อย BODY_MIN และคออย่างน้อย NECK_MIN', () => {
    expect(resolveNeckH(id, box.H, 500)).toBe(box.H - BODY_MIN)
    expect(resolveNeckH(id, box.H, 0)).toBe(NECK_MIN)
    const v = generateVessel(box, mat, 'body', { neckH: 500 })
    expect(v.profile.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
  })
})

// ไหล่ (รอยต่อตัว→คอ): ความสูงไหล่อยู่ในความสูงตัว + รูปทรง โค้งมน/ลาดตรง/ไหล่ตั้ง
describe.each(VESSEL_IDS.map((id) => [id] as const))('vessel: ไหล่ %s', (id) => {
  const mat = getMaterial(id)
  const R = box.W / 2
  const rn = box.D / 2
  const neckH = 30
  const Hb = box.H - neckH
  // จุดสุดท้ายที่ยังกว้างเต็มตัว = ไหล่เริ่ม
  const s0 = (v: ReturnType<typeof generateVessel>) => Math.max(...v.profile.filter((p) => Math.abs(p.x - R) < 1e-6).map((p) => p.y))

  it('ตั้งสูงไหล่ → ไหล่เริ่มที่ (ตัว − ไหล่), โคนคอ/สูงรวมเท่าเดิม', () => {
    for (const sh of [5, 40, 100]) {
      const v = generateVessel(box, mat, 'body', { neckH, shoulderH: sh })
      expect(s0(v)).toBeCloseTo(Hb - sh, 6)
      expect(v.profile.some((p) => Math.abs(p.x - rn) < 1e-6 && Math.abs(p.y - Hb) < 1e-6)).toBe(true)
      expect(Math.max(...v.profile.map((p) => p.y))).toBeCloseTo(box.H)
    }
  })

  it('ไม่ตั้งค่า = สัดส่วนมาตรฐานของวัสดุ; ค่าเกินถูกจำกัด', () => {
    const v = generateVessel(box, mat, 'body', { neckH })
    expect(s0(v)).toBeCloseTo(Hb - defaultShoulderH(id, Hb), 6)
    expect(resolveShoulderH(id, Hb, 1e4)).toBe(shoulderMax(id, Hb))
    expect(resolveShoulderH(id, Hb, 0)).toBe(SHOULDER_MIN)
  })

  it('ฉลากมาตรฐานอยู่ใต้ไหล่เสมอ (ไหล่สูง → ฉลากเตี้ยลง)', () => {
    const lo = generateVessel(box, mat, 'body', { neckH, shoulderH: 10 })
    const hi = generateVessel(box, mat, 'body', { neckH, shoulderH: 80 })
    expect(hi.labelY1).toBeLessThan(lo.labelY1)
    expect(hi.labelY1).toBeLessThanOrEqual(Hb - 80)
    expect(hi.labelY1).toBeGreaterThan(hi.labelY0)
  })

  it('ลาดตรง = เส้นตรงจากไหล่เริ่มถึงโคนคอ', () => {
    const v = generateVessel(box, mat, 'body', { neckH, shoulderH: 40, shoulderStyle: 'slope' })
    const i = v.profile.findIndex((p) => Math.abs(p.x - R) < 1e-6 && Math.abs(p.y - (Hb - 40)) < 1e-6)
    expect(v.profile[i + 1].x).toBeCloseTo(rn)
    expect(v.profile[i + 1].y).toBeCloseTo(Hb)
  })

  it('ไหล่ตั้ง = มุมมนแล้วบ่าแบนที่ระดับโคนคอ', () => {
    const sh = 8
    const v = generateVessel(box, mat, 'body', { neckH, shoulderH: sh, shoulderStyle: 'flat' })
    const top = v.profile.filter((p) => Math.abs(p.y - Hb) < 1e-6)
    expect(top.some((p) => Math.abs(p.x - (R - Math.min(sh, R - rn))) < 1e-6)).toBe(true)
    expect(top.some((p) => Math.abs(p.x - rn) < 1e-6)).toBe(true)
    for (let i = 1; i < v.profile.length; i++) expect(v.profile[i].y).toBeGreaterThanOrEqual(v.profile[i - 1].y - 1e-9)
  })
})

// ฉลากกำหนดเอง: ตำแหน่งแนวตั้ง/สูง/ยาวรอบตัว — อยู่บนลำตัวตรงเสมอ
describe.each(VESSEL_IDS.map((id) => [id] as const))('vessel: ฉลากกำหนดเอง %s', (id) => {
  const mat = getMaterial(id)
  const circ = Math.PI * box.W
  const base = generateVessel(box, mat)
  const [b0, b1] = base.labelRange

  it('ตั้งขอบล่าง + สูง → ฉลากอยู่ตรงนั้น, dieline สูงตาม', () => {
    const v = generateVessel(box, mat, 'body', { label: { y: b0 + 10, h: 40 } })
    expect(v.labelY0).toBeCloseTo(b0 + 10)
    expect(v.labelY1).toBeCloseTo(b0 + 50)
    expect(v.label.height).toBeCloseTo(40)
  })

  it('ค่าเกินลำตัวถูกจำกัดให้อยู่บนลำตัวตรง', () => {
    const hi = generateVessel(box, mat, 'body', { label: { y: 1e4, h: 30 } })
    expect(hi.labelY1).toBeCloseTo(b1)
    const lo = generateVessel(box, mat, 'body', { label: { y: -50, h: 1e4 } })
    expect(lo.labelY0).toBeCloseTo(b0)
    expect(lo.labelY1).toBeCloseTo(b1)
    const tiny = generateVessel(box, mat, 'body', { label: { h: 0 } })
    expect(tiny.labelY1 - tiny.labelY0).toBeCloseTo(LABEL_MIN)
  })

  it('ยาวเท่าเส้นรอบวง = พันรอบ (มีทับกาว), สั้นกว่า = ฉลากแผ่นหน้าไม่มีกาว', () => {
    const wrap = generateVessel(box, mat, 'body', { label: { w: circ } })
    expect(wrap.labelArc).toBeCloseTo(2 * Math.PI)
    expect(wrap.label.width).toBeCloseTo(circ + LABEL_OVERLAP)
    const front = generateVessel(box, mat, 'body', { label: { w: 100 } })
    expect(front.label.width).toBeCloseTo(100)
    expect(front.label.panels.map((p) => p.id)).toEqual(['label'])
    expect(front.labelArc).toBeCloseTo(100 / (box.W / 2))
    expect(front.label.segments.some((sg) => sg.kind === 'crease')).toBe(false)
  })
})

// ปากขวดทุกชนิดมีขอบปาก (วงแหวน) + ฝาเลือกได้ครอบขอบปาก
describe.each(VESSEL_IDS.map((id) => [id] as const))('vessel: ปากขวด/ฝา %s', (id) => {
  const v = generateVessel(box, getMaterial(id))
  const m = v.mouth!

  it('มีขอบปากกว้างกว่าคอ ที่ปลายบน', () => {
    expect(m.rr).toBeGreaterThan(m.rn)
    expect(m.top).toBeCloseTo(box.H)
    expect(v.profile.some((p) => Math.abs(p.x - m.rr) < 1e-6 && Math.abs(p.y - box.H) < 1e-6)).toBe(true)
  })

  it.each(CAP_STYLES.filter((c) => c.id !== 'none').map((c) => [c.id] as const))('ฝา %s ครอบขอบปาก (ล่างต่ำกว่าวงแหวน กว้างกว่า สูงพ้นปาก)', (style) => {
    const c = capShape(style, m)!
    const ys = c.lathe.map((p) => p.y)
    expect(Math.min(...ys)).toBeLessThan(m.lipY)
    // จุกก๊อก: หัวจุกกว้างกว่าขอบปาก (วางบนปาก) — ฝาอื่นครอบนอกขอบปาก
    expect(Math.max(...c.lathe.map((p) => p.x))).toBeGreaterThan(m.rr)
    expect(c.top).toBeGreaterThan(m.top)
    for (let i = 1; i < c.lathe.length; i++) expect(c.lathe[i].y).toBeGreaterThanOrEqual(c.lathe[i - 1].y - 1e-9)
  })

  it('ไม่มีฝา = null; ฉลากหมุนได้ (180° = ด้านหลัง)', () => {
    expect(capShape('none', m)).toBeNull()
    expect(generateVessel(box, getMaterial(id), 'body', { label: { rot: 180 } }).labelRot).toBeCloseTo(Math.PI)
    expect(v.labelRot).toBe(0)
  })
})

describe('vessel: จุกไวน์', () => {
  const m = generateVessel({ W: 75, D: 20, H: 300, handle: false }, getMaterial('glass')).mouth!
  const c = capShape('cork', m)!

  it('ก้านจุกอยู่ในรูคอ (แคบกว่าคอ) ไม่ลึกเลยโคนคอ หัวจุกวางบนปาก', () => {
    const below = c.lathe.filter((p) => p.y < m.top - 1e-6)
    expect(Math.max(...below.map((p) => p.x))).toBeLessThan(m.rn)
    expect(Math.min(...c.lathe.map((p) => p.y))).toBeGreaterThan(m.neckY)
    const head = c.lathe.filter((p) => p.y > m.top + 1e-6)
    expect(Math.max(...head.map((p) => p.x))).toBeGreaterThan(m.rr)
    expect(c.top).toBeGreaterThan(m.top)
  })
})
