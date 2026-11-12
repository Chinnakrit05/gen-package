import type { ZodType } from 'zod'
import type { Actor } from '../modules/identity/actor'
import type { ActorAuthenticationOptions } from '../modules/identity/sessionService'
import type { ConversationRepository } from '../modules/conversations/conversationRepository'
import * as v from '../modules/conversations/validation'
import { HttpError } from './errors'
const paths = [
  ['list', /^\/api\/v1\/marketplace\/conversations$/, ['GET', 'POST']],
  ['get', /^\/api\/v1\/marketplace\/conversations\/([^/]+)$/, ['GET']],
  ['messages', /^\/api\/v1\/marketplace\/conversations\/([^/]+)\/messages$/, ['GET', 'POST']],
  ['read', /^\/api\/v1\/marketplace\/conversations\/([^/]+)\/read$/, ['POST']],
  ['upload', /^\/api\/v1\/marketplace\/conversations\/([^/]+)\/files$/, ['POST']],
  ['download', /^\/api\/v1\/marketplace\/conversations\/([^/]+)\/files\/([^/]+)$/, ['GET']],
] as const
interface ConversationRoute { kind: typeof paths[number][0]; methods: readonly string[]; id?: string; fileId?: string }
export function matchConversationRoute(path: string): ConversationRoute | null {
  for (const [kind, pattern, methods] of paths) { const m = pattern.exec(path); if (m) return { kind, methods, id: m[1], fileId: m[2] } }
  return null
}
function parse<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new HttpError(422, 'VALIDATION_ERROR', 'ข้อมูลการสนทนาไม่ถูกต้อง')
  return parsed.data
}
export async function serveConversationRoute(route: ConversationRoute, request: { method: string; query: URLSearchParams; authenticate(options: ActorAuthenticationOptions): Promise<Actor>; readBody(maxBytes?: number): Promise<unknown> }, repository: ConversationRepository): Promise<{ status: number; data: unknown }> {
  if (!route.methods.includes(request.method)) throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method นี้ใช้กับ endpoint ไม่ได้')
  const actor = await request.authenticate({ verifyMfa: false })
  const query = Object.fromEntries(request.query)
  if (Object.keys(query).length !== request.query.size) throw new HttpError(422, 'VALIDATION_ERROR', 'query parameter ต้องไม่ซ้ำ')
  if (route.kind === 'list') {
    if (request.method === 'GET') return { status: 200, data: await repository.list(actor, parse(v.conversationListQuery, query).after ?? null) }
    return { status: 200, data: await repository.ensure(actor, parse(v.ensureConversationInput, await request.readBody())) }
  }
  const id = parse(v.conversationId, route.id)
  switch (route.kind) {
    case 'get': return { status: 200, data: await repository.get(actor, id) }
    case 'messages':
      if (request.method === 'GET') return { status: 200, data: await repository.messages(actor, id, parse(v.messageListQuery, query).before ?? null) }
      return { status: 201, data: await repository.send(actor, id, parse(v.sendMessageInput, await request.readBody())) }
    case 'read': return { status: 200, data: await repository.read(actor, id, parse(v.readConversationInput, await request.readBody()).sequence) }
    case 'upload': return { status: 201, data: await repository.upload(actor, id, parse(v.uploadFileInput, await request.readBody(2900000))) }
    case 'download': return { status: 200, data: await repository.download(actor, id, parse(v.conversationId, route.fileId)) }
  }
}
