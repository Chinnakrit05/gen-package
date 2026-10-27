import {
  isProOnlyExport,
  type CreateOrderInput,
  type Entitlements,
  type ExportAuthorization,
  type ExportFormat,
  type LicenseSource,
  type Order,
} from '../../../shared/contracts/billing'
import { HttpError } from '../../http/errors'
import { logServerEvent } from '../../logging'
import type { Actor } from '../identity/actor'

// ชั้นบริการ billing — กติกาอยู่ในฐานข้อมูล (RPC ใน supabase/migrations/20261013000600_billing.sql
// และ 20261015000700_open_access.sql) ชั้นนี้เติมเฉพาะสิ่งที่ DB ไม่รู้: flag ตาม config ของ server
// (devFulfilAvailable/purchasesEnabled/openAccess), gate ของการจำลองชำระเงิน, gate การเปิดขาย
// และเลือก RPC ของ open access แทนกติกาปกติ

export type AiRequestOutcome = 'succeeded' | 'failed'

// ข้อมูลต้นทุนของคำขอ AI ที่บันทึกตอน settle (ดูรายงานด้วย scripts/report-ai-usage.mjs)
// ไม่มี prompt/รูป/ผลลัพธ์/คีย์ — DB เก็บ model/token เฉพาะ 'succeeded' ส่วน hasImage เก็บทั้งสองผล
export interface AiRequestUsage {
  hasImage: boolean
  model?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  cacheReadTokens?: number | null
  cacheCreationTokens?: number | null
}

// Entitlements ตามที่ DB คืน — ยังไม่มี field ที่ server เติมเอง (devFulfilAvailable, purchasesEnabled, openAccess)
export type StoredEntitlements = Omit<Entitlements, 'devFulfilAvailable' | 'purchasesEnabled' | 'openAccess'>

export interface StoredExportAuthorization {
  projectId: string
  source: LicenseSource
  entitlements: StoredEntitlements
}

export interface AiCreditReservation {
  requestId: string
  credits: number
}

export interface AiCreditSettlement {
  credits: number
}

export interface BillingRepository {
  getEntitlements(actor: Actor, workspaceId: string): Promise<StoredEntitlements>
  authorizeExport(actor: Actor, projectId: string): Promise<StoredExportAuthorization>
  // open access: เริ่มรอบ Pro ฟรีถ้า workspace ยังไม่มี Pro ที่ใช้งานอยู่ แล้วคืนสิทธิ์ (shape เดียวกับ getEntitlements)
  ensureOpenAccess(actor: Actor, workspaceId: string): Promise<StoredEntitlements>
  // open access: ตรวจโปรเจกต์/สมาชิก + รอบ Pro ฟรี โดยไม่ออก license ถาวร
  authorizeOpenAccessExport(actor: Actor, projectId: string): Promise<StoredExportAuthorization>
  reserveAiCredit(actor: Actor, workspaceId: string, operationId: string): Promise<AiCreditReservation>
  settleAiRequest(
    actor: Actor,
    requestId: string,
    outcome: AiRequestOutcome,
    usage?: AiRequestUsage,
  ): Promise<AiCreditSettlement>
  createOrder(actor: Actor, input: CreateOrderInput): Promise<Order>
  // actor null = webhook ของผู้ให้บริการในอนาคต (ไม่ตรวจ purchaser)
  fulfilOrder(actor: Actor | null, orderId: string, provider: string, providerRef: string | null): Promise<Order>
}

export interface BillingServiceOptions {
  // จำลองการชำระเงินได้เฉพาะ development/test — ที่อื่นเส้นทาง dev-fulfil ต้องเหมือนไม่มีอยู่
  devFulfilEnabled: boolean
  // เปิดให้สั่งซื้อ (POST /billing/orders) — ปิดอยู่ = 503 PURCHASE_UNAVAILABLE และ client ซ่อนปุ่มซื้อ
  // router เป็นคนตัดสินจาก config (ดู isPurchaseEnabled ใน server/http/router.ts)
  purchasesEnabled: boolean
  // ทุก workspace ใช้งานได้เหมือน Pro (รอบ Pro ฟรี) แทน paywall — ดู isOpenAccess ใน server/http/router.ts
  openAccess: boolean
  // ช่วงพัฒนา: บอก client ให้โชว์ตัวเลือกรุ่น AI + ค่าใช้จ่าย — ดู isAiModelChoiceEnabled ใน server/http/router.ts
  aiModelChoice?: boolean
}

