import type { ApiFailure } from '../../../shared/contracts/errors'
import type { ApiSuccess } from '../../../shared/contracts/http'

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ApiClientError'
  }
}

// รหัสฝั่ง client เมื่อ fetch ไม่ถึง server (ออฟไลน์/DNS/CORS/server ล่ม) — ไม่ใช่รหัสจาก server จึงไม่อยู่ใน API_ERROR_CODES
export const NETWORK_ERROR = 'NETWORK_ERROR'
export const NETWORK_ERROR_MESSAGE = 'เชื่อมต่อ server ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่'

export function isApiSessionError(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 401
    && (error.code === 'SESSION_INVALID' || error.code === 'AUTH_REQUIRED')
}

interface ApiSessionRecovery {
  isCurrent(accessToken: string): boolean
  refresh(): Promise<string | null>
  expire(accessToken: string): void
}

type ResolveApiSession = (url: string, accessToken: string) => ApiSessionRecovery | null

let resolveApiSession: ResolveApiSession | null = null

// CloudRoot owns recovery for authenticated API requests. Local demo has no resolver.
export function registerApiSessionRecovery(resolve: ResolveApiSession): () => void {
  resolveApiSession = resolve
  return () => { if (resolveApiSession === resolve) resolveApiSession = null }
}

const isAbortError = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'

function canReplay(init: RequestInit): boolean {
  const method = init.method?.toUpperCase() ?? 'GET'
  if (method === 'GET' || method === 'HEAD') return true
  if (new Headers(init.headers).get('idempotency-key')) return true
  if (typeof init.body !== 'string') return false
  try {
    const payload = JSON.parse(init.body)
    return typeof payload?.operationId === 'string' && payload.operationId.length > 0
  } catch {
    return false
  }
}

export async function requestApi<T>(
  url: string,
  accessToken: string,
  init: RequestInit,
  options?: { replaySafeRead?: true },
): Promise<T> {
  const resolve = resolveApiSession
  // Bind to the account that owns the token at request start, including while fetch is in flight.
  const recovery = resolve?.(url, accessToken)
  try {
    return await requestOnce<T>(url, accessToken, init)
  } catch (error) {
    if (!recovery || resolve !== resolveApiSession || init.signal?.aborted || !isApiSessionError(error)) throw error
    const refreshed = await recovery.refresh()
    if (!refreshed || resolve !== resolveApiSession || init.signal?.aborted
      || !recovery.isCurrent(refreshed) || (!options?.replaySafeRead && !canReplay(init))) throw error
    try {
      return await requestOnce<T>(url, refreshed, init)
    } catch (retryError) {
      if (!init.signal?.aborted && resolve === resolveApiSession && isApiSessionError(retryError)) recovery.expire(refreshed)
      throw retryError
    }
  }
}

async function requestOnce<T>(
  url: string,
  accessToken: string | null,
  init: RequestInit,
): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('accept', 'application/json')
  if (accessToken !== null) headers.set('authorization', `Bearer ${accessToken}`)
  let response: Response
  try {
    response = await fetch(url, { ...init, headers, cache: 'no-store' })
  } catch (error) {
    // ยกเลิกเอง (AbortController/เหตุผลที่ผู้เรียกส่งมา) ต้องโยนต่อแบบเดิม — ผู้เรียกแยก "ยกเลิก" ออกจาก "ล้มเหลว"
    if (isAbortError(error) || init.signal?.aborted) throw error
    // fetch reject = ไม่ได้ response เลย (TypeError: Failed to fetch ฯลฯ) → error เดียวที่ UI แปลเป็นข้อความได้
    throw new ApiClientError(0, NETWORK_ERROR, NETWORK_ERROR_MESSAGE)
  }
  const payload = await response.json().catch(() => null) as ApiSuccess<T> | ApiFailure | null
  if (!response.ok || !payload || 'error' in payload) {
    const error = payload && 'error' in payload ? payload.error : null
    throw new ApiClientError(
      response.status,
      error?.code ?? 'INVALID_RESPONSE',
      error?.message ?? `เรียก API ไม่สำเร็จ (${response.status})`,
      error?.details,
    )
  }
  return payload.data
}

export function requestPublicApi<T>(url: string, signal?: AbortSignal): Promise<T> {
  return requestOnce<T>(url, null, { method: 'GET', credentials: 'omit', signal })
}
