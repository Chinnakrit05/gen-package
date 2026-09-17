import { randomUUID } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'
import type { ApiSuccess } from '../../shared/contracts/http'
import type { SessionBootstrapData } from '../../shared/contracts/auth'
import type { HealthData } from '../../shared/contracts/system'
import { createSupabaseSessionService } from '../adapters/supabase/sessionService'
import type { ServerConfig } from '../config'
import type { SessionService } from '../modules/identity/sessionService'
import { HttpError, toApiFailure } from './errors'

export interface HttpRequest {
  method?: string
  url?: string
  headers: IncomingHttpHeaders
}

export interface HttpResponse {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body?: string): void
}

export type ApiHandler = (req: HttpRequest, res: HttpResponse) => Promise<void>

export interface ApiRouterDependencies {
  sessionService?: SessionService | null
}

function requestPath(req: HttpRequest): string {
  try {
    return new URL(req.url ?? '/', 'http://packit.local').pathname.replace(/\/+$/, '') || '/'
  } catch {
    return '/'
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

export function createApiRouter(config: ServerConfig, dependencies: ApiRouterDependencies = {}): ApiHandler {
  const sessionService = dependencies.sessionService === undefined
    ? config.supabase && createSupabaseSessionService(config.supabase)
    : dependencies.sessionService

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

    const error = new HttpError(404, 'NOT_FOUND', 'ไม่พบ API endpoint นี้')
    sendJson(res, error.status, toApiFailure(error, requestId), requestId)
  }
}
