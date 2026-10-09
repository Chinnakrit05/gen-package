import { describe, expect, it } from 'vitest'
import { Group, Quaternion, Vector3 } from 'three'
import { computeMatrices, rollBeads, to3D } from '../fold'
import { FEFCO0427_SPIN, fefco0427Layout } from './fefco0427'
import { getTemplate } from './index'
import { getMaterial } from '../materials'
import { computeGuides } from '../guides'
import { dielineDXFString } from '../dxf'
import type { Vec2 } from '../types'

// เทสต์การพับเชิงตัวเลข — แทนการดูภาพ 3D ด้วยการคำนวณตำแหน่งจริงของทุกแผง
// ที่ fold=1 ผ่าน computeMatrices แล้วยืนยันว่าอยู่ระนาบ/ความสูงที่กล่องจริงต้องเป็น
// (วิธีนี้จับบั๊กทิศพับ/เครื่องหมาย zOffset ได้โดยไม่ต้องใช้ตา)

const mat = getMaterial('corrugated-e')
const t = mat.thickness
const tp = getTemplate('fefco-0427')
const Hp = 60 + t
// ตรวจเรขาคณิตการพับบนผังก่อนหมุน (แกนอ่านง่าย) — ผังที่ส่งออกจริงคือผังนี้หมุน 90° (เทสต์ท้ายไฟล์)
const box = { W: 200, D: 140, H: 60, handle: false }
const d = fefco0427Layout(box, mat)
const sp = 3 * t + 0.2
const M = computeMatrices(d.panels, 1)

const centroid = (pts: Vec2[]) => {
  const c = pts.reduce((s, p) => ({ x: s.x + p.x, y: s.y + p.y }), { x: 0, y: 0 })
  return { x: c.x / pts.length, y: c.y / pts.length }
}
const world = (id: string): Vector3 => {
  const p = d.panels.find((q) => q.id === id)!
  return to3D(centroid(p.outline)).applyMatrix4(M.get(id)!)
}
const worldPts = (id: string): Vector3[] => {
  const p = d.panels.find((q) => q.id === id)!
  return p.outline.map((q) => to3D(q).applyMatrix4(M.get(id)!))
}

const base = d.panels.find((p) => p.id === 'base')!
const cx0 = Math.min(...base.outline.map((p) => p.x))
const cx1 = Math.max(...base.outline.map((p) => p.x))
const yF = -Math.max(...base.outline.map((p) => p.y)) // ระนาบผนังหน้า (world y)
const yB = -Math.min(...base.outline.map((p) => p.y))

