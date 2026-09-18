import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js'
import type {
  CloudProject,
  CreateProjectInput,
  DeleteProjectInput,
  DeleteReceipt,
  LegacyImportInput,
  LegacyImportReceipt,
  ProjectPage,
  SaveProjectInput,
  SaveReceipt,
} from '../../../shared/contracts/projects'
import { HttpError } from '../../http/errors'
import type { Actor } from '../../modules/identity/actor'
import type { ServerConfig } from '../../config'
import { encodeProjectCursor } from '../../modules/projects/canonical'
import type { ProjectListQuery, ProjectRepository } from '../../modules/projects/projectRepository'
import {
  cloudProjectSchema,
  deleteReceiptSchema,
  legacyImportReceiptSchema,
  projectListRowSchema,
  saveReceiptSchema,
} from '../../modules/projects/validation'

function mapDatabaseError(error: PostgrestError): HttpError {
  if (error.message.includes('ASSET_NOT_READY')) {
    return new HttpError(422, 'ASSET_NOT_READY', 'รูปที่อ้างถึงยังไม่พร้อมใช้งาน')
  }
  if (error.message.includes('IDEMPOTENCY_KEY_REUSED')) {
    return new HttpError(409, 'IDEMPOTENCY_KEY_REUSED', 'operationId นี้ถูกใช้กับข้อมูลอื่นแล้ว')
  }
  if (error.message.includes('LEGACY_SOURCE_CHANGED')) {
    return new HttpError(409, 'LEGACY_SOURCE_CHANGED', 'ข้อมูลต้นทางเดิมถูกแก้ไขหลังเริ่มย้ายข้อมูล')
  }
  if (error.message.includes('REVISION_CONFLICT')) {
    const currentRevision = Number(error.details)
    return new HttpError(
      409,
      'REVISION_CONFLICT',
      'งานนี้ถูกแก้ไขจากอีกหน้าต่าง',
      Number.isSafeInteger(currentRevision) ? { currentRevision } : undefined,
    )
  }
  if (error.message.includes('PROJECT_NOT_FOUND')) {
    return new HttpError(404, 'NOT_FOUND', 'ไม่พบโปรเจกต์นี้')
  }
  if (error.message.includes('APP_USER_NOT_ACTIVE')) {
    return new HttpError(403, 'USER_NOT_ACTIVE', 'บัญชีนี้ไม่พร้อมใช้งาน')
  }
  return new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'ฐานข้อมูลโปรเจกต์ไม่พร้อมใช้งาน')
}

function providerContractError(): HttpError {
  return new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'ฐานข้อมูลคืนข้อมูลโปรเจกต์ไม่ถูกต้อง')
}

export class SupabaseProjectRepository implements ProjectRepository {
  constructor(private readonly client: SupabaseClient) {}

  async list(actor: Actor, query: ProjectListQuery): Promise<ProjectPage> {
    const { data, error } = await this.client.rpc('list_projects', {
      p_actor_user_id: actor.userId,
      p_workspace_id: query.workspaceId,
      p_cursor_updated_at: query.cursor?.updatedAt ?? null,
      p_cursor_id: query.cursor?.id ?? null,
      p_limit: query.limit + 1,
    })
    if (error) throw mapDatabaseError(error)
    const parsed = projectListRowSchema.array().safeParse(data)
    if (!parsed.success) throw providerContractError()
    const hasMore = parsed.data.length > query.limit
    const rows = parsed.data.slice(0, query.limit)
    const items = rows.map((row) => ({
      id: row.project_id,
      workspaceId: row.workspace_id,
      name: row.project_name,
      revision: row.project_revision,
      updatedAt: row.project_updated_at,
    }))
    const last = hasMore ? items.at(-1) : undefined
    return {
      items,
      nextCursor: last ? encodeProjectCursor({ updatedAt: last.updatedAt, id: last.id }) : null,
    }
  }

  async get(actor: Actor, projectId: string): Promise<CloudProject> {
    const { data, error } = await this.client.rpc('get_project', {
      p_actor_user_id: actor.userId,
      p_project_id: projectId,
    })
    if (error) throw mapDatabaseError(error)
    const parsed = cloudProjectSchema.safeParse(data)
    if (!parsed.success) throw providerContractError()
    return parsed.data as CloudProject
  }

  async create(actor: Actor, input: CreateProjectInput, hash: string): Promise<CloudProject> {
    const { data, error } = await this.client.rpc('create_project', {
      p_actor_user_id: actor.userId,
      p_workspace_id: input.workspaceId,
      p_operation_id: input.operationId,
      p_request_hash: hash,
      p_name: input.name,
      p_document_schema_version: input.documentSchemaVersion,
      p_document: input.document,
    })
    if (error) throw mapDatabaseError(error)
    const parsed = cloudProjectSchema.safeParse(data)
    if (!parsed.success) throw providerContractError()
    return parsed.data as CloudProject
  }

  async importLegacy(actor: Actor, input: LegacyImportInput, hash: string): Promise<LegacyImportReceipt> {
    const { data, error } = await this.client.rpc('import_legacy_project', {
      p_actor_user_id: actor.userId,
      p_workspace_id: input.workspaceId,
      p_operation_id: input.operationId,
      p_request_hash: hash,
      p_source_installation_id: input.sourceInstallationId,
      p_source_project_key: input.sourceProjectKey,
      p_source_hash: input.sourceHash,
      p_name: input.name,
      p_document_schema_version: input.documentSchemaVersion,
      p_document: input.document,
    })
    if (error) throw mapDatabaseError(error)
    const parsed = legacyImportReceiptSchema.safeParse(data)
    if (!parsed.success) throw providerContractError()
    return parsed.data as LegacyImportReceipt
  }

  async save(actor: Actor, input: SaveProjectInput, hash: string): Promise<SaveReceipt> {
    const { data, error } = await this.client.rpc('save_project', {
      p_actor_user_id: actor.userId,
      p_project_id: input.projectId,
      p_operation_id: input.operationId,
      p_request_hash: hash,
      p_expected_revision: input.expectedRevision,
      p_name: input.name,
      p_document_schema_version: input.documentSchemaVersion,
      p_document: input.document,
    })
    if (error) throw mapDatabaseError(error)
    const parsed = saveReceiptSchema.safeParse(data)
    if (!parsed.success) throw providerContractError()
    return parsed.data
  }

  async remove(actor: Actor, input: DeleteProjectInput, hash: string): Promise<DeleteReceipt> {
    const { data, error } = await this.client.rpc('delete_project', {
      p_actor_user_id: actor.userId,
      p_project_id: input.projectId,
      p_operation_id: input.operationId,
      p_request_hash: hash,
      p_expected_revision: input.expectedRevision,
    })
    if (error) throw mapDatabaseError(error)
    const parsed = deleteReceiptSchema.safeParse(data)
    if (!parsed.success) throw providerContractError()
    return parsed.data
  }
}

export function createSupabaseProjectRepository(
  config: NonNullable<ServerConfig['supabase']>,
): ProjectRepository {
  const client = createClient(config.url, config.secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })
  return new SupabaseProjectRepository(client)
}
