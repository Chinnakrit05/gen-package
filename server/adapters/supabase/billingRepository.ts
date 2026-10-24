import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { ZodError } from 'zod'
import type { CreateOrderInput, Order, PlanCode } from '../../../shared/contracts/billing'
import type { ServerConfig } from '../../config'
import { HttpError } from '../../http/errors'
import { errorMessageForLog, logServerEvent } from '../../logging'
import type {
  AiCreditReservation,
  AiCreditSettlement,
  AiRequestOutcome,
  AiRequestUsage,
  BillingRepository,
  StoredEntitlements,
  StoredExportAuthorization,
} from '../../modules/billing/billingService'
import type {
  StorageQuotaCheck,
  StorageQuotaRepository,
  StorageQuotaResult,
} from '../../modules/billing/storageQuota'
import {
  aiReservationResultSchema,
  aiSettlementResultSchema,
  catalogItemResultSchema,
  entitlementsResultSchema,
  exportAuthorizationResultSchema,
  orderResultSchema,
  storageQuotaResultSchema,
} from '../../modules/billing/validation'
import type { Actor } from '../../modules/identity/actor'

// error ที่ PostgREST คืนจาก RPC — RPC ของ billing raise errcode P0001 + message เป็นรหัสคงที่
// (supabase/migrations/20261013000600_billing.sql) ส่วน detail ใช้ส่งข้อมูลประกอบ (ราคา/แผน)
export interface BillingDatabaseError {
  message: string
  details?: string | null
  code?: string | null
}

export interface BillingErrorContext {
  projectId?: string
}

// RPC authorize_export แนบ CatalogItem ของ design ไว้ใน detail ให้ client โชว์ราคาได้โดยไม่ต้องยิงอีกรอบ
function paymentRequiredDetails(error: BillingDatabaseError, projectId: string | undefined): Record<string, unknown> {
  let price: unknown
  try {
    price = JSON.parse(error.details ?? '')
  } catch {
    price = undefined
  }
  const parsed = catalogItemResultSchema.safeParse(price)
  return {
    ...(projectId ? { projectId } : {}),
    ...(parsed.success ? { price: parsed.data } : {}),
  }
}

function exhaustedPlan(error: BillingDatabaseError): PlanCode {
  return error.details === 'pro' ? 'pro' : 'free'
}

// แปลง error ของ RPC billing เป็น HttpError (pure — log อยู่ที่ repository ด้านล่าง)
// รหัสที่ไม่รู้จัก = 503 DEPENDENCY_UNAVAILABLE (ไม่ส่งข้อความจาก DB ถึง client)
export function mapBillingDatabaseError(error: BillingDatabaseError, context: BillingErrorContext = {}): HttpError {
  const message = error.message ?? ''
  if (message.includes('EXPORT_PAYMENT_REQUIRED')) {
    return new HttpError(
      402,
      'PAYMENT_REQUIRED',
      'ต้องซื้อแบบนี้หรือสมัคร Pro ก่อนดาวน์โหลดไฟล์ผลิต',
      paymentRequiredDetails(error, context.projectId),
    )
  }
  if (message.includes('AI_CREDITS_EXHAUSTED')) {
    return new HttpError(402, 'AI_CREDITS_EXHAUSTED', 'เครดิต AI หมดแล้ว', {
      credits: 0,
      plan: exhaustedPlan(error),
    })
  }
  if (message.includes('AI_CONCURRENCY_LIMIT')) {
    // workspace มีคำขอ AI ค้าง reserved ครบเพดานแล้ว (reserve_ai_credit) — ไม่ได้หักเครดิต
    return new HttpError(429, 'AI_RATE_LIMITED', 'มีคำขอ AI ของพื้นที่งานนี้กำลังทำงานอยู่ รอสักครู่แล้วลองใหม่')
  }
  if (message.includes('AI_REQUEST_IN_PROGRESS')) {
    return new HttpError(409, 'AI_REQUEST_IN_PROGRESS', 'คำขอ AI นี้กำลังดำเนินการอยู่')
  }
  if (message.includes('AI_REQUEST_NOT_RESERVED')) {
    return new HttpError(409, 'AI_REQUEST_IN_PROGRESS', 'คำขอ AI นี้ถูกปิดไปแล้ว')
  }
  if (message.includes('IDEMPOTENCY_KEY_REUSED')) {
    return new HttpError(409, 'IDEMPOTENCY_KEY_REUSED', 'operationId นี้ถูกใช้กับข้อมูลอื่นแล้ว')
  }
  if (message.includes('ALREADY_LICENSED')) {
    return new HttpError(409, 'ALREADY_LICENSED', 'แบบนี้ได้สิทธิ์ดาวน์โหลดแล้ว ไม่ต้องซื้อซ้ำ')
  }
  if (message.includes('PROJECT_NOT_FOUND')) {
    return new HttpError(404, 'NOT_FOUND', 'ไม่พบโปรเจกต์นี้')
  }
  if (message.includes('ORDER_NOT_FOUND')) {
    return new HttpError(404, 'ORDER_NOT_FOUND', 'ไม่พบคำสั่งซื้อนี้')
  }
  if (message.includes('ORDER_NOT_PAYABLE')) {
    return new HttpError(409, 'ORDER_NOT_PAYABLE', 'คำสั่งซื้อนี้ถูกยกเลิกแล้ว')
  }
  if (message.includes('APP_USER_NOT_ACTIVE')) {
    return new HttpError(403, 'USER_NOT_ACTIVE', 'บัญชีนี้ไม่พร้อมใช้งาน')
  }
  return new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'ระบบสิทธิ์การใช้งานไม่พร้อมใช้งาน')
}

