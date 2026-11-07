import { describe, expect, it, vi } from 'vitest'
import type { SupplierProfile } from '../../shared/contracts/marketplace'
import type { MarketplaceRepository } from '../modules/marketplace/marketplaceRepository'
import { HttpError } from './errors'
import { createApiRouter, type HttpRequest } from './router'

const userId = 'c9f50a54-cd13-4bef-9d75-03c452f9ba0a'
const supplierId = '06aa1b0a-0b33-4af9-ab3a-133809b9df23'
const workspaceId = '27b5d515-49d5-4613-8bee-b4c01ff3887e'
const operationId = '8e1a0ff2-08cd-47d1-8931-e0092ef006e2'
const profile: SupplierProfile = {
  id: supplierId, workspaceId, kind: 'print_shop', name: 'Test Print Shop', slug: 'test-print-shop',
  description: 'Synthetic shop', contactEmail: 'shop@example.test', capabilities: ['digital_printing'],
  status: 'draft', revision: 1, reviewNote: null, updatedAt: '2026-11-07T00:00:00.000Z',
}
const input = {
  kind: profile.kind, name: profile.name, slug: profile.slug, description: profile.description,
  contactEmail: profile.contactEmail, capabilities: profile.capabilities,
}
const { contactEmail: _email, ...publicProfile } = { id: supplierId, ...input }

function harness({ reviewer = false, mfa = false, enabled = true } = {}) {
  const access = { profile, role: 'manager' as const }
  const repository = {
    context: vi.fn(async () => ({ suppliers: [access], isSupplierReviewer: reviewer })),
    create: vi.fn(async () => access),
    get: vi.fn(async () => access),
    update: vi.fn(async () => access),
    submit: vi.fn(async () => access),
    publicProfile: vi.fn(async () => publicProfile),
    adminList: vi.fn(async () => {
      if (!reviewer) throw new HttpError(403, 'MARKETPLACE_FORBIDDEN', 'Forbidden')
      return { items: [profile], nextCursor: null }
    }),
    review: vi.fn(async () => profile),
  } satisfies MarketplaceRepository
  const authenticate = vi.fn(async (_token: string, requestId: string, options?: { verifyMfa: boolean }) => ({
    userId, identityIssuer: 'https://fixture.example/auth/v1', identitySubject: userId, requestId,
    hasVerifiedMfa: options?.verifyMfa && mfa,
  }))
  const router = createApiRouter({ appEnv: 'test', allowedOrigins: [], ai: null, supabase: null, marketplaceSuppliersEnabled: enabled }, {
    marketplaceRepository: repository,
    sessionService: { authenticate, bootstrap: vi.fn(), getMe: vi.fn() },
  })

  async function request(path: string, method = 'GET', body?: unknown, signedIn = true) {
    const req: HttpRequest = {
      method, url: `/api/v1${path}`, body,
      headers: {
        ...(signedIn ? { authorization: 'Bearer fixture' } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
    }
    let content = ''
    const headers: Record<string, string> = {}
    const response = {
      statusCode: 0,
      setHeader: (name: string, value: string) => { headers[name] = value },
      end: (value?: string) => { content = value ?? '' },
    }
    await router(req, response)
    return { status: response.statusCode, headers, payload: JSON.parse(content) }
  }
  return { authenticate, repository, request }
}

describe('Marketplace HTTP boundaries', () => {
  it('keeps routes hidden until the deployment enables the feature', async () => {
    const { authenticate, repository, request } = harness({ enabled: false })
    for (const path of ['/marketplace/context', '/suppliers/public/test-print-shop', '/admin/suppliers']) {
      expect(await request(path)).toMatchObject({ status: 404, payload: { error: { code: 'NOT_FOUND' } } })
    }
    expect(authenticate).not.toHaveBeenCalled()
    expect(repository.publicProfile).not.toHaveBeenCalled()
    expect((await request('/health')).status).toBe(200)
  })

  it('requires a user for private routes and permits anonymous public profiles', async () => {
    const { authenticate, request } = harness()
    expect(await request('/marketplace/context', 'GET', undefined, false)).toMatchObject({
      status: 401, payload: { error: { code: 'AUTH_REQUIRED' } },
    })
    const published = await request('/suppliers/public/test-print-shop', 'GET', undefined, false)
    expect(published.status).toBe(200)
    expect(published.payload.data).toEqual(publicProfile)
    expect(published.headers['cache-control']).toBe('no-store')
    expect(authenticate).not.toHaveBeenCalled()
    expect(await request('/suppliers/public/test-print-shop', 'PUT', input)).toMatchObject({
      status: 405, headers: { allow: 'GET' },
    })
  })

  it('derives the actor from auth and rejects client-supplied authority', async () => {
    const { request, repository } = harness()
    for (const extra of [{ workspaceId }, { role: 'manager' }, { status: 'approved' }, { userId }]) {
      expect((await request('/suppliers', 'POST', { ...input, operationId, ...extra })).status).toBe(422)
    }
    expect(repository.create).not.toHaveBeenCalled()
    expect((await request('/suppliers', 'POST', { ...input, operationId })).status).toBe(201)
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ userId }), operationId, input)
    expect(await request(`/suppliers/${supplierId}/submit`, 'POST', { expectedRevision: 0 })).toMatchObject({ status: 422 })
    expect((await request(`/suppliers/${supplierId}/submit`, 'POST', { expectedRevision: 1 })).status).toBe(200)
    expect(repository.submit).toHaveBeenCalledWith(expect.objectContaining({ userId }), supplierId, 1)
  })

  it('requires verified MFA as well as the independent platform reviewer grant', async () => {
    const unverifiedReviewer = harness({ reviewer: true })
    const context = await unverifiedReviewer.request('/marketplace/context')
    expect(context.payload.data.staff).toEqual({ canReviewSuppliers: true, requiresMfa: true })
    expect(await unverifiedReviewer.request('/admin/suppliers')).toMatchObject({
      status: 403, payload: { error: { code: 'MARKETPLACE_MFA_REQUIRED' } },
    })
    expect(unverifiedReviewer.repository.adminList).not.toHaveBeenCalled()
    const verifiedManager = harness({ mfa: true })
    expect(await verifiedManager.request('/admin/suppliers')).toMatchObject({
      status: 403, payload: { error: { code: 'MARKETPLACE_FORBIDDEN' } },
    })

    const verifiedReviewer = harness({ reviewer: true, mfa: true })
    expect((await verifiedReviewer.request('/admin/suppliers?status=pending')).status).toBe(200)
    expect((await verifiedReviewer.request(`/admin/suppliers/${supplierId}/review`, 'POST', {
      expectedRevision: 2, action: 'approve', reason: '  Reviewed the application  ',
    })).status).toBe(200)
    expect(verifiedReviewer.repository.review).toHaveBeenCalledWith(
      expect.objectContaining({ userId, hasVerifiedMfa: true }), supplierId, 2, 'approve', 'Reviewed the application',
    )
  })
})
