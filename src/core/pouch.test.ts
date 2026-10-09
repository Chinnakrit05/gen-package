import { describe, expect, it } from 'vitest'
import {
  brickAt,
  brickRows,
  brickShape,
  BRICK_SEAL,
  generatePouch,
  pouchDepthFactor,
  pouchWidthFactor,
  pouchSection,
  pouchSectionArea,
  lensZ,
  doypackRows,
  doypackAt,
  doypackZ,
  doypackCorner,
  DOYPACK_FIN,
  DOYPACK_LENS,
  isPouch,
  POUCH_SIDE_SEAL,
  POUCH_TOP_SEAL,
} from './pouch'
import { getMaterial } from './materials'
import { dielinePDFBytes } from './pdf'
import { computeGuides } from './guides'

const mat = getMaterial('pouch-foil')

describe('pouch: dieline แผ่นฟิล์มแบน', () => {
  it('วัสดุ pouch ถูกจำแนกเป็นถุง', () => {
    expect(isPouch(mat)).toBe(true)
    expect(isPouch(getMaterial('pet-bottle'))).toBe(false)
    expect(isPouch(getMaterial('carton-300'))).toBe(false)
  })

  it('doypack: แผงหน้า+หลังแยก กว้าง 2W × (ซีลบน + สูงลำตัว + ครึ่งก้น)', () => {
    const W = 120,
      D = 70,
      H = 180
    const p = generatePouch({ W, D, H }, mat)
    expect(p.label.width).toBe(2 * W) // ซีลข้างอยู่ในแผง ไม่มีลิ้นกาว
    expect(p.label.height).toBe(POUCH_TOP_SEAL + H + D / 2)
    expect(p.gusset).toBe(D)
    expect(p.backSeam).toBe(false)
    expect(p.frontRect).toEqual({ x: 0, y: POUCH_TOP_SEAL, w: W, h: H })
    expect(p.backRect).toEqual({ x: W, y: POUCH_TOP_SEAL, w: W, h: H })
    expect(p.backRectL).toBeUndefined()
    const ds = p.label.segments.map((s) => s.d)
    // แผงแยกด้วยเส้นตัดกลาง, ซีลข้างทั้งสองแผง, ซีลก้นโค้งลงกลางแผง
    expect(p.label.segments).toContainEqual({ kind: 'cut', d: `M ${W} 0 L ${W} ${p.label.height}` })
    for (const x of [POUCH_SIDE_SEAL, W - POUCH_SIDE_SEAL, W + POUCH_SIDE_SEAL, 2 * W - POUCH_SIDE_SEAL]) {
      expect(ds).toContain(`M ${x} 0 L ${x} ${p.label.height}`)
    }
    expect(ds.filter((d) => d.includes(' Q ')).length).toBe(2)
  })

  it('ก้น (D) ถูก clamp ไม่เกินความกว้างถุง และไม่ต่ำกว่า 10', () => {
    expect(generatePouch({ W: 100, D: 300, H: 150 }, mat).gusset).toBe(100) // เกิน W → = W
    expect(generatePouch({ W: 100, D: 3, H: 150 }, mat).gusset).toBe(10) // ต่ำกว่า 10 → 10
  })

  it('doypack: เส้นตัดรอบนอก + เส้นแบ่งแผง; ซีลต่อแผง 6 เส้น (ข้าง 2/บน/ก้นโค้ง/พับก้น 2)', () => {
    const p = generatePouch({ W: 120, D: 70, H: 180 }, mat)
    expect(p.label.segments.filter((s) => s.kind === 'cut').length).toBe(2)
    expect(p.label.segments.filter((s) => s.kind === 'crease').length).toBe(12)
    expect(p.label.panels.map((pp) => pp.id)).toEqual(['front', 'back'])
  })

  it('ไม่ใส่ซิป (ค่าเริ่มต้น) → ไม่มี zipY และไม่มีเส้น/รอยฉีกเพิ่ม', () => {
    const p = generatePouch({ W: 120, D: 70, H: 180 }, mat)
    expect(p.zipper).toBe(false)
    expect(p.zipY).toBeUndefined()
    expect(p.label.segments.filter((s) => s.kind === 'crease').length).toBe(12)
    expect(p.label.segments.filter((s) => s.kind === 'cut').length).toBe(2)
  })

  it('ใส่ซิป → เพิ่มแนวซิป (crease) + รอยฉีกสองข้าง (cut) + zipY อยู่ใต้ปากบน', () => {
    const p = generatePouch({ W: 120, D: 70, H: 180 }, mat, { zipper: true })
    expect(p.zipper).toBe(true)
    expect(p.zipY).toBe(POUCH_TOP_SEAL + 18) // inset 18 (H สูงพอ)
    expect(p.label.segments.filter((s) => s.kind === 'crease').length).toBe(14) // +แนวซิปแผงละเส้น
    expect(p.label.segments.filter((s) => s.kind === 'cut').length).toBe(6) // +รอยฉีกซีลข้างทั้ง 4 ขอบ
    expect(p.label.dims.some((d) => d.label.includes('ซิป'))).toBe(true)
  })

  it('ถุงเตี้ยมาก: แนวซิปไม่ต่ำกว่าครึ่งลำตัว', () => {
    const p = generatePouch({ W: 120, D: 70, H: 20 }, mat, { zipper: true }) // H เล็ก → inset ถูกจำกัด
    expect(p.zipY! - POUCH_TOP_SEAL).toBeLessThanOrEqual(10) // ≤ H*0.5
  })

  it('รูปแบบซองแบน (flat): ไม่มีก้น — สูงแผ่น = ริมบน+ตัว+ริมล่าง, ไม่มีเส้นพับกลางก้น', () => {
    const W = 100,
      D = 70,
      H = 140
    const p = generatePouch({ W, D, H }, mat, { style: 'flat' })
    expect(p.style).toBe('flat')
    expect(p.gusset).toBe(0) // ไม่มีก้น (ไม่ใช้ D)
    expect(p.label.height).toBe(POUCH_TOP_SEAL + H + POUCH_TOP_SEAL) // ริมบน + ตัว + ริมล่าง
    // ซองแบน = crease 4 เส้น (สันข้าง/กาว/ซีลบน/ซีลล่าง) ไม่มีพับกลางก้น
    expect(p.label.segments.filter((s) => s.kind === 'crease').length).toBe(4)
    expect(p.label.dims.some((d) => d.label.includes('ก้น'))).toBe(false)
    expect(p.label.dims.some((d) => d.label.includes('กว้างซอง'))).toBe(true)
    expect(p.depth3D).toBeGreaterThan(0) // ยังพองบาง ๆ ใน 3D
  })

  it('ค่าเริ่มต้น (ไม่ระบุ opts) = ถุงตั้ง', () => {
    expect(generatePouch({ W: 100, D: 70, H: 140 }, mat).style).toBe('stand')
  })

  it('ถุงก้นแบนตั้งเหลี่ยม (box): มีทั้งจีบข้างและก้น + ตั้งได้', () => {
    const p = generatePouch({ W: 90, D: 60, H: 200 }, mat, { style: 'box' })
    expect(p.stands).toBe(true)
    expect(p.label.width).toBe(2 * 90 + 2 * 60 + POUCH_SIDE_SEAL) // มีจีบข้าง
    expect(p.label.height).toBe(POUCH_TOP_SEAL + 200 + 60) // ริมบน + ตัว + ก้น
    expect(p.label.dims.some((d) => d.label.includes('จีบข้าง'))).toBe(true)
    expect(p.label.dims.some((d) => d.label.includes('ก้น'))).toBe(true)
  })

  it('ซองหลังกลาง (pillow): ไม่มีก้น/จีบ + มีเส้นซีลหลังกลาง + พองมากกว่าซองแบน', () => {
    const p = generatePouch({ W: 100, D: 70, H: 150 }, mat, { style: 'pillow' })
    expect(p.stands).toBe(false)
    expect(p.gusset).toBe(0)
    expect(p.label.width).toBe(2 * 100 + POUCH_SIDE_SEAL) // ไม่มีจีบข้าง
    expect(p.depth3D).toBeGreaterThan(generatePouch({ W: 100, D: 70, H: 150 }, mat, { style: 'flat' }).depth3D)
  })

  it('ถุงมีจุก (spout): ตั้งได้เหมือน doypack + spout=true + มีป้ายจุก', () => {
    const p = generatePouch({ W: 110, D: 70, H: 180 }, mat, { style: 'spout' })
    expect(p.spout).toBe(true)
    expect(p.stands).toBe(true)
    expect(p.label.height).toBe(POUCH_TOP_SEAL + 180 + 35) // ครึ่งก้น gusset เหมือน stand
    expect(p.label.dims.some((d) => d.label.includes('จุก'))).toBe(true)
  })

  it('ออปชันเสริม: รูแขวน/วาล์ว/tin-tie เพิ่มเส้นและป้ายเมื่อเปิด', () => {
    const base = generatePouch({ W: 120, D: 70, H: 180 }, mat)
    expect(base.hangHole).toBe(false)
    expect(base.valve).toBe(false)
    expect(base.tinTie).toBe(false)
    const p = generatePouch({ W: 120, D: 70, H: 180 }, mat, {
      addons: { hangHole: true, valve: true, tinTie: true },
    })
    expect(p.hangHole).toBe(true)
    expect(p.valve).toBe(true)
    expect(p.tinTie).toBe(true)
    // รูแขวนเป็นการตัดจริง (cut) ทะลุสองชั้น — doypack แผงแยก จึงเจาะทั้งหน้าและหลัง
    expect(p.label.segments.filter((s) => s.kind === 'cut').length).toBe(base.label.segments.filter((s) => s.kind === 'cut').length + 2)
    expect(p.label.dims.some((d) => d.label.includes('รูแขวน'))).toBe(true)
    expect(p.label.dims.some((d) => d.label.includes('วาล์ว'))).toBe(true)
    expect(p.label.dims.some((d) => d.label.includes('tin-tie'))).toBe(true)
  })

  it('รูปแบบซองข้างจีบ (gusset): กว้างแผ่น = 2W + จีบสองข้าง + ซีล, มีเส้นจีบ, ก้นซีลแบน', () => {
    const W = 90,
      D = 60,
      H = 200
    const p = generatePouch({ W, D, H }, mat, { style: 'gusset' })
    expect(p.style).toBe('gusset')
    expect(p.gusset).toBe(D) // จีบข้าง = D (clamp 10..W)
    expect(p.label.width).toBe(2 * W + 2 * D + POUCH_SIDE_SEAL) // หน้า+หลัง+จีบสองข้าง+ซีล
    expect(p.label.height).toBe(BRICK_SEAL + H + BRICK_SEAL) // ริมบน+ตัว+ริมล่าง (ไม่มีก้น)
    // หลังอยู่ถัดจากหน้า+จีบซ้าย
    expect(p.frontRect).toEqual({ x: 0, y: BRICK_SEAL, w: W, h: H })
    expect(p.backRect).toEqual({ x: W + D, y: BRICK_SEAL, w: W, h: H })
    // crease: ซีลข้าง(กาว) + สันพับ 3 + จีบกลาง 2 + ซีลบน + ซีลล่าง = 8
    expect(p.label.segments.filter((s) => s.kind === 'crease').length).toBe(8)
    expect(p.label.dims.some((d) => d.label.includes('จีบข้าง'))).toBe(true)
    expect(p.label.dims.some((d) => d.label.includes('ก้น'))).toBe(false)
    expect(p.stands).toBe(true) // ซีลก้นพับซ่อนใต้ฐาน → ตั้งได้แบบถุงกาแฟ
  })

  it('dieline ไหลผ่าน guides + export PDF (CMYK) ได้เหมือน Dieline ปกติ', () => {
    const p = generatePouch({ W: 120, D: 70, H: 180 }, mat)
    expect(() => computeGuides(p.label.panels)).not.toThrow()
    const s = new TextDecoder('latin1').decode(dielinePDFBytes(p.label, true))
    expect(s.startsWith('%PDF-1.5')).toBe(true)
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true)
    // สีเป็น CMYK (k/K) ตามไฟล์ผลิต
    expect(/[\d.]+ [\d.]+ [\d.]+ [\d.]+ K\b/.test(s)).toBe(true)
  })
})

