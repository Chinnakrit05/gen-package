import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { ReadyAssetMetadata } from '../../../shared/contracts/assets'
import type { ServerConfig } from '../../config'
import { HttpError } from '../../http/errors'
import type {
  AssetRepository,
  ClaimedAsset,
  InternalAsset,
} from '../../modules/assets/assetRepository'
import { AssetService } from '../../modules/assets/assetService'
import {
  StorageObjectMissingError,
  type ObjectStorage,
} from '../../modules/assets/objectStorage'
import type { Actor } from '../../modules/identity/actor'

const safeInteger = z.union([
  z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  z.string().regex(/^\d+$/).transform((value, context) => {
    const number = Number(value)
    if (!Number.isSafeInteger(number) || number < 0) {
      context.addIssue({ code: 'custom', message: 'integer exceeds JSON safe range' })
      return z.NEVER
    }
    return number
  }),
])
const timestamp = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'invalid timestamp')
const assetPurpose = z.enum(['project-decoration', 'project-fill'])
const assetMime = z.enum(['image/png', 'image/jpeg'])
const internalAssetSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  purpose: assetPurpose,
  state: z.enum(['pending', 'validating', 'ready', 'rejected']),
  stagingKey: z.string().min(1),
  objectKey: z.string().min(1).nullable(),
  declaredMime: assetMime,
  declaredSize: safeInteger,
  mimeType: assetMime.nullable(),
  byteSize: safeInteger.nullable(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  width: safeInteger.nullable(),
  height: safeInteger.nullable(),
  ticketExpiresAt: timestamp,
  processingLeaseUntil: timestamp.nullable(),
  processingFencingVersion: safeInteger,
  rejectionCode: z.string().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict()
const claimedAssetSchema = internalAssetSchema.extend({ claimed: z.boolean() }).strict()
const downloadRowSchema = z.object({
  asset_id: z.uuid(),
  workspace_id: z.uuid(),
  purpose: assetPurpose,
  object_key: z.string().min(1),
  mime_type: assetMime,
  byte_size: safeInteger,
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  width: safeInteger,
  height: safeInteger,
  created_at: timestamp,
}).strict()

function databaseError(error: PostgrestError): HttpError {
  if (error.message.includes('IDEMPOTENCY_KEY_REUSED')) {
    return new HttpError(409, 'IDEMPOTENCY_KEY_REUSED', 'operationId นี้ถูกใช้กับข้อมูลอื่นแล้ว')
  }
  if (error.message.includes('ASSET_QUOTA_EXCEEDED')) {
    return new HttpError(429, 'ASSET_QUOTA_EXCEEDED', 'พื้นที่เก็บไฟล์หรือจำนวนไฟล์ที่รออัปโหลดเต็มแล้ว')
  }
  if (error.message.includes('ASSET_NOT_READY')) {
    return new HttpError(422, 'ASSET_NOT_READY', 'รูปที่อ้างถึงยังไม่พร้อมใช้งาน')
  }
  if (error.message.includes('ASSET_NOT_FOUND')) {
    return new HttpError(404, 'NOT_FOUND', 'ไม่พบไฟล์รูปนี้')
  }
  if (error.message.includes('PROJECT_NOT_FOUND')) {
    return new HttpError(404, 'NOT_FOUND', 'ไม่พบไฟล์รูปนี้')
  }
  if (error.message.includes('ASSET_NOT_PENDING')
    || error.message.includes('ASSET_VALIDATION_FENCED')) {
    return new HttpError(409, 'INVALID_REQUEST', 'สถานะไฟล์เปลี่ยนไปแล้ว')
  }
  if (error.message.includes('APP_USER_NOT_ACTIVE')) {
    return new HttpError(403, 'USER_NOT_ACTIVE', 'บัญชีนี้ไม่พร้อมใช้งาน')
  }
  if (error.code === '22023') {
    return new HttpError(422, 'VALIDATION_ERROR', 'ข้อมูลไฟล์รูปไม่ถูกต้อง')
  }
  return new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'ฐานข้อมูลไฟล์รูปไม่พร้อมใช้งาน')
}

function parseAsset(data: unknown): InternalAsset {
  const parsed = internalAssetSchema.safeParse(data)
  if (!parsed.success) {
    throw new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'ฐานข้อมูลคืนข้อมูลไฟล์ไม่ถูกต้อง')
  }
  return parsed.data as InternalAsset
}

class SupabaseAssetRepository implements AssetRepository {
  constructor(private readonly client: SupabaseClient) {}

  private async rpc(name: string, parameters: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await this.client.rpc(name, parameters)
    if (error) throw databaseError(error)
    return data
  }

  async createIntent(actor: Actor, input: Parameters<AssetRepository['createIntent']>[1]): Promise<InternalAsset> {
    return parseAsset(await this.rpc('create_asset_upload_intent', {
      p_actor_user_id: actor.userId,
      p_workspace_id: input.workspaceId,
      p_operation_id: input.operationId,
      p_request_hash: input.requestHash,
      p_purpose: input.purpose,
      p_declared_mime: input.declaredMime,
      p_declared_size: input.declaredSize,
      p_ticket_expires_at: input.ticketExpiresAt,
    }))
  }

