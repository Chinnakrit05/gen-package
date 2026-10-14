import { describe, expect, it } from 'vitest'
import { deleteProjectConfirmText, designLicenseKnowledge, saveAsCopyConfirmText } from './designLicense'

const th = (thai: string) => thai
const en = (_thai: string, english: string) => english

describe('designLicenseKnowledge', () => {
  const licensed = new Set(['bought'])

  it('ใช้รายการสิทธิ์เมื่อโหลดสิทธิ์ได้แล้ว', () => {
    expect(designLicenseKnowledge('bought', licensed, true, true)).toBe('licensed')
    expect(designLicenseKnowledge('other', licensed, true, true)).toBe('none')
  })

  it('สิทธิ์โหลดไม่ได้/กำลังโหลด → ไม่รู้ ไม่ใช่ "ไม่ได้ซื้อ"', () => {
    expect(designLicenseKnowledge('other', new Set(), true, false)).toBe('unknown')
    // ข้อมูลเดิมที่รู้แน่ยังใช้ได้
    expect(designLicenseKnowledge('bought', licensed, true, false)).toBe('licensed')
  })

  it('local-demo ไม่มีสิทธิ์ให้เสีย', () => {
    expect(designLicenseKnowledge('bought', licensed, false, true)).toBe('none')
  })
})

describe('confirm text ก่อนลบงาน / เก็บเป็นสำเนา', () => {
  it('ลบงานที่ซื้อแล้ว = เตือนว่าสิทธิ์หายถาวร', () => {
    expect(deleteProjectConfirmText('กล่องชา', 'licensed', th)).toContain('สิทธิ์ดาวน์โหลดจะหายไปและกู้คืนไม่ได้')
    expect(deleteProjectConfirmText('Tea', 'licensed', en)).toContain('loses them permanently')
  })

  it('ตรวจสิทธิ์ไม่ได้ = ยังเตือนแบบมีเงื่อนไข', () => {
    const text = deleteProjectConfirmText('กล่องชา', 'unknown', th)
    expect(text).toContain('ตรวจสิทธิ์แพ็กเกจไม่ได้')
    expect(text).toContain('ถ้างานนี้ซื้อสิทธิ์ดาวน์โหลดไว้แล้ว')
    expect(deleteProjectConfirmText('Tea', 'unknown', en)).toContain('if you bought download rights')
  })

  it('รู้แน่ว่าไม่ได้ซื้อ = ถามลบธรรมดา', () => {
    expect(deleteProjectConfirmText('กล่องชา', 'none', th)).toBe('ลบงาน "กล่องชา" ทั้งงานรวมประวัติ?')
  })

  it('เก็บเป็นสำเนา: ถามเมื่อมีหรือไม่รู้สิทธิ์ ไม่ถามเมื่อรู้ว่าไม่มี', () => {
    expect(saveAsCopyConfirmText('licensed', th)).toContain('สำเนาจะเป็นแบบใหม่ที่ไม่มีสิทธิ์ดาวน์โหลด')
    expect(saveAsCopyConfirmText('unknown', th)).toContain('ตรวจสิทธิ์แพ็กเกจไม่ได้')
    expect(saveAsCopyConfirmText('unknown', en)).toContain('Reload latest')
    expect(saveAsCopyConfirmText('none', th)).toBeNull()
  })
})
