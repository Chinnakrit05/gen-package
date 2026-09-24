import { describe, expect, it } from 'vitest'
import type { CloudProjectDocumentV1 } from '../../shared/contracts/projects'
import type { SessionService } from '../modules/identity/sessionService'
import type { AssetService } from '../modules/assets/assetService'
import { AiProviderError, type AiService } from '../modules/ai/aiService'
import type { ProjectRepository } from '../modules/projects/projectRepository'
import { ProjectService } from '../modules/projects/projectService'
import { normalizeVercelRequestUrl } from '../entrypoints/vercel'
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

const actor = {
  userId: '10000000-0000-4000-8000-000000000001',
  identityIssuer: 'https://test.supabase.local/auth/v1',
  identitySubject: 'subject-1',
  requestId: 'request-1',
}
const workspaceId = '20000000-0000-4000-8000-000000000001'
const projectId = '30000000-0000-4000-8000-000000000001'
const operationId = '40000000-0000-4000-8000-000000000001'
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

describe('API router', () => {
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

  it('authenticates cloud AI requests and forwards the BYOK key without echoing it', async () => {
    const calls: unknown[] = []
    const sessionService: SessionService = {
      bootstrap: async () => { throw new Error('must not be called') },
      authenticate: async (token) => {
        expect(token).toBe('verified-token')
        return actor
      },
      getMe: async () => { throw new Error('must not be called') },
    }
    const aiService: AiService = {
      async generateBoxSpec(apiKey, input) {
        calls.push({ apiKey, input })
        return {
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
      },
    }
    const configuredRouter = createApiRouter(config, {
      sessionService,
      aiService,
      projectService: null,
      assetService: null,
    })
    const target = response()
    const apiKey = 'sk-ant-test-request-only'

    await configuredRouter({
      method: 'POST',
      url: '/api/v1/ai/box-spec',
      headers: {
        authorization: 'Bearer verified-token',
        'content-type': 'application/json',
        'x-packit-anthropic-api-key': apiKey,
      },
      body: { prompt: 'กล่องของฝาก' },
    }, target.res)

    expect(target.res.statusCode).toBe(200)
    expect(calls).toEqual([{ apiKey, input: { prompt: 'กล่องของฝาก' } }])
    expect(JSON.stringify(target.readBody())).not.toContain(apiKey)
    expect(target.readBody()).toMatchObject({ data: { template: 'tuck-end', mock: false } })
  })

  it('rejects cloud AI requests without a bearer token or BYOK key', async () => {
    let called = false
    const sessionService: SessionService = {
      bootstrap: async () => { throw new Error('must not be called') },
      authenticate: async () => actor,
      getMe: async () => { throw new Error('must not be called') },
    }
    const aiService: AiService = {
      generateBoxSpec: async () => {
        called = true
        throw new Error('must not be called')
      },
    }
    const configuredRouter = createApiRouter(config, { sessionService, aiService })

    const missingBearer = response()
    await configuredRouter({
      method: 'POST',
      url: '/api/v1/ai/box-spec',
      headers: { 'content-type': 'application/json', 'x-packit-anthropic-api-key': 'sk-ant-test-request-only' },
      body: { prompt: 'กล่องของฝาก' },
    }, missingBearer.res)
    expect(missingBearer.res.statusCode).toBe(401)
    expect(missingBearer.readBody()).toMatchObject({ error: { code: 'AUTH_REQUIRED' } })

    const missingKey = response()
    await configuredRouter({
      method: 'POST',
      url: '/api/v1/ai/box-spec',
      headers: { authorization: 'Bearer verified-token', 'content-type': 'application/json' },
      body: { prompt: 'กล่องของฝาก' },
    }, missingKey.res)
    expect(missingKey.res.statusCode).toBe(422)
    expect(missingKey.readBody()).toMatchObject({ error: { code: 'AI_API_KEY_REQUIRED' } })
    expect(called).toBe(false)
  })

  it('maps malformed and provider-rejected AI keys to stable API errors', async () => {
    const sessionService: SessionService = {
      bootstrap: async () => { throw new Error('must not be called') },
      authenticate: async () => actor,
      getMe: async () => { throw new Error('must not be called') },
    }
    const aiService: AiService = {
      generateBoxSpec: async () => { throw new AiProviderError('authentication') },
    }
    const configuredRouter = createApiRouter(config, { sessionService, aiService })

    const malformed = response()
    await configuredRouter({
      method: 'POST',
      url: '/api/v1/ai/box-spec',
      headers: {
        authorization: 'Bearer verified-token',
        'content-type': 'application/json',
        'x-packit-anthropic-api-key': 'short',
      },
      body: { prompt: 'กล่องของฝาก' },
    }, malformed.res)
    expect(malformed.res.statusCode).toBe(400)
    expect(malformed.readBody()).toMatchObject({ error: { code: 'AI_API_KEY_INVALID' } })

    const rejected = response()
    await configuredRouter({
      method: 'POST',
      url: '/api/v1/ai/box-spec',
      headers: {
        authorization: 'Bearer verified-token',
        'content-type': 'application/json',
        'x-packit-anthropic-api-key': 'sk-ant-rejected-test-key',
      },
      body: { prompt: 'กล่องของฝาก' },
    }, rejected.res)
    expect(rejected.res.statusCode).toBe(401)
    expect(rejected.readBody()).toMatchObject({ error: { code: 'AI_API_KEY_INVALID' } })
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
