import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js'
import type { ZodType } from 'zod'
import type { ApiErrorCode } from '../../../shared/contracts/errors'
import type { MarketplaceRole, SupplierProfileInput, SupplierReviewAction, SupplierStatus } from '../../../shared/contracts/marketplace'
import type { ServerConfig } from '../../config'
import { HttpError } from '../../http/errors'
import type { Actor } from '../../modules/identity/actor'
import type { MarketplaceRepository } from '../../modules/marketplace/marketplaceRepository'
import {
  marketplaceContext,
  removedSupplierMember,
  revokedSupplierInvite,
  supplierAccess,
  supplierAdminPage,
  supplierInvite,
  supplierProfile,
  supplierPublicProfile,
  supplierTeam,
  supplierTeamMember,
} from '../../modules/marketplace/validation'

const databaseErrors = new Map<string, [number, ApiErrorCode, string]>([
  ['APP_USER_NOT_ACTIVE', [403, 'USER_NOT_ACTIVE', 'บัญชีนี้ไม่พร้อมใช้งาน']],
  ['MARKETPLACE_NOT_FOUND', [404, 'NOT_FOUND', 'ไม่พบกิจการนี้']],
  ['MARKETPLACE_FORBIDDEN', [403, 'MARKETPLACE_FORBIDDEN', 'คุณไม่มีสิทธิ์ทำรายการนี้']],
  ['MARKETPLACE_CONFLICT', [409, 'MARKETPLACE_CONFLICT', 'ชื่อ URL ถูกใช้แล้วหรือสถานะกิจการเปลี่ยนไป กรุณาตรวจข้อมูลล่าสุด']],
  ['MARKETPLACE_INVITE_INVALID', [404, 'NOT_FOUND', 'ใช้คำเชิญนี้ไม่ได้ กรุณาตรวจบัญชีที่ใช้หรือขอลิงก์ใหม่']],
  ['MARKETPLACE_INVITE_EXISTS', [409, 'MARKETPLACE_CONFLICT', 'อีเมลนี้มีคำเชิญที่ยังใช้ได้อยู่แล้ว']],
  ['MARKETPLACE_MEMBER_EXISTS', [409, 'MARKETPLACE_CONFLICT', 'บัญชีนี้เป็นสมาชิกของผู้รับผลิตแล้ว']],
  ['MARKETPLACE_MANAGER_REQUIRED', [409, 'MARKETPLACE_CONFLICT', 'ต้องมีผู้จัดการที่ใช้งานได้อย่างน้อยหนึ่งคน']],
  ['MARKETPLACE_OWNER_PROTECTED', [409, 'MARKETPLACE_CONFLICT', 'เปลี่ยนสิทธิ์หรือนำเจ้าของพื้นที่ออกจากทีมไม่ได้']],
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

  team(actor: Actor, supplierId: string) {
    return this.rpc('marketplace_supplier_team', {
      p_actor_user_id: actor.userId,
      p_supplier_id: supplierId,
    }, supplierTeam)
  }

  invite(actor: Actor, supplierId: string, email: string, role: MarketplaceRole, tokenHash: string) {
    return this.rpc('marketplace_create_supplier_invite', {
      p_actor_user_id: actor.userId,
      p_supplier_id: supplierId,
      p_email: email,
      p_role: role,
      p_token_hash: tokenHash,
    }, supplierInvite)
  }

  acceptInvite(actor: Actor, verifiedEmail: string, tokenHash: string) {
    return this.rpc('marketplace_accept_supplier_invite', {
      p_actor_user_id: actor.userId,
      p_verified_email: verifiedEmail,
      p_token_hash: tokenHash,
    }, supplierAccess)
  }

  changeMember(actor: Actor, supplierId: string, userId: string, role: MarketplaceRole) {
    return this.rpc('marketplace_change_supplier_member', {
      p_actor_user_id: actor.userId,
      p_supplier_id: supplierId,
      p_member_user_id: userId,
      p_role: role,
    }, supplierTeamMember)
  }

  removeMember(actor: Actor, supplierId: string, userId: string) {
    return this.rpc('marketplace_remove_supplier_member', {
      p_actor_user_id: actor.userId,
      p_supplier_id: supplierId,
      p_member_user_id: userId,
    }, removedSupplierMember)
  }

  revokeInvite(actor: Actor, supplierId: string, inviteId: string) {
    return this.rpc('marketplace_revoke_supplier_invite', {
      p_actor_user_id: actor.userId,
      p_supplier_id: supplierId,
      p_invite_id: inviteId,
    }, revokedSupplierInvite)
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
