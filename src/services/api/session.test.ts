import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootstrapSession } from './session'

afterEach(() => vi.unstubAllGlobals())

describe('bootstrapSession', () => {
  it('sends the current bearer token and returns the server identity', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.headers).toMatchObject({ authorization: 'Bearer token-1' })
      return new Response(JSON.stringify({
        data: {
          user: { id: 'user-1', displayName: 'Tester', email: null },
          personalWorkspace: { id: 'workspace-1', kind: 'personal', name: 'พื้นที่ส่วนตัว', role: 'owner' },
        },
        requestId: 'request-1',
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(bootstrapSession('/api/v1', 'token-1')).resolves.toMatchObject({
      user: { id: 'user-1' },
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/session/bootstrap', expect.any(Object))
  })

  it('maps the shared API error without exposing the token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'SESSION_INVALID', message: 'Session หมดอายุ' },
      requestId: 'request-1',
    }), { status: 401, headers: { 'content-type': 'application/json' } })))

    await expect(bootstrapSession('/api/v1', 'secret-token')).rejects.toEqual(
      expect.objectContaining({ status: 401, code: 'SESSION_INVALID' }),
    )
  })
})