// โทเคน/โมเดลที่ไม่สมเหตุผลส่งเป็น null แทน — check constraint ใน DB จะทำให้ settle ล้มทั้งคำขอ
const MAX_INT4 = 2_147_483_647

function tokenCount(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_INT4 ? value : null
}

function modelName(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed.length >= 1 && trimmed.length <= 200 ? trimmed : null
}

export function settleUsageParams(usage: AiRequestUsage | undefined): Record<string, string | number | boolean | null> {
  return {
    p_model: modelName(usage?.model),
    p_input_tokens: tokenCount(usage?.inputTokens),
    p_output_tokens: tokenCount(usage?.outputTokens),
    p_cache_read_tokens: tokenCount(usage?.cacheReadTokens),
    p_cache_creation_tokens: tokenCount(usage?.cacheCreationTokens),
    p_has_image: typeof usage?.hasImage === 'boolean' ? usage.hasImage : null,
  }
}

export class SupabaseBillingRepository implements BillingRepository, StorageQuotaRepository {
  constructor(private readonly client: SupabaseClient) {}

  // map + log กรณี 5xx (รหัสที่ไม่รู้จัก) หนึ่งบรรทัด: requestId, RPC, รหัส, ข้อความจาก DB (ผ่าน redact)
  private databaseError(
    error: BillingDatabaseError,
    rpc: string,
    actor: Actor | null,
    context: BillingErrorContext = {},
  ): HttpError {
    const mapped = mapBillingDatabaseError(error, context)
    if (mapped.status >= 500) {
      logServerEvent('error', 'billing_database_error', {
        requestId: actor?.requestId,
        route: `rpc ${rpc}`,
        code: mapped.code,
        dbCode: error.code ?? undefined,
        error: errorMessageForLog(error),
      })
    }
    return mapped
  }

