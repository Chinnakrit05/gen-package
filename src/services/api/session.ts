import type { SessionBootstrapData } from '../../../shared/contracts/auth'
import type { ApiFailure } from '../../../shared/contracts/errors'
import type { ApiSuccess } from '../../../shared/contracts/http'

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiClientError'
  }
}

export async function bootstrapSession(
  apiBaseUrl: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<SessionBootstrapData> {
  const response = await fetch(`${apiBaseUrl}/session/bootstrap`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: '{}',
    cache: 'no-store',
    signal,
  })
  const payload = await response.json().catch(() => null) as
    | ApiSuccess<SessionBootstrapData>
    | ApiFailure
    | null
  if (!response.ok || !payload || 'error' in payload) {
    const error = payload && 'error' in payload ? payload.error : null
    throw new ApiClientError(
      response.status,
      error?.code ?? 'INVALID_RESPONSE',
      error?.message ?? `เรียก API ไม่สำเร็จ (${response.status})`,
    )
  }
  return payload.data
}
