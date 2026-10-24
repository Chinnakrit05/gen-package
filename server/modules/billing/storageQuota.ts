import type { PlanCode } from '../../../shared/contracts/billing'
import { HttpError } from '../../http/errors'
import type { Actor } from '../identity/actor'

// โควตาพื้นที่เก็บงานบน cloud ต่อ workspace (เจ้าของผลิตภัณฑ์ตัดสินใจ 23 ต.ค. 2026): Freemium 20 MB / Pro 1 GB
// ตัวเลขและการนับอยู่ในฐานข้อมูล (RPC check_storage_quota ใน supabase/migrations/20261023000800_storage_quota.sql)
// **ยังไม่เปิดใช้** — router สร้าง StorageQuota เฉพาะเมื่อ isStorageQuotaEnabled (server/http/router.ts) ซึ่งตอนนี้ปิดทุก environment
// ProjectService/AssetService ที่ไม่ได้รับ StorageQuota (null) ทำงานเหมือนเดิมทุกอย่าง

export interface StorageQuotaCheck {
  workspaceId: string | null // null = บันทึกทับงานเดิม (workspace มาจาก projectId)
  projectId: string | null // งานที่บันทึกทับ (null = งานใหม่/ขออัปโหลดรูป)
  operationId: string // operation ที่เคยสำเร็จแล้ว (client ส่งซ้ำ) ผ่านเสมอ
  document: unknown // เอกสารที่จะเก็บ (null = ขออัปโหลดรูป)
  extraBytes: number // ขนาดรูปที่กำลังจะอัปโหลด
}

export interface StorageQuotaResult {
  ok: boolean
  plan: PlanCode
  limitBytes: number
  usedBytes: number
  projectedBytes: number
}

export interface StorageQuotaRepository {
  checkStorageQuota(actor: Actor, input: StorageQuotaCheck, openAccess: boolean): Promise<StorageQuotaResult>
}

export interface StorageQuotaOptions {
  // ช่วง open access ทุก workspace ได้รอบ Pro ฟรี — ให้ DB เปิดรอบก่อนคิดแพ็กเกจ (รอบหมดระหว่างแก้งานต้องไม่ตกเป็นโควตา Freemium)
  openAccess: boolean
}

export class StorageQuota {
  constructor(
    private readonly repository: StorageQuotaRepository,
    private readonly options: StorageQuotaOptions,
  ) {}

  // เกินโควตา → 402 STORAGE_QUOTA_EXCEEDED: คิวบันทึกของ client ถือเป็น error ถาวร (ไม่ลองซ้ำเอง)
  // ต้องลบงาน/รูป หรืออัปเกรดก่อน; details ให้ client บอกพื้นที่ที่ใช้/เพดานได้
  async assert(actor: Actor, input: StorageQuotaCheck): Promise<void> {
    const result = await this.repository.checkStorageQuota(actor, input, this.options.openAccess)
    if (result.ok) return
    throw new HttpError(402, 'STORAGE_QUOTA_EXCEEDED', 'พื้นที่เก็บงานเต็มแล้ว', {
      plan: result.plan,
      limitBytes: result.limitBytes,
      usedBytes: result.usedBytes,
      projectedBytes: result.projectedBytes,
    })
  }
}
