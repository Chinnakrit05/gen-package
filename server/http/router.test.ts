import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BillingCatalog, Order } from '../../shared/contracts/billing'
import type { CloudProjectDocumentV1 } from '../../shared/contracts/projects'
import { mapBillingDatabaseError } from '../adapters/supabase/billingRepository'
import type { ServerConfig } from '../config'
import type { SessionService } from '../modules/identity/sessionService'
import type { AssetService } from '../modules/assets/assetService'
import { AiProviderError, type AiService } from '../modules/ai/aiService'
import type { BillingRepository, StoredEntitlements } from '../modules/billing/billingService'
import type { ProjectRepository } from '../modules/projects/projectRepository'
import { ProjectService } from '../modules/projects/projectService'
import { normalizeVercelRequestUrl } from '../entrypoints/vercel'
import { HttpError } from './errors'
import { billingFlags, createApiRouter, type HttpRequest, type HttpResponse } from './router'

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

const config = { appEnv: 'test' as const, allowedOrigins: [], supabase: null, ai: null }
const router = createApiRouter(config)

const actor = {
  userId: '10000000-0000-4000-8000-000000000001',
  identityIssuer: 'https://test.supabase.local/auth/v1',
  identitySubject: 'subject-1',
  requestId: 'request-1',
}
const workspaceId = '20000000-0000-4000-8000-000000000001'
const projectId = '30000000-0000-4000-8000-000000000001'
const operationId = '40000000-0000-4000-8000-000000000001'
const aiRequestId = '60000000-0000-4000-8000-000000000001'
const orderId = '70000000-0000-4000-8000-000000000001'
const serverAiKey = 'sk-ant-server-only-never-echoed'
const catalog: BillingCatalog = {
  design: { kind: 'design', amountMinor: 14900, currency: 'THB', credits: 10, periodDays: null },
  pro: { kind: 'pro', amountMinor: 39900, currency: 'THB', credits: 100, periodDays: 30 },
}
const storedEntitlements: StoredEntitlements = {
  workspaceId,
  plan: 'free',
  proUntil: null,
  credits: 3,
  licensedProjectIds: [],
  catalog,
}
// สิทธิ์ตอน open access = รอบ Pro ฟรี (ensure_open_access)
const openEntitlements: StoredEntitlements = {
  ...storedEntitlements,
  plan: 'pro',
  proUntil: '2026-11-14T00:00:00.000Z',
  credits: 100,
}
const pendingOrder: Order = {
  id: orderId,
  workspaceId,
  kind: 'design',
  projectId,
  amountMinor: 14900,
  currency: 'THB',
  credits: 10,
  status: 'pending',
  provider: 'none',
  providerRef: null,
  checkoutUrl: null,
  createdAt: '2026-10-13T00:00:00.000Z',
  paidAt: null,
}
const aiModel = 'claude-test-model'
const aiUsage = { inputTokens: 1200, outputTokens: 340, cacheReadTokens: 0, cacheCreationTokens: 0 }
// รูปอ้างอิงขั้นต่ำที่ parseImage ยอมรับ (base64 ≥ 100 ตัวอักษร)
const refImage = { data: 'A'.repeat(120), mediaType: 'image/png' }
const boxSpec = {
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
const document: CloudProjectDocumentV1 = {
  live: { template: 'tuck-end', materialId: 'carton-300', W: 80, D: 50, H: 120, handle: false },
  qty: 500,
  fillColor: null,
  decos: [],
  history: [],
  histIdx: -1,
}

function projectRouter(repository: ProjectRepository) {
  const sessionService: SessionService = {
    bootstrap: async () => { throw new Error('must not be called') },
    authenticate: async () => actor,
    getMe: async () => ({
      user: { id: actor.userId, displayName: 'Tester', email: null },
      workspaces: [{ id: workspaceId, kind: 'personal', name: 'พื้นที่ส่วนตัว', role: 'owner' }],
    }),
  }
  return createApiRouter(config, {
    sessionService,
    projectService: new ProjectService(repository),
  })
}

function repositoryStub(overrides: Partial<ProjectRepository> = {}): ProjectRepository {
  return {
    list: async () => ({ items: [], nextCursor: null }),
    get: async () => { throw new Error('must not be called') },
    create: async () => { throw new Error('must not be called') },
    importLegacy: async () => { throw new Error('must not be called') },
    save: async () => { throw new Error('must not be called') },
    remove: async () => { throw new Error('must not be called') },
    ...overrides,
  }
}

function billingRepositoryStub(overrides: Partial<BillingRepository> = {}): BillingRepository {
  return {
    getEntitlements: async () => storedEntitlements,
    authorizeExport: async () => { throw new Error('must not be called') },
    ensureOpenAccess: async () => { throw new Error('must not be called') },
    authorizeOpenAccessExport: async () => { throw new Error('must not be called') },
    reserveAiCredit: async () => { throw new Error('must not be called') },
    settleAiRequest: async () => { throw new Error('must not be called') },
    createOrder: async () => { throw new Error('must not be called') },
    fulfilOrder: async () => { throw new Error('must not be called') },
    ...overrides,
  }
}

// router ที่มี billing service จริงต่อกับ repository ปลอม — ส่ง repository ให้ createApiRouter สร้าง service เอง
// สวิตช์เปิดขาย/จำลองจ่ายจึงมาจาก billingFlags(config) ตัวจริงของ router ไม่ใช่สูตรที่เทสต์ลอกมา
function billingRouter(
  repository: BillingRepository,
  options: { appEnv?: ServerConfig['appEnv']; ai?: ServerConfig['ai']; aiService?: AiService } = {},
) {
  const appEnv = options.appEnv ?? 'test'
  const sessionService: SessionService = {
    bootstrap: async () => { throw new Error('must not be called') },
    authenticate: async () => actor,
    getMe: async () => { throw new Error('must not be called') },
  }
  return createApiRouter({ appEnv, allowedOrigins: [], supabase: null, ai: options.ai ?? null }, {
    sessionService,
    projectService: null,
    assetService: null,
    aiService: options.aiService ?? null,
    billingRepository: repository,
  })
}

// authorization null = ไม่ส่ง bearer (undefined จะถูกแทนด้วยค่า default)
function aiRequest(body: unknown, authorization: string | null = 'Bearer verified-token'): HttpRequest {
  return {
    method: 'POST',
    url: '/api/v1/ai/box-spec',
    headers: { ...(authorization ? { authorization } : {}), 'content-type': 'application/json' },
    body,
  }
}

// อ่าน log บรรทัดเดียว (JSON) ที่ server เขียนผ่าน logServerEvent
function logLines(spy: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
  return spy.mock.calls.map((call) => {
    expect(call).toHaveLength(1)
    expect(String(call[0])).not.toContain('\n')
    return JSON.parse(String(call[0])) as Record<string, unknown>
  })
}

describe('API router', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each(['/api/backend', '/api/v1/projects'])(
    'lists projects through the Vercel adapter at %s without relaxing query validation',
    async (runtimePath) => {
      const listed: unknown[] = []
      const handler = projectRouter(repositoryStub({
        list: async (_actor, query) => {
          listed.push(query)
          return { items: [], nextCursor: null }
        },
      }))
      const url = `${runtimePath}?apiPath=projects&path=projects&workspaceId=${workspaceId}&limit=10`
      const target = response()
      await handler(request('GET', normalizeVercelRequestUrl(url), 'Bearer token'), target.res)
      expect(target.res.statusCode).toBe(200)
      expect(target.readBody()).toMatchObject({ data: { items: [], nextCursor: null } })
      expect(listed).toEqual([{ workspaceId, limit: 10, cursor: null }])

      for (const extra of ['&unexpected=1', '&limit=20']) {
        const rejected = response()
        await handler(request('GET', normalizeVercelRequestUrl(`${url}${extra}`), 'Bearer token'), rejected.res)
        expect(rejected.res.statusCode).toBe(422)
        expect(rejected.readBody()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
      }
      expect(listed).toHaveLength(1)
    },
  )

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
      authenticate: async () => { throw new Error('must not be called') },
      getMe: async () => { throw new Error('must not be called') },
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
      authenticate: async () => { throw new Error('must not be called') },
      getMe: async () => { throw new Error('must not be called') },
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
      authenticate: async () => { throw new Error('must not be called') },
      getMe: async () => { throw new Error('must not be called') },
    }
    const configuredRouter = createApiRouter(config, { sessionService: fakeService })
    const target = response()
    await configuredRouter(request('POST', '/api/v1/session/bootstrap', 'Basic abc'), target.res)
    expect(target.res.statusCode).toBe(401)
    expect(target.readBody()).toMatchObject({ error: { code: 'SESSION_INVALID' } })
  })

  it('returns the verified profile and workspace summaries from /me', async () => {
    const configuredRouter = projectRouter(repositoryStub())
    const target = response()
    await configuredRouter(request('GET', '/api/v1/me', 'Bearer verified-token'), target.res)
    expect(target.res.statusCode).toBe(200)
    expect(target.readBody()).toMatchObject({
      data: {
        user: { id: actor.userId },
        workspaces: [{ id: workspaceId, role: 'owner' }],
      },
    })
  })

  it('refuses cloud AI requests when the server has no AI key', async () => {
    let providerCalled = false
    const configuredRouter = billingRouter(billingRepositoryStub(), {
      aiService: {
        generateBoxSpec: async () => {
          providerCalled = true
          throw new Error('must not be called')
        },
      },
    })
    const target = response()
    await configuredRouter(aiRequest({ workspaceId, operationId, prompt: 'กล่องของฝาก' }), target.res)

    expect(target.res.statusCode).toBe(503)
    expect(target.readBody()).toMatchObject({ error: { code: 'CONFIGURATION_ERROR' } })
    expect(providerCalled).toBe(false)
  })

  it('reserves a credit, calls the provider with the server key, settles with usage and returns the balance', async () => {
    const calls: unknown[] = []
    const configuredRouter = billingRouter(billingRepositoryStub({
      reserveAiCredit: async (resolvedActor, resolvedWorkspaceId, resolvedOperationId) => {
        calls.push(['reserve', resolvedActor.userId, resolvedWorkspaceId, resolvedOperationId])
        return { requestId: aiRequestId, credits: 4 }
      },
      settleAiRequest: async (_actor, requestId, outcome, usage) => {
        calls.push(['settle', requestId, outcome, usage])
        return { credits: 4 }
      },
    }), {
      ai: { anthropicApiKey: serverAiKey, model: 'm' },
      aiService: {
        async generateBoxSpec(apiKey, input) {
          calls.push(['generate', apiKey, input])
          return { spec: boxSpec, model: aiModel, usage: aiUsage }
        },
      },
    })
    const target = response()
    await configuredRouter(aiRequest({ workspaceId, operationId, prompt: '  กล่องของฝาก ', image: refImage }), target.res)

    expect(target.res.statusCode).toBe(200)
    expect(calls).toEqual([
      ['reserve', actor.userId, workspaceId, operationId],
      ['generate', serverAiKey, { prompt: 'กล่องของฝาก', image: refImage }],
      ['settle', aiRequestId, 'succeeded', { hasImage: true, model: aiModel, ...aiUsage }],
    ])
    const body = target.readBody()
    expect(JSON.stringify(body)).not.toContain(serverAiKey)
    expect(body).toEqual({ data: { ...boxSpec, credits: 4 }, requestId: expect.any(String) })
    // model/usage เป็นข้อมูลต้นทุนฝั่ง server เท่านั้น — response คงรูป { ...spec, credits }
    for (const key of ['model', 'usage', 'inputTokens', 'outputTokens', 'hasImage']) {
      expect(body.data).not.toHaveProperty(key)
    }
  })

  it.each([
    ['provider', 502, 'AI_PROVIDER_UNAVAILABLE', 'บริการ AI ขัดข้อง ลองใหม่อีกครั้ง'],
    ['rate-limit', 429, 'AI_RATE_LIMITED', 'เรียก AI ถี่เกินไป รอสักครู่แล้วลองใหม่'],
    ['authentication', 503, 'CONFIGURATION_ERROR', 'คีย์ AI ของ server ไม่ถูกต้อง'],
    // โมเดลปฏิเสธ (stop_reason refusal): คืนเครดิตเหมือน provider ล้ม แต่บอกให้ปรับคำอธิบายแทน "ลองใหม่"
    ['refusal', 502, 'AI_PROVIDER_UNAVAILABLE', 'AI ไม่รับคำขอนี้ ลองปรับคำอธิบายแล้วส่งใหม่'],
  ] as const)('refunds the reservation when the provider fails with %s', async (kind, status, code, message) => {
    const settled: unknown[] = []
    const configuredRouter = billingRouter(billingRepositoryStub({
      reserveAiCredit: async () => ({ requestId: aiRequestId, credits: 4 }),
      settleAiRequest: async (_actor, requestId, outcome, usage) => {
        settled.push([requestId, outcome, usage])
        return { credits: 5 }
      },
    }), {
      ai: { anthropicApiKey: serverAiKey, model: 'm' },
      aiService: {
        generateBoxSpec: async () => {
          // ข้อความต้นทางที่บังเอิญมีคีย์ติดมา ต้องไม่หลุดไปทั้ง response และ log
          throw new AiProviderError(kind, new Error(`upstream ${kind} for key ${serverAiKey}`))
        },
      },
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const target = response()
    await configuredRouter(aiRequest({ workspaceId, operationId, prompt: 'กล่องของฝาก' }), target.res)

    expect(target.res.statusCode).toBe(status)
    const body = target.readBody()
    expect(body).toMatchObject({ error: { code, message } })
    expect(JSON.stringify(body)).not.toContain(serverAiKey)
    expect(settled).toEqual([[aiRequestId, 'failed', { hasImage: false }]])

    const [line] = logLines(error)
    expect(error).toHaveBeenCalledTimes(1)
    expect(line).toMatchObject({
      level: 'error',
      event: 'ai_provider_error',
      requestId: body.requestId,
      route: 'POST /api/v1/ai/box-spec',
      status,
      code,
      kind,
    })
    expect(String(line.error)).toContain(`upstream ${kind}`)
    expect(JSON.stringify(line)).not.toContain(serverAiKey)
    expect(JSON.stringify(line)).not.toContain('กล่องของฝาก')
  })

  it('keeps the delivered result and the deducted credit when settling a success fails', async () => {
    const settled: unknown[] = []
    const configuredRouter = billingRouter(billingRepositoryStub({
      reserveAiCredit: async () => ({ requestId: aiRequestId, credits: 4 }),
      settleAiRequest: async (_actor, requestId, outcome) => {
        settled.push([requestId, outcome])
        throw new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'ฐานข้อมูลไม่ตอบ')
      },
    }), {
      ai: { anthropicApiKey: serverAiKey, model: 'm' },
      aiService: { generateBoxSpec: async () => ({ spec: boxSpec, model: aiModel, usage: null }) },
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const target = response()
    await configuredRouter(aiRequest({ workspaceId, operationId, prompt: 'กล่องของฝาก' }), target.res)

    // ผลลัพธ์จาก provider ต้องถึงผู้ใช้ และต้องไม่พยายามคืนเครดิต (settle 'failed') ทั้งที่ได้ผลแล้ว
    expect(target.res.statusCode).toBe(200)
    expect(target.readBody()).toMatchObject({ data: { template: 'tuck-end', credits: 4 } })
    expect(settled).toEqual([[aiRequestId, 'succeeded']])
    expect(logLines(warn)).toEqual([expect.objectContaining({
      event: 'ai_settle_failed',
      requestId: target.readBody().requestId,
      aiRequestId,
    })])
  })

  it('passes the per-workspace concurrency cap through as 429 without calling the provider', async () => {
    let providerCalled = false
    let settleCalled = false
    const configuredRouter = billingRouter(billingRepositoryStub({
      // แปลงผ่าน mapper จริงของ adapter: reserve_ai_credit raise AI_CONCURRENCY_LIMIT
      reserveAiCredit: async () => {
        throw mapBillingDatabaseError({ message: 'AI_CONCURRENCY_LIMIT', details: null, code: 'P0001' })
      },
      settleAiRequest: async () => {
        settleCalled = true
        throw new Error('must not be called')
      },
    }), {
      ai: { anthropicApiKey: serverAiKey, model: 'm' },
      aiService: {
        generateBoxSpec: async () => {
          providerCalled = true
          throw new Error('must not be called')
        },
      },
    })
    const target = response()
    await configuredRouter(aiRequest({ workspaceId, operationId, prompt: 'กล่องของฝาก' }), target.res)

    expect(target.res.statusCode).toBe(429)
    expect(target.readBody()).toMatchObject({ error: { code: 'AI_RATE_LIMITED' } })
    expect(providerCalled).toBe(false)
    expect(settleCalled).toBe(false)
  })

  it('passes a credit refusal through without calling the provider', async () => {
    let providerCalled = false
    let settleCalled = false
    const configuredRouter = billingRouter(billingRepositoryStub({
      reserveAiCredit: async () => {
        throw new HttpError(402, 'AI_CREDITS_EXHAUSTED', 'เครดิตหมด', { credits: 0, plan: 'free' })
      },
      settleAiRequest: async () => {
        settleCalled = true
        throw new Error('must not be called')
      },
    }), {
      ai: { anthropicApiKey: serverAiKey, model: 'm' },
      aiService: {
        generateBoxSpec: async () => {
          providerCalled = true
          throw new Error('must not be called')
        },
      },
    })
    const target = response()
    await configuredRouter(aiRequest({ workspaceId, operationId, prompt: 'กล่องของฝาก' }), target.res)

    expect(target.res.statusCode).toBe(402)
    expect(target.readBody()).toMatchObject({
      error: { code: 'AI_CREDITS_EXHAUSTED', details: { credits: 0, plan: 'free' } },
    })
    expect(providerCalled).toBe(false)
    expect(settleCalled).toBe(false)
  })

  it('rejects AI bodies without workspace and operation IDs before reserving credits', async () => {
    let reserveCalled = false
    const configuredRouter = billingRouter(billingRepositoryStub({
      reserveAiCredit: async () => {
        reserveCalled = true
        throw new Error('must not be called')
      },
    }), {
      ai: { anthropicApiKey: serverAiKey, model: 'm' },
      aiService: { generateBoxSpec: async () => { throw new Error('must not be called') } },
    })

    for (const body of [
      { prompt: 'กล่องของฝาก' },
      { workspaceId, prompt: 'กล่องของฝาก' },
      { workspaceId, operationId, prompt: '   ' },
      { workspaceId, operationId, prompt: 'กล่องของฝาก', apiKey: 'sk-ant-client-supplied' },
    ]) {
      const target = response()
      await configuredRouter(aiRequest(body), target.res)
      expect(target.res.statusCode).toBe(422)
      expect(target.readBody()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
    }
    expect(reserveCalled).toBe(false)

    const missingBearer = response()
    await configuredRouter(aiRequest({ workspaceId, operationId, prompt: 'กล่องของฝาก' }, null), missingBearer.res)
    expect(missingBearer.res.statusCode).toBe(401)
    expect(missingBearer.readBody()).toMatchObject({ error: { code: 'AUTH_REQUIRED' } })
    expect(reserveCalled).toBe(false)
  })

  // เจ้าของผลิตภัณฑ์ 13 ต.ค. 2026: ยังไม่มีผู้ให้บริการชำระเงิน → staging/production ห้ามขาย/จำลองจ่าย
  // 15 ต.ค. 2026: ระหว่างยังขายไม่ได้ staging/production เปิดสิทธิ์ Pro ให้ทุก workspace (open access)
  it.each([
    ['test', true],
    ['development', true],
    ['staging', false],
    ['production', false],
  ] as const)('keeps purchases and dev fulfilment %s → %s and opens access while not selling', (appEnv, enabled) => {
    expect(billingFlags({ appEnv })).toEqual({
      devFulfilEnabled: enabled,
      purchasesEnabled: enabled,
      openAccess: !enabled,
    })
  })

  it.each([
    ['test', true],
    ['development', true],
    ['staging', false],
    ['production', false],
  ] as const)('returns entitlements with the server flags reflecting appEnv %s', async (appEnv, enabled) => {
    const calls: string[] = []
    const configuredRouter = billingRouter(billingRepositoryStub({
      getEntitlements: async () => {
        calls.push('get_entitlements')
        return storedEntitlements
      },
      ensureOpenAccess: async (resolvedActor, resolvedWorkspaceId) => {
        calls.push(`ensure_open_access ${resolvedActor.userId} ${resolvedWorkspaceId}`)
        return openEntitlements
      },
    }), { appEnv })
    const target = response()
    await configuredRouter(
      request('GET', `/api/v1/billing/entitlements?workspaceId=${workspaceId}`, 'Bearer token'),
      target.res,
    )
    expect(target.res.statusCode).toBe(200)
    expect(target.readBody()).toMatchObject({
      data: enabled
        ? { workspaceId, plan: 'free', credits: 3, catalog, devFulfilAvailable: true, purchasesEnabled: true, openAccess: false }
        : { workspaceId, plan: 'pro', credits: 100, catalog, devFulfilAvailable: false, purchasesEnabled: false, openAccess: true },
    })
    expect(calls).toEqual([enabled ? 'get_entitlements' : `ensure_open_access ${actor.userId} ${workspaceId}`])

    const rejected = response()
    await configuredRouter(
      request('GET', `/api/v1/billing/entitlements?workspaceId=${workspaceId}&extra=1`, 'Bearer token'),
      rejected.res,
    )
    expect(rejected.res.statusCode).toBe(422)
    expect(rejected.readBody()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
  })

  it('logs one line and answers 503 when a billing dependency fails unexpectedly', async () => {
    const configuredRouter = billingRouter(billingRepositoryStub({
      getEntitlements: async () => {
        throw new TypeError('fetch failed for owner@example.test with Bearer abc.def.ghi')
      },
    }))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const target = response()
    await configuredRouter(
      request('GET', `/api/v1/billing/entitlements?workspaceId=${workspaceId}`, 'Bearer token'),
      target.res,
    )

    expect(target.res.statusCode).toBe(503)
    const body = target.readBody()
    expect(body).toMatchObject({ error: { code: 'DEPENDENCY_UNAVAILABLE' } })
    expect(JSON.stringify(body)).not.toContain('fetch failed')
    const lines = logLines(error)
    expect(lines).toEqual([{
      level: 'error',
      event: 'api_unexpected_error',
      requestId: body.requestId,
      route: 'GET /api/v1/billing/entitlements',
      status: 503,
      code: 'DEPENDENCY_UNAVAILABLE',
      error: expect.stringContaining('TypeError: fetch failed'),
    }])
    expect(JSON.stringify(lines)).not.toMatch(/owner@example\.test|abc\.def\.ghi/)
  })

  it.each(['staging', 'production'] as const)(
    'refuses orders with 503 PURCHASE_UNAVAILABLE in %s without touching the repository',
    async (appEnv) => {
      let called = false
      const configuredRouter = billingRouter(billingRepositoryStub({
        createOrder: async () => {
          called = true
          throw new Error('must not be called')
        },
      }), { appEnv })
      const info = vi.spyOn(console, 'info').mockImplementation(() => {})
      const target = response()
      await configuredRouter({
        method: 'POST',
        url: '/api/v1/billing/orders',
        headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
        body: { workspaceId, operationId, kind: 'pro' },
      }, target.res)

      expect(target.res.statusCode).toBe(503)
      expect(target.readBody()).toMatchObject({ error: { code: 'PURCHASE_UNAVAILABLE' } })
      expect(called).toBe(false)
      expect(info).not.toHaveBeenCalled()
    },
  )

  it('creates an order for the actor and reports that there is no checkout page yet', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const calls: unknown[] = []
    const configuredRouter = billingRouter(billingRepositoryStub({
      createOrder: async (resolvedActor, input) => {
        calls.push({ userId: resolvedActor.userId, input })
        return { ...pendingOrder, kind: input.kind, projectId: input.projectId ?? null }
      },
    }))
    const target = response()
    await configuredRouter({
      method: 'POST',
      url: '/api/v1/billing/orders',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: { workspaceId, operationId, kind: 'design', projectId },
    }, target.res)

    expect(target.res.statusCode).toBe(201)
    expect(calls).toEqual([{ userId: actor.userId, input: { workspaceId, operationId, kind: 'design', projectId } }])
    expect(target.readBody()).toMatchObject({ data: { id: orderId, status: 'pending', provider: 'none', checkoutUrl: null } })

    for (const body of [
      { workspaceId, operationId, kind: 'design' },
      { workspaceId, operationId, kind: 'pro', projectId },
      { workspaceId, operationId, kind: 'pro', amountMinor: 1 },
    ]) {
      const rejected = response()
      await configuredRouter({
        method: 'POST',
        url: '/api/v1/billing/orders',
        headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
        body,
      }, rejected.res)
      expect(rejected.res.statusCode).toBe(422)
      expect(rejected.readBody()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
    }
    expect(calls).toHaveLength(1)
  })

  it('hides dev fulfilment outside development/test and fulfils with the dev provider inside', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const fulfilled: unknown[] = []
    const repository = billingRepositoryStub({
      fulfilOrder: async (resolvedActor, resolvedOrderId, provider, providerRef) => {
        fulfilled.push([resolvedActor?.userId, resolvedOrderId, provider, providerRef])
        return { ...pendingOrder, status: 'paid', provider, providerRef, paidAt: '2026-10-13T00:00:01.000Z' }
      },
    })

    const hidden = response()
    await billingRouter(repository, { appEnv: 'staging' })(
      request('POST', `/api/v1/billing/orders/${orderId}/dev-fulfil`, 'Bearer token'),
      hidden.res,
    )
    expect(hidden.res.statusCode).toBe(404)
    expect(hidden.readBody()).toMatchObject({ error: { code: 'NOT_FOUND' } })
    expect(fulfilled).toEqual([])

    const target = response()
    await billingRouter(repository, { appEnv: 'test' })(
      request('POST', `/api/v1/billing/orders/${orderId}/dev-fulfil`, 'Bearer token'),
      target.res,
    )
    expect(target.res.statusCode).toBe(200)
    expect(fulfilled).toEqual([[actor.userId, orderId, 'dev', expect.stringMatching(/^[0-9a-f-]{36}$/)]])
    expect(target.readBody()).toMatchObject({
      data: { id: orderId, status: 'paid', provider: 'dev', checkoutUrl: null },
    })
  })

  it('authorizes exports for the actor and passes payment refusals through with details', async () => {
    const unpaidProjectId = '30000000-0000-4000-8000-000000000002'
    const price = catalog.design
    const configuredRouter = billingRouter(billingRepositoryStub({
      authorizeExport: async (resolvedActor, resolvedProjectId) => {
        expect(resolvedActor.userId).toBe(actor.userId)
        if (resolvedProjectId !== projectId) {
          throw new HttpError(402, 'PAYMENT_REQUIRED', 'ต้องซื้อแบบนี้ก่อน', { projectId: resolvedProjectId, price })
        }
        return {
          projectId,
          source: 'purchase',
          entitlements: { ...storedEntitlements, licensedProjectIds: [projectId] },
        }
      },
    }))

    const target = response()
    await configuredRouter({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/export-authorizations`,
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: {},
    }, target.res)
    expect(target.res.statusCode).toBe(200)
    expect(target.readBody()).toMatchObject({
      data: {
        projectId,
        source: 'purchase',
        entitlements: { licensedProjectIds: [projectId], devFulfilAvailable: true },
      },
    })

    const refused = response()
    await configuredRouter(
      request('POST', `/api/v1/projects/${unpaidProjectId}/export-authorizations`, 'Bearer token'),
      refused.res,
    )
    expect(refused.res.statusCode).toBe(402)
    expect(refused.readBody()).toMatchObject({
      error: { code: 'PAYMENT_REQUIRED', details: { projectId: unpaidProjectId, price } },
    })

    const withPayload = response()
    await configuredRouter({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/export-authorizations`,
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: { force: true },
    }, withPayload.res)
    expect(withPayload.res.statusCode).toBe(422)

    // format บอกรูปแบบไฟล์: svg/ai ของแบบที่ซื้อรายแบบ (ไม่ใช่ Pro) → 402 PRO_REQUIRED; รูปแบบไม่รู้จัก → 422
    const vector = response()
    await configuredRouter({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/export-authorizations`,
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: { format: 'svg' },
    }, vector.res)
    expect(vector.res.statusCode).toBe(402)
    expect(vector.readBody()).toMatchObject({ error: { code: 'PRO_REQUIRED', details: { projectId, format: 'svg' } } })

    const dxf = response()
    await configuredRouter({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/export-authorizations`,
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: { format: 'dxf' },
    }, dxf.res)
    expect(dxf.res.statusCode).toBe(200)

    const unknown = response()
    await configuredRouter({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/export-authorizations`,
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: { format: 'eps' },
    }, unknown.res)
    expect(unknown.res.statusCode).toBe(422)
  })

  it.each(['staging', 'production'] as const)(
    'authorizes exports through open access in %s without the paywall RPC',
    async (appEnv) => {
      const calls: unknown[] = []
      const configuredRouter = billingRouter(billingRepositoryStub({
        authorizeOpenAccessExport: async (resolvedActor, resolvedProjectId) => {
          calls.push([resolvedActor.userId, resolvedProjectId])
          return { projectId: resolvedProjectId, source: 'pro', entitlements: openEntitlements }
        },
      }), { appEnv })

      const target = response()
      await configuredRouter(
        request('POST', `/api/v1/projects/${projectId}/export-authorizations`, 'Bearer token'),
        target.res,
      )
      expect(target.res.statusCode).toBe(200)
      expect(calls).toEqual([[actor.userId, projectId]])
      expect(target.readBody()).toMatchObject({
        data: {
          projectId,
          source: 'pro',
          entitlements: { plan: 'pro', licensedProjectIds: [], openAccess: true, purchasesEnabled: false },
        },
      })
    },
  )

  it('renews the open-access period before reserving an AI credit', async () => {
    const calls: unknown[] = []
    const configuredRouter = billingRouter(billingRepositoryStub({
      ensureOpenAccess: async (resolvedActor, resolvedWorkspaceId) => {
        calls.push(['ensure', resolvedActor.userId, resolvedWorkspaceId])
        return openEntitlements
      },
      reserveAiCredit: async (_actor, resolvedWorkspaceId) => {
        calls.push(['reserve', resolvedWorkspaceId])
        return { requestId: aiRequestId, credits: 99 }
      },
      settleAiRequest: async () => ({ credits: 99 }),
    }), {
      appEnv: 'staging',
      ai: { anthropicApiKey: serverAiKey, model: 'm' },
      aiService: {
        async generateBoxSpec() {
          calls.push(['generate'])
          return { spec: boxSpec, model: aiModel, usage: aiUsage }
        },
      },
    })
    const target = response()
    await configuredRouter(aiRequest({ workspaceId, operationId, prompt: 'กล่องของฝาก' }), target.res)

    expect(target.res.statusCode).toBe(200)
    expect(calls).toEqual([['ensure', actor.userId, workspaceId], ['reserve', workspaceId], ['generate']])
    expect(target.readBody()).toMatchObject({ data: { credits: 99 } })
  })

  it('validates and creates a project for the actor resolved from the bearer token', async () => {
    const calls: unknown[] = []
    const configuredRouter = projectRouter(repositoryStub({
      async create(resolvedActor, input, hash) {
        calls.push({ resolvedActor, input, hash })
        return {
          id: projectId,
          workspaceId,
          name: input.name,
          documentSchemaVersion: 1,
          document: input.document,
          revision: 1,
          createdAt: '2026-09-18T00:00:00.000Z',
          updatedAt: '2026-09-18T00:00:00.000Z',
          assets: [],
        }
      },
    }))
    const target = response()
    await configuredRouter({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: 'Bearer verified-token', 'content-type': 'application/json' },
      body: { workspaceId, operationId, name: 'กล่องทดสอบ', documentSchemaVersion: 1, document },
    }, target.res)

    expect(target.res.statusCode).toBe(201)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      resolvedActor: { userId: actor.userId },
      input: { workspaceId, operationId, name: 'กล่องทดสอบ' },
      hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
  })

  it('rejects unknown/mass-assignment fields before the repository is called', async () => {
    let called = false
    const configuredRouter = projectRouter(repositoryStub({
      create: async () => {
        called = true
        throw new Error('must not be called')
      },
    }))
    const target = response()
    await configuredRouter({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: 'Bearer verified-token', 'content-type': 'application/json' },
      body: {
        workspaceId,
        operationId,
        name: 'กล่องทดสอบ',
        documentSchemaVersion: 1,
        document,
        actorUserId: 'attacker-controlled',
      },
    }, target.res)

    expect(target.res.statusCode).toBe(422)
    expect(called).toBe(false)
    expect(target.readBody()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
  })

  it('imports a legacy project through the source-deduplicating endpoint', async () => {
    const sourceInstallationId = '50000000-0000-4000-8000-000000000001'
    const sourceHash = 'a'.repeat(64)
    const configuredRouter = projectRouter(repositoryStub({
      async importLegacy(resolvedActor, input, hash) {
        expect(resolvedActor.userId).toBe(actor.userId)
        expect(input).toMatchObject({ workspaceId, sourceInstallationId, sourceProjectKey: 'projects:0' })
        expect(hash).toMatch(/^[0-9a-f]{64}$/)
        return {
          sourceInstallationId,
          sourceProjectKey: input.sourceProjectKey,
          sourceHash,
          project: {
            id: projectId,
            workspaceId,
            name: input.name,
            documentSchemaVersion: 1,
            document: input.document,
            revision: 1,
            createdAt: '2026-09-18T00:00:00.000Z',
            updatedAt: '2026-09-18T00:00:00.000Z',
            assets: [],
          },
          completedAt: '2026-09-18T00:00:00.000Z',
        }
      },
    }))
    const target = response()
    await configuredRouter({
      method: 'POST',
      url: '/api/v1/projects/import-legacy',
      headers: { authorization: 'Bearer verified-token', 'content-type': 'application/json' },
      body: {
        workspaceId,
        operationId,
        sourceInstallationId,
        sourceProjectKey: 'projects:0',
        sourceHash,
        name: 'งานเดิม',
        documentSchemaVersion: 1,
        document,
      },
    }, target.res)

    expect(target.res.statusCode).toBe(200)
    expect(target.readBody()).toMatchObject({ data: { sourceHash, project: { id: projectId } } })
  })

  it('requires the exact JSON media type for project writes', async () => {
    let called = false
    const configuredRouter = projectRouter(repositoryStub({
      create: async () => {
        called = true
        throw new Error('must not be called')
      },
    }))
    const target = response()
    await configuredRouter({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: 'Bearer verified-token', 'content-type': 'application/json-evil' },
      body: { workspaceId, operationId, name: 'กล่องทดสอบ', documentSchemaVersion: 1, document },
    }, target.res)

    expect(target.res.statusCode).toBe(415)
    expect(called).toBe(false)
    expect(target.readBody()).toMatchObject({ error: { code: 'UNSUPPORTED_MEDIA_TYPE' } })
  })

  it('parses delete concurrency headers and returns the durable receipt', async () => {
    const configuredRouter = projectRouter(repositoryStub({
      async remove(_actor, input) {
        expect(input).toEqual({ projectId, operationId, expectedRevision: 7 })
        return {
          projectId,
          operationId,
          revision: 8,
          deletedAt: '2026-09-18T00:00:00.000Z',
        }
      },
    }))
    const target = response()
    await configuredRouter({
      method: 'DELETE',
      url: `/api/v1/projects/${projectId}`,
      headers: {
        authorization: 'Bearer verified-token',
        'x-expected-revision': '7',
        'idempotency-key': operationId,
      },
    }, target.res)

    expect(target.res.statusCode).toBe(200)
    expect(target.readBody()).toMatchObject({ data: { projectId, revision: 8 } })
  })

  it('rejects a delete without the application revision header', async () => {
    const configuredRouter = projectRouter(repositoryStub({
      async remove() { throw new Error('must not be called') },
    }))
    const target = response()
    await configuredRouter({
      method: 'DELETE',
      url: `/api/v1/projects/${projectId}`,
      headers: {
        authorization: 'Bearer verified-token',
        'if-match': '"7"',
        'idempotency-key': operationId,
      },
    }, target.res)

    expect(target.res.statusCode).toBe(422)
    expect(target.readBody()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
  })

  it('validates asset upload intents and resolves their actor from the bearer token', async () => {
    const assetId = '50000000-0000-4000-8000-000000000001'
    const calls: unknown[] = []
    const assetService = {
      async createIntent(resolvedActor: typeof actor, input: Record<string, unknown>) {
        calls.push({ resolvedActor, input })
        return {
          asset: {
            id: assetId,
            workspaceId,
            purpose: 'project-decoration' as const,
            state: 'pending' as const,
            declaredMime: 'image/png' as const,
            declaredSize: 100,
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
            method: 'PUT' as const,
            headers: { 'content-type': 'image/png' },
            expiresAt: '2026-09-18T02:00:00.000Z',
          },
        }
      },
    } as unknown as AssetService
    const sessionService: SessionService = {
      bootstrap: async () => { throw new Error('must not be called') },
      authenticate: async () => actor,
      getMe: async () => { throw new Error('must not be called') },
    }
    const configuredRouter = createApiRouter(config, { sessionService, assetService, projectService: null })
    const target = response()
    await configuredRouter({
      method: 'POST',
      url: '/api/v1/assets/upload-intents',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: {
        workspaceId,
        operationId,
        purpose: 'project-decoration',
        declaredMime: 'image/png',
        declaredSize: 100,
      },
    }, target.res)

    expect(target.res.statusCode).toBe(201)
    expect(calls).toEqual([expect.objectContaining({
      resolvedActor: expect.objectContaining({ userId: actor.userId }),
      input: expect.objectContaining({ workspaceId, operationId, declaredSize: 100 }),
    })])
    expect(target.readBody()).toMatchObject({ data: { asset: { id: assetId, state: 'pending' } } })
  })
})