describe('pouch: หน้าตัด 3D (ยืนได้/พุงป่อง/ปากซีล)', () => {
  it('ครึ่งความลึกก้น > 0 (ตั้งได้) และปากบนแบนเกือบ 0', () => {
    expect(pouchDepthFactor(0)).toBeGreaterThan(0.5) // ก้นมีความลึก → ตั้งได้
    expect(pouchDepthFactor(1)).toBeLessThan(0.15) // ปากซีลแบน
  })

  it('doypack: ด้านข้างทรงหัวกระสุน — หนาสุดที่ก้น ลดลงต่อเนื่อง ยังอิ่มที่ครึ่งความสูง แล้วแหลมที่ปาก', () => {
    expect(pouchDepthFactor(0)).toBe(1)
    let prev = 1
    for (let v = 0.05; v <= 1.0001; v += 0.05) {
      const d = pouchDepthFactor(v)
      expect(d).toBeLessThan(prev)
      prev = d
    }
    // เทียบภาพด้านข้าง doypack จริง: ครึ่งความสูง ~86%, สามในสี่ ~57%
    expect(pouchDepthFactor(0.5)).toBeGreaterThan(0.8)
    expect(pouchDepthFactor(0.75)).toBeGreaterThan(0.5)
    expect(pouchDepthFactor(0.75)).toBeLessThan(0.65)
    expect(pouchDepthFactor(1)).toBe(0)
    expect(pouchDepthFactor(0.5, 'spout')).toBe(pouchDepthFactor(0.5))
  })

  it('ครึ่งความกว้างอยู่ในช่วง (0,1]; doypack กว้างเต็มถึงปากซีล, ซองแบนคอดที่ปลาย', () => {
    for (const style of ['stand', 'flat', 'pillow'] as const) {
      for (const v of [0, 0.2, 0.5, 0.8, 1]) {
        const a = pouchWidthFactor(v, style)
        expect(a).toBeGreaterThan(0)
        expect(a).toBeLessThanOrEqual(1)
      }
    }
    expect(pouchWidthFactor(1)).toBe(1) // doypack: แถบซีลบนกว้างเต็ม
    expect(pouchWidthFactor(1, 'flat')).toBeLessThan(1)
  })

  it('doypack: หน้าตัดเลนส์ — ตะเข็บข้างคม (ความลึกเป็น 0 ที่ขอบ) หน้าอิ่มกว่าเลนส์พาราโบลา', () => {
    expect(pouchSection(0, 'stand').cz).toBe(0)
    expect(pouchSection(Math.PI, 'stand').cz).toBeCloseTo(0, 10)
    expect(pouchSection(Math.PI / 2, 'stand').cz).toBeCloseTo(1, 10)
    expect(pouchSection(-Math.PI / 2, 'stand').cz).toBeCloseTo(-1, 10)
    // ความชันที่ตะเข็บจำกัด (มุมคม) ไม่ตั้งฉากแบบวงรี: lensZ(1−ε)/ε → P
    const e = 1e-4
    expect(lensZ(1 - e) / e).toBeCloseTo(DOYPACK_LENS, 2)
    expect(lensZ(0.5)).toBeGreaterThan(1 - 0.5 ** 2)
    expect(pouchSectionArea('stand')).toBeLessThan(Math.PI)
    expect(pouchSectionArea('stand')).toBeGreaterThan(8 / 3) // > เลนส์พาราโบลา
  })

  it('ซองแบน (flat): วงรีสมมาตร ซีลแบนทั้งบน-ล่าง พองสุดกลาง', () => {
    expect(pouchDepthFactor(0, 'flat')).toBeLessThan(0.1) // ซีลล่างแบน
    expect(pouchDepthFactor(1, 'flat')).toBeLessThan(0.1) // ซีลบนแบน
    expect(pouchDepthFactor(0.5, 'flat')).toBeCloseTo(1, 5) // พองสุดกลาง
  })

  it('ซองข้างจีบ (gusset): ลำตัวเต็ม (แท่ง) ก้นเต็ม + หน้าตัดเหลี่ยมกว่าวงรี', () => {
    expect(pouchDepthFactor(0.5, 'gusset')).toBe(1) // ลำตัวเต็ม
    expect(pouchDepthFactor(0, 'gusset')).toBeGreaterThan(0.8) // ก้นแบน ตั้งได้
    // หน้าตัดที่ 45°: superellipse เหลี่ยมกว่าวงรี (ค่าเข้าใกล้ 1 มากกว่า)
    const box = pouchSection(Math.PI / 4, 'gusset')
    const ell = pouchSection(Math.PI / 4, 'stand')
    expect(Math.abs(box.cx)).toBeGreaterThan(Math.abs(ell.cx))
  })
})

