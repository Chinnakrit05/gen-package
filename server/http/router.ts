import { randomUUID } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'
import { z, ZodError } from 'zod'
import type { ApiSuccess } from '../../shared/contracts/http'
import type { SessionBootstrapData } from '../../shared/contracts/auth'
import type { HealthData } from '../../shared/contracts/system'
import type { DeleteProjectInput, SaveProjectInput } from '../../shared/contracts/projects'
import { EXPORT_FORMATS, type ExportFormat } from '../../shared/contracts/billing'
import { createSupabaseAssetService } from '../adapters/supabase/assetService'
import { createSupabaseBillingRepository, createSupabaseStorageQuotaRepository } from '../adapters/supabase/billingRepository'
import { createSupabaseProjectRepository } from '../adapters/supabase/projectRepository'
import { createSupabaseSessionService } from '../adapters/supabase/sessionService'
import type { ServerConfig } from '../config'
import { errorMessageForLog, logServerEvent } from '../logging'
import type { SessionService } from '../modules/identity/sessionService'
import { AssetService } from '../modules/assets/assetService'
import { AiProviderError, AnthropicAiService, type AiService, type AiUsage } from '../modules/ai/aiService'
import { parseArtworkRequest, type ArtworkRequest } from '../aiArtwork'
import { parseCurrent, parseImage } from '../boxSpec'
import {
  assetDownloadRequestSchema,
  assetIdSchema,
  assetOperationSchema,
  createAssetUploadIntentSchema,
} from '../modules/assets/validation'
import {
  BillingService,
  type AiRequestUsage,
  type BillingRepository,
  type BillingServiceOptions,
} from '../modules/billing/billingService'
import {
  aiArtworkRequestSchema,
  aiBoxSpecRequestSchema,
  createOrderInputSchema,
  entitlementsQuerySchema,
  orderIdSchema,
} from '../modules/billing/validation'
import { StorageQuota } from '../modules/billing/storageQuota'
import { decodeProjectCursor } from '../modules/projects/canonical'
import { ProjectService } from '../modules/projects/projectService'
import {
  createProjectInputSchema,
  expectedRevisionSchema,
  legacyImportInputSchema,
  operationIdSchema,
  projectIdSchema,
  projectListQuerySchema,
  projectThumbnailBatchSchema,
  putProjectThumbnailInputSchema,
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
  // ส่ง repository แทน service ได้ (เทสต์) — router สร้าง BillingService เองด้วย billingFlags(config)
  // เทสต์จึงตรวจเงื่อนไขเปิดขาย/จำลองจ่ายตัวจริง ไม่ใช่สำเนาสูตรในเทสต์
  billingRepository?: BillingRepository | null
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
// body ของขอสิทธิ์ดาวน์โหลด: ว่าง / {} / { format } — format บอกรูปแบบไฟล์ (SVG/AI เฉพาะ Pro)
const exportAuthorizationBodySchema = z.object({ format: z.enum(EXPORT_FORMATS).optional() }).strict()
async function readExportAuthorizationBody(req: HttpRequest): Promise<{ format?: ExportFormat }> {
  const contentLength = Number(headerValue(req, 'content-length') ?? 0)
  if (req.body === undefined && contentLength <= 0 && !headerValue(req, 'transfer-encoding')) return {}
  requireJsonContentType(req)
  return parseOrThrow(exportAuthorizationBodySchema.safeParse(await readJsonBody(req)))
}

async function rejectNonEmptyBody(req: HttpRequest): Promise<void> {
  const contentLength = Number(headerValue(req, 'content-length') ?? 0)
  if (req.body === undefined && contentLength <= 0 && !headerValue(req, 'transfer-encoding')) return
  requireJsonContentType(req)
  const body = await readJsonBody(req)
  if (typeof body !== 'object' || body === null || Array.isArray(body) || Object.keys(body).length > 0) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'endpoint นี้รับเฉพาะ body ว่างหรือ {}')
  }
}

