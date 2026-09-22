import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestCloudBoxSpec } from './ai'

afterEach(() => vi.unstubAllGlobals())

describe('cloud AI API client', () => {
  it('sends bearer auth and the session-only key in headers, never in the JSON body', async () => {
    const apiKey = 'sk-ant-browser-session-only'
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const headers = new Headers(init.headers)
      const body = JSON.parse(String(init.body)) as Record<string, unknown>

      expect(url).toBe('/api/v1/ai/box-spec')
      expect(headers.get('authorization')).toBe('Bearer access-token')
      expect(headers.get('x-packit-anthropic-api-key')).toBe(apiKey)
      expect(JSON.stringify(body)).not.toContain(apiKey)
      expect(body).toEqual({ prompt: 'กล่องของฝาก' })

      return new Response(JSON.stringify({
        data: {
          template: 'tuck-end',
          materialId: 'carton-300',
          W: 80,
          D: 50,
          H: 120,
          handle: false,
          assumptions: [],
          layoutNote: '-',
          reasoning: 'test',
          mock: false,
        },
        requestId: crypto.randomUUID(),
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    await expect(requestCloudBoxSpec(
      '/api/v1',
      'access-token',
      apiKey,
      'กล่องของฝาก',
    )).resolves.toMatchObject({ template: 'tuck-end', mock: false })
  })
})
