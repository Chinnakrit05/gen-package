import { z } from 'zod'
import type { SupabaseAdminRepository } from '../adapters/supabase/adminRepository'
import type { Actor } from '../modules/identity/actor'
import type { ActorAuthenticationOptions } from '../modules/identity/sessionService'
import { adminSearchQuery, adminPageQuery, createSupportCaseSchema, closeSupportCaseSchema, supportAccessSchema, supportFileAccessSchema, adminUserQuery, adminUserStatusSchema, adminMaintenanceSchema } from '../modules/admin/validation'
import { HttpError } from './errors'
const routes = [
 ['users', /^\/api\/v1\/admin\/users$/, ['GET']],
 ['userStatus', /^\/api\/v1\/admin\/users\/([^/]+)\/status$/, ['POST']],
 ['maintenance', /^\/api\/v1\/admin\/maintenance$/, ['POST']],
 ['context', /^\/api\/v1\/admin\/context$/, ['GET']],
 ['dashboard', /^\/api\/v1\/admin\/dashboard$/, ['GET']],
 ['search', /^\/api\/v1\/admin\/search$/, ['GET']],
 ['cases', /^\/api\/v1\/admin\/support-cases$/, ['GET', 'POST']],
 ['closeCase', /^\/api\/v1\/admin\/support-cases\/([^/]+)\/close$/, ['POST']],
 ['access', /^\/api\/v1\/admin\/support-cases\/([^/]+)\/access$/, ['POST']],
 ['file', /^\/api\/v1\/admin\/support-cases\/([^/]+)\/files\/([^/]+)\/access$/, ['POST']],
 ['audit', /^\/api\/v1\/admin\/audit-log$/, ['GET']],
] as const
export function matchAdminRoute(path: string) {
 for (const [kind, pattern, methods] of routes) { const match = pattern.exec(path); if (match) return { kind, methods: methods as readonly string[], params: match.slice(1) } }
 return null
}
export async function serveAdminRoute(route: NonNullable<ReturnType<typeof matchAdminRoute>>, request: { method: string; query: URLSearchParams; authenticate(options: ActorAuthenticationOptions): Promise<Actor>; readBody(): Promise<unknown> }, repository: SupabaseAdminRepository) {
 const actor = await request.authenticate({ verifyMfa: true })
 if (route.kind === 'context') { const context = await repository.context(actor.userId); return { status: 200, data: { ...context, requiresMfa: context.scopes.length > 0 && actor.hasVerifiedMfa !== true } } }
 if (actor.hasVerifiedMfa !== true) throw new HttpError(403, 'MARKETPLACE_MFA_REQUIRED', 'ยืนยันตัวตนสองขั้นตอนก่อนใช้งานหน้าแอดมิน')
 const query = Object.fromEntries(request.query)
 if (Object.keys(query).length !== request.query.size) throw new HttpError(422, 'VALIDATION_ERROR', 'query parameter ต้องไม่ซ้ำ')
 if (route.kind === 'users') { const q = adminUserQuery.parse(query); return { status: 200, data: await repository.users(actor.userId, q.q, q.cursor ?? null) } }
 if (route.kind === 'userStatus') return { status: 200, data: await repository.userStatus(actor.userId, z.string().uuid().parse(route.params[0]), adminUserStatusSchema.parse(await request.readBody())) }
 if (route.kind === 'maintenance') return { status: 200, data: await repository.maintenance(actor.userId, adminMaintenanceSchema.parse(await request.readBody())) }
 if (route.kind === 'dashboard') { z.object({}).strict().parse(query); return { status: 200, data: await repository.dashboard(actor.userId) } }
 if (route.kind === 'search') { const q = adminSearchQuery.parse(query); return { status: 200, data: await repository.search(actor.userId, q.q, q.kind, q.cursor ?? null) } }
 if (route.kind === 'audit') { const q = adminPageQuery.parse(query); return { status: 200, data: await repository.audit(actor.userId, q.cursor ?? null) } }
 if (route.kind === 'cases') {
  if (request.method === 'GET') { const q = adminPageQuery.parse(query); return { status: 200, data: await repository.cases(actor.userId, q.cursor ?? null) } }
  return { status: 201, data: await repository.createCase(actor.userId, createSupportCaseSchema.parse(await request.readBody())) }
 }
 const id = z.string().uuid().parse(route.params[0])
 if (route.kind === 'closeCase') return { status: 200, data: await repository.closeCase(actor.userId, id, closeSupportCaseSchema.parse(await request.readBody())) }
 if (route.kind === 'access') return { status: 200, data: await repository.accessCase(actor.userId, id, supportAccessSchema.parse(await request.readBody())) }
 const fileId = z.string().uuid().parse(route.params[1])
 const { reason } = supportFileAccessSchema.parse(await request.readBody())
 return { status: 200, data: await repository.accessFile(actor.userId, id, fileId, reason) }
}
