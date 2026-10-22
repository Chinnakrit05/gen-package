import { describe, expect, it } from 'vitest'
import { cameraPosition, needsRefit, pouchCameraFit, REFIT_RATIO, vesselCameraFit } from './viewerCamera'

// กล้องของภาชนะ/ถุงต้องจัดใหม่เมื่อสลับรูปทรงหรือขนาดต่างมาก ทั้งที่หน้า 3D ไม่ถูกถอด (เดิมค้างระยะของชิ้นก่อน)
describe('viewer camera refit (ภาชนะ/ถุง)', () => {
  const bottle = { H: 205, labelR: 32.5 } // PET 500 มล.
  const tube = { H: 130, labelR: 15, tube: {} } // หลอด 50 มล.

  it('ตำแหน่งแรกเท่ากับที่ Canvas เคยตั้งเอง (ไม่เปลี่ยนภาพตอนเปิดหน้า 3D)', () => {
    const d = Math.max(130, 15 * 4) * 2.2
    expect(cameraPosition(vesselCameraFit(tube))).toEqual([d * 0.45, d * 0.3, d])
    const p = Math.max(215, 140) * 2.6
    expect(cameraPosition(pouchCameraFit({ H: 215, W: 140 }, 'stand'))).toEqual([p * 0.35, p * 0.25, p])
  })

  it('สลับขวด → หลอดโดยไม่ถอดหน้า 3D = จัดกล้องใหม่ (กรณีที่หลอดดูเล็ก/เอียงจนชื่อแบรนด์ไปตกขอบโค้ง)', () => {
    expect(needsRefit(vesselCameraFit(bottle), vesselCameraFit(tube))).toBe(true)
    expect(needsRefit(pouchCameraFit({ H: 215, W: 140 }, 'stand'), pouchCameraFit({ H: 215, W: 140 }, 'gusset'))).toBe(true)
  })

  it('ขยับขนาดทีละน้อยไม่รีเซ็ตมุมที่ผู้ใช้หมุนไว้ ครั้งแรกไม่จัดซ้ำ', () => {
    const a = vesselCameraFit(tube)
    const small = vesselCameraFit({ ...tube, H: 130 * (1 + REFIT_RATIO / 2) })
    const big = vesselCameraFit({ ...tube, H: 130 * (1 + REFIT_RATIO * 1.5) })
    expect(needsRefit(a, small)).toBe(false)
    expect(needsRefit(a, big)).toBe(true)
    expect(needsRefit(null, a)).toBe(false)
  })
})
