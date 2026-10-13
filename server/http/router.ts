import { randomUUID } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'
import { ZodError } from 'zod'
import type { ApiSuccess } from '../../shared/contracts/http'
import type { SessionBootstrapData } from '../../shared/contracts/auth'
import type { HealthData } from '../../shared/contracts/system'
import type { DeleteProjectInput, SaveProjectInput } from '../../shared/contracts/projects'
import { createSupabaseAssetService } from '../adapters/supabase/assetService'
import { createSupabaseBillingRepository } from '../adapters/supabase/billingRepository'
import { createSupabaseProjectRepository } from '../adapters/supabase/projectRepository'
import { createSupabaseSessionService } from '../adapters/supabase/sessionService'
import type { ServerConfig } from '../config'
import type { SessionService } from '../modules/identity/sessionService'
import { AssetService } from '../modules/assets/assetService'
import { AiProviderError, AnthropicAiService, type AiService } from '../modules/ai/aiService'
import { parseCurrent, parseImage, type BoxSpecResult } from '../boxSpec'
import {
  assetDownloadRequestSchema,
  assetIdSchema,
  assetOperationSchema,
  createAssetUploadIntentSchema,
} from '../modules/assets/validation'
import { BillingService } from '../modules/billing/billingService'
import {
  aiBoxSpecRequestSchema,
  createOrderInputSchema,
  entitlementsQuerySchema,
  orderIdSchema,
} from '../modules/billing/validation'
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
  billingService?: BillingService | null
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

// POST ที่ไม่ต้องการข้อมูล: ยอมรับไม่มี body หรือ {} เท่านั้น (client บางตัวส่ง {} มาเสมอ)
async function rejectNonEmptyBody(req: HttpRequest): Promise<void> {
  const contentLength = Number(headerValue(req, 'content-length') ?? 0)
  if (req.body === undefined && contentLength <= 0 && !headerValue(req, 'transfer-encoding')) return
  requireJsonContentType(req)
  const body = await readJsonBody(req)
  if (typeof body !== 'object' || body === null || Array.isArray(body) || Object.keys(body).length > 0) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'endpoint นี้รับเฉพาะ body ว่างหรือ {}')
  }
}