export class BillingService {
  constructor(
    private readonly repository: BillingRepository,
    private readonly options: BillingServiceOptions,
  ) {}

  private withServerFlags(entitlements: StoredEntitlements): Entitlements {
    return {
      ...entitlements,
      devFulfilAvailable: this.options.devFulfilEnabled,
      purchasesEnabled: this.options.purchasesEnabled,
      openAccess: this.options.openAccess,
      ...(this.options.aiModelChoice ? { aiModelChoice: true } : {}),
    }
  }

  async getEntitlements(actor: Actor, workspaceId: string): Promise<Entitlements> {
    const stored = this.options.openAccess
      ? await this.repository.ensureOpenAccess(actor, workspaceId)
      : await this.repository.getEntitlements(actor, workspaceId)
    return this.withServerFlags(stored)
  }

  // format: รูปแบบไฟล์ที่จะดาวน์โหลด — SVG/AI เฉพาะ Pro: ผ่านด่านสิทธิ์แบบปกติก่อน (ไม่มีสิทธิ์ = 402 PAYMENT_REQUIRED เดิม)
  // แล้วถ้าไม่ใช่ Pro (เช่น ซื้อรายแบบ) → 402 PRO_REQUIRED พร้อมราคา Pro ให้ client เปิดหน้าสมัคร
  // (open access = plan 'pro' อยู่แล้วจึงผ่าน); Pro ที่ได้ license จาก RPC ตามปกติไม่เสียหายอะไร
  async authorizeExport(actor: Actor, projectId: string, format?: ExportFormat): Promise<ExportAuthorization> {
    const authorization = this.options.openAccess
      ? await this.repository.authorizeOpenAccessExport(actor, projectId)
      : await this.repository.authorizeExport(actor, projectId)
    if (isProOnlyExport(format) && authorization.entitlements.plan !== 'pro') {
      throw new HttpError(402, 'PRO_REQUIRED', 'ไฟล์ SVG / AI ดาวน์โหลดได้เฉพาะสมาชิก Pro', {
        projectId,
        format,
        price: authorization.entitlements.catalog.pro,
      })
    }
    return { ...authorization, entitlements: this.withServerFlags(authorization.entitlements) }
  }

  async createOrder(actor: Actor, input: CreateOrderInput): Promise<Order> {
    // ยังไม่มีผู้ให้บริการชำระเงิน → ไม่สร้าง order ค้างจ่ายที่ไม่มีทางจ่ายได้ (ตัดสินก่อนแตะฐานข้อมูล)
    if (!this.options.purchasesEnabled) {
      throw new HttpError(503, 'PURCHASE_UNAVAILABLE', 'ยังไม่เปิดขาย — ระบบชำระเงินยังไม่พร้อมให้บริการ')
    }
    const order = await this.repository.createOrder(actor, input)
    // operationId เดิมคืน order เดิม (idempotent) จึงอาจเห็นบรรทัดนี้ซ้ำสำหรับ order id เดียวกัน
    logServerEvent('info', 'order_created', {
      requestId: actor.requestId,
      orderId: order.id,
      kind: order.kind,
      workspaceId: order.workspaceId,
      provider: order.provider,
    })
    return order
  }

  async devFulfilOrder(actor: Actor, orderId: string, requestId: string): Promise<Order> {
    if (!this.options.devFulfilEnabled) {
      throw new HttpError(404, 'NOT_FOUND', 'ไม่พบ API endpoint นี้')
    }
    const order = await this.repository.fulfilOrder(actor, orderId, 'dev', requestId)
    logServerEvent('info', 'order_fulfilled', {
      requestId,
      orderId: order.id,
      kind: order.kind,
      workspaceId: order.workspaceId,
      provider: order.provider,
    })
    return order
  }

  async reserveAiCredit(actor: Actor, workspaceId: string, operationId: string): Promise<AiCreditReservation> {
    // open access: ต่อรอบ Pro ฟรีที่หมดไปก่อนจอง — แท็บที่เปิดค้างข้ามรอบจะได้โควตาใหม่โดยไม่ต้องโหลดสิทธิ์ก่อน
    if (this.options.openAccess) await this.repository.ensureOpenAccess(actor, workspaceId)
    return this.repository.reserveAiCredit(actor, workspaceId, operationId)
  }

  settleAiRequest(
    actor: Actor,
    requestId: string,
    outcome: AiRequestOutcome,
    usage?: AiRequestUsage,
  ): Promise<AiCreditSettlement> {
    return this.repository.settleAiRequest(actor, requestId, outcome, usage)
  }
}
