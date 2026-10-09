import { describe, expect, it } from 'vitest'
import { generatePouch, pouchZipLayout, POUCH_TOP_SEAL, TEAR_GAP, type PouchAddons, type PouchStyle } from './pouch'
import { pouchZipIssues } from './pouchPreflight'
import { getMaterial } from './materials'
import { parseProject } from './project'
import { parseProjectFile, serializeProject } from './projectFile'

const mat = getMaterial('pouch-foil')
const size = { W: 120, D: 60, H: 180 }
const make = (addons: PouchAddons = {}, style: PouchStyle = 'stand', zipper = true) =>
  generatePouch(size, mat, { style, zipper, addons })
const codes = (addons: PouchAddons = {}, style: PouchStyle = 'stand') => pouchZipIssues(make(addons, style)).map((i) => i.code)

describe('pouchZipLayout', () => {
  it('ค่าเริ่มต้น: ซิป 28 มม. จากขอบบน รอยฉีกเหนือซิป TEAR_GAP และพ้นซีลบน', () => {
    const z = pouchZipLayout(POUCH_TOP_SEAL, 180)
    expect(z.zipY).toBe(28)
    expect(z.tearY).toBe(28 - TEAR_GAP)
    expect(z.tearY).toBeGreaterThan(POUCH_TOP_SEAL)
  })

  it('ตั้งเองได้ และรอยฉีกอัตโนมัติตามซิป; ซิปชิดซีล → รอยฉีกกึ่งกลางซีล-ซิป', () => {
    expect(pouchZipLayout(10, 180, { zipAt: 45 })).toEqual({ zipY: 45, tearY: 37 })
    expect(pouchZipLayout(10, 180, { zipAt: 45, tearAt: 16 })).toEqual({ zipY: 45, tearY: 16 })
    expect(pouchZipLayout(10, 180, { zipAt: 18 }).tearY).toBe(14)
  })

  it('จำกัดให้วาดได้: ซิปอยู่ในลำตัว', () => {
    expect(pouchZipLayout(10, 100, { zipAt: 500 }).zipY).toBe(109)
    expect(pouchZipLayout(10, 100, { zipAt: 2 }).zipY).toBe(11)
  })

  it('dieline: รอยบาก V ตรงตำแหน่งที่ตั้ง (ขอบซ้าย-ขวา) + แนวซิป', () => {
    const p = make({ zipAt: 40, tearAt: 22 })
    expect(p.zipY).toBe(40)
    expect(p.tearY).toBe(22)
    const ds = p.label.segments.map((s) => s.d)
    // doypack: แนวซิปต่อแผงระหว่างซีลข้าง + รอยบากที่ซีลข้างทั้ง 4 ขอบของสองแผง
    expect(ds).toContain('M 6 40 L 114 40')
    expect(ds).toContain('M 126 40 L 234 40')
    expect(ds).toContain('M 0 19.5 L 4 22 L 0 24.5')
    expect(ds).toContain('M 120 19.5 L 116 22 L 120 24.5')
    expect(ds).toContain('M 120 19.5 L 124 22 L 120 24.5')
    expect(ds).toContain('M 240 19.5 L 236 22 L 240 24.5')
  })
})

