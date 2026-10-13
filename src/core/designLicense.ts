// คำเตือนก่อนลบงาน/เก็บเป็นสำเนาบน cloud — สิทธิ์ดาวน์โหลด (ซื้อรายแบบ) ผูกกับ id ของงาน:
// ลบแล้วหายถาวร, สำเนาได้ id ใหม่จึงไม่ได้สิทธิ์ตาม (docs/billing-freemium-pro.md §1)
// สิทธิ์ยังโหลดไม่ได้/กำลังโหลด = 'unknown' — ห้ามถือว่า "ไม่ได้ซื้อ" ไม่งั้นผู้ใช้ที่ซื้อแล้วลบงานโดยไม่ได้รับคำเตือน

export type DesignLicenseKnowledge = 'licensed' | 'unknown' | 'none'

type Translate = (th: string, en: string) => string

// entitlementsReady = มีข้อมูลสิทธิ์จาก server แล้ว (สถานะ 'ready'); local-demo ไม่มีสิทธิ์ให้เสีย → 'none'
export function designLicenseKnowledge(
  projectId: string,
  licensedIds: ReadonlySet<string>,
  cloud: boolean,
  entitlementsReady: boolean,
): DesignLicenseKnowledge {
  if (!cloud) return 'none'
  if (licensedIds.has(projectId)) return 'licensed'
  return entitlementsReady ? 'none' : 'unknown'
}

export function deleteProjectConfirmText(name: string, knowledge: DesignLicenseKnowledge, t: Translate): string {
  const base = t(`ลบงาน "${name}" ทั้งงานรวมประวัติ?`, `Delete "${name}" including its history?`)
  if (knowledge === 'licensed') {
    return base + t(
      '\n\nงานนี้มีสิทธิ์ดาวน์โหลดไฟล์ผลิตแล้ว — ลบแล้วสิทธิ์ดาวน์โหลดจะหายไปและกู้คืนไม่ได้ (สำเนาหรือไฟล์ที่นำเข้าใหม่ไม่ได้สิทธิ์ตาม)',
      '\n\nThis design has production download rights — deleting it loses them permanently and they cannot be restored (copies and re-imported files do not inherit them).',
    )
  }
  if (knowledge === 'unknown') {
    return base + t(
      '\n\nตอนนี้ตรวจสิทธิ์แพ็กเกจไม่ได้ — ถ้างานนี้ซื้อสิทธิ์ดาวน์โหลดไว้แล้ว ลบแล้วสิทธิ์จะหายไปและกู้คืนไม่ได้ (สำเนาหรือไฟล์ที่นำเข้าใหม่ไม่ได้สิทธิ์ตาม)',
      '\n\nYour plan could not be checked right now — if you bought download rights for this design, deleting it loses them permanently and they cannot be restored (copies and re-imported files do not inherit them).',
    )
  }
  return base
}

// null = ไม่ต้องถาม (รู้แน่ว่างานนี้ไม่มีสิทธิ์ให้เสีย)
export function saveAsCopyConfirmText(knowledge: DesignLicenseKnowledge, t: Translate): string | null {
  if (knowledge === 'licensed') {
    return t(
      'งานนี้มีสิทธิ์ดาวน์โหลดไฟล์ผลิตแล้ว แต่สำเนาจะเป็นแบบใหม่ที่ไม่มีสิทธิ์ดาวน์โหลด\n\nถ้าต้องการใช้สิทธิ์ต่อ ให้กด "ยกเลิก" แล้วเลือก "โหลดล่าสุด" แทน (ทิ้ง draft ในแท็บนี้)\n\nยังต้องการเก็บเป็นสำเนา?',
      'This design has production download rights, but the copy will be a new design without them.\n\nTo keep the rights, press Cancel and choose "Reload latest" instead (discards this tab’s draft).\n\nSave as a copy anyway?',
    )
  }
  if (knowledge === 'unknown') {
    return t(
      'ตอนนี้ตรวจสิทธิ์แพ็กเกจไม่ได้ — ถ้างานนี้ซื้อสิทธิ์ดาวน์โหลดไว้แล้ว สำเนาจะเป็นแบบใหม่ที่ไม่มีสิทธิ์ดาวน์โหลด\n\nถ้าต้องการใช้สิทธิ์ต่อ ให้กด "ยกเลิก" แล้วเลือก "โหลดล่าสุด" แทน (ทิ้ง draft ในแท็บนี้)\n\nยังต้องการเก็บเป็นสำเนา?',
      'Your plan could not be checked right now — if you bought download rights for this design, the copy will be a new design without them.\n\nTo keep the rights, press Cancel and choose "Reload latest" instead (discards this tab’s draft).\n\nSave as a copy anyway?',
    )
  }
  return null
}
