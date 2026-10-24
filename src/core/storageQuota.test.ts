import { describe, expect, it } from 'vitest'
import { formatStorageBytes, isStorageQuotaError, storageQuotaDetails, storageQuotaHint } from './storageQuota'

// error ของ server ตามที่ ApiClientError ถือ (code + details) — ฝั่ง core ไม่ผูกกับคลาส
const quotaError = (details: unknown) => Object.assign(new Error('พื้นที่เก็บงานเต็มแล้ว'), { code: 'STORAGE_QUOTA_EXCEEDED', details })

describe('storageQuota (ข้อความเมื่อพื้นที่เก็บงานเต็ม — ยังไม่เปิดใช้)', () => {
  it('อ่านหน่วยฐาน 1024 ตรงกับตัวเลขโควตาใน DB', () => {
    expect(formatStorageBytes(20971520)).toBe('20 MB')
    expect(formatStorageBytes(1073741824)).toBe('1 GB')
    expect(formatStorageBytes(20761804)).toBe('19.8 MB')
    expect(formatStorageBytes(1536)).toBe('2 KB')
    expect(formatStorageBytes(10)).toBe('1 KB')
  })

  it('แยก error พื้นที่เต็มจาก error อื่น และอ่าน details ที่ server ส่ง', () => {
    const error = quotaError({ plan: 'free', limitBytes: 20971520, usedBytes: 20761804, projectedBytes: 21000000 })
    expect(isStorageQuotaError(error)).toBe(true)
    expect(isStorageQuotaError(Object.assign(new Error('x'), { code: 'REVISION_CONFLICT' }))).toBe(false)
    expect(isStorageQuotaError(null)).toBe(false)
    expect(storageQuotaDetails(error)).toEqual({ plan: 'free', limitBytes: 20971520, usedBytes: 20761804 })
    expect(storageQuotaDetails(quotaError({ plan: 'gold', limitBytes: 1, usedBytes: 1 }))).toBeNull()
    expect(storageQuotaDetails(quotaError(undefined))).toBeNull()
  })

  it('บอกที่ใช้/เพดาน และทางออกตามแพ็กเกจ (Freemium ชวนสมัคร Pro, Pro ให้ลบงาน)', () => {
    expect(storageQuotaHint({ plan: 'free', limitBytes: 20971520, usedBytes: 20761804 }))
      .toBe('ใช้ไป 19.8 MB จาก 20 MB — ลบงานหรือรูปที่ไม่ใช้แล้ว หรือสมัคร Pro เพื่อพื้นที่มากขึ้น')
    expect(storageQuotaHint({ plan: 'pro', limitBytes: 1073741824, usedBytes: 1073741824 }))
      .toBe('ใช้ไป 1 GB จาก 1 GB — ลบงานหรือรูปที่ไม่ใช้แล้วเพื่อบันทึกต่อ')
    expect(storageQuotaHint(null)).toBe('พื้นที่เก็บงานเต็ม — ลบงานหรือรูปที่ไม่ใช้แล้วเพื่อบันทึกต่อ')
  })
})
