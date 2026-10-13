import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError, NETWORK_ERROR, requestApi } from './client'

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
})
