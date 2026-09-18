import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssetStatus, ReadyAssetMetadata } from '../../../shared/contracts/assets'
import { createHttpAssetTransfer } from './httpAssetTransfer'

afterEach(() => vi.unstubAllGlobals())

const workspaceId = '11111111-1111-4111-8111-111111111111'
const assetId = '22222222-2222-4222-8222-222222222222'
const requestId = '33333333-3333-4333-8333-333333333333'
const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

const pending: AssetStatus = {
  id: assetId,
  workspaceId,
  purpose: 'project-decoration',
  state: 'pending',
  declaredMime: 'image/png',
  declaredSize: bytes.byteLength,
  mimeType: null,
  byteSize: null,
  sha256: null,
  width: null,
  height: null,
  rejectionCode: null,
  createdAt: '2026-09-18T00:00:00.000Z',
  updatedAt: '2026-09-18T00:00:00.000Z',
}

const ready: ReadyAssetMetadata = {
  id: assetId,
  workspaceId,
  purpose: 'project-decoration',
  state: 'ready',
  mimeType: 'image/png',
  byteSize: bytes.byteLength,
  sha256: 'a'.repeat(64),
  width: 1,
  height: 1,
  createdAt: pending.createdAt,
}

describe('HTTP project asset transfer', () => {
  it('uses app auth only for API calls and raw signed URLs for object bytes', async () => {
    const signedCalls: RequestInit[] = []
    const apiCalls: RequestInit[] = []
    const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url === 'https://storage.test/upload') {
        signedCalls.push(init)
        expect(new Headers(init.headers).get('authorization')).toBeNull()
        expect(await (init.body as Blob).arrayBuffer()).toEqual(bytes.buffer)
        return new Response(null, { status: 200 })
      }
      if (url === 'https://storage.test/download') {
        signedCalls.push(init)
        expect(new Headers(init.headers).get('authorization')).toBeNull()
        return new Response(bytes, { status: 200, headers: { 'content-type': 'image/png' } })
      }

      apiCalls.push(init)
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer app-token')
      if (url === '/api/v1/assets/upload-intents') {
        return json({
          asset: pending,
          upload: {
            url: 'https://storage.test/upload',
            method: 'PUT',
            headers: { 'content-type': 'image/png', 'x-upsert': 'false' },
            expiresAt: '2026-09-18T02:00:00.000Z',
          },
        }, 201)
      }
      if (url === `/api/v1/assets/${assetId}/complete`) {
        return json({
          ...pending,
          ...ready,
          declaredMime: 'image/png',
          declaredSize: bytes.byteLength,
          rejectionCode: null,
          updatedAt: '2026-09-18T00:01:00.000Z',
        })
      }
      if (url === '/api/v1/assets/download-tickets') {
        return json({
          tickets: [{ asset: ready, url: 'https://storage.test/download', expiresAt: '2026-09-18T00:05:00.000Z' }],
        })
      }
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const transfer = createHttpAssetTransfer({ apiBaseUrl: '/api/v1', accessToken: 'app-token' })
    await expect(transfer.upload({
      workspaceId,
      purpose: 'project-decoration',
      mimeType: 'image/png',
      bytes,
      sourceSha256: 'b'.repeat(64),
    })).resolves.toEqual(ready)
    await expect(transfer.download([assetId])).resolves.toEqual([{ asset: ready, bytes }])
    expect(apiCalls).toHaveLength(3)
    expect(signedCalls).toHaveLength(2)
  })
})

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, requestId }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
