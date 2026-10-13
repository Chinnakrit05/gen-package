import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js'
import type { CreateOrderInput, Order, PlanCode } from '../../../shared/contracts/billing'
import type { ServerConfig } from '../../config'
import { HttpError } from '../../http/errors'
import type {
  AiCreditReservation,
  AiCreditSettlement,
  AiRequestOutcome,
  BillingRepository,
  StoredEntitlements,
  StoredExportAuthorization,
} from '../../modules/billing/billingService'
import {
  aiReservationResultSchema,
  aiSettlementResultSchema,
  catalogItemResultSchema,
  entitlementsResultSchema,
  exportAuthorizationResultSchema,
  orderResultSchema,
} from '../../modules/billing/validation'
import type { Actor } from '../../modules/identity/actor'

// RPC authorize_export แนบ CatalogItem ของ design ไว้ใน detail ให้ client โชว์ราคาได้โดยไม่ต้องยิงอีกรอบ
function paymentRequiredDetails(error: PostgrestError, projectId: string | undefined): Record<string, unknown> {
  let price: unknown
  try {
    price = JSON.parse(error.details)
  } catch {
    price = undefined
  }
  const parsed = catalogItemResultSchema.safeParse(price)
  return {
    ...(projectId ? { projectId } : {}),
    ...(parsed.success ? { price: parsed.data } : {}),
  }
}

function exhaustedPlan(error: PostgrestError): PlanCode {
  return error.details === 'pro' ? 'pro' : 'free'
}

function mapDatabaseError(error: PostgrestError, context: { projectId?: string } = {}): HttpError {
  if (error.message.includes('EXPORT_PAYMENT_REQUIRED')) {
    return new HttpError(
      402,
      'PAYMENT_REQUIRED',
      'ต้องซื้อแบบนี้หรือสมัคร Pro ก่อนดาวน์โหลดไฟล์ผลิต',
      paymentRequiredDetails(error, context.projectId),
    )
  }
  if (error.message.includes('AI_CREDITS_EXHAUSTED')) {
    return new HttpError(402, 'AI_CREDITS_EXHAUSTED', 'เครดิต AI หมด ซื้อแบบหรือสมัคร Pro เพื่อรับเครดิตเพิ่ม', {
      credits: 0,
      plan: exhaustedPlan(error),
    })
  }
  if (error.message.includes('AI_REQUEST_IN_PROGRESS')) {
    return new HttpError(409, 'AI_REQUEST_IN_PROGRESS', 'คำขอ AI นี้กำลังดำเนินการอยู่')
  }
  if (error.message.includes('AI_REQUEST_NOT_RESERVED')) {
    return new HttpError(409, 'AI_REQUEST_IN_PROGRESS', 'คำขอ AI นี้ถูกปิดไปแล้ว')
  }
  if (error.message.includes('IDEMPOTENCY_KEY_REUSED')) {
    return new HttpError(409, 'IDEMPOTENCY_KEY_REUSED', 'operationId นี้ถูกใช้กับข้อมูลอื่นแล้ว')
  }
  if (error.message.includes('ALREADY_LICENSED')) {
    return new HttpError(409, 'ALREADY_LICENSED', 'แบบนี้ได้สิทธิ์ดาวน์โหลดแล้ว ไม่ต้องซื้อซ้ำ')
  }
  if (error.message.includes('PROJECT_NOT_FOUND')) {
    return new HttpError(404, 'NOT_FOUND', 'ไม่พบโปรเจกต์นี้')
  }
  if (error.message.includes('ORDER_NOT_FOUND')) {
    return new HttpError(404, 'ORDER_NOT_FOUND', 'ไม่พบคำสั่งซื้อนี้')
  }
  if (error.message.includes('ORDER_NOT_PAYABLE')) {
    return new HttpError(409, 'ORDER_NOT_PAYABLE', 'คำสั่งซื้อนี้ถูกยกเลิกแล้ว')
  }
  if (error.message.includes('APP_USER_NOT_ACTIVE')) {
    return new HttpError(403, 'USER_NOT_ACTIVE', 'บัญชีนี้ไม่พร้อมใช้งาน')
  }
  return new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'ระบบสิทธิ์การใช้งานไม่พร้อมใช้งาน')
}