describe('pouch: ทรง 3D ถุงตั้ง (doypack)', () => {
  const p = generatePouch({ W: 120, D: 60, H: 180 }, mat, { style: 'stand', zipper: true })
  const rows = doypackRows(p)
  const st = p.frontRect.y
  const PH = p.label.height
  const Hi = PH - st

  it('แถบซีลบนแบนกว้างเต็ม = แถบซีลบน dieline [0..st] บนสุดของแผง', () => {
    const fin = rows.filter((r) => r.y > Hi)
    expect(fin.length).toBeGreaterThan(0)
    for (const r of fin) {
      expect(r.a).toBe(p.W / 2)
      expect(r.b).toBe(DOYPACK_FIN)
      expect(r.dly).toBeLessThanOrEqual(st + 1e-9)
    }
    expect(rows[rows.length - 1].y).toBeCloseTo(PH, 9)
    expect(rows[rows.length - 1].dly).toBeCloseTo(0, 9)
  })

  it('แม็พทั้งแผง: ขอบล่างแผง (รวมครึ่งก้น) อยู่บนพื้น และ dly ลดลงต่อเนื่องถึงขอบบน', () => {
    expect(rows[0].y).toBe(0)
    expect(rows[0].dly).toBeCloseTo(PH, 9)
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].y).toBeGreaterThan(rows[i - 1].y)
      expect(rows[i].dly).toBeLessThan(rows[i - 1].dly)
    }
  })

  it('ซีลข้างแบนกว้างเท่า dieline ตรงเกือบดิ่ง; มุมก้นมนเข้า; ฐานลึกเต็มตั้งได้', () => {
    const Wi2 = p.W / 2 - POUCH_SIDE_SEAL
    const { ry } = doypackCorner(p.W, PH)
    for (const r of rows) {
      expect(r.a - r.ai).toBeCloseTo(POUCH_SIDE_SEAL, 9)
      expect(doypackZ(r, r.ai + 1)).toBe(DOYPACK_FIN) // ซีลข้างแบน
      expect(doypackZ(r, 0)).toBeCloseTo(r.b, 9)
      if (r.y >= ry) expect(r.ai).toBeGreaterThanOrEqual(Wi2 * 0.95 - 1e-9) // ซีลแข็ง ไม่หดตามความพอง
    }
    expect(rows[0].b).toBeCloseTo(DOYPACK_FIN + p.depth3D, 9) // หนาสุดที่ก้น
    expect(rows[0].a).toBeLessThan(rows.find((r) => r.y >= ry)!.a) // มุมล่างมนเข้า
  })

  it('doypackAt: แนวซิปบน dieline ตกใกล้ปาก — ซิปหนีบปากแบน ใต้ปีกซิปเริ่มพองและเอนไปหลัง', () => {
    const z = doypackAt(rows, p.zipY!)
    expect(z.y).toBeGreaterThan(Hi * 0.8)
    expect(z.y).toBeLessThan(Hi)
    expect(z.b).toBeCloseTo(DOYPACK_FIN, 9)
    const below = doypackAt(rows, p.zipY! + 20)
    expect(below.b).toBeGreaterThan(DOYPACK_FIN + 1)
    expect(below.tilt).toBeGreaterThan(0)
  })

  it('ไม่มีซิป: พองขึ้นไปถึงใต้ซีลบน', () => {
    const q = generatePouch({ W: 120, D: 60, H: 180 }, mat, { style: 'stand' })
    const rs = doypackRows(q)
    const below = rs.filter((r) => r.y < q.label.height - q.frontRect.y - 15)
    expect(below[below.length - 1].b).toBeGreaterThan(DOYPACK_FIN + 1)
  })
})