describe('pouchZipIssues', () => {
  it('ค่าเริ่มต้นผ่านทุกรูปแบบถุง', () => {
    for (const style of ['stand', 'flat', 'gusset', 'box', 'pillow'] as PouchStyle[]) {
      expect(codes({}, style)).toEqual([])
    }
  })

  it('ไม่มีซิป → ไม่ตรวจ', () => {
    expect(pouchZipIssues(make({ zipAt: 5 }, 'stand', false))).toEqual([])
  })

  it('รอยฉีกในซีลบน → error; ชิดซีล → warn', () => {
    expect(codes({ zipAt: 40, tearAt: 8 })).toContain('tear-in-seal')
    expect(codes({ zipAt: 40, tearAt: 11 })).toContain('tear-near-seal')
    expect(codes({ zipAt: 40, tearAt: 20 })).toEqual([])
  })

  it('รอยฉีกต่ำกว่า/ทับซิป → error; ชิดซิป → warn', () => {
    expect(codes({ zipAt: 30, tearAt: 34 })).toContain('tear-below-zip')
    expect(codes({ zipAt: 30, tearAt: 26 })).toContain('tear-below-zip') // อยู่ในปีกซิป
    expect(codes({ zipAt: 30, tearAt: 24 })).toContain('tear-near-zip')
  })

  it('ซิปชิดซีลจนไม่มีที่ให้รอยฉีก → error เดียวที่บอกตรงสาเหตุ', () => {
    expect(codes({ zipAt: 18 })).toEqual(['zip-near-seal'])
    expect(codes({ zipAt: 21 })).not.toContain('zip-near-seal')
  })

  it('ซิปต่ำกว่าครึ่งถุง → warn; ลงถึงก้นจีบ → error', () => {
    expect(codes({ zipAt: 110 })).toContain('zip-low')
    expect(codes({ zipAt: 186 })).toContain('zip-bottom') // ปีกซิปเลยแนวบนของก้น gusset (ซีล 10 + สูง 180)
    expect(codes({ zipAt: 100 }, 'box')).not.toContain('zip-bottom')
    expect(codes({ zipAt: 170 }, 'box')).toContain('zip-bottom') // box: ก้นจีบกินขึ้นมา D/2 = 30 มม.
  })

  it('ซิปทับวาล์ว/จุก → error, ทับที่รัดปาก → warn', () => {
    const vy = POUCH_TOP_SEAL + (1 - 0.72) * size.H
    expect(codes({ valve: true, zipAt: vy })).toContain('zip-valve')
    expect(codes({ valve: true, zipAt: 25 })).not.toContain('zip-valve')
    // ถุงเล็ก 80×120: ซิปค่าเริ่มต้นชิดวาล์ว → เตือน (ไม่ใช่ error)
    const small = pouchZipIssues(generatePouch({ W: 80, D: 50, H: 120 }, mat, { zipper: true, addons: { valve: true } }))
    expect(small.find((i) => i.code === 'zip-valve')?.level).toBe('warn')
    expect(codes({ tinTie: true })).toContain('zip-tintie')
    expect(codes({ tinTie: true, zipAt: 45 })).not.toContain('zip-tintie')
    expect(codes({}, 'spout')).toContain('zip-spout')
    expect(codes({ zipAt: 45 }, 'spout')).not.toContain('zip-spout')
  })

  it('รูแขวนอยู่ในหัวถุงเหนือรอยฉีก: ค่าเริ่มต้นผ่าน', () => {
    expect(codes({ hangHole: true })).toEqual([])
  })
})

describe('pouchAddons: เก็บตำแหน่งซิป/รอยฉีก', () => {
  const base = {
    id: 'p1',
    name: 'ถุง',
    updatedAt: 1,
    live: { template: 'tuck-end', materialId: 'pouch-foil', W: 120, D: 60, H: 180, handle: false },
    qty: 1,
    fillColor: null,
    zipper: true,
    decos: [],
    history: [],
    histIdx: -1,
  }

  it('parse: ปัดครึ่งมม. ตัดค่าที่ไม่ใช่ตัวเลข', () => {
    const p = parseProject({ ...base, pouchAddons: { zipAt: 33.26, tearAt: 'x', valve: true } }, 0)!
    expect(p.pouchAddons).toEqual({ valve: true, zipAt: 33.5 })
  })

  it('ไฟล์ .genpkg.json เดินทางไปกลับครบ', () => {
    const p = parseProject({ ...base, pouchAddons: { zipAt: 40, tearAt: 22 } }, 0)!
    const back = parseProjectFile(serializeProject(p))
    expect(back.ok && back.project.pouchAddons).toEqual({ zipAt: 40, tearAt: 22 })
  })
})
