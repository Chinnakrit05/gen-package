import { describe, expect, it } from 'vitest'
import type { SessionService } from '../modules/identity/sessionService'
import { createApiRouter, type HttpRequest, type HttpResponse } from './router'

function request(method: string, url: string, authorization?: string): HttpRequest {
  return { method, url, headers: authorization ? { authorization } : {} }
}

function response() {
  const headers = new Map<string, string>()
  let body = ''
  const res: HttpResponse = {
    statusCode: 0,
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value)
    },
    end(value) {
      body = value ?? ''
    },
  }
  return { res, headers, readBody: () => JSON.parse(body) as Record<string, unknown> }
}

const config = { appEnv: 'test' as const, allowedOrigins: [], supabase: null }
const router = createApiRouter(config)

describe('API router', () => {
  it('returns a minimal health response with a server request ID', async () => {
    const target = response()
    await router(request('GET', '/api/v1/health?probe=readiness'), target.res)

    expect(target.res.statusCode).toBe(200)
    expect(target.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(target.headers.get('cache-control')).toBe('no-store')
    expect(target.readBody()).toEqual({
      data: { status: 'ok' },
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    })
  })

  it('uses the shared error envelope for unknown routes instead of SPA HTML', async () => {
    const target = response()
    await router(request('GET', '/api/v1/unknown'), target.res)

    expect(target.res.statusCode).toBe(404)
    expect(target.readBody()).toMatchObject({ error: { code: 'NOT_FOUND' } })
  })

  it('rejects unsupported methods and advertises the allowed method', async () => {
    const target = response()
    await router(request('POST', '/api/v1/health'), target.res)

    expect(target.res.statusCode).toBe(405)
    expect(target.headers.get('allow')).toBe('GET')
    expect(target.readBody()).toMatchObject({ error: { code: 'METHOD_NOT_ALLOWED' } })
  })

  it('fails closed when session bootstrap has no bearer token or server config', async () => {
    const missingConfig = response()
    await router(request('POST', '/api/v1/session/bootstrap', 'Bearer token'), missingConfig.res)
    expect(missingConfig.res.statusCode).toBe(503)
    expect(missingConfig.readBody()).toMatchObject({ error: { code: 'CONFIGURATION_ERROR' } })

    const fakeService: SessionService = {
      bootstrap: async () => { throw new Error('must not be called') },
    }
    const configuredRouter = createApiRouter(config, { sessionService: fakeService })
    const missingToken = response()
    await configuredRouter(request('POST', '/api/v1/session/bootstrap'), missingToken.res)
    expect(missingToken.res.statusCode).toBe(401)
    expect(missingToken.readBody()).toMatchObject({ error: { code: 'AUTH_REQUIRED' } })
  })

  it('bootstraps a verified session and never accepts actor identity from the request body', async () => {
    const calls: string[] = []
    const fakeService: SessionService = {
      async bootstrap(token) {
        calls.push(token)
        return {
          user: { id: 'user-1', displayName: 'Tester', email: 'test@example.com' },
          personalWorkspace: { id: 'workspace-1', kind: 'personal', name: 'พื้นที่ส่วนตัว', role: 'owner' },
        }
      },
    }
    const configuredRouter = createApiRouter(config, { sessionService: fakeService })
    const target = response()
    await configuredRouter(request('POST', '/api/v1/session/bootstrap', 'Bearer verified-token'), target.res)

    expect(target.res.statusCode).toBe(200)
    expect(calls).toEqual(['verified-token'])
    expect(target.readBody()).toMatchObject({
      data: { user: { id: 'user-1' }, personalWorkspace: { id: 'workspace-1' } },
    })
  })

  it('rejects malformed bearer schemes before calling the auth service', async () => {
    const fakeService: SessionService = {
      bootstrap: async () => { throw new Error('must not be called') },
    }
    const configuredRouter = createApiRouter(config, { sessionService: fakeService })
    const target = response()
    await configuredRouter(request('POST', '/api/v1/session/bootstrap', 'Basic abc'), target.res)
    expect(target.res.statusCode).toBe(401)
    expect(target.readBody()).toMatchObject({ error: { code: 'SESSION_INVALID' } })
  })
})