function isDevFulfilEnvironment(config: ServerConfig): boolean {
  return config.appEnv === 'development' || config.appEnv === 'test'
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
  const aiService = dependencies.aiService === undefined
    ? new AnthropicAiService(config.ai?.model)
    : dependencies.aiService
  const billingService = dependencies.billingService === undefined
    ? config.supabase && new BillingService(createSupabaseBillingRepository(config.supabase), {
        devFulfilEnabled: isDevFulfilEnvironment(config),
      })
    : dependencies.billingService

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
        if (!sessionService || !aiService || !billingService) {
          throw new HttpError(503, 'CONFIGURATION_ERROR', 'Server ยังไม่ได้ตั้งค่า AI หรือ Supabase')
        }
        requireJsonContentType(req)
        const actor = await sessionService.authenticate(bearerToken(req), requestId)

        const input = parseOrThrow(aiBoxSpecRequestSchema.safeParse(await readJsonBody(req, 6 * 1024 * 1024)))
        const current = parseCurrent(input.current)
        if (input.current !== undefined && !current) {
          throw new HttpError(422, 'VALIDATION_ERROR', 'สเปกปัจจุบันไม่ถูกต้อง')
        }
        const image = parseImage(input.image)
        if (input.image !== undefined && !image) {
          throw new HttpError(422, 'VALIDATION_ERROR', 'รูปอ้างอิงไม่ถูกต้องหรือใหญ่เกินไป')
        }
        // ตรวจคีย์ AI ของ server หลัง auth + validate (ไม่เปิดเผยสถานะ config ให้ผู้ไม่ได้ login)
        // และก่อนจองเครดิต เพื่อไม่หักเครดิตทั้งที่เรียก provider ไม่ได้
        const serverAi = config.ai
        if (!serverAi) {
          throw new HttpError(503, 'CONFIGURATION_ERROR', 'Server ยังไม่ได้ตั้งค่าคีย์ AI')
        }

        // หักเครดิตก่อนเรียก provider (402/409 จากการจองส่งต่อตรง ๆ); provider ล้ม → คืนแบบ best-effort
        // ผลลัพธ์กลับมาแล้วไม่คืน — ดู docs/billing-freemium-pro.md §1
        const reservation = await billingService.reserveAiCredit(actor, input.workspaceId, input.operationId)
        let data: BoxSpecResult
        try {
          data = await aiService.generateBoxSpec(serverAi.anthropicApiKey, {
            prompt: input.prompt.trim(),
            ...(current ? { current } : {}),
            ...(image ? { image } : {}),
          })
        } catch (providerError) {
          try {
            await billingService.settleAiRequest(actor, reservation.requestId, 'failed')
          } catch (refundError) {
            // คืนเครดิตไม่สำเร็จ — รายงานข้อผิดพลาดต้นทางแทน; แถวค้าง reserved จะถูกคืนเองตอนจองครั้งถัดไป
            // หลังพ้น 15 นาที (reserve_ai_credit)
            console.warn(`[${requestId}] คืนเครดิต ai_request ${reservation.requestId} ไม่สำเร็จ (ค้างสถานะ reserved)`, refundError)
          }
          throw providerError
        }
        // ผลลัพธ์กลับมาแล้ว = เครดิตหักขาดตามสเปก §1; settle เป็นแค่ bookkeeping — ถ้าล้มต้องไม่คืนเครดิต
        // และต้องไม่ทิ้งผลลัพธ์ที่จ่าย provider ไปแล้ว (ยอดจาก reservation ถูกต้องอยู่แล้วเพราะหักตอนจอง)
        let credits = reservation.credits
        try {
          credits = (await billingService.settleAiRequest(actor, reservation.requestId, 'succeeded')).credits
        } catch (settleError) {
          console.warn(`[${requestId}] settle ai_request ${reservation.requestId} ไม่สำเร็จ (ค้างสถานะ reserved)`, settleError)
        }
        sendJson(res, 200, { data: { ...data, credits }, requestId }, requestId)
      } catch (error) {
        let httpError: HttpError
        if (error instanceof HttpError) httpError = error
        else if (error instanceof AiProviderError && error.kind === 'authentication') {
          httpError = new HttpError(503, 'CONFIGURATION_ERROR', 'คีย์ AI ของ server ไม่ถูกต้อง')
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

    if (path === '/api/v1/billing/entitlements') {
      try {
        if (req.method !== 'GET') {
          res.setHeader('allow', 'GET')
          throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method นี้ใช้กับ endpoint ไม่ได้')
        }
        if (!sessionService || !billingService) {
          throw new HttpError(503, 'CONFIGURATION_ERROR', 'Server ยังไม่ได้ตั้งค่า Supabase')
        }
        const actor = await sessionService.authenticate(bearerToken(req), requestId)
        const url = requestUrl(req)
        if ([...url.searchParams.keys()].some((key) => key !== 'workspaceId')) {
          throw new HttpError(422, 'VALIDATION_ERROR', 'query parameter ไม่ถูกต้อง')
        }
        if (url.searchParams.getAll('workspaceId').length > 1) {
          throw new HttpError(422, 'VALIDATION_ERROR', 'query parameter ต้องไม่ซ้ำ')
        }
        const query = parseOrThrow(entitlementsQuerySchema.safeParse({
          workspaceId: url.searchParams.get('workspaceId') ?? undefined,
        }))
        const data = await billingService.getEntitlements(actor, query.workspaceId)
        sendJson(res, 200, { data, requestId }, requestId)
      } catch (error) {
        const httpError = error instanceof HttpError
          ? error
          : new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'โหลดสิทธิ์การใช้งานไม่สำเร็จ')
        sendJson(res, httpError.status, toApiFailure(httpError, requestId), requestId)
      }
      return
    }

    if (path === '/api/v1/billing/orders') {
      try {
        if (req.method !== 'POST') {
          res.setHeader('allow', 'POST')
          throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method นี้ใช้กับ endpoint ไม่ได้')
        }
        if (!sessionService || !billingService) {
          throw new HttpError(503, 'CONFIGURATION_ERROR', 'Server ยังไม่ได้ตั้งค่า Supabase')
        }
        requireJsonContentType(req)
        const actor = await sessionService.authenticate(bearerToken(req), requestId)
        const input = parseOrThrow(createOrderInputSchema.safeParse(await readJsonBody(req)))
        const data = await billingService.createOrder(actor, input)
        sendJson(res, 201, { data, requestId }, requestId)
      } catch (error) {
        const httpError = error instanceof HttpError
          ? error
          : new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'สร้างคำสั่งซื้อไม่สำเร็จ')
        sendJson(res, httpError.status, toApiFailure(httpError, requestId), requestId)
      }
      return
    }

    const devFulfilMatch = /^\/api\/v1\/billing\/orders\/([^/]+)\/dev-fulfil$/.exec(path)
    if (devFulfilMatch) {
      try {
        // นอก development/test เส้นทางนี้ต้องเหมือนไม่มีอยู่ (ตอบ 404 ก่อนตรวจ method/session)
        if (!isDevFulfilEnvironment(config)) {
          throw new HttpError(404, 'NOT_FOUND', 'ไม่พบ API endpoint นี้')
        }
        if (req.method !== 'POST') {
          res.setHeader('allow', 'POST')
          throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method นี้ใช้กับ endpoint ไม่ได้')
        }
        if (!sessionService || !billingService) {
          throw new HttpError(503, 'CONFIGURATION_ERROR', 'Server ยังไม่ได้ตั้งค่า Supabase')
        }
        const actor = await sessionService.authenticate(bearerToken(req), requestId)
        const orderId = parseOrThrow(orderIdSchema.safeParse(devFulfilMatch[1]))
        await rejectNonEmptyBody(req)
        const data = await billingService.devFulfilOrder(actor, orderId, requestId)
        sendJson(res, 200, { data, requestId }, requestId)
      } catch (error) {
        const httpError = error instanceof HttpError
          ? error
          : new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'จำลองการชำระเงินไม่สำเร็จ')
        sendJson(res, httpError.status, toApiFailure(httpError, requestId), requestId)
      }
      return
    }

    const exportAuthorizationMatch = /^\/api\/v1\/projects\/([^/]+)\/export-authorizations$/.exec(path)
    if (exportAuthorizationMatch) {
      try {
        if (req.method !== 'POST') {
          res.setHeader('allow', 'POST')
          throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method นี้ใช้กับ endpoint ไม่ได้')
        }
        if (!sessionService || !billingService) {
          throw new HttpError(503, 'CONFIGURATION_ERROR', 'Server ยังไม่ได้ตั้งค่า Supabase')
        }
        const actor = await sessionService.authenticate(bearerToken(req), requestId)
        const projectId = parseOrThrow(projectIdSchema.safeParse(exportAuthorizationMatch[1]))
        await rejectNonEmptyBody(req)
        const data = await billingService.authorizeExport(actor, projectId)
        sendJson(res, 200, { data, requestId }, requestId)
      } catch (error) {
        const httpError = error instanceof HttpError
          ? error
          : new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'ตรวจสอบสิทธิ์ดาวน์โหลดไม่สำเร็จ')
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
          const revisionHeader = headerValue(req, 'x-expected-revision')
          if (!revisionHeader || !/^[1-9]\d*$/.test(revisionHeader)) {
            throw new HttpError(422, 'VALIDATION_ERROR', 'X-Expected-Revision ต้องเป็น revision จำนวนเต็มบวก')
          }
          const expectedRevision = parseOrThrow(expectedRevisionSchema.safeParse(revisionHeader))
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
