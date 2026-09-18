import type {
  AssetDownloadTickets,
  AssetStatus,
  AssetUploadTicket,
  CreateAssetUploadIntentInput,
} from '../../../shared/contracts/assets'
import { requestApi } from './client'

export function createAssetUploadIntent(
  apiBaseUrl: string,
  accessToken: string,
  input: CreateAssetUploadIntentInput,
  signal?: AbortSignal,
): Promise<AssetUploadTicket> {
  return requestApi<AssetUploadTicket>(`${apiBaseUrl}/assets/upload-intents`, accessToken, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
}

export async function uploadAssetBytes(
  ticket: NonNullable<AssetUploadTicket['upload']>,
  bytes: Blob,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(ticket.url, {
    method: ticket.method,
    headers: ticket.headers,
    body: bytes,
    signal,
  })
  if (!response.ok) throw new Error(`อัปโหลดไฟล์ไม่สำเร็จ (${response.status})`)
}

export function completeAsset(
  apiBaseUrl: string,
  accessToken: string,
  assetId: string,
  operationId: string,
  signal?: AbortSignal,
): Promise<AssetStatus> {
  return requestApi<AssetStatus>(
    `${apiBaseUrl}/assets/${encodeURIComponent(assetId)}/complete`,
    accessToken,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operationId }),
      signal,
    },
  )
}

export function renewAssetUploadTicket(
  apiBaseUrl: string,
  accessToken: string,
  assetId: string,
  operationId: string,
  signal?: AbortSignal,
): Promise<AssetUploadTicket> {
  return requestApi<AssetUploadTicket>(
    `${apiBaseUrl}/assets/${encodeURIComponent(assetId)}/upload-ticket`,
    accessToken,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operationId }),
      signal,
    },
  )
}

export function getAsset(
  apiBaseUrl: string,
  accessToken: string,
  assetId: string,
  signal?: AbortSignal,
): Promise<AssetStatus> {
  return requestApi<AssetStatus>(
    `${apiBaseUrl}/assets/${encodeURIComponent(assetId)}`,
    accessToken,
    { method: 'GET', signal },
  )
}

export function createAssetDownloadTickets(
  apiBaseUrl: string,
  accessToken: string,
  assetIds: string[],
  signal?: AbortSignal,
): Promise<AssetDownloadTickets> {
  return requestApi<AssetDownloadTickets>(`${apiBaseUrl}/assets/download-tickets`, accessToken, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assetIds }),
    signal,
  })
}
