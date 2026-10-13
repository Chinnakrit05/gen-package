import type { AiCreditsReceipt } from '../../../shared/contracts/billing'
import type { AiBoxSpec, CurrentSpec } from '../../core/ai'
import { requestApi } from './client'

// AI บน cloud ใช้คีย์ของระบบฝั่ง server — ไม่รับคีย์จากผู้ใช้ (BYOK header ถูกถอดแล้ว)
// ทุกคำขอหัก 1 เครดิต AI ของ workspace; operationId ใหม่ต่อคำขอ (ซ้ำ → 409) ดู docs/billing-freemium-pro.md §3
export interface CloudBoxSpecInput {
  workspaceId: string
  operationId: string
  prompt: string
  current?: CurrentSpec
  imageBase64?: string
}

export function requestCloudBoxSpec(
  apiBaseUrl: string,
  accessToken: string,
  input: CloudBoxSpecInput,
): Promise<AiBoxSpec & AiCreditsReceipt> {
  const { workspaceId, operationId, prompt, current, imageBase64 } = input
  return requestApi<AiBoxSpec & AiCreditsReceipt>(`${apiBaseUrl}/ai/box-spec`, accessToken, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workspaceId,
      operationId,
      prompt,
      current,
      image: imageBase64 ? { data: imageBase64, mediaType: 'image/jpeg' } : undefined,
    }),
  })
}