export function isDevFulfilEnvironment(config: Pick<ServerConfig, 'appEnv'>): boolean {
  return config.appEnv === 'development' || config.appEnv === 'test'
}

// เปิดขาย (POST /billing/orders + Entitlements.purchasesEnabled) — เจ้าของผลิตภัณฑ์ตัดสินใจ 13 ต.ค. 2026
// ให้ซ่อนการซื้อจนกว่าจะมีผู้ให้บริการชำระเงิน ตอนนี้จึงเปิดเฉพาะที่จำลองจ่ายได้ (development/test)
// เมื่อเลือกผู้ให้บริการแล้ว ต้องเปลี่ยนเงื่อนไขนี้เป็น "ตั้งค่าผู้ให้บริการชำระเงินใน config แล้ว" ไม่ใช่ตาม appEnv
export function isPurchaseEnabled(config: Pick<ServerConfig, 'appEnv'>): boolean {
  return isDevFulfilEnvironment(config)
}

// open access (เจ้าของผลิตภัณฑ์ตัดสินใจ 15 ต.ค. 2026): ระหว่างยังขายไม่ได้ ทุก workspace ใช้งานได้เหมือน Pro —
// ดาวน์โหลดไฟล์ผลิตได้ทุกแบบ ไม่มีลายน้ำ เครดิต AI ตามโควตา Pro ต่อรอบ (supabase/migrations/20261015000700_open_access.sql)
// ผูกกับ isPurchaseEnabled: เปิดขายเมื่อไรกลับเป็นกติกาปกติเอง; development/test ปิดไว้ให้เทสต์ paywall ยังตรวจกติกาปกติ
export function isOpenAccess(config: Pick<ServerConfig, 'appEnv'>): boolean {
  return !isPurchaseEnabled(config)
}

// โควตาพื้นที่เก็บงานบน cloud (เจ้าของผลิตภัณฑ์ตัดสินใจ 23 ต.ค. 2026: Freemium 20 MB / Pro 1 GB) — ทำไว้รอแล้วแต่
// **ยังไม่เปิดใช้ทุก environment** (ช่วงพัฒนา); เปิดเมื่อพร้อม: apply supabase/migrations/20261027000900_storage_quota.sql
// กับฐานข้อมูลของ environment นั้นก่อน (เปิดก่อนมี RPC = บันทึกงานล้มทั้งหมด) แล้วค่อยเปลี่ยนเงื่อนไขนี้
// — รายการที่ต้องทำก่อนเปิดอยู่ใน docs/billing-freemium-pro.md §1
export function isStorageQuotaEnabled(_config: Pick<ServerConfig, 'appEnv'>): boolean {
  return false
}

// สวิตช์ของ BillingService ตาม config — ทางเดียวที่ createApiRouter ใช้
// (router.test ตรวจ staging/production = ปิดการขาย/จำลองจ่าย และเปิด open access)
export function billingFlags(config: Pick<ServerConfig, 'appEnv'>): BillingServiceOptions {
  return {
    devFulfilEnabled: isDevFulfilEnvironment(config),
    purchasesEnabled: isPurchaseEnabled(config),
    openAccess: isOpenAccess(config),
  }
}

// error ที่ไม่ใช่ HttpError = บั๊กหรือ dependency ล้ม → log หนึ่งบรรทัด (ไม่มีคีย์/token/อีเมล/body) แล้วตอบ fallback
function unexpectedError(requestId: string, route: string, error: unknown, fallback: HttpError): HttpError {
  logServerEvent('error', 'api_unexpected_error', {
    requestId,
    route,
    status: fallback.status,
    code: fallback.code,
    error: errorMessageForLog(error),
  })
  return fallback
}

const AI_ROUTE = 'POST /api/v1/ai/box-spec'
const AI_ARTWORK_ROUTE = 'POST /api/v1/ai/artwork'

