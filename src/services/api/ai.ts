import type { AiBoxSpec, CurrentSpec } from '../../core/ai'
import { requestApi } from './client'

export function requestCloudBoxSpec(
  apiBaseUrl: string,
  accessToken: string,
  apiKey: string,
  prompt: string,
  current?: CurrentSpec,
  imageBase64?: string,
): Promise<AiBoxSpec> {
  return requestApi<AiBoxSpec>(`${apiBaseUrl}/ai/box-spec`, accessToken, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-packit-anthropic-api-key': apiKey,
    },
    body: JSON.stringify({
      prompt,
      current,
      image: imageBase64 ? { data: imageBase64, mediaType: 'image/jpeg' } : undefined,
    }),
  })
}
