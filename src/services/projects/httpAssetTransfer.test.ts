import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssetStatus, ReadyAssetMetadata } from '../../../shared/contracts/assets'
import { registerApiSessionRecovery } from '../api/client'
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
  it('uses the refreshed token for upload completion and keeps app auth off signed URLs', async () => {
    const signedCalls: RequestInit[] = []
    const apiCalls: RequestInit[] = []
    let token = 'app-token'
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
      expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${token}`)
      if (url === '/api/v1/assets/upload-intents') {
        if (token === 'app-token') {
          return Response.json({ error: { code: 'SESSION_INVALID', message: 'Session expired' } }, { status: 401 })
        }
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
    const dispose = registerApiSessionRecovery(() => ({
      isCurrent: (candidate) => candidate === token,
      refresh: async () => (token = 'refreshed-token'),
      expire: vi.fn(),
    }))

    try {
      const transfer = createHttpAssetTransfer({ apiBaseUrl: '/api/v1', getAccessToken: () => token })
      await expect(transfer.upload({
        workspaceId,
        purpose: 'project-decoration',
        mimeType: 'image/png',
        bytes,
        sourceSha256: 'b'.repeat(64),
      })).resolves.toEqual(ready)
      await expect(transfer.download([assetId])).resolves.toEqual([{ asset: ready, bytes }])
      expect(apiCalls.map((call) => new Headers(call.headers).get('authorization')))
        .toEqual(['Bearer app-token', 'Bearer refreshed-token', 'Bearer refreshed-token', 'Bearer refreshed-token'])
      expect(apiCalls[1].body).toBe(apiCalls[0].body)
      expect(signedCalls).toHaveLength(2)
    } finally {
      dispose()
    }
  })

  it('does not use download capabilities received after the bound account changed', async () => {
    let stillCurrent = true
    const fetchMock = vi.fn(async () => {
      stillCurrent = false
      return json({ tickets: [{ asset: ready, url: 'https://storage.test/download' }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const transfer = createHttpAssetTransfer({
      apiBaseUrl: '/api/v1',
      getAccessToken: () => {
        if (!stillCurrent) throw new Error('Account changed')
        return 'app-token'
      },
    })

    await expect(transfer.download([assetId])).rejects.toThrow('Account changed')
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, requestId }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