// provider ล้ม/บั๊กใน AI route → HttpError + log ชนิดความล้มเหลว + ข้อความต้นทาง (redact แล้ว) — คีย์ของ server ไม่อยู่ในข้อความนี้
function aiRouteError(error: unknown, requestId: string, route: string): HttpError {
  if (error instanceof HttpError) return error
  let httpError: HttpError
  if (error instanceof AiProviderError && error.kind === 'authentication') {
    httpError = new HttpError(503, 'CONFIGURATION_ERROR', 'คีย์ AI ของ server ไม่ถูกต้อง')
  } else if (error instanceof AiProviderError && error.kind === 'rate-limit') {
    httpError = new HttpError(429, 'AI_RATE_LIMITED', 'เรียก AI ถี่เกินไป รอสักครู่แล้วลองใหม่')
  } else if (error instanceof AiProviderError && error.kind === 'refusal') {
    // โมเดลปฏิเสธคำขอ (stop_reason refusal) — กดซ้ำแบบเดิมไม่ช่วย จึงบอกให้ปรับคำอธิบาย; รหัสเดิม ไม่แตะ contract
    httpError = new HttpError(502, 'AI_PROVIDER_UNAVAILABLE', 'AI ไม่รับคำขอนี้ ลองปรับคำอธิบายแล้วส่งใหม่')
  } else {
    httpError = new HttpError(502, 'AI_PROVIDER_UNAVAILABLE', 'บริการ AI ขัดข้อง ลองใหม่อีกครั้ง')
  }
  logServerEvent('error', 'ai_provider_error', {
    requestId,
    route,
    status: httpError.status,
    code: httpError.code,
    kind: error instanceof AiProviderError ? error.kind : 'unexpected',
    error: error instanceof AiProviderError ? error.providerMessage : errorMessageForLog(error),
  })
  return httpError
}

