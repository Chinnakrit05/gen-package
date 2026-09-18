import type {
  AssetDownloadTickets,
  AssetStatus,
  AssetUploadTicket,
  CompleteAssetInput,
  CreateAssetUploadIntentInput,
  RenewAssetUploadInput,
} from '../../../shared/contracts/assets'
import type { Actor } from '../identity/actor'
import { requestHash } from '../projects/canonical'
import type { AssetRepository, InternalAsset } from './assetRepository'
import { AssetValidationError, validateAndCanonicalizeImage } from './imageValidator'
import { StorageObjectMissingError, type ObjectStorage } from './objectStorage'

const UPLOAD_TICKET_MS = 2 * 60 * 60 * 1000
const VALIDATION_LEASE_MS = 2 * 60 * 1000
const DOWNLOAD_TICKET_SECONDS = 5 * 60

function publicStatus(asset: InternalAsset): AssetStatus {
  return {
    id: asset.id,
    workspaceId: asset.workspaceId,
    purpose: asset.purpose,
    state: asset.state,
    declaredMime: asset.declaredMime,
    declaredSize: asset.declaredSize,
    mimeType: asset.mimeType,
    byteSize: asset.byteSize,
    sha256: asset.sha256,
    width: asset.width,
    height: asset.height,
    rejectionCode: asset.rejectionCode,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  }
}

export class AssetService {
  constructor(
    private readonly repository: AssetRepository,
    private readonly storage: ObjectStorage,
  ) {}

  private async ticket(asset: InternalAsset): Promise<AssetUploadTicket> {
    if (asset.state !== 'pending') return { asset: publicStatus(asset), upload: null }
    const signed = await this.storage.createUploadTicket(asset.stagingKey)
    return {
      asset: publicStatus(asset),
      upload: {
        url: signed.url,
        method: 'PUT',
        headers: {
          'content-type': asset.declaredMime,
          'cache-control': 'max-age=3600',
          'x-upsert': 'false',
        },
        expiresAt: asset.ticketExpiresAt,
      },
    }
  }

  async createIntent(actor: Actor, input: CreateAssetUploadIntentInput): Promise<AssetUploadTicket> {
    const hash = requestHash({ operationType: 'create-asset', ...input })
    const asset = await this.repository.createIntent(actor, {
      ...input,
      requestHash: hash,
      ticketExpiresAt: new Date(Date.now() + UPLOAD_TICKET_MS).toISOString(),
    })
    return this.ticket(asset)
  }

  async renewTicket(actor: Actor, input: RenewAssetUploadInput): Promise<AssetUploadTicket> {
    const hash = requestHash({ operationType: 'renew-asset-ticket', ...input })
    const asset = await this.repository.renewTicket(actor, {
      ...input,
      requestHash: hash,
      ticketExpiresAt: new Date(Date.now() + UPLOAD_TICKET_MS).toISOString(),
    })
    return this.ticket(asset)
  }

  async complete(actor: Actor, input: CompleteAssetInput): Promise<AssetStatus> {
    const hash = requestHash({ operationType: 'complete-asset', ...input })
    const claimed = await this.repository.claimValidation(actor, {
      ...input,
      requestHash: hash,
      leaseUntil: new Date(Date.now() + VALIDATION_LEASE_MS).toISOString(),
    })
    if (!claimed.claimed || claimed.state === 'ready' || claimed.state === 'rejected') {
      return publicStatus(claimed)
    }

    try {
      const uploaded = await this.storage.download(claimed.stagingKey)
      const image = await validateAndCanonicalizeImage(uploaded, claimed.declaredMime)
      const objectKey = `assets/${claimed.workspaceId}/${claimed.id}/${claimed.processingFencingVersion}.${image.extension}`
      await this.storage.putImmutable(objectKey, image.bytes, image.mimeType)
      const ready = await this.repository.finalizeValidation(actor, {
        assetId: claimed.id,
        operationId: input.operationId,
        requestHash: hash,
        fencingVersion: claimed.processingFencingVersion,
        objectKey,
        mimeType: image.mimeType,
        byteSize: image.bytes.length,
        sha256: image.sha256,
        width: image.width,
        height: image.height,
      })
      void this.storage.remove(claimed.stagingKey).catch(() => undefined)
      return publicStatus(ready)
    } catch (error) {
      const rejectionCode = error instanceof AssetValidationError
        ? error.rejectionCode
        : error instanceof StorageObjectMissingError
          ? 'OBJECT_MISSING'
          : null
      if (!rejectionCode) throw error
      const rejected = await this.repository.rejectValidation(actor, {
        assetId: claimed.id,
        operationId: input.operationId,
        requestHash: hash,
        fencingVersion: claimed.processingFencingVersion,
        rejectionCode,
      })
      void this.storage.remove(claimed.stagingKey).catch(() => undefined)
      return publicStatus(rejected)
    }
  }

  async get(actor: Actor, assetId: string): Promise<AssetStatus> {
    return publicStatus(await this.repository.get(actor, assetId))
  }

  async createDownloadTickets(actor: Actor, assetIds: string[]): Promise<AssetDownloadTickets> {
    const assets = await this.repository.getForDownload(actor, assetIds)
    const expiresAt = new Date(Date.now() + DOWNLOAD_TICKET_SECONDS * 1000).toISOString()
    return {
      tickets: await Promise.all(assets.map(async ({ objectKey, ...asset }) => ({
        asset,
        url: (await this.storage.signDownload(objectKey, DOWNLOAD_TICKET_SECONDS)).url,
        expiresAt,
      }))),
    }
  }
}
