export type AssetPurpose = 'project-decoration' | 'project-fill'
export type AssetState = 'pending' | 'validating' | 'ready' | 'rejected'
export type AssetMime = 'image/png' | 'image/jpeg'

export interface AssetStatus {
  id: string
  workspaceId: string
  purpose: AssetPurpose
  state: AssetState
  declaredMime: AssetMime
  declaredSize: number
  mimeType: AssetMime | null
  byteSize: number | null
  sha256: string | null
  width: number | null
  height: number | null
  rejectionCode: string | null
  createdAt: string
  updatedAt: string
}

export interface ReadyAssetMetadata {
  id: string
  workspaceId: string
  purpose: AssetPurpose
  state: 'ready'
  mimeType: AssetMime
  byteSize: number
  sha256: string
  width: number
  height: number
  createdAt: string
}

export interface CreateAssetUploadIntentInput {
  workspaceId: string
  purpose: AssetPurpose
  declaredMime: AssetMime
  declaredSize: number
  operationId: string
}

export interface AssetUploadTicket {
  asset: AssetStatus
  upload: null | {
    url: string
    method: 'PUT'
    headers: Record<string, string>
    expiresAt: string
  }
}

export interface CompleteAssetInput {
  assetId: string
  operationId: string
}

export interface RenewAssetUploadInput {
  assetId: string
  operationId: string
}

export interface AssetDownloadTicket {
  asset: ReadyAssetMetadata
  url: string
  expiresAt: string
}

export interface AssetDownloadTickets {
  tickets: AssetDownloadTicket[]
}
