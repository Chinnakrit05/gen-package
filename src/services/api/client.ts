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

export async function requestApi<T>(
  url: string,
  accessToken: string,
  init: RequestInit,
): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('accept', 'application/json')
  headers.set('authorization', `Bearer ${accessToken}`)
  const response = await fetch(url, { ...init, headers, cache: 'no-store' })
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
