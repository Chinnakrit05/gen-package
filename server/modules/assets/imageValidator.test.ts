import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { AssetValidationError, validateAndCanonicalizeImage } from './imageValidator'

describe('asset image validation', () => {
  it('decodes and canonicalizes a single-frame PNG', async () => {
    const source = await sharp({
      create: { width: 3, height: 2, channels: 4, background: '#336699cc' },
    }).png().withMetadata({ orientation: 1 }).toBuffer()

    const result = await validateAndCanonicalizeImage(source, 'image/png')
    expect(result).toMatchObject({ mimeType: 'image/png', width: 3, height: 2, extension: 'png' })
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/)
    const metadata = await sharp(result.bytes).metadata()
    expect(metadata.exif).toBeUndefined()
  })

  it('rejects a declared MIME that does not match decoded bytes', async () => {
    const jpeg = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#ffffff' },
    }).jpeg().toBuffer()

    await expect(validateAndCanonicalizeImage(jpeg, 'image/png')).rejects.toEqual(
      expect.objectContaining<Partial<AssetValidationError>>({ rejectionCode: 'MIME_MISMATCH' }),
    )
  })

  it('rejects bytes that cannot be decoded as an image', async () => {
    await expect(validateAndCanonicalizeImage(Buffer.from('not an image'), 'image/png')).rejects.toEqual(
      expect.objectContaining<Partial<AssetValidationError>>({ rejectionCode: 'INVALID_IMAGE' }),
    )
  })
})
