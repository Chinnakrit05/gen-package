import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { ZodType } from 'zod'
import type { ServerConfig } from '../../config'
import type { Actor } from '../../modules/identity/actor'
import type { ConversationRepository } from '../../modules/conversations/conversationRepository'
import type { EnsureConversationInput, SendConversationMessageInput, UploadConversationFileInput } from '../../../shared/contracts/conversations'
import * as v from '../../modules/conversations/validation'
import { HttpError } from '../../http/errors'
export class SupabaseConversationRepository implements ConversationRepository {
  constructor(private readonly client: SupabaseClient) {}
  private async rpc<T>(name: string, actor: Actor, args: Record<string, unknown>, schema: ZodType<T>): Promise<T> {
    const { data, error } = await this.client.rpc(name, { p_actor_user_id: actor.userId, ...args })
    if (error) {
      if (['MARKETPLACE_NOT_FOUND', 'CONVERSATION_NOT_FOUND'].includes(error.message)) throw new HttpError(404, 'NOT_FOUND', 'ไม่พบการสนทนานี้')
      if (error.message === 'MARKETPLACE_FORBIDDEN') throw new HttpError(403, 'MARKETPLACE_FORBIDDEN', 'คุณไม่มีสิทธิ์ส่งข้อความ')
      if (error.message === 'IDEMPOTENCY_KEY_REUSED') throw new HttpError(409, 'IDEMPOTENCY_KEY_REUSED', 'รหัสคำขอนี้ถูกใช้กับข้อมูลอื่นแล้ว')
      if (error.message === 'VALIDATION_ERROR') throw new HttpError(422, 'VALIDATION_ERROR', 'ข้อมูลการสนทนาไม่ถูกต้อง')
      if (error.message === 'CONVERSATION_FILE_LIMIT') throw new HttpError(409, 'STORAGE_QUOTA_EXCEEDED', 'ไฟล์ในห้องสนทนาถึงขีดจำกัดแล้ว')
      throw new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'การสนทนาไม่พร้อมใช้งาน')
    }
    const parsed = schema.safeParse(data)
    if (!parsed.success) throw new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'ข้อมูลการสนทนาไม่ถูกต้อง')
    return parsed.data
  }
  list(actor: Actor, after: string | null) { return this.rpc('marketplace_list_conversations', actor, { p_after: after }, v.conversationPage) }
  ensure(actor: Actor, input: EnsureConversationInput) { return this.rpc('marketplace_ensure_conversation', actor, { p_request_id: input.requestId, p_supplier_id: input.supplierId }, v.conversation) }
  get(actor: Actor, id: string) { return this.rpc('marketplace_get_conversation', actor, { p_conversation_id: id }, v.conversation) }
  messages(actor: Actor, id: string, before: number | null) { return this.rpc('marketplace_list_conversation_messages', actor, { p_conversation_id: id, p_before: before }, v.conversationMessagePage) }
  send(actor: Actor, id: string, input: SendConversationMessageInput) { return this.rpc('marketplace_send_conversation_message', actor, { p_conversation_id: id, p_operation_id: input.operationId, p_body: input.body, p_attachment_ids: input.attachmentIds }, v.conversationMessage) }
  read(actor: Actor, id: string, sequence: number) { return this.rpc('marketplace_read_conversation', actor, { p_conversation_id: id, p_sequence: sequence }, v.conversationRead) }
  upload(actor: Actor, id: string, input: UploadConversationFileInput) { return this.rpc('marketplace_upload_conversation_file', actor, { p_conversation_id: id, p_operation_id: input.operationId, p_name: input.name, p_mime_type: input.mimeType, p_data_base64: input.dataBase64 }, v.conversationFile) }
  download(actor: Actor, id: string, fileId: string) { return this.rpc('marketplace_download_conversation_file', actor, { p_conversation_id: id, p_file_id: fileId }, v.conversationFileDownload) }
}
export function createSupabaseConversationRepository(config: NonNullable<ServerConfig['supabase']>): ConversationRepository {
  return new SupabaseConversationRepository(createClient(config.url, config.secretKey, { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } }))
}
