import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js'
import type { ZodType } from 'zod'
import type { ApiErrorCode } from '../../../shared/contracts/errors'
import {
  SUPPLIER_NOTIFICATION_PAGE_SIZE,
  type MarketplaceRole,
  type SupplierNotificationCursor,
  type SupplierProfileInput,
  type SupplierReviewAction,
  type SupplierReviewDocumentUpload,
  type SupplierStatus,
} from '../../../shared/contracts/marketplace'
import type { CreateQuoteRequestDraftInput, QuoteRequestCursor } from '../../../shared/contracts/quoteRequests'
import type { ServerConfig } from '../../config'
import { HttpError } from '../../http/errors'
import type { Actor } from '../../modules/identity/actor'
import type { MarketplaceRepository } from '../../modules/marketplace/marketplaceRepository'
import {
  quoteDraft,
  quoteDraftPage,
  quoteEligibleSupplierPage,
  quoteRequestPublication,
  quoteRequestPublicationState,
  supplierQuoteRequest,
  supplierQuoteRequestPage,
} from '../../modules/marketplace/quoteRequestValidation'
import {
  marketplaceContext,
  removedSupplierMember,
  removedSupplierReviewDocument,
  revokedSupplierInvite,
  supplierAccess,
  supplierAdminPage,
  supplierInvite,
  supplierNotificationPage,
  supplierNotificationRead,
  supplierProfile,
  supplierPublicProfile,
  supplierReviewDocument,
  supplierReviewDocumentDownload,
  supplierReviewDocuments,
  supplierTeam,
  supplierTeamMember,
} from '../../modules/marketplace/validation'

