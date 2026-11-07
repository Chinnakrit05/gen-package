import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js'
import type { ZodType } from 'zod'
import type { ApiErrorCode } from '../../../shared/contracts/errors'
import type { SupplierProfileInput, SupplierReviewAction, SupplierStatus } from '../../../shared/contracts/marketplace'
import type { ServerConfig } from '../../config'
import { HttpError } from '../../http/errors'
import type { Actor } from '../../modules/identity/actor'
import type { MarketplaceRepository } from '../../modules/marketplace/marketplaceRepository'
import {
  marketplaceContext,
  supplierAccess,
  supplierAdminPage,
  supplierProfile,
  supplierPublicProfile,
} from '../../modules/marketplace/validation'

const databaseErrors = new Map<string, [number, ApiErrorCode, string]>([
  ['APP_USER_NOT_ACTIVE', [403, 'USER_NOT_ACTIVE', 'บัญชีนี้ไม่พร้อมใช้งาน']],
  ['MARKETPLACE_NOT_FOUND', [404, 'NOT_FOUND', 'ไม่พบกิจการนี้']],
  ['MARKETPLACE_FORBIDDEN', [403, 'MARKETPLACE_FORBIDDEN', 'คุณไม่มีสิทธิ์ทำรายการนี้']],
  ['MARKETPLACE_CONFLICT', [409, 'MARKETPLACE_CONFLICT', 'ชื่อ URL ถูกใช้แล้วหรือสถานะกิจการเปลี่ยนไป กรุณาตรวจข้อมูลล่าสุด']],
  ['IDEMPOTENCY_KEY_REUSED', [409, 'IDEMPOTENCY_KEY_REUSED', 'คำขอนี้ถูกใช้กับข้อมูลอื่นแล้ว']],
  ['VALIDATION_ERROR', [422, 'VALIDATION_ERROR', 'ข้อมูลกิจการไม่ถูกต้องหรือยังไม่ครบ']],
])

function mapDatabaseError(error: PostgrestError): HttpError {
  if (error.message === 'REVISION_CONFLICT') {
    let currentRevision: unknown
    try {
      currentRevision = (JSON.parse(error.details) as { currentRevision?: unknown } | null)?.currentRevision
    } catch {
      currentRevision = undefined
    }
    return new HttpError(409, 'REVISION_CONFLICT', 'ข้อมูลกิจการเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด',
      typeof currentRevision === 'number' && Number.isSafeInteger(currentRevision) && currentRevision > 0
        ? { currentRevision }
        : undefined)
  }
  const mapped = databaseErrors.get(error.message)
  return mapped ? new HttpError(...mapped) : new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'ฐานข้อมูล Marketplace ไม่พร้อมใช้งาน')
}

export class SupabaseMarketplaceRepository implements MarketplaceRepository {
  constructor(private readonly client: SupabaseClient) {}

  private async rpc<T>(name: string, args: Record<string, unknown>, schema: ZodType<T>): Promise<T> {
    const { data, error } = await this.client.rpc(name, args)
    if (error) throw mapDatabaseError(error)
    const parsed = schema.safeParse(data)
    if (!parsed.success) throw new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'ฐานข้อมูลคืนข้อมูล Marketplace ไม่ถูกต้อง')
    return parsed.data
  }

  context(actor: Actor) {
    return this.rpc('marketplace_context', { p_actor_user_id: actor.userId }, marketplaceContext)
  }

  create(actor: Actor, operationId: string, profile: SupplierProfileInput) {
    return this.rpc('marketplace_create_supplier', {
      p_actor_user_id: actor.userId,
      p_operation_id: operationId,
      p_profile: profile,
    }, supplierAccess)
  }

  get(actor: Actor, supplierId: string) {
    return this.rpc('marketplace_get_supplier', {
      p_actor_user_id: actor.userId,
      p_supplier_id: supplierId,
    }, supplierAccess)
  }

  update(actor: Actor, supplierId: string, expectedRevision: number, profile: SupplierProfileInput) {
    return this.rpc('marketplace_update_supplier', {
      p_actor_user_id: actor.userId,
      p_supplier_id: supplierId,
      p_expected_revision: expectedRevision,
      p_profile: profile,
    }, supplierAccess)
  }

  submit(actor: Actor, supplierId: string, expectedRevision: number) {
    return this.rpc('marketplace_submit_supplier', {
      p_actor_user_id: actor.userId,
      p_supplier_id: supplierId,
      p_expected_revision: expectedRevision,
    }, supplierAccess)
  }

  publicProfile(slug: string) {
    return this.rpc('marketplace_public_supplier', { p_slug: slug }, supplierPublicProfile)
  }

  adminList(actor: Actor, status: SupplierStatus, after?: string) {
    return this.rpc('marketplace_admin_suppliers', {
      p_actor_user_id: actor.userId,
      p_status: status,
      p_after: after ?? null,
    }, supplierAdminPage)
  }

  review(actor: Actor, supplierId: string, expectedRevision: number, action: SupplierReviewAction, reason: string) {
    return this.rpc('marketplace_review_supplier', {
      p_actor_user_id: actor.userId,
      p_supplier_id: supplierId,
      p_expected_revision: expectedRevision,
      p_action: action,
      p_reason: reason,
    }, supplierProfile)
  }
}

export function createSupabaseMarketplaceRepository(config: NonNullable<ServerConfig['supabase']>): MarketplaceRepository {
  const client = createClient(config.url, config.secretKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  })
  return new SupabaseMarketplaceRepository(client)
}