function providerContractError(): HttpError {
  return new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'ฐานข้อมูลคืนข้อมูลสิทธิ์การใช้งานไม่ถูกต้อง')
}

export class SupabaseBillingRepository implements BillingRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getEntitlements(actor: Actor, workspaceId: string): Promise<StoredEntitlements> {
    const { data, error } = await this.client.rpc('get_entitlements', {
      p_actor_user_id: actor.userId,
      p_workspace_id: workspaceId,
    })
    if (error) throw mapDatabaseError(error)
    const parsed = entitlementsResultSchema.safeParse(data)
    if (!parsed.success) throw providerContractError()
    return parsed.data
  }

  async authorizeExport(actor: Actor, projectId: string): Promise<StoredExportAuthorization> {
    const { data, error } = await this.client.rpc('authorize_export', {
      p_actor_user_id: actor.userId,
      p_project_id: projectId,
    })
    if (error) throw mapDatabaseError(error, { projectId })
    const parsed = exportAuthorizationResultSchema.safeParse(data)
    if (!parsed.success) throw providerContractError()
    return parsed.data
  }

  async reserveAiCredit(actor: Actor, workspaceId: string, operationId: string): Promise<AiCreditReservation> {
    const { data, error } = await this.client.rpc('reserve_ai_credit', {
      p_actor_user_id: actor.userId,
      p_workspace_id: workspaceId,
      p_operation_id: operationId,
    })
    if (error) throw mapDatabaseError(error)
    const parsed = aiReservationResultSchema.safeParse(data)
    if (!parsed.success) throw providerContractError()
    return parsed.data
  }

  async settleAiRequest(actor: Actor, requestId: string, outcome: AiRequestOutcome): Promise<AiCreditSettlement> {
    const { data, error } = await this.client.rpc('settle_ai_request', {
      p_actor_user_id: actor.userId,
      p_request_id: requestId,
      p_outcome: outcome,
    })
    if (error) throw mapDatabaseError(error)
    const parsed = aiSettlementResultSchema.safeParse(data)
    if (!parsed.success) throw providerContractError()
    return parsed.data
  }

  async createOrder(actor: Actor, input: CreateOrderInput): Promise<Order> {
    const { data, error } = await this.client.rpc('create_order', {
      p_actor_user_id: actor.userId,
      p_workspace_id: input.workspaceId,
      p_operation_id: input.operationId,
      p_kind: input.kind,
      p_project_id: input.projectId ?? null,
    })
    if (error) throw mapDatabaseError(error)
    const parsed = orderResultSchema.safeParse(data)
    if (!parsed.success) throw providerContractError()
    // ยังไม่มีผู้ให้บริการชำระเงิน จึงไม่มีหน้า checkout
    return { ...parsed.data, checkoutUrl: null }
  }

  async fulfilOrder(
    actor: Actor | null,
    orderId: string,
    provider: string,
    providerRef: string | null,
  ): Promise<Order> {
    const { data, error } = await this.client.rpc('fulfil_order', {
      p_actor_user_id: actor?.userId ?? null,
      p_order_id: orderId,
      p_provider: provider,
      p_provider_ref: providerRef,
    })
    if (error) throw mapDatabaseError(error)
    const parsed = orderResultSchema.safeParse(data)
    if (!parsed.success) throw providerContractError()
    return { ...parsed.data, checkoutUrl: null }
  }
}

export function createSupabaseBillingRepository(
  config: NonNullable<ServerConfig['supabase']>,
): BillingRepository {
  const client = createClient(config.url, config.secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })
  return new SupabaseBillingRepository(client)
}
