import { randomUUID } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'
import { ZodError } from 'zod'
import type { ApiSuccess } from '../../shared/contracts/http'
import type { SessionBootstrapData } from '../../shared/contracts/auth'
import type { HealthData } from '../../shared/contracts/system'
import type { DeleteProjectInput, SaveProjectInput } from '../../shared/contracts/projects'
import { createSupabaseAssetService } from '../adapters/supabase/assetService'
import { createSupabaseProjectRepository } from '../adapters/supabase/projectRepository'
import { createSupabaseSessionService } from '../adapters/supabase/sessionService'
import type { ServerConfig } from '../config'
import type { SessionService } from '../modules/identity/sessionService'
import { AssetService } from '../modules/assets/assetService'
import { AiProviderError, AnthropicAiService, type AiService } from '../modules/ai/aiService'
import { readRequestApiKey } from '../modules/ai/requestApiKey'
import { parseCurrent, parseImage } from '../boxSpec'
import {
  assetDownloadRequestSchema,
  assetIdSchema,
  assetOperationSchema,
  createAssetUploadIntentSchema,
} from '../modules/assets/validation'
import { decodeProjectCursor } from '../modules/projects/canonical'
import { ProjectService } from '../modules/projects/projectService'
import {
  createProjectInputSchema,
  expectedRevisionSchema,
  legacyImportInputSchema,
  operationIdSchema,
  projectIdSchema,
  projectListQuerySchema,
  saveProjectInputSchema,
} from '../modules/projects/validation'
import { readJsonBody } from './body'
import { HttpError, toApiFailure } from './errors'

export interface HttpRequest {
  method?: string
  url?: string
  headers: IncomingHttpHeaders
  body?: unknown
  raw?: AsyncIterable<unknown>
}

export interface HttpResponse {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body?: string): void
}

export type ApiHandler = (req: HttpRequest, res: HttpResponse) => Promise<void>

export interface ApiRouterDependencies {
  sessionService?: SessionService | null
  projectService?: ProjectService | null
  assetService?: AssetService | null
  aiService?: AiService | null
}

function requestPath(req: HttpRequest): string {
  try {
    return new URL(req.url ?? '/', 'http://packit.local').pathname.replace(/\/+$/, '') || '/'
  } catch {
    return '/'
  }
}

function requestUrl(req: HttpRequest): URL {
  try {
    return new URL(req.url ?? '/', 'http://packit.local')
  } catch {
    throw new HttpError(400, 'INVALID_REQUEST', 'URL ของคำขอไม่ถูกต้อง')
  }
}

function sendJson(res: HttpResponse, status: number, body: unknown, requestId: string): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-request-id', requestId)
  res.end(JSON.stringify(body))
}

function bearerToken(req: HttpRequest): string {
  const raw = req.headers.authorization
  if (typeof raw !== 'string') {
    throw new HttpError(401, 'AUTH_REQUIRED', 'ต้องเข้าสู่ระบบก่อนใช้งาน')
  }
  const match = /^Bearer\s+(\S+)$/i.exec(raw.trim())
  if (!match) throw new HttpError(401, 'SESSION_INVALID', 'Authorization header ไม่ถูกต้อง')
  return match[1]
}

function headerValue(req: HttpRequest, name: keyof IncomingHttpHeaders): string | undefined {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] : value
}

function requireJsonContentType(req: HttpRequest): void {
  const contentType = headerValue(req, 'content-type')
  if (!contentType || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'content-type ต้องเป็น application/json')
  }
}

function rejectDeleteBody(req: HttpRequest): void {
  const contentLength = Number(headerValue(req, 'content-length') ?? 0)
  if (req.body !== undefined || contentLength > 0 || headerValue(req, 'transfer-encoding')) {
    throw new HttpError(400, 'INVALID_REQUEST', 'DELETE endpoint นี้ไม่รับ body')
  }
}

function validationError(error: ZodError): HttpError {
  return new HttpError(422, 'VALIDATION_ERROR', 'ข้อมูลโปรเจกต์ไม่ถูกต้อง', {
    issues: error.issues.slice(0, 20).map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  })
}

function parseOrThrow<T>(result: { success: true; data: T } | { success: false; error: ZodError }): T {
  if (!result.success) throw validationError(result.error)
  return result.data
}