const databaseErrors = new Map<string, [number, ApiErrorCode, string]>([
  ['APP_USER_NOT_ACTIVE', [403, 'USER_NOT_ACTIVE', 'บัญชีนี้ไม่พร้อมใช้งาน']],
  ['MARKETPLACE_NOT_FOUND', [404, 'NOT_FOUND', 'ไม่พบกิจการนี้']],
  ['QUOTE_REQUEST_NOT_FOUND', [404, 'NOT_FOUND', 'ไม่พบคำขอราคาหรือรายการงานของกิจการนี้']],
  ['QUOTE_REQUEST_ALREADY_PUBLISHED', [409, 'MARKETPLACE_CONFLICT', 'คำขอราคานี้เผยแพร่แล้ว กรุณาตรวจรายชื่อผู้รับล่าสุด']],
  ['QUOTE_REQUEST_SUPPLIER_UNAVAILABLE', [409, 'MARKETPLACE_CONFLICT', 'ผู้รับผลิตที่เลือกบางรายยังรับคำขอนี้ไม่ได้ กรุณาเลือกร้านจากรายการล่าสุด']],
  ['MARKETPLACE_FORBIDDEN', [403, 'MARKETPLACE_FORBIDDEN', 'คุณไม่มีสิทธิ์ทำรายการนี้']],
  ['MARKETPLACE_CONFLICT', [409, 'MARKETPLACE_CONFLICT', 'ชื่อ URL ถูกใช้แล้วหรือสถานะกิจการเปลี่ยนไป กรุณาตรวจข้อมูลล่าสุด']],
  ['MARKETPLACE_INVITE_INVALID', [404, 'NOT_FOUND', 'ใช้คำเชิญนี้ไม่ได้ กรุณาตรวจบัญชีที่ใช้หรือขอลิงก์ใหม่']],
  ['MARKETPLACE_INVITE_EXISTS', [409, 'MARKETPLACE_CONFLICT', 'อีเมลนี้มีคำเชิญที่ยังใช้ได้อยู่แล้ว']],
  ['MARKETPLACE_MEMBER_EXISTS', [409, 'MARKETPLACE_CONFLICT', 'บัญชีนี้เป็นสมาชิกของผู้รับผลิตแล้ว']],
  ['MARKETPLACE_MANAGER_REQUIRED', [409, 'MARKETPLACE_CONFLICT', 'ต้องมีผู้จัดการที่ใช้งานได้อย่างน้อยหนึ่งคน']],
  ['MARKETPLACE_OWNER_PROTECTED', [409, 'MARKETPLACE_CONFLICT', 'เปลี่ยนสิทธิ์หรือนำเจ้าของพื้นที่ออกจากทีมไม่ได้']],
  ['SUPPLIER_DOCUMENT_LIMIT', [409, 'SUPPLIER_DOCUMENT_LIMIT', 'แนบเอกสารประกอบการตรวจได้สูงสุด 3 ไฟล์']],
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

  listNotifications(actor: Actor, asReviewer: boolean, after: SupplierNotificationCursor | null) {
    return this.rpc('marketplace_list_supplier_notifications', {
      p_actor_user_id: actor.userId,
      p_as_reviewer: asReviewer,
      p_limit: SUPPLIER_NOTIFICATION_PAGE_SIZE,
      p_after_created_at: after?.createdAt ?? null,
      p_after_id: after?.id ?? null,
    }, supplierNotificationPage)
  }

  markNotificationRead(actor: Actor, asReviewer: boolean, id: string) {
    return this.rpc('marketplace_mark_supplier_notification_read', {
      p_actor_user_id: actor.userId,
      p_notification_id: id,
      p_as_reviewer: asReviewer,
    }, supplierNotificationRead)
  }

  listReviewDocuments(actor: Actor, supplierId: string, asReviewer: boolean) {
    return this.rpc('marketplace_list_supplier_review_documents', {
      p_actor_user_id: actor.userId,
      p_supplier_id: supplierId,
      p_as_reviewer: asReviewer,
    }, supplierReviewDocuments)
  }

  getReviewDocument(actor: Actor, supplierId: string, documentId: string, asReviewer: boolean) {
    return this.rpc('marketplace_get_supplier_review_document', {
      p_actor_user_id: actor.userId,
      p_supplier_id: supplierId,
      p_document_id: documentId,
      p_as_reviewer: asReviewer,
    }, supplierReviewDocumentDownload)
  }

  addReviewDocument(actor: Actor, supplierId: string, input: SupplierReviewDocumentUpload) {
    return this.rpc('marketplace_add_supplier_review_document', {
      p_actor_user_id: actor.userId,
      p_supplier_id: supplierId,
      p_operation_id: input.operationId,
      p_name: input.name,
      p_mime_type: input.mimeType,
      p_data_base64: input.dataBase64,
    }, supplierReviewDocument)
  }

  removeReviewDocument(actor: Actor, supplierId: string, documentId: string) {
    return this.rpc('marketplace_remove_supplier_review_document', {
      p_actor_user_id: actor.userId,
      p_supplier_id: supplierId,
      p_document_id: documentId,
    }, removedSupplierReviewDocument)
  }

  createQuoteRequestDraft(actor: Actor, input: CreateQuoteRequestDraftInput) {
    return this.rpc('marketplace_create_quote_request_draft', {
      p_actor_user_id: actor.userId,
      p_workspace_id: input.workspaceId,
      p_project_id: input.projectId,
      p_expected_project_revision: input.expectedProjectRevision,
      p_operation_id: input.operationId,
      p_title: input.title,
      p_quantity: input.quantity,
      p_notes: input.notes,
    }, quoteDraft)
  }

  listQuoteRequestDrafts(actor: Actor, workspaceId: string, after: QuoteRequestCursor | null) {
    return this.rpc('marketplace_list_quote_request_drafts', {
      p_actor_user_id: actor.userId,
      p_workspace_id: workspaceId,
      p_after_created_at: after?.createdAt ?? null,
      p_after_id: after?.id ?? null,
    }, quoteDraftPage)
  }

  getQuoteRequestDraft(actor: Actor, id: string) {
    return this.rpc('marketplace_get_quote_request_draft', {
      p_actor_user_id: actor.userId,
      p_request_id: id,
    }, quoteDraft)
  }

  getQuoteRequestPublication(actor: Actor, id: string) {
    return this.rpc('marketplace_quote_request_publication', {
      p_actor_user_id: actor.userId,
      p_request_id: id,
    }, quoteRequestPublicationState)
  }

  listQuoteRequestEligibleSuppliers(actor: Actor, id: string, after: string | null) {
    return this.rpc('marketplace_quote_request_eligible_suppliers', {
      p_actor_user_id: actor.userId,
      p_request_id: id,
      p_after: after,
    }, quoteEligibleSupplierPage)
  }

  publishQuoteRequest(actor: Actor, id: string, supplierIds: string[]) {
    return this.rpc('marketplace_publish_quote_request', {
      p_actor_user_id: actor.userId,
      p_request_id: id,
      p_supplier_ids: supplierIds,
    }, quoteRequestPublication)
  }

  listSupplierQuoteRequests(actor: Actor, supplierId: string, after: QuoteRequestCursor | null) {
    return this.rpc('marketplace_list_supplier_quote_requests', {
      p_actor_user_id: actor.userId,
      p_supplier_id: supplierId,
      p_after_created_at: after?.createdAt ?? null,
      p_after_id: after?.id ?? null,
    }, supplierQuoteRequestPage)
  }

  getSupplierQuoteRequest(actor: Actor, supplierId: string, id: string) {
    return this.rpc('marketplace_get_supplier_quote_request', {
      p_actor_user_id: actor.userId,
      p_supplier_id: supplierId,
      p_request_id: id,
    }, supplierQuoteRequest)
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
