import type { AiCreditsReceipt } from '../../../shared/contracts/billing'
import type { AiBoxSpec, ArtworkRequestInput, ArtworkResponse, CurrentSpec } from '../../core/ai'
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

// AI ออกแบบหน้าตาบน cloud: payload เดียวกับ legacy /api/ai-artwork + ซอง workspace/operation; หัก 1 เครดิต/แบบ
// ใช้เวลาเป็นนาที (server ให้ถึง ~4.5 นาที) — ส่ง signal เพื่อให้ผู้ใช้ยกเลิกได้ (เครดิตที่จองแล้วถูกคืนเมื่อ provider ล้มเท่านั้น)
export interface CloudArtworkInput extends ArtworkRequestInput {
  workspaceId: string
  operationId: string
}

export function requestCloudArtwork(
  apiBaseUrl: string,
  accessToken: string,
  input: CloudArtworkInput,
  signal?: AbortSignal,
): Promise<ArtworkResponse & AiCreditsReceipt> {
  return requestApi<ArtworkResponse & AiCreditsReceipt>(`${apiBaseUrl}/ai/artwork`, accessToken, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
}
