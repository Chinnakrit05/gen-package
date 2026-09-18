import type { MeData, SessionBootstrapData } from '../../../shared/contracts/auth'
import { requestApi } from './client'
export { ApiClientError } from './client'

export async function bootstrapSession(
  apiBaseUrl: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<SessionBootstrapData> {
  return requestApi<SessionBootstrapData>(`${apiBaseUrl}/session/bootstrap`, accessToken, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: '{}',
    cache: 'no-store',
    signal,
  })
}

export function getMe(
  apiBaseUrl: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<MeData> {
  return requestApi<MeData>(`${apiBaseUrl}/me`, accessToken, {
    method: 'GET',
    signal,
  })
}
