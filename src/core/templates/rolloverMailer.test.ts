import { describe, expect, it } from 'vitest'
import { computeMatrices, to3D, rollBeads } from '../fold'
import { getTemplate } from './index'
import { getMaterial } from '../materials'
import { dielineDXFString } from '../dxf'

// Rollover hinged lid mailer = ฐาน + ผนัง + แผ่นม้วน 180° (ผนังสองชั้น) + ฝาพับคลุม
const mat = getMaterial('carton-300')
const tp = getTemplate('rollover-mailer')
const box = { W: 220, D: 150, H: 70, handle: false }
const Hp = box.H + mat.thickness
const d = tp.generate(box, mat)
const M = computeMatrices(d.panels, 1)

describe('rollover-mailer: ขอบม้วนสองชั้น + ฝาพับ', () => {
  it('ลงทะเบียน + มีแผ่นม้วนซ้าย-ขวา (พับ 180°) และฝา', () => {
    expect(tp.id).toBe('rollover-mailer')
    const rl = d.panels.find((p) => p.id === 'roll-left')!
    const rr = d.panels.find((p) => p.id === 'roll-right')!
    expect(Math.abs(rl.foldAngle!)).toBe(180)
    expect(Math.abs(rr.foldAngle!)).toBe(180)
    expect(d.panels.some((p) => p.id === 'lid')).toBe(true)
  })

  it('พับเต็ม: แผ่นม้วนทบกลับแนบผนังข้าง (ไม่ยื่นออกนอก) + ฝาคลุมที่ความสูง Hp', () => {
    // แผ่นม้วนซ้ายหลังพับ 180° ปลายไกลควรกลับมาที่ระดับฐาน (z≈0) = แนบผนังด้านใน
    const rl = d.panels.find((p) => p.id === 'roll-left')!
    const far = to3D(rl.outline[0]).applyMatrix4(M.get('roll-left')!)
    expect(Math.abs(far.z)).toBeLessThan(3) // ทบกลับมาแนบ (ไม่ค้างที่ยอด ไม่ยื่นออก)
    const lid = d.panels.find((p) => p.id === 'lid')!
    const lidFar = to3D({ x: lid.outline[0].x, y: Math.min(...lid.outline.map((p) => p.y)) }).applyMatrix4(M.get('lid')!)
    expect(lidFar.z).toBeCloseTo(Hp, 0) // ฝาคลุมที่ระดับ Hp
  })

  it('มีขอบม้วนโค้ง (rollBeads) 2 เส้น จากรอยพับ 180°', () => {
    expect(rollBeads(d.panels, M).length).toBe(2)
  })

  it('matrices finite + DXF ไม่มี NaN', () => {
    for (const p of d.panels) {
      const v = to3D(p.outline[0]).applyMatrix4(M.get(p.id)!)
      expect(Number.isFinite(v.x + v.y + v.z)).toBe(true)
    }
    const dxf = dielineDXFString(d)
    expect(dxf).toContain('SECTION')
    expect(dxf).not.toContain('NaN')
  })
})
