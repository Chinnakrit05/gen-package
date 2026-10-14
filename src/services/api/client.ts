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

const isAbortError = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'

export async function requestApi<T>(
  url: string,
  accessToken: string,
  init: RequestInit,
): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('accept', 'application/json')
  headers.set('authorization', `Bearer ${accessToken}`)
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
