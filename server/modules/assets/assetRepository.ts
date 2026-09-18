import type {
  AssetMime,
  AssetPurpose,
  AssetState,
  ReadyAssetMetadata,
} from '../../../shared/contracts/assets'
import type { Actor } from '../identity/actor'

export interface InternalAsset {
  id: string
  workspaceId: string
  purpose: AssetPurpose
  state: AssetState
  stagingKey: string
  objectKey: string | null
  declaredMime: AssetMime
  declaredSize: number
  mimeType: AssetMime | null
  byteSize: number | null
  sha256: string | null
  width: number | null
  height: number | null
  ticketExpiresAt: string
  processingLeaseUntil: string | null
  processingFencingVersion: number
  rejectionCode: string | null
  createdAt: string
  updatedAt: string
}

export interface ClaimedAsset extends InternalAsset {
  claimed: boolean
}

export interface AssetRepository {
  createIntent(actor: Actor, input: {
    workspaceId: string
    operationId: string
    requestHash: string
    purpose: AssetPurpose
    declaredMime: AssetMime
    declaredSize: number
    ticketExpiresAt: string
  }): Promise<InternalAsset>
  renewTicket(actor: Actor, input: {
    assetId: string
    operationId: string
    requestHash: string
    ticketExpiresAt: string
  }): Promise<InternalAsset>
  claimValidation(actor: Actor, input: {
    assetId: string
    operationId: string
    requestHash: string
    leaseUntil: string
  }): Promise<ClaimedAsset>
  finalizeValidation(actor: Actor, input: {
    assetId: string
    operationId: string
    requestHash: string
    fencingVersion: number
    objectKey: string
    mimeType: AssetMime
    byteSize: number
    sha256: string
    width: number
    height: number
  }): Promise<InternalAsset>
  rejectValidation(actor: Actor, input: {
    assetId: string
    operationId: string
    requestHash: string
    fencingVersion: number
    rejectionCode: string
  }): Promise<InternalAsset>
  get(actor: Actor, assetId: string): Promise<InternalAsset>
  getForDownload(actor: Actor, assetIds: string[]): Promise<Array<ReadyAssetMetadata & { objectKey: string }>>
}
