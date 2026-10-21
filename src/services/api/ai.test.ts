import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from './client'
import { requestCloudArtwork, requestCloudBoxSpec } from './ai'

afterEach(() => vi.unstubAllGlobals())

const spec = {
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
}

describe('cloud AI API client', () => {
  it('sends bearer auth plus workspace/operation ids in the body and never an API key header', async () => {
    const operationId = crypto.randomUUID()
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const headers = new Headers(init.headers)
      const body = JSON.parse(String(init.body)) as Record<string, unknown>

      expect(url).toBe('/api/v1/ai/box-spec')
      expect(headers.get('authorization')).toBe('Bearer access-token')
      expect(headers.has('x-packit-anthropic-api-key')).toBe(false)
      expect(body).toEqual({ workspaceId: 'space', operationId, prompt: 'กล่องของฝาก' })

      return new Response(JSON.stringify({
        data: { ...spec, credits: 9 },
        requestId: crypto.randomUUID(),
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    await expect(requestCloudBoxSpec('/api/v1', 'access-token', {
      workspaceId: 'space',
      operationId,
      prompt: 'กล่องของฝาก',
    })).resolves.toMatchObject({ template: 'tuck-end', mock: false, credits: 9 })
  })

  it('wraps the reference image as an image block beside the current spec', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      expect(body.image).toEqual({ data: 'abc', mediaType: 'image/jpeg' })
      expect(body.current).toMatchObject({ template: 'tuck-end', W: 80 })
      return new Response(JSON.stringify({ data: { ...spec, credits: 4 }, requestId: crypto.randomUUID() }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))

    await expect(requestCloudBoxSpec('/api/v1', 'token', {
      workspaceId: 'space',
      operationId: crypto.randomUUID(),
      prompt: 'ปรับให้หรูขึ้น',
      current: { template: 'tuck-end', materialId: 'carton-300', W: 80, D: 50, H: 120, handle: false },
      imageBase64: 'abc',
    })).resolves.toMatchObject({ credits: 4 })
  })

  it('surfaces AI_CREDITS_EXHAUSTED as an ApiClientError carrying the remaining credits', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'AI_CREDITS_EXHAUSTED', message: 'เครดิต AI หมด', details: { credits: 0, plan: 'free' } },
      requestId: crypto.randomUUID(),
    }), { status: 402, headers: { 'content-type': 'application/json' } })))

    const failure = await requestCloudBoxSpec('/api/v1', 'token', {
      workspaceId: 'space',
      operationId: crypto.randomUUID(),
      prompt: 'กล่อง',
    }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ApiClientError)
    expect(failure).toMatchObject({ status: 402, code: 'AI_CREDITS_EXHAUSTED', details: { credits: 0 } })
  })

  it('posts the artwork request with workspace/operation ids to /ai/artwork and forwards the abort signal', async () => {
    const operationId = crypto.randomUUID()
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const headers = new Headers(init.headers)
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      expect(url).toBe('/api/v1/ai/artwork')
      expect(headers.get('authorization')).toBe('Bearer access-token')
      expect(init.signal).toBe(controller.signal)
      expect(body).toMatchObject({ workspaceId: 'space', operationId, prompt: 'ลายดอกไม้', panels: [{ id: 'front', w: 80 }], images: [] })
      return new Response(JSON.stringify({
        data: { ok: true, plan: { name: 'x', elements: [] }, issues: [], rounds: [], model: 'm', mock: false, credits: 3 },
        requestId: crypto.randomUUID(),
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    await expect(requestCloudArtwork('/api/v1', 'access-token', {
      workspaceId: 'space',
      operationId,
      prompt: 'ลายดอกไม้',
      kind: 'box',
      template: 'tuck-end',
      materialId: 'carton-300',
      box: { W: 80, D: 50, H: 120 },
      sheet: { w: 300, h: 250 },
      panels: [{ id: 'front', x0: 0, y0: 0, x1: 80, y1: 120, w: 80, h: 120, role: 'หน้า', print: true }],
      fillColor: null,
      existing: 0,
      images: [],
    }, controller.signal)).resolves.toMatchObject({ ok: true, credits: 3 })
  })
})