describe('fefco-0427: โครงสร้าง dieline', () => {
  it('ลงทะเบียนใน registry และมีแผงครบ 17 ชิ้น (สัน 2 + ปีกข้างฝา 2)', () => {
    expect(tp.id).toBe('fefco-0427')
    expect(d.panels).toHaveLength(17)
    for (const id of ['spine-left', 'spine-right', 'lid-flap-left', 'lid-flap-right']) {
      expect(d.panels.some((p) => p.id === id)).toBe(true)
    }
  })

  it('ผนังทบเป็นรอยพับคู่ห่างกัน sp (ไม่ใช่พับ 180° เส้นเดียว)', () => {
    for (const id of ['spine-left', 'spine-right']) {
      const p = d.panels.find((q) => q.id === id)!
      const xs = p.outline.map((q) => q.x)
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(sp, 6)
    }
    expect(d.panels.every((p) => Math.abs(p.foldAngle ?? 0) <= 90)).toBe(true)
  })

  it('ฝาแคบกว่าฐานข้างละ sp (ลงระหว่างสันผนังข้าง) และผนังหน้าเตี้ยกว่าผนังหลัง t', () => {
    const lid = d.panels.find((p) => p.id === 'lid')!
    const lxs = lid.outline.map((q) => q.x)
    expect(Math.min(...lxs)).toBeCloseTo(cx0 + sp, 6)
    expect(Math.max(...lxs)).toBeCloseTo(cx1 - sp, 6)
    const h = (id: string) => {
      const ys = d.panels.find((p) => p.id === id)!.outline.map((q) => q.y)
      return Math.max(...ys) - Math.min(...ys)
    }
    expect(h('back') - h('front')).toBeCloseTo(t, 6)
  })

  it('ฐานเจาะช่องเสียบลิ้น 4 ช่อง ชิดขอบซ้าย-ขวา', () => {
    expect(base.holes).toHaveLength(4)
    for (const slot of base.holes!) {
      const c = centroid(slot)
      const off = Math.min(c.x - cx0, cx1 - c.x)
      expect(off).toBeGreaterThan(0)
      expect(off).toBeLessThan(6)
    }
  })

  it('outline ทุกจุด finite และแผ่นกว้างพอสำหรับผนังม้วนสองข้าง', () => {
    const pts = d.panels.flatMap((p) => p.outline)
    expect(pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
    expect(d.width).toBeGreaterThan(cx1 - cx0 + 2 * Hp) // ม้วน+ลิ้นเพิ่มจากผนังปกติ
  })
})

describe('fefco-0427: ตำแหน่งหลังพับสุด (fold=1)', () => {
  it('base อยู่กับที่ z=0', () => {
    expect(Math.abs(world('base').z)).toBeLessThan(0.01)
  })

  it.each([
    ['front', yF, 'y'],
    ['back', yB, 'y'],
    ['side-left', cx0, 'x'],
    ['side-right', cx1, 'x'],
  ] as const)('%s ตั้งฉากบนระนาบตัวเอง สูง ~Hp/2', (id, plane, axis) => {
    const v = world(id)
    expect(Math.abs((axis === 'x' ? v.x : v.y) - plane)).toBeLessThan(0.5)
    expect(v.z).toBeGreaterThan(Hp * 0.3)
    expect(v.z).toBeLessThan(Hp * 0.7)
  })

  it.each([
    ['ear-fl', cx0, 1],
    ['ear-bl', cx0, 1],
    ['ear-fr', cx1, -1],
    ['ear-br', cx1, -1],
  ] as const)('%s พับแนบด้านในผนังข้าง (ตรวจทุกมุม ไม่ใช่แค่จุดกึ่งกลาง)', (id, plane, dir) => {
    const v = world(id)
    expect((v.x - plane) * dir).toBeGreaterThanOrEqual(-0.01) // ฝั่งในกล่อง
    expect(Math.abs(v.x - plane)).toBeLessThan(3 * t + 1)
    expect(v.y).toBeGreaterThan(yF - 1)
    expect(v.y).toBeLessThan(yB + 1)
    // เช็ค z ของ "ทุกมุม" ต้องอยู่ในช่วง [0, Hp] — กันหูมุมเอียงทะลุใต้ฐาน/เหนือกล่อง
    // (จุดกึ่งกลางจับไม่ได้: หูที่เอียงจาก z=-10 ถึง 75 มี centroid ~32 ดูเหมือนปกติ)
    const zs = worldPts(id).map((p) => p.z)
    expect(Math.min(...zs)).toBeGreaterThan(-1)
    expect(Math.max(...zs)).toBeLessThan(Hp + 1)
  })

  it.each([
    ['roll-left', cx0, 1],
    ['roll-right', cx1, -1],
  ] as const)('%s ทบกลับเข้าด้านใน (ห่างผนัง ~sp) พาดจากบนผนังลงถึงฐาน', (id, plane, dir) => {
    const pts = worldPts(id)
    const xs = pts.map((v) => v.x)
    const zs = pts.map((v) => v.z)
    expect(xs.every((x) => (x - plane) * dir > 0.5)).toBe(true) // อยู่ในกล่อง ไม่ทะลุออกนอก
    expect(xs.every((x) => Math.abs(x - plane) < 4 * t + 2)).toBe(true)
    expect(Math.max(...zs)).toBeGreaterThan(Hp * 0.85) // มาจากสันบนผนัง
    expect(Math.min(...zs)).toBeLessThan(2) // ลิ้นลงถึง/ทะลุระดับฐานที่ช่องเสียบ
  })

  it('lid ปิดบนสุด z≈Hp คลุมฐาน', () => {
    const v = world('lid')
    expect(Math.abs(v.z - Hp)).toBeLessThan(2 * t + 1)
    expect(v.y).toBeGreaterThan(yF)
    expect(v.y).toBeLessThan(yB)
  })

  it('lip เสียบลงด้านในผนังหน้า', () => {
    const v = world('lip')
    expect(v.y).toBeGreaterThanOrEqual(yF - 0.01)
    expect(v.y).toBeLessThan(yF + 4 * t + 2)
    expect(v.z).toBeGreaterThan(0)
    expect(v.z).toBeLessThan(Hp)
  })
})

describe('fefco-0427: สันผนังทบ + ปีกข้างฝา', () => {
  it('ไม่มีรอยพับ 180° แล้ว (สันเป็นแผ่นแบนกว้าง sp) → ไม่มีสันโค้ง', () => {
    expect(rollBeads(d.panels, M)).toHaveLength(0)
  })

  it.each([
    ['spine-left', cx0, 1],
    ['spine-right', cx1, -1],
  ] as const)('%s นอนบนยอดผนังข้าง z≈Hp ระหว่างผนังนอกกับชั้นทบ', (id, plane, dir) => {
    const pts = worldPts(id)
    for (const v of pts) {
      expect(Math.abs(v.z - Hp)).toBeLessThan(t + 0.5)
      expect((v.x - plane) * dir).toBeGreaterThan(-0.01)
      expect((v.x - plane) * dir).toBeLessThan(sp + 0.01)
    }
  })

  it.each([
    ['lid-flap-left', cx0, 1],
    ['lid-flap-right', cx1, -1],
  ] as const)('%s ห้อยลงด้านในชั้นทบ (ไม่ทับชั้นทบ/ผนัง) อยู่ใต้ฝาเหนือฐาน', (id, plane, dir) => {
    const pts = worldPts(id)
    for (const v of pts) {
      expect((v.x - plane) * dir).toBeGreaterThanOrEqual(sp - 0.01) // ชั้นทบอยู่ที่ ≤ sp
      expect((v.x - plane) * dir).toBeLessThan(sp + 2 * t + 1)
      expect(v.z).toBeGreaterThan(t)
      expect(v.z).toBeLessThan(Hp + 0.5)
      expect(v.y).toBeGreaterThan(yF - 0.5)
      expect(v.y).toBeLessThan(yB + 0.5)
    }
  })
})

describe('fefco-0427: ลำดับจังหวะพับ', () => {
  // วัดความคืบหน้าของ "บานพับตัวเอง" = มุมหมุนเทียบกับแผงแม่ (parent⁻¹ × own)
  // ต้องหักการเคลื่อนที่ที่ถูกแผงแม่พาไปออก ไม่งั้นแผงลูกจะดูเหมือนเริ่มขยับ
  // ตั้งแต่แม่เริ่มพับ ทั้งที่บานพับตัวเองยังไม่หมุน
  const ownAngle = (id: string, fold: number) => {
    const p = d.panels.find((q) => q.id === id)!
    const M = computeMatrices(d.panels, fold)
    const own = M.get(id)!.clone()
    if (p.parentId) own.premultiply(M.get(p.parentId)!.clone().invert())
    const q = new Quaternion().setFromRotationMatrix(own)
    return 2 * Math.acos(Math.min(1, Math.abs(q.w)))
  }
  const progressAt = (id: string, fold: number) => {
    const full = ownAngle(id, 1)
    return full < 1e-9 ? 1 : ownAngle(id, fold) / full
  }

  it('แผ่นม้วนยังไม่เริ่มทบจนหูมุมพับไปแล้วเกิน 85% (กันสองแผงกวาดเฉียดกัน)', () => {
    let started = 1
    for (let f = 0; f <= 1.0001; f += 0.01) {
      if (progressAt('roll-left', f) > 0.01) {
        started = f
        break
      }
    }
    expect(progressAt('ear-fl', started)).toBeGreaterThan(0.85)
  })

  // ลิ้นฝาเป็นลิ้นเสียบ (Panel.tuck): พับเข้าตามฝาที่กำลังปิด ไม่รอฝาปิดก่อน
  // — การรอแล้วค่อยพับ 90° ทำให้ปลายลิ้นกวาดทะลุผนังหน้า; ตรวจระยะจริงใน tuck.test.ts
  it('ลิ้นฝาผูกจังหวะกับฝา และพับเข้าแล้วเกินครึ่งก่อนฝาปิดสนิท', () => {
    expect(d.panels.find((p) => p.id === 'lip')!.tuck).toBe(true)
    let closed = 1
    for (let f = 0; f <= 1.0001; f += 0.01) {
      if (progressAt('lid', f) > 0.999) {
        closed = f
        break
      }
    }
    expect(progressAt('lip', closed)).toBeGreaterThan(0.5)
  })

  it('ทุกแผงพับครบเมื่อ fold=1', () => {
    for (const p of d.panels) expect(progressAt(p.id, 1)).toBeCloseTo(1, 6)
  })
})

describe('fefco-0427: เข้ากับระบบอื่น', () => {
  it('guides คำนวณได้', () => {
    const g = computeGuides(d.panels)
    expect(g.safe.length).toBeGreaterThanOrEqual(5)
    expect(g.bleed.length).toBeGreaterThan(0)
  })

  it('DXF สร้างได้ไม่มี NaN', () => {
    const dxf = dielineDXFString(d)
    expect(dxf).toContain('EOF')
    expect(dxf).not.toContain('NaN')
  })
})

describe('fefco-0427: ผัง dieline มาตรฐาน (หมุน 90°) + viewer หมุนกลับ', () => {
  const out = tp.generate(box, mat)

  it('ผังที่ส่งออก = ผังพับหมุน 90°: ฝาเปิดไปทางขวา ผนังหน้าอยู่ซ้ายของฐาน', () => {
    expect(out.width).toBeCloseTo(d.height, 6)
    expect(out.height).toBeCloseTo(d.width, 6)
    const cxOf = (id: string) => centroid(out.panels.find((p) => p.id === id)!.outline).x
    expect(cxOf('lid')).toBeGreaterThan(cxOf('base'))
    expect(cxOf('front')).toBeLessThan(cxOf('base'))
    for (const p of out.panels) for (const q of p.outline) {
      expect(q.x).toBeGreaterThanOrEqual(-1e-6)
      expect(q.x).toBeLessThanOrEqual(out.width + 1e-6)
    }
  })

  it('3D หลังพับ: ผังหมุน + spin ของ template = ตำแหน่งเดิมทุกแผง (ผนังหน้ายังหันหากล้อง)', () => {
    // จำลองลำดับ transform ของ viewer: scale x=-1 → rotation (tilt, 0, spin·fold) → เลื่อนให้ฐานอยู่กลาง
    const place = (dl: typeof d, spin: number, id: string) => {
      const g = new Group()
      g.scale.set(-1, 1, 1)
      g.rotation.set(tp.tilt, 0, spin)
      g.updateMatrixWorld(true)
      const base = dl.panels[0].outline
      const xs = base.map((q) => q.x)
      const ys = base.map((q) => q.y)
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2
      const p = dl.panels.find((q) => q.id === id)!
      const v = to3D(centroid(p.outline)).applyMatrix4(computeMatrices(dl.panels, 1).get(id)!)
      return v.add(new Vector3(-cx, cy, 0)).applyMatrix4(g.matrixWorld)
    }
    expect(tp.spin).toBe(FEFCO0427_SPIN)
    for (const id of ['front', 'back', 'lid', 'side-left', 'lip']) {
      const a = place(d, 0, id)
      const b = place(out, FEFCO0427_SPIN, id)
      expect(a.distanceTo(b)).toBeLessThan(1e-3)
    }
  })
})
