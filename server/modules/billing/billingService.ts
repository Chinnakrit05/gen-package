import type {
  CreateOrderInput,
  Entitlements,
  ExportAuthorization,
  LicenseSource,
  Order,
} from '../../../shared/contracts/billing'
import { HttpError } from '../../http/errors'
import type { Actor } from '../identity/actor'

// ชั้นบริการ billing — กติกาอยู่ในฐานข้อมูล (RPC ใน supabase/migrations/20261013000600_billing.sql)
// ชั้นนี้เติมเฉพาะสิ่งที่ DB ไม่รู้: devFulfilAvailable ตาม appEnv และ gate ของการจำลองชำระเงิน

export type AiRequestOutcome = 'succeeded' | 'failed'

// Entitlements ตามที่ DB คืน — ยังไม่มี devFulfilAvailable
export type StoredEntitlements = Omit<Entitlements, 'devFulfilAvailable'>

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
  reserveAiCredit(actor: Actor, workspaceId: string, operationId: string): Promise<AiCreditReservation>
  settleAiRequest(actor: Actor, requestId: string, outcome: AiRequestOutcome): Promise<AiCreditSettlement>
  createOrder(actor: Actor, input: CreateOrderInput): Promise<Order>
  // actor null = webhook ของผู้ให้บริการในอนาคต (ไม่ตรวจ purchaser)
  fulfilOrder(actor: Actor | null, orderId: string, provider: string, providerRef: string | null): Promise<Order>
}

export interface BillingServiceOptions {
  // จำลองการชำระเงินได้เฉพาะ development/test — ที่อื่นเส้นทาง dev-fulfil ต้องเหมือนไม่มีอยู่
  devFulfilEnabled: boolean
}

export class BillingService {
  constructor(
    private readonly repository: BillingRepository,
    private readonly options: BillingServiceOptions,
  ) {}

  private withDevFlag(entitlements: StoredEntitlements): Entitlements {
    return { ...entitlements, devFulfilAvailable: this.options.devFulfilEnabled }
  }

  async getEntitlements(actor: Actor, workspaceId: string): Promise<Entitlements> {
    return this.withDevFlag(await this.repository.getEntitlements(actor, workspaceId))
  }

  async authorizeExport(actor: Actor, projectId: string): Promise<ExportAuthorization> {
    const authorization = await this.repository.authorizeExport(actor, projectId)
    return { ...authorization, entitlements: this.withDevFlag(authorization.entitlements) }
  }

  createOrder(actor: Actor, input: CreateOrderInput): Promise<Order> {
    return this.repository.createOrder(actor, input)
  }

  async devFulfilOrder(actor: Actor, orderId: string, requestId: string): Promise<Order> {
    if (!this.options.devFulfilEnabled) {
      throw new HttpError(404, 'NOT_FOUND', 'ไม่พบ API endpoint นี้')
    }
    return this.repository.fulfilOrder(actor, orderId, 'dev', requestId)
  }

  reserveAiCredit(actor: Actor, workspaceId: string, operationId: string): Promise<AiCreditReservation> {
    return this.repository.reserveAiCredit(actor, workspaceId, operationId)
  }

  settleAiRequest(actor: Actor, requestId: string, outcome: AiRequestOutcome): Promise<AiCreditSettlement> {
    return this.repository.settleAiRequest(actor, requestId, outcome)
  }
}
