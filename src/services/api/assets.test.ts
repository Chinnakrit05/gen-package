import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssetUploadTicket } from '../../../shared/contracts/assets'
import { createAssetUploadIntent, uploadAssetBytes } from './assets'

afterEach(() => vi.unstubAllGlobals())

describe('asset API client', () => {
  it('creates an authenticated upload intent', async () => {
    const assetId = crypto.randomUUID()
    const workspaceId = crypto.randomUUID()
    const operationId = crypto.randomUUID()
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('/api/v1/assets/upload-intents')
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer token')
      expect(JSON.parse(String(init.body))).toMatchObject({ workspaceId, operationId })
      return new Response(JSON.stringify({
        data: {
          asset: {
            id: assetId,
            workspaceId,
            purpose: 'project-decoration',
            state: 'pending',
            declaredMime: 'image/png',
            declaredSize: 10,
            mimeType: null,
            byteSize: null,
            sha256: null,
            width: null,
            height: null,
            rejectionCode: null,
            createdAt: '2026-09-18T00:00:00.000Z',
            updatedAt: '2026-09-18T00:00:00.000Z',
          },
          upload: {
            url: 'https://storage.test/upload',
            method: 'PUT',
            headers: { 'content-type': 'image/png', 'x-upsert': 'false' },
            expiresAt: '2026-09-18T02:00:00.000Z',
          },
        },
        requestId: crypto.randomUUID(),
      }), { status: 201, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(createAssetUploadIntent('/api/v1', 'token', {
      workspaceId,
      operationId,
      purpose: 'project-decoration',
      declaredMime: 'image/png',
      declaredSize: 10,
    })).resolves.toMatchObject({ asset: { id: assetId } })
  })

  it('uploads raw bytes only to the scoped signed URL', async () => {
    const ticket: NonNullable<AssetUploadTicket['upload']> = {
      url: 'https://storage.test/upload?token=secret-capability',
      method: 'PUT',
      headers: { 'content-type': 'image/png', 'x-upsert': 'false' },
      expiresAt: '2026-09-18T02:00:00.000Z',
    }
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(ticket.url)
      expect(init.method).toBe('PUT')
      expect(new Headers(init.headers).get('authorization')).toBeNull()
      expect(new Headers(init.headers).get('x-upsert')).toBe('false')
      return new Response(null, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(uploadAssetBytes(ticket, new Blob(['png']))).resolves.toBeUndefined()
  })
})