export function createApiRouter(config: ServerConfig, dependencies: ApiRouterDependencies = {}): ApiHandler {
  const sessionService = dependencies.sessionService === undefined
    ? config.supabase && createSupabaseSessionService(config.supabase)
    : dependencies.sessionService
  const projectService = dependencies.projectService === undefined
    ? config.supabase && new ProjectService(createSupabaseProjectRepository(config.supabase))
    : dependencies.projectService
  const assetService = dependencies.assetService === undefined
    ? config.supabase && createSupabaseAssetService(config.supabase)
    : dependencies.assetService
  const aiService = dependencies.aiService === undefined ? new AnthropicAiService() : dependencies.aiService

  return async (req, res) => {
    const requestId = randomUUID()
    const path = requestPath(req)

    if (path === '/api/v1/health') {
      if (req.method !== 'GET') {
        res.setHeader('allow', 'GET')
        const error = new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method นี้ใช้กับ endpoint ไม่ได้')
        sendJson(res, error.status, toApiFailure(error, requestId), requestId)
        return
      }
      const body: ApiSuccess<HealthData> = { data: { status: 'ok' }, requestId }
      sendJson(res, 200, body, requestId)
      return
    }

    if (path === '/api/v1/session/bootstrap') {
      if (req.method !== 'POST') {
        res.setHeader('allow', 'POST')
        const error = new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method นี้ใช้กับ endpoint ไม่ได้')
        sendJson(res, error.status, toApiFailure(error, requestId), requestId)
        return
      }
      try {
        if (!sessionService) {
          throw new HttpError(503, 'CONFIGURATION_ERROR', 'Server ยังไม่ได้ตั้งค่า Supabase')
        }
        const token = bearerToken(req)
        const data = await sessionService.bootstrap(token, requestId)
        const body: ApiSuccess<SessionBootstrapData> = { data, requestId }
        sendJson(res, 200, body, requestId)
      } catch (error) {
        const httpError = error instanceof HttpError
          ? error
          : new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'ตรวจสอบ session ไม่สำเร็จ')
        sendJson(res, httpError.status, toApiFailure(httpError, requestId), requestId)
      }
      return
    }

    if (path === '/api/v1/me') {
      try {
        if (req.method !== 'GET') {
          res.setHeader('allow', 'GET')
          throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method นี้ใช้กับ endpoint ไม่ได้')
        }
        if (!sessionService) {
          throw new HttpError(503, 'CONFIGURATION_ERROR', 'Server ยังไม่ได้ตั้งค่า Supabase')
        }
        const actor = await sessionService.authenticate(bearerToken(req), requestId)
        const data = await sessionService.getMe(actor)
        sendJson(res, 200, { data, requestId }, requestId)
      } catch (error) {
        const httpError = error instanceof HttpError
          ? error
          : new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'โหลดข้อมูลบัญชีไม่สำเร็จ')
        sendJson(res, httpError.status, toApiFailure(httpError, requestId), requestId)
      }
      return
    }

    if (path === '/api/v1/ai/box-spec') {
      try {
        if (req.method !== 'POST') {
          res.setHeader('allow', 'POST')
          throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method นี้ใช้กับ endpoint ไม่ได้')
        }
        if (!sessionService || !aiService) {
          throw new HttpError(503, 'CONFIGURATION_ERROR', 'Server ยังไม่ได้ตั้งค่า AI หรือ Supabase')
        }
        requireJsonContentType(req)
        await sessionService.authenticate(bearerToken(req), requestId)

        const apiKey = readRequestApiKey(req.headers)
        if (apiKey === undefined) {
          throw new HttpError(422, 'AI_API_KEY_REQUIRED', 'กรุณาใส่ Anthropic API key')
        }
        if (apiKey === null) {
          throw new HttpError(400, 'AI_API_KEY_INVALID', 'รูปแบบ Anthropic API key ไม่ถูกต้อง')
        }

        const body = await readJsonBody(req, 6 * 1024 * 1024)
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
          throw new HttpError(422, 'VALIDATION_ERROR', 'ข้อมูล AI ไม่ถูกต้อง')
        }
        const input = body as Record<string, unknown>
        const allowedKeys = new Set(['prompt', 'current', 'image'])
        if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
          throw new HttpError(422, 'VALIDATION_ERROR', 'ข้อมูล AI มี field ที่ไม่รองรับ')
        }
        if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 2000) {
          throw new HttpError(422, 'VALIDATION_ERROR', 'prompt ต้องเป็นข้อความ 1-2000 ตัวอักษร')
        }
        const current = parseCurrent(input.current)
        if (input.current !== undefined && !current) {
          throw new HttpError(422, 'VALIDATION_ERROR', 'สเปกปัจจุบันไม่ถูกต้อง')
        }
        const image = parseImage(input.image)
        if (input.image !== undefined && !image) {
          throw new HttpError(422, 'VALIDATION_ERROR', 'รูปอ้างอิงไม่ถูกต้องหรือใหญ่เกินไป')
        }

        const data = await aiService.generateBoxSpec(apiKey, {
          prompt: input.prompt.trim(),
          ...(current ? { current } : {}),
          ...(image ? { image } : {}),
        })
        sendJson(res, 200, { data, requestId }, requestId)
      } catch (error) {
        let httpError: HttpError
        if (error instanceof HttpError) httpError = error
        else if (error instanceof AiProviderError && error.kind === 'authentication') {
          httpError = new HttpError(401, 'AI_API_KEY_INVALID', 'Anthropic API key ไม่ถูกต้อง')
        } else if (error instanceof AiProviderError && error.kind === 'rate-limit') {
          httpError = new HttpError(429, 'AI_RATE_LIMITED', 'เรียก AI ถี่เกินไป รอสักครู่แล้วลองใหม่')
        } else {
          httpError = new HttpError(502, 'AI_PROVIDER_UNAVAILABLE', 'บริการ AI ขัดข้อง ลองใหม่อีกครั้ง')
        }
        sendJson(res, httpError.status, toApiFailure(httpError, requestId), requestId)
      }
      return
    }

    if (path === '/api/v1/projects') {
      try {
        if (!sessionService || !projectService) {
          throw new HttpError(503, 'CONFIGURATION_ERROR', 'Server ยังไม่ได้ตั้งค่า Supabase')
        }
        const actor = await sessionService.authenticate(bearerToken(req), requestId)

        if (req.method === 'GET') {
          const url = requestUrl(req)
          const allowedQuery = new Set(['workspaceId', 'cursor', 'limit'])
          if ([...url.searchParams.keys()].some((key) => !allowedQuery.has(key))) {
            throw new HttpError(422, 'VALIDATION_ERROR', 'query parameter ไม่ถูกต้อง')
          }
          if ([...allowedQuery].some((key) => url.searchParams.getAll(key).length > 1)) {
            throw new HttpError(422, 'VALIDATION_ERROR', 'query parameter ต้องไม่ซ้ำ')
          }
          const query = parseOrThrow(projectListQuerySchema.safeParse({
            workspaceId: url.searchParams.get('workspaceId') ?? undefined,
            cursor: url.searchParams.get('cursor') ?? undefined,
            limit: url.searchParams.get('limit') ?? undefined,
          }))
          let cursor = null
          if (query.cursor) {
            try {
              cursor = decodeProjectCursor(query.cursor)
            } catch {
              throw new HttpError(422, 'VALIDATION_ERROR', 'cursor ไม่ถูกต้อง')
            }
          }
          const data = await projectService.list(actor, {
            workspaceId: query.workspaceId,
            cursor,
            limit: query.limit,
          })
          sendJson(res, 200, { data, requestId }, requestId)
          return
        }

        if (req.method === 'POST') {
          requireJsonContentType(req)
          const input = parseOrThrow(createProjectInputSchema.safeParse(await readJsonBody(req)))
          const data = await projectService.create(actor, input)
          sendJson(res, 201, { data, requestId }, requestId)
          return
        }

        res.setHeader('allow', 'GET, POST')
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method นี้ใช้กับ endpoint ไม่ได้')
      } catch (error) {
        const httpError = error instanceof HttpError
          ? error
          : new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'ดำเนินการกับโปรเจกต์ไม่สำเร็จ')
        sendJson(res, httpError.status, toApiFailure(httpError, requestId), requestId)
      }
      return
    }

    if (path === '/api/v1/projects/import-legacy') {
      try {
        if (req.method !== 'POST') {
          res.setHeader('allow', 'POST')
          throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method นี้ใช้กับ endpoint ไม่ได้')
        }
        if (!sessionService || !projectService) {
          throw new HttpError(503, 'CONFIGURATION_ERROR', 'Server ยังไม่ได้ตั้งค่า Supabase')
        }
        requireJsonContentType(req)
        const actor = await sessionService.authenticate(bearerToken(req), requestId)
        const input = parseOrThrow(legacyImportInputSchema.safeParse(await readJsonBody(req)))
        const data = await projectService.importLegacy(actor, input)
        sendJson(res, 200, { data, requestId }, requestId)
      } catch (error) {
        const httpError = error instanceof HttpError
          ? error
          : new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'ย้ายโปรเจกต์เดิมไม่สำเร็จ')
        sendJson(res, httpError.status, toApiFailure(httpError, requestId), requestId)
      }
      return
    }

    if (path === '/api/v1/assets/upload-intents' || path === '/api/v1/assets/download-tickets') {
      try {
        if (req.method !== 'POST') {
          res.setHeader('allow', 'POST')
          throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method นี้ใช้กับ endpoint ไม่ได้')
        }
        if (!sessionService || !assetService) {
          throw new HttpError(503, 'CONFIGURATION_ERROR', 'Server ยังไม่ได้ตั้งค่า Supabase')
        }
        requireJsonContentType(req)
        const actor = await sessionService.authenticate(bearerToken(req), requestId)
        if (path.endsWith('/upload-intents')) {
          const input = parseOrThrow(createAssetUploadIntentSchema.safeParse(await readJsonBody(req)))
          const data = await assetService.createIntent(actor, input)
          sendJson(res, 201, { data, requestId }, requestId)
        } else {
          const input = parseOrThrow(assetDownloadRequestSchema.safeParse(await readJsonBody(req)))
          const data = await assetService.createDownloadTickets(actor, input.assetIds)
          sendJson(res, 200, { data, requestId }, requestId)
        }
      } catch (error) {
        const httpError = error instanceof HttpError
          ? error
          : new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'ดำเนินการกับไฟล์รูปไม่สำเร็จ')
        sendJson(res, httpError.status, toApiFailure(httpError, requestId), requestId)
      }
      return
    }

    const assetActionMatch = /^\/api\/v1\/assets\/([^/]+)(?:\/(complete|upload-ticket))?$/.exec(path)
    if (assetActionMatch) {
      try {
        if (!sessionService || !assetService) {
          throw new HttpError(503, 'CONFIGURATION_ERROR', 'Server ยังไม่ได้ตั้งค่า Supabase')
        }
        const action = assetActionMatch[2]
        const expectedMethod = action ? 'POST' : 'GET'
        if (req.method !== expectedMethod) {
          res.setHeader('allow', expectedMethod)
          throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method นี้ใช้กับ endpoint ไม่ได้')
        }
        const actor = await sessionService.authenticate(bearerToken(req), requestId)
        const assetId = parseOrThrow(assetIdSchema.safeParse(assetActionMatch[1]))
        if (!action) {
          const data = await assetService.get(actor, assetId)
          sendJson(res, 200, { data, requestId }, requestId)
          return
        }
        requireJsonContentType(req)
        const body = parseOrThrow(assetOperationSchema.safeParse(await readJsonBody(req)))
        if (action === 'upload-ticket') {
          const data = await assetService.renewTicket(actor, { assetId, operationId: body.operationId })
          sendJson(res, 200, { data, requestId }, requestId)
        } else {
          const data = await assetService.complete(actor, { assetId, operationId: body.operationId })
          sendJson(res, data.state === 'validating' ? 202 : 200, { data, requestId }, requestId)
        }
      } catch (error) {
        const httpError = error instanceof HttpError
          ? error
          : new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'ดำเนินการกับไฟล์รูปไม่สำเร็จ')
        sendJson(res, httpError.status, toApiFailure(httpError, requestId), requestId)
      }
      return
    }

    const projectMatch = /^\/api\/v1\/projects\/([^/]+)$/.exec(path)
    if (projectMatch) {
      try {
        if (!sessionService || !projectService) {
          throw new HttpError(503, 'CONFIGURATION_ERROR', 'Server ยังไม่ได้ตั้งค่า Supabase')
        }
        const actor = await sessionService.authenticate(bearerToken(req), requestId)
        const projectId = parseOrThrow(projectIdSchema.safeParse(projectMatch[1]))

        if (req.method === 'GET') {
          const data = await projectService.get(actor, projectId)
          sendJson(res, 200, { data, requestId }, requestId)
          return
        }

        if (req.method === 'PUT') {
          requireJsonContentType(req)
          const body = parseOrThrow(saveProjectInputSchema.safeParse(await readJsonBody(req)))
          const input: SaveProjectInput = { projectId, ...body }
          const data = await projectService.save(actor, input)
          sendJson(res, 200, { data, requestId }, requestId)
          return
        }

        if (req.method === 'DELETE') {
          rejectDeleteBody(req)
          const ifMatch = headerValue(req, 'if-match')
          const match = ifMatch && /^"([1-9]\d*)"$/.exec(ifMatch.trim())
          if (!match) throw new HttpError(422, 'VALIDATION_ERROR', 'If-Match ต้องเป็น revision ในเครื่องหมายคำพูด')
          const expectedRevision = parseOrThrow(expectedRevisionSchema.safeParse(match[1]))
          const operationId = parseOrThrow(operationIdSchema.safeParse(headerValue(req, 'idempotency-key')))
          const input: DeleteProjectInput = { projectId, operationId, expectedRevision }
          const data = await projectService.remove(actor, input)
          sendJson(res, 200, { data, requestId }, requestId)
          return
        }

        res.setHeader('allow', 'GET, PUT, DELETE')
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method นี้ใช้กับ endpoint ไม่ได้')
      } catch (error) {
        const httpError = error instanceof HttpError
          ? error
          : new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'ดำเนินการกับโปรเจกต์ไม่สำเร็จ')
        sendJson(res, httpError.status, toApiFailure(httpError, requestId), requestId)
      }
      return
    }

    const error = new HttpError(404, 'NOT_FOUND', 'ไม่พบ API endpoint นี้')
    sendJson(res, error.status, toApiFailure(error, requestId), requestId)
  }
}
