import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { ZodType } from 'zod'
import type { ServerConfig } from '../../config'
import { HttpError } from '../../http/errors'
import { commerceDatabaseError } from './commerceRepository'
import { adminContextSchema, adminDashboardSchema, adminSearchPageSchema, supportCasePageSchema, supportCaseSchema, supportAccessResultSchema, supportFileSchema, adminAuditPageSchema, adminUserPageSchema, adminUserSchema, adminMaintenanceResultSchema } from '../../modules/admin/validation'
import type { CreateSupportCaseInput, CloseSupportCaseInput, SupportAccessInput, AdminUserStatusInput, AdminMaintenanceInput } from '../../../shared/contracts/admin'
export class SupabaseAdminRepository {
 constructor(private readonly client: SupabaseClient) {}
 private async rpc<T>(name: string, args: Record<string, unknown>, schema: ZodType<T>): Promise<T> {
  const { data, error } = await this.client.rpc(name, args)
  if (error) throw commerceDatabaseError(error)
  const parsed = schema.safeParse(data)
  if (!parsed.success) throw new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'ข้อมูลผู้ดูแลระบบไม่พร้อมใช้งาน')
  return parsed.data
 }
 users(actor: string, q: string, after: string | null) { return this.rpc('marketplace_admin_users', { p_actor: actor, p_query: q, p_after: after }, adminUserPageSchema) }
 userStatus(actor: string, user: string, input: AdminUserStatusInput) { return this.rpc('marketplace_admin_user_status', { p_actor: actor, p_user: user, p_input: input }, adminUserSchema) }
 maintenance(actor: string, input: AdminMaintenanceInput) { return this.rpc('marketplace_admin_maintenance', { p_actor: actor, p_input: input }, adminMaintenanceResultSchema) }
 context(actor: string) { return this.rpc('marketplace_admin_context', { p_actor: actor }, adminContextSchema) }
 dashboard(actor: string) { return this.rpc('marketplace_admin_dashboard', { p_actor: actor }, adminDashboardSchema) }
 search(actor: string, q: string, kind: string, after: string | null) { return this.rpc('marketplace_admin_search', { p_actor: actor, p_query: q, p_kind: kind, p_after: after }, adminSearchPageSchema) }
 cases(actor: string, after: string | null) { return this.rpc('marketplace_support_cases', { p_actor: actor, p_after: after }, supportCasePageSchema) }
 createCase(actor: string, input: CreateSupportCaseInput) { return this.rpc('marketplace_support_case_create', { p_actor: actor, p_input: input }, supportCaseSchema) }
 closeCase(actor: string, id: string, input: CloseSupportCaseInput) { return this.rpc('marketplace_support_case_close', { p_actor: actor, p_case: id, p_input: input }, supportCaseSchema) }
 accessCase(actor: string, id: string, input: SupportAccessInput) { return this.rpc('marketplace_support_access', { p_actor: actor, p_case: id, p_input: input }, supportAccessResultSchema) }
 accessFile(actor: string, id: string, file: string, reason: string) { return this.rpc('marketplace_support_file', { p_actor: actor, p_case: id, p_file: file, p_reason: reason }, supportFileSchema) }
 audit(actor: string, after: string | null) { return this.rpc('marketplace_admin_audit', { p_actor: actor, p_after: after }, adminAuditPageSchema) }
}
export function createSupabaseAdminRepository(config: NonNullable<ServerConfig['supabase']>) {
 return new SupabaseAdminRepository(createClient(config.url, config.secretKey, { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } }))
}