describe('pouch: ทรง 3D ซองข้างจีบ (brick) แบบถุงกาแฟ', () => {
  const W = 80,
    D = 50,
    H = 120
  const p = generatePouch({ W, D, H }, mat, { style: 'gusset' })
  const s = brickShape(p)
  const rows = brickRows(s, BRICK_SEAL)
  const top = rows[rows.length - 1]

  it('ก้นแบนเต็มความลึก (ตั้งได้) + กว้างเท่าหน้าตลอดถึงปลายครีบ', () => {
    expect(rows[0].y).toBe(0)
    expect(rows[0].b).toBe(D / 2)
    expect(s.a).toBe(W / 2)
  })

  it('ความยาวผิวหน้า ลำตัว+ไหล่ = H และครีบสูง = แถบซีลบน (UV ไม่ยืด)', () => {
    expect(s.bodyH + s.shoulderL).toBeCloseTo(H, 6)
    expect(s.finH).toBe(BRICK_SEAL)
    expect(top.y).toBeCloseTo(s.topY, 6)
    // dieline แนวตั้ง: ก้น = ขอบล่างแผงหน้า, โคนครีบ = แนวซีลบน, ปลายครีบ = ขอบบนแผ่น
    expect(rows[0].dly).toBeCloseTo(BRICK_SEAL + H, 6)
    expect(rows.find((r) => Math.abs(r.y - (s.bodyH + s.shoulderH)) < 1e-9)?.dly).toBeCloseTo(BRICK_SEAL, 6)
    expect(top.dly).toBeCloseTo(0, 6)
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].y).toBeGreaterThanOrEqual(rows[i - 1].y)
      expect(rows[i].dly).toBeLessThan(rows[i - 1].dly)
    }
  })

  it('ไหล่: หน้า-หลังลาดเข้าเป็นครีบบาง จีบข้างพับเข้า โดยความยาวครึ่งจีบคงที่ (ฟิล์มไม่ยืด)', () => {
    expect(top.b).toBeLessThan(1) // ครีบ = ฟิล์มสองชั้นประกบ
    expect(top.d).toBeGreaterThan(D / 2 - 1) // จีบพับเข้าเกือบเต็มครึ่งจีบ
    expect(top.d).toBeLessThanOrEqual(s.a)
    for (const r of rows) expect(Math.hypot(r.b, r.d)).toBeCloseTo(s.gussetHalf, 6)
    expect(s.shoulderH).toBeGreaterThan(0)
  })

  it('brickAt วางออปชันตามระยะบน dieline: 0 = โคนครีบ, H = ก้น, บนไหล่เอียง ลำตัวตั้งตรง', () => {
    const fin = brickAt(s, 0)
    expect(fin.y).toBeCloseTo(s.bodyH + s.shoulderH, 6)
    expect(fin.b).toBeCloseTo(s.finHalf, 6)
    expect(fin.tilt).toBeGreaterThan(0)
    const bottom = brickAt(s, H)
    expect(bottom.y).toBeCloseTo(0, 6)
    expect(bottom.b).toBe(s.b0)
    expect(bottom.tilt).toBe(0)
    // ระยะตามผิวไหล่ = ระยะบน dieline
    const mid = brickAt(s, s.shoulderL / 2)
    expect(Math.hypot(fin.y - mid.y, fin.b - mid.b)).toBeCloseTo(s.shoulderL / 2, 6)
  })

  it('ถุงเตี้ย-จีบลึก: ไหล่ไม่กินเกิน 60% ของหน้า ลำตัวยังมีความสูง', () => {
    const q = brickShape(generatePouch({ W: 80, D: 80, H: 60 }, mat, { style: 'gusset' }))
    expect(q.shoulderH).toBeGreaterThanOrEqual(0)
    expect(q.bodyH).toBeGreaterThanOrEqual(60 * 0.4)
    expect(Number.isFinite(q.topY)).toBe(true)
  })
})