// ลำดับคิดเงินของทุก AI route (ดู docs/billing-freemium-pro.md §1): จองเครดิตก่อนเรียก provider (402/409/429 จากการจอง
// ส่งต่อตรง ๆ โดยไม่หักเครดิต) → provider ล้ม = คืนแบบ best-effort → ผลกลับมาแล้วหักขาด settle เป็นแค่ bookkeeping
// (ล้มก็ไม่คืนเครดิต ไม่ทิ้งผลที่จ่าย provider ไปแล้ว; ยอดจาก reservation ถูกต้องอยู่แล้วเพราะหักตอนจอง)
// model/usage เก็บลง ai_requests เพื่อดูต้นทุน — ไม่ส่งให้ client
async function chargedAiCall<T>(
  ctx: {
    billingService: BillingService
    actor: Parameters<BillingService['reserveAiCredit']>[0]
    workspaceId: string
    operationId: string
    requestId: string
    route: string
    hasImage: boolean
  },
  call: () => Promise<{ value: T; model: string; usage: AiUsage | null }>,
): Promise<{ value: T; credits: number }> {
  const reservation = await ctx.billingService.reserveAiCredit(ctx.actor, ctx.workspaceId, ctx.operationId)
  let generated: { value: T; model: string; usage: AiUsage | null }
  try {
    generated = await call()
  } catch (providerError) {
    try {
      await ctx.billingService.settleAiRequest(ctx.actor, reservation.requestId, 'failed', { hasImage: ctx.hasImage })
    } catch (refundError) {
      // คืนเครดิตไม่สำเร็จ — รายงานข้อผิดพลาดต้นทางแทน; แถวค้าง reserved จะถูกคืนเองตอนจองครั้งถัดไป
      // หลังพ้น 15 นาที (reserve_ai_credit)
      logServerEvent('warn', 'ai_refund_failed', {
        requestId: ctx.requestId,
        route: ctx.route,
        aiRequestId: reservation.requestId,
        error: errorMessageForLog(refundError),
      })
    }
    throw providerError
  }
  const usage: AiRequestUsage = {
    hasImage: ctx.hasImage,
    model: generated.model,
    ...(generated.usage ?? {}),
  }
  let credits = reservation.credits
  try {
    credits = (await ctx.billingService.settleAiRequest(ctx.actor, reservation.requestId, 'succeeded', usage)).credits
  } catch (settleError) {
    logServerEvent('warn', 'ai_settle_failed', {
      requestId: ctx.requestId,
      route: ctx.route,
      aiRequestId: reservation.requestId,
      error: errorMessageForLog(settleError),
    })
  }
  return { value: generated.value, credits }
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
  const storageQuota = config.supabase && isStorageQuotaEnabled(config)
    ? new StorageQuota(createSupabaseStorageQuotaRepository(config.supabase), { openAccess: isOpenAccess(config) })
    : null
  const projectService = dependencies.projectService === undefined
    ? config.supabase && new ProjectService(createSupabaseProjectRepository(config.supabase), storageQuota)
    : dependencies.projectService
  const assetService = dependencies.assetService === undefined
    ? config.supabase && createSupabaseAssetService(config.supabase, storageQuota)
    : dependencies.assetService
  const aiService = dependencies.aiService === undefined
    ? new AnthropicAiService(config.ai?.model)
    : dependencies.aiService
  const billingRepository = dependencies.billingRepository === undefined
    ? config.supabase && createSupabaseBillingRepository(config.supabase)
    : dependencies.billingRepository
  const billingService = dependencies.billingService === undefined
    ? billingRepository && new BillingService(billingRepository, billingFlags(config))
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

    // AI ออกแบบหน้าตาบน template ที่เลือก (payload เดียวกับ legacy /api/ai-artwork + ซอง workspace/operation):
    // สิทธิ์/เครดิต/รหัสข้อผิดพลาดชุดเดียวกับ box-spec (1 เครดิต/แบบ) — ใช้เวลาได้ถึงงบ CLOUD_ARTWORK_LIMITS ใต้ maxDuration 300
    if (path === '/api/v1/ai/artwork') {
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

        // รูป ≤ 4 รูป (JPEG ย่อ ≤ 1024px ฝั่ง client) — Vercel รับ body ได้ ~4.5 MB อยู่แล้ว
        const input = parseOrThrow(aiArtworkRequestSchema.safeParse(await readJsonBody(req, 8 * 1024 * 1024)))
        let request: ArtworkRequest
        try {
          request = parseArtworkRequest(input)
        } catch (error) {
          throw new HttpError(422, 'VALIDATION_ERROR', `คำขอออกแบบหน้าตาไม่ถูกต้อง (${error instanceof Error ? error.message : 'body'})`)
        }
        const serverAi = config.ai
        if (!serverAi) {
          throw new HttpError(503, 'CONFIGURATION_ERROR', 'Server ยังไม่ได้ตั้งค่าคีย์ AI')
        }

        const { value: result, credits } = await chargedAiCall(
          { billingService, actor, workspaceId: input.workspaceId, operationId: input.operationId, requestId, route: AI_ARTWORK_ROUTE, hasImage: request.images.length > 0 },
          async () => {
            const generated = await aiService.generateArtwork(serverAi.anthropicApiKey, request)
            return { value: generated.result, model: generated.model, usage: generated.usage }
          },
        )
        sendJson(res, 200, { data: { ...result, credits }, requestId }, requestId)
      } catch (error) {
        const httpError = aiRouteError(error, requestId, AI_ARTWORK_ROUTE)
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

        const { value: spec, credits } = await chargedAiCall(
          { billingService, actor, workspaceId: input.workspaceId, operationId: input.operationId, requestId, route: AI_ROUTE, hasImage: image !== undefined },
          async () => {
            const generated = await aiService.generateBoxSpec(serverAi.anthropicApiKey, {
              prompt: input.prompt.trim(),
              ...(current ? { current } : {}),
              ...(image ? { image } : {}),
            })
            return { value: generated.spec, model: generated.model, usage: generated.usage }
          },
        )
        sendJson(res, 200, { data: { ...spec, credits }, requestId }, requestId)
      } catch (error) {
        const httpError = aiRouteError(error, requestId, AI_ROUTE)
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
          : unexpectedError(requestId, 'GET /api/v1/billing/entitlements', error,
            new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'โหลดสิทธิ์การใช้งานไม่สำเร็จ'))
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
          : unexpectedError(requestId, 'POST /api/v1/billing/orders', error,
            new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'สร้างคำสั่งซื้อไม่สำเร็จ'))
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
          : unexpectedError(requestId, 'POST /api/v1/billing/orders/:id/dev-fulfil', error,
            new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'จำลองการชำระเงินไม่สำเร็จ'))
        sendJson(res, httpError.status, toApiFailure(httpError, requestId), requestId)
      }
      return
    }

    // ภาพย่อ 3D ของแกลเลอรีงาน: ขอตัวรูปทีละชุด (client ขอเฉพาะที่ version ไม่ตรงแคช) — ต้องอยู่ก่อน /projects/:id
    if (path === '/api/v1/projects/thumbnails') {
      try {
        if (req.method !== 'POST') {
          res.setHeader('allow', 'POST')
          throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method นี้ใช้กับ endpoint ไม่ได้')
        }
        if (!sessionService || !projectService) {
          throw new HttpError(503, 'CONFIGURATION_ERROR', 'Server ยังไม่ได้ตั้งค่า Supabase')
        }
        const actor = await sessionService.authenticate(bearerToken(req), requestId)
        requireJsonContentType(req)
        const input = parseOrThrow(projectThumbnailBatchSchema.safeParse(await readJsonBody(req)))
        const items = await projectService.thumbnails(actor, input.workspaceId, input.projectIds)
        sendJson(res, 200, { data: { items }, requestId }, requestId)
      } catch (error) {
        const httpError = error instanceof HttpError
          ? error
          : unexpectedError(requestId, 'POST /api/v1/projects/thumbnails', error,
            new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'โหลดภาพย่อไม่สำเร็จ'))
        sendJson(res, httpError.status, toApiFailure(httpError, requestId), requestId)
      }
      return
    }

    const thumbnailMatch = /^\/api\/v1\/projects\/([^/]+)\/thumbnail$/.exec(path)
    if (thumbnailMatch) {
      try {
        if (req.method !== 'PUT') {
          res.setHeader('allow', 'PUT')
          throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method นี้ใช้กับ endpoint ไม่ได้')
        }
        if (!sessionService || !projectService) {
          throw new HttpError(503, 'CONFIGURATION_ERROR', 'Server ยังไม่ได้ตั้งค่า Supabase')
        }
        const actor = await sessionService.authenticate(bearerToken(req), requestId)
        const projectId = parseOrThrow(projectIdSchema.safeParse(thumbnailMatch[1]))
        requireJsonContentType(req)
        const input = parseOrThrow(putProjectThumbnailInputSchema.safeParse(await readJsonBody(req)))
        const data = await projectService.putThumbnail(actor, projectId, input)
        sendJson(res, 200, { data, requestId }, requestId)
      } catch (error) {
        const httpError = error instanceof HttpError
          ? error
          : unexpectedError(requestId, 'PUT /api/v1/projects/:id/thumbnail', error,
            new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'บันทึกภาพย่อไม่สำเร็จ'))
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
        const { format } = await readExportAuthorizationBody(req)
        const data = await billingService.authorizeExport(actor, projectId, format)
        sendJson(res, 200, { data, requestId }, requestId)
      } catch (error) {
        const httpError = error instanceof HttpError
          ? error
          : unexpectedError(requestId, 'POST /api/v1/projects/:id/export-authorizations', error,
            new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'ตรวจสอบสิทธิ์ดาวน์โหลดไม่สำเร็จ'))
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