  // RPC คืน jsonb ที่ไม่ตรงสัญญา — log เฉพาะ path ของ field ที่ผิด (ไม่ log ค่า)
  private contractError(rpc: string, actor: Actor | null, error: ZodError): HttpError {
    const mapped = new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'ฐานข้อมูลคืนข้อมูลสิทธิ์การใช้งานไม่ถูกต้อง')
    logServerEvent('error', 'billing_contract_error', {
      requestId: actor?.requestId,
      route: `rpc ${rpc}`,
      code: mapped.code,
      error: `invalid fields: ${error.issues.slice(0, 5).map((issue) => issue.path.join('.') || '(root)').join(', ')}`,
    })
    return mapped
  }

  async getEntitlements(actor: Actor, workspaceId: string): Promise<StoredEntitlements> {
    const { data, error } = await this.client.rpc('get_entitlements', {
      p_actor_user_id: actor.userId,
      p_workspace_id: workspaceId,
    })
    if (error) throw this.databaseError(error, 'get_entitlements', actor)
    const parsed = entitlementsResultSchema.safeParse(data)
    if (!parsed.success) throw this.contractError('get_entitlements', actor, parsed.error)
    return parsed.data
  }

  async authorizeExport(actor: Actor, projectId: string): Promise<StoredExportAuthorization> {
    const { data, error } = await this.client.rpc('authorize_export', {
      p_actor_user_id: actor.userId,
      p_project_id: projectId,
    })
    if (error) throw this.databaseError(error, 'authorize_export', actor, { projectId })
    const parsed = exportAuthorizationResultSchema.safeParse(data)
    if (!parsed.success) throw this.contractError('authorize_export', actor, parsed.error)
    return parsed.data
  }

  async ensureOpenAccess(actor: Actor, workspaceId: string): Promise<StoredEntitlements> {
    const { data, error } = await this.client.rpc('ensure_open_access', {
      p_actor_user_id: actor.userId,
      p_workspace_id: workspaceId,
    })
    if (error) throw this.databaseError(error, 'ensure_open_access', actor)
    const parsed = entitlementsResultSchema.safeParse(data)
    if (!parsed.success) throw this.contractError('ensure_open_access', actor, parsed.error)
    return parsed.data
  }

  async authorizeOpenAccessExport(actor: Actor, projectId: string): Promise<StoredExportAuthorization> {
    const { data, error } = await this.client.rpc('authorize_open_access_export', {
      p_actor_user_id: actor.userId,
      p_project_id: projectId,
    })
    if (error) throw this.databaseError(error, 'authorize_open_access_export', actor, { projectId })
    const parsed = exportAuthorizationResultSchema.safeParse(data)
    if (!parsed.success) throw this.contractError('authorize_open_access_export', actor, parsed.error)
    return parsed.data
  }

  async reserveAiCredit(actor: Actor, workspaceId: string, operationId: string): Promise<AiCreditReservation> {
    const { data, error } = await this.client.rpc('reserve_ai_credit', {
      p_actor_user_id: actor.userId,
      p_workspace_id: workspaceId,
      p_operation_id: operationId,
    })
    if (error) throw this.databaseError(error, 'reserve_ai_credit', actor)
    const parsed = aiReservationResultSchema.safeParse(data)
    if (!parsed.success) throw this.contractError('reserve_ai_credit', actor, parsed.error)
    return parsed.data
  }

  async settleAiRequest(
    actor: Actor,
    requestId: string,
    outcome: AiRequestOutcome,
    usage?: AiRequestUsage,
  ): Promise<AiCreditSettlement> {
    // ส่งพารามิเตอร์ usage ครบทุกตัวเสมอ (null = ไม่มี) ให้ PostgREST เลือก function ได้ชัด
    const { data, error } = await this.client.rpc('settle_ai_request', {
      p_actor_user_id: actor.userId,
      p_request_id: requestId,
      p_outcome: outcome,
      ...settleUsageParams(usage),
    })
    if (error) throw this.databaseError(error, 'settle_ai_request', actor)
    const parsed = aiSettlementResultSchema.safeParse(data)
    if (!parsed.success) throw this.contractError('settle_ai_request', actor, parsed.error)
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
    if (error) throw this.databaseError(error, 'create_order', actor)
    const parsed = orderResultSchema.safeParse(data)
    if (!parsed.success) throw this.contractError('create_order', actor, parsed.error)
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
    if (error) throw this.databaseError(error, 'fulfil_order', actor)
    const parsed = orderResultSchema.safeParse(data)
    if (!parsed.success) throw this.contractError('fulfil_order', actor, parsed.error)
    return { ...parsed.data, checkoutUrl: null }
  }

  // โควตาพื้นที่เก็บงาน (ยังไม่เปิดใช้ — เรียกผ่าน StorageQuota เฉพาะเมื่อ isStorageQuotaEnabled)
  async checkStorageQuota(actor: Actor, input: StorageQuotaCheck, openAccess: boolean): Promise<StorageQuotaResult> {
    const { data, error } = await this.client.rpc('check_storage_quota', {
      p_actor_user_id: actor.userId,
      p_workspace_id: input.workspaceId,
      p_project_id: input.projectId,
      p_operation_id: input.operationId,
      p_document: input.document,
      p_extra_bytes: input.extraBytes,
      p_open_access: openAccess,
    })
    if (error) throw this.databaseError(error, 'check_storage_quota', actor, input.projectId ? { projectId: input.projectId } : {})
    const parsed = storageQuotaResultSchema.safeParse(data)
    if (!parsed.success) throw this.contractError('check_storage_quota', actor, parsed.error)
    return parsed.data
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

export function createSupabaseStorageQuotaRepository(
  config: NonNullable<ServerConfig['supabase']>,
): StorageQuotaRepository {
  const client = createClient(config.url, config.secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })
  return new SupabaseBillingRepository(client)
}
