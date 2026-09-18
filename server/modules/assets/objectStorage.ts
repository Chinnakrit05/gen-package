import type { AssetMime } from '../../../shared/contracts/assets'

export class StorageObjectMissingError extends Error {
  constructor() {
    super('Storage object missing')
    this.name = 'StorageObjectMissingError'
  }
}

export interface ObjectStorage {
  createUploadTicket(key: string): Promise<{ url: string }>
  download(key: string): Promise<Buffer>
  putImmutable(key: string, bytes: Buffer, mimeType: AssetMime): Promise<void>
  signDownload(key: string, expiresInSeconds: number): Promise<{ url: string }>
  remove(key: string): Promise<void>
}
