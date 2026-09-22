import type { AssetStatus, ReadyAssetMetadata } from '../../../shared/contracts/assets'
import {
  completeAsset,
  createAssetDownloadTickets,
  createAssetUploadIntent,
  uploadAssetBytes,
} from '../api/assets'
import type { CodecAssetDownload, CodecAssetUploadInput, ProjectAssetTransfer } from './cloudProjectCodec'

export interface HttpAssetTransferOptions {
  apiBaseUrl: string
  accessToken: string
}

export function createHttpAssetTransfer(options: HttpAssetTransferOptions): ProjectAssetTransfer {
  return {
    async upload(input: CodecAssetUploadInput): Promise<ReadyAssetMetadata> {
      const intent = await createAssetUploadIntent(options.apiBaseUrl, options.accessToken, {
        workspaceId: input.workspaceId,
        purpose: input.purpose,
        declaredMime: input.mimeType,
        declaredSize: input.bytes.byteLength,
        operationId: crypto.randomUUID(),
      }, input.signal)

      if (intent.asset.state === 'ready') return toReadyAsset(intent.asset)
      if (!intent.upload) throw new Error('server ไม่ได้ออก upload ticket สำหรับ pending asset')

      await uploadAssetBytes(
        intent.upload,
        new Blob([input.bytes as Uint8Array<ArrayBuffer>], { type: input.mimeType }),
        input.signal,
      )
      const completed = await completeAsset(
        options.apiBaseUrl,
        options.accessToken,
        intent.asset.id,
        crypto.randomUUID(),
        input.signal,
      )
      return toReadyAsset(completed)
    },

    async download(assetIds: string[], signal?: AbortSignal): Promise<CodecAssetDownload[]> {
      const response = await createAssetDownloadTickets(
        options.apiBaseUrl,
        options.accessToken,
        assetIds,
        signal,
      )
      return Promise.all(response.tickets.map(async (ticket) => {
        const download = await fetch(ticket.url, { method: 'GET', signal })
        if (!download.ok) throw new Error(`ดาวน์โหลด asset ไม่สำเร็จ (${download.status})`)
        return {
          asset: ticket.asset,
          bytes: new Uint8Array(await download.arrayBuffer()),
        }
      }))
    },
  }
}

function toReadyAsset(asset: AssetStatus): ReadyAssetMetadata {
  if (
    asset.state !== 'ready'
    || asset.mimeType === null
    || asset.byteSize === null
    || asset.sha256 === null
    || asset.width === null
    || asset.height === null
  ) {
    throw new Error(asset.rejectionCode
      ? `asset ถูกปฏิเสธ (${asset.rejectionCode})`
      : `asset ยังไม่พร้อม (${asset.state})`)
  }
  return {
    id: asset.id,
    workspaceId: asset.workspaceId,
    purpose: asset.purpose,
    state: 'ready',
    mimeType: asset.mimeType,
    byteSize: asset.byteSize,
    sha256: asset.sha256,
    width: asset.width,
    height: asset.height,
    createdAt: asset.createdAt,
  }
}