  async renewTicket(actor: Actor, input: Parameters<AssetRepository['renewTicket']>[1]): Promise<InternalAsset> {
    return parseAsset(await this.rpc('renew_asset_upload_ticket', {
      p_actor_user_id: actor.userId,
      p_asset_id: input.assetId,
      p_operation_id: input.operationId,
      p_request_hash: input.requestHash,
      p_ticket_expires_at: input.ticketExpiresAt,
    }))
  }

  async claimValidation(actor: Actor, input: Parameters<AssetRepository['claimValidation']>[1]): Promise<ClaimedAsset> {
    const parsed = claimedAssetSchema.safeParse(await this.rpc('claim_asset_validation', {
      p_actor_user_id: actor.userId,
      p_asset_id: input.assetId,
      p_operation_id: input.operationId,
      p_request_hash: input.requestHash,
      p_lease_until: input.leaseUntil,
    }))
    if (!parsed.success) {
      throw new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'ฐานข้อมูลคืน validation lease ไม่ถูกต้อง')
    }
    return parsed.data as ClaimedAsset
  }

  async finalizeValidation(actor: Actor, input: Parameters<AssetRepository['finalizeValidation']>[1]): Promise<InternalAsset> {
    return parseAsset(await this.rpc('finalize_asset_validation', {
      p_actor_user_id: actor.userId,
      p_asset_id: input.assetId,
      p_operation_id: input.operationId,
      p_request_hash: input.requestHash,
      p_fencing_version: input.fencingVersion,
      p_object_key: input.objectKey,
      p_mime_type: input.mimeType,
      p_byte_size: input.byteSize,
      p_sha256: input.sha256,
      p_width: input.width,
      p_height: input.height,
    }))
  }

  async rejectValidation(actor: Actor, input: Parameters<AssetRepository['rejectValidation']>[1]): Promise<InternalAsset> {
    return parseAsset(await this.rpc('reject_asset_validation', {
      p_actor_user_id: actor.userId,
      p_asset_id: input.assetId,
      p_operation_id: input.operationId,
      p_request_hash: input.requestHash,
      p_fencing_version: input.fencingVersion,
      p_rejection_code: input.rejectionCode,
    }))
  }

  async get(actor: Actor, assetId: string): Promise<InternalAsset> {
    return parseAsset(await this.rpc('get_asset', {
      p_actor_user_id: actor.userId,
      p_asset_id: assetId,
    }))
  }

  async getForDownload(actor: Actor, assetIds: string[]): Promise<Array<ReadyAssetMetadata & { objectKey: string }>> {
    const parsed = downloadRowSchema.array().safeParse(await this.rpc('get_assets_for_download', {
      p_actor_user_id: actor.userId,
      p_asset_ids: assetIds,
    }))
    if (!parsed.success) {
      throw new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'ฐานข้อมูลคืนข้อมูลดาวน์โหลดไม่ถูกต้อง')
    }
    return parsed.data.map((row) => ({
      id: row.asset_id,
      workspaceId: row.workspace_id,
      purpose: row.purpose,
      state: 'ready' as const,
      objectKey: row.object_key,
      mimeType: row.mime_type,
      byteSize: row.byte_size,
      sha256: row.sha256,
      width: row.width,
      height: row.height,
      createdAt: row.created_at,
    }))
  }
}

class SupabaseObjectStorage implements ObjectStorage {
  constructor(private readonly client: SupabaseClient) {}

  async createUploadTicket(key: string): Promise<{ url: string }> {
    const { data, error } = await this.client.storage
      .from('packit-staging')
      .createSignedUploadUrl(key, { upsert: false })
    if (error || !data) {
      throw new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'ออก upload ticket ไม่สำเร็จ')
    }
    return { url: data.signedUrl }
  }

  async download(key: string): Promise<Buffer> {
    const { data, error } = await this.client.storage.from('packit-staging').download(key)
    if (error || !data) {
      const status = Number((error as { statusCode?: string | number } | null)?.statusCode)
      if (status === 404 || error?.message.toLowerCase().includes('not found')) {
        throw new StorageObjectMissingError()
      }
      throw new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'อ่านไฟล์ที่อัปโหลดไม่สำเร็จ')
    }
    return Buffer.from(await data.arrayBuffer())
  }

  async putImmutable(key: string, bytes: Buffer, mimeType: 'image/png' | 'image/jpeg'): Promise<void> {
    const { error } = await this.client.storage.from('packit-assets').upload(key, bytes, {
      contentType: mimeType,
      cacheControl: '31536000',
      upsert: false,
    })
    if (error) {
      throw new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'เขียน immutable asset ไม่สำเร็จ')
    }
  }

  async signDownload(key: string, expiresInSeconds: number): Promise<{ url: string }> {
    const { data, error } = await this.client.storage
      .from('packit-assets')
      .createSignedUrl(key, expiresInSeconds)
    if (error || !data) {
      throw new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'ออก download ticket ไม่สำเร็จ')
    }
    return { url: data.signedUrl }
  }

  async remove(key: string): Promise<void> {
    const { error } = await this.client.storage.from('packit-staging').remove([key])
    if (error) throw error
  }
}

export function createSupabaseAssetService(
  config: NonNullable<ServerConfig['supabase']>,
): AssetService {
  const client = createClient(config.url, config.secretKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  })
  return new AssetService(new SupabaseAssetRepository(client), new SupabaseObjectStorage(client))
}
