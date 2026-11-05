import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAssetDownloadTickets } from './assets'
import { ApiClientError, NETWORK_ERROR, registerApiSessionRecovery, requestApi } from './client'
import { getProjectThumbnails } from './projects'

afterEach(() => vi.unstubAllGlobals())

describe('requestApi', () => {
  it('returns data and sends bearer auth without caching', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer token')
      expect(init.cache).toBe('no-store')
      return new Response(JSON.stringify({ data: { ok: true }, requestId: 'r' }), { status: 200 })
    }))
    await expect(requestApi('/api/v1/x', 'token', { method: 'GET' })).resolves.toEqual({ ok: true })
  })

  it('maps a server error envelope to ApiClientError with its code and details', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'PURCHASE_UNAVAILABLE', message: 'ยังไม่เปิดขาย', details: { a: 1 } },
      requestId: 'r',
    }), { status: 503 })))
    const failure = await requestApi('/api/v1/x', 'token', { method: 'POST' }).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(ApiClientError)
    expect(failure).toMatchObject({ status: 503, code: 'PURCHASE_UNAVAILABLE', message: 'ยังไม่เปิดขาย', details: { a: 1 } })
  })

  it('turns a fetch rejection (no response) into a translated NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))
    const failure = await requestApi('/api/v1/x', 'secret-token', { method: 'GET' }).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(ApiClientError)
    expect(failure).toMatchObject({ status: 0, code: NETWORK_ERROR })
    expect((failure as Error).message).toBe('เชื่อมต่อ server ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่')
    expect((failure as Error).message).not.toContain('secret-token')
  })

  it('rethrows an AbortError unchanged', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError')
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw abort
    }))
    await expect(requestApi('/api/v1/x', 'token', { method: 'GET' })).rejects.toBe(abort)
  })

  it('rethrows the caller abort reason unchanged when the signal was aborted', async () => {
    const controller = new AbortController()
    const reason = new Error('stale request')
    controller.abort(reason)
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      throw init.signal?.reason
    }))
    await expect(requestApi('/api/v1/x', 'token', { method: 'GET', signal: controller.signal })).rejects.toBe(reason)
  })

  it('keeps a non-JSON failure response as INVALID_RESPONSE with the HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 })))
    await expect(requestApi('/api/v1/x', 'token', { method: 'GET' })).rejects.toMatchObject({
      status: 502,
      code: 'INVALID_RESPONSE',
    })
  })

  it('recovers one session failure and replays the same idempotent save payload', async () => {
    const init = { method: 'PUT', body: JSON.stringify({ operationId: 'save-1', expectedRevision: 7 }) }
    const response = vi.fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(sessionFailure())
      .mockResolvedValueOnce(Response.json({ data: { revision: 8 } }))
    vi.stubGlobal('fetch', response)
    const refresh = vi.fn(async () => 'rotated')
    const dispose = registerApiSessionRecovery(() => ({ refresh, isCurrent: () => true, expire: vi.fn() }))
    try {
      await expect(requestApi('/api/v1/projects/p1', 'token', init)).resolves.toEqual({ revision: 8 })
      expect(refresh).toHaveBeenCalledOnce()
      expect(response.mock.calls.map(([, request]) => new Headers(request.headers).get('authorization')))
        .toEqual(['Bearer token', 'Bearer rotated'])
      expect(response.mock.calls.map(([, request]) => request.body)).toEqual([init.body, init.body])
    } finally {
      dispose()
    }
  })

  it('never replays a mutation without an operation ID or a request whose account changed', async () => {
    const response = vi.fn(async () => sessionFailure())
    vi.stubGlobal('fetch', response)
    const refresh = vi.fn(async () => 'rotated')
    const isCurrent = vi.fn(() => true)
    const expire = vi.fn()
    const dispose = registerApiSessionRecovery(() => ({ refresh, isCurrent, expire }))
    try {
      await expect(requestApi('/api/v1/projects', 'token', { method: 'POST', body: '{}' })).rejects.toMatchObject({ status: 401 })
      isCurrent.mockReturnValue(false)
      await expect(requestApi('/api/v1/projects', 'token', { method: 'GET' })).rejects.toMatchObject({ status: 401 })
      expect(response).toHaveBeenCalledTimes(2)
      expect(expire).not.toHaveBeenCalled()
    } finally {
      dispose()
    }
  })

  it.each([
    ['thumbnail batch', () => getProjectThumbnails('/api/v1', 'token', { workspaceId: 'team', projectIds: ['p1'] }), { items: [] }],
    ['asset download tickets', () => createAssetDownloadTickets('/api/v1', 'token', ['asset-1']), { tickets: [] }],
  ] as const)('replays a read-only %s POST after refresh', async (_name, request, data) => {
    const response = vi.fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(sessionFailure())
      .mockResolvedValueOnce(Response.json({ data }))
    vi.stubGlobal('fetch', response)
    const refresh = vi.fn(async () => 'rotated')
    const dispose = registerApiSessionRecovery(() => ({ refresh, isCurrent: () => true, expire: vi.fn() }))
    try {
      await expect(request()).resolves.toEqual(data)
      expect(refresh).toHaveBeenCalledOnce()
      expect(response.mock.calls.map(([, init]) => init.method)).toEqual(['POST', 'POST'])
      expect(response.mock.calls[1][1].body).toBe(response.mock.calls[0][1].body)
      expect(new Headers(response.mock.calls[1][1].headers).get('authorization')).toBe('Bearer rotated')
    } finally {
      dispose()
    }
  })

  it('does not recover an unrelated 401 and expires only after a second known session failure', async () => {
    const response = vi.fn(async () => sessionFailure())
      .mockResolvedValueOnce(new Response('Preview authorization required', { status: 401 }))
    vi.stubGlobal('fetch', response)
    const refresh = vi.fn(async () => 'rotated')
    const expire = vi.fn()
    const dispose = registerApiSessionRecovery(() => ({ refresh, isCurrent: () => true, expire }))
    try {
      await expect(requestApi('/api/v1/me', 'token', {})).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
      expect(refresh).not.toHaveBeenCalled()
      await expect(requestApi('/api/v1/me', 'token', {})).rejects.toMatchObject({ code: 'SESSION_INVALID' })
      expect(refresh).toHaveBeenCalledOnce()
      expect(expire).toHaveBeenCalledExactlyOnceWith('rotated')
      expect(response).toHaveBeenCalledTimes(3)
    } finally {
      dispose()
    }
  })
})

function sessionFailure(): Response {
  return Response.json({ error: { code: 'SESSION_INVALID', message: 'Session expired' } }, { status: 401 })
}
