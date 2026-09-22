import { createHash } from 'node:crypto'
import sharp from 'sharp'
import type { AssetMime } from '../../../shared/contracts/assets'

export const MAX_ASSET_BYTES = 10 * 1024 * 1024
export const MAX_ASSET_PIXELS = 20_000_000

export type AssetRejectionCode =
  | 'MIME_MISMATCH'
  | 'INVALID_IMAGE'
  | 'IMAGE_TOO_LARGE'
  | 'ANIMATED_IMAGE'
  | 'FINAL_OBJECT_TOO_LARGE'

export class AssetValidationError extends Error {
  constructor(readonly rejectionCode: AssetRejectionCode) {
    super(rejectionCode)
    this.name = 'AssetValidationError'
  }
}

export interface ValidatedImage {
  bytes: Buffer
  mimeType: AssetMime
  sha256: string
  width: number
  height: number
  extension: 'png' | 'jpg'
}

export async function validateAndCanonicalizeImage(
  input: Buffer,
  declaredMime: AssetMime,
): Promise<ValidatedImage> {
  if (input.length < 1 || input.length > MAX_ASSET_BYTES) {
    throw new AssetValidationError('IMAGE_TOO_LARGE')
  }

  try {
    const source = sharp(input, {
      failOn: 'warning',
      limitInputPixels: MAX_ASSET_PIXELS,
      animated: true,
    })
    const metadata = await source.metadata()
    const detectedMime: AssetMime | null = metadata.format === 'png'
      ? 'image/png'
      : metadata.format === 'jpeg'
        ? 'image/jpeg'
        : null
    if (!detectedMime || detectedMime !== declaredMime) {
      throw new AssetValidationError('MIME_MISMATCH')
    }
    if ((metadata.pages ?? 1) !== 1) {
      throw new AssetValidationError('ANIMATED_IMAGE')
    }
    if (!metadata.width || !metadata.height
      || metadata.width * metadata.height > MAX_ASSET_PIXELS) {
      throw new AssetValidationError('IMAGE_TOO_LARGE')
    }

    const pipeline = sharp(input, {
      failOn: 'warning',
      limitInputPixels: MAX_ASSET_PIXELS,
      animated: false,
    }).rotate()
    const output = detectedMime === 'image/png'
      ? await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
      : await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer({ resolveWithObject: true })
    if (output.data.length > MAX_ASSET_BYTES) {
      throw new AssetValidationError('FINAL_OBJECT_TOO_LARGE')
    }
    if (output.info.width * output.info.height > MAX_ASSET_PIXELS) {
      throw new AssetValidationError('IMAGE_TOO_LARGE')
    }
    return {
      bytes: output.data,
      mimeType: detectedMime,
      sha256: createHash('sha256').update(output.data).digest('hex'),
      width: output.info.width,
      height: output.info.height,
      extension: detectedMime === 'image/png' ? 'png' : 'jpg',
    }
  } catch (error) {
    if (error instanceof AssetValidationError) throw error
    throw new AssetValidationError('INVALID_IMAGE')
  }
}
