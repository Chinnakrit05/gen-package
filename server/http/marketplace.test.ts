import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { SupplierInvite, SupplierNotification, SupplierProfile, SupplierReviewDocument, SupplierTeamMember } from '../../shared/contracts/marketplace'
import type { QuoteRequestDraft } from '../../shared/contracts/quoteRequests'
import type { ActorAuthenticationOptions } from '../modules/identity/sessionService'
import type { MarketplaceRepository } from '../modules/marketplace/marketplaceRepository'
import { HttpError } from './errors'
import { createApiRouter, type HttpRequest } from './router'

const userId = 'c9f50a54-cd13-4bef-9d75-03c452f9ba0a'
const supplierId = '06aa1b0a-0b33-4af9-ab3a-133809b9df23'
const workspaceId = '27b5d515-49d5-4613-8bee-b4c01ff3887e'
const operationId = '8e1a0ff2-08cd-47d1-8931-e0092ef006e2'
const teamMember: SupplierTeamMember = { userId, displayName: 'Test Manager', role: 'manager', isWorkspaceOwner: true }
const invitation: SupplierInvite = {
  id: operationId, email: 'invited@example.test', role: 'viewer',
  createdAt: '2026-11-07T00:00:00Z', expiresAt: '2026-11-14T00:00:00Z',
}
const teamPath = `/suppliers/${supplierId}/team`
const acceptPath = '/suppliers/invitations/accept'
const notificationsPath = '/marketplace/notifications'
const adminNotificationsPath = '/admin/suppliers/notifications'
const notification: SupplierNotification = {
  id: operationId, supplierId, supplierName: 'Test Print Shop', action: 'approve',
  createdAt: '2026-11-08T00:00:00.123456Z', readAt: null,
}
const documentsPath = `/suppliers/${supplierId}/review-documents`
const documentPath = `${documentsPath}/${operationId}`
const pdfBytes = Buffer.from('%PDF-1.4\n%%EOF\n')
const reviewDocument: SupplierReviewDocument = {
  id: operationId, name: 'หลักฐาน.pdf', mimeType: 'application/pdf', byteSize: pdfBytes.length, createdAt: '2026-11-08T00:00:00Z',
}
const uploadDocument = { operationId, name: reviewDocument.name, mimeType: reviewDocument.mimeType, dataBase64: pdfBytes.toString('base64') }
const profile: SupplierProfile = {
  id: supplierId, workspaceId, kind: 'print_shop', name: 'Test Print Shop', slug: 'test-print-shop',
  description: 'Synthetic shop', contactEmail: 'shop@example.test', capabilities: ['digital_printing'],
  status: 'draft', revision: 1, reviewNote: null, updatedAt: '2026-11-07T00:00:00.000Z',
}
const input = {
  kind: profile.kind, name: profile.name, slug: profile.slug, description: profile.description,
  contactEmail: profile.contactEmail, capabilities: profile.capabilities,
}
const quoteDraft: QuoteRequestDraft = {
  id: operationId, workspaceId, projectId: supplierId, projectName: 'Saved Project', projectRevision: 1,
  title: 'Request boxes', quantity: 100, notes: '', createdAt: '2026-11-08T00:00:00.123456Z',
  spec: { template: 'tuck-end', materialId: 'carton-300', W: 80, D: 50, H: 120, handle: false },
}
const quotePublicationPath = `/marketplace/requests/${operationId}/publication`
const quoteSuppliersPath = `/marketplace/requests/${operationId}/eligible-suppliers`
const supplierRequestsPath = `/suppliers/${supplierId}/quote-requests`
const quoteNotificationsPath = '/marketplace/quote-request-notifications'
const quoteNotificationReadPath = `${supplierRequestsPath}/${operationId}/read`
const receipt = { revisionId: workspaceId, publishedAt: quoteDraft.createdAt, suppliers: [{ id: supplierId, name: profile.name }] }
const supplierQuote = {
  id: quoteDraft.id, revisionId: receipt.revisionId, title: quoteDraft.title, quantity: quoteDraft.quantity,
  publishedAt: receipt.publishedAt, notes: quoteDraft.notes, spec: quoteDraft.spec,
}
const { contactEmail: _email, ...publicProfile } = { id: supplierId, ...input }

function harness({ reviewer = false, mfa = false, enabled = true, hasVerifiedEmail = true } = {}) {
  const access = { profile, role: 'manager' as const }
  const repository = {
    context: vi.fn(async () => ({ suppliers: [access], isSupplierReviewer: reviewer })),
    create: vi.fn(async () => access),
    get: vi.fn(async () => access),
    update: vi.fn(async () => access),
    submit: vi.fn(async () => access),
    team: vi.fn(async () => ({ members: [teamMember], invites: [invitation] })),
    invite: vi.fn(async () => invitation),
    acceptInvite: vi.fn(async () => ({ profile, role: 'viewer' as const })),
    changeMember: vi.fn(async () => teamMember),
    removeMember: vi.fn(async () => ({ userId })),
    revokeInvite: vi.fn(async () => ({ id: invitation.id })),
    listNotifications: vi.fn(async () => ({ items: [notification], nextCursor: null })),
    markNotificationRead: vi.fn(async () => ({ id: notification.id, readAt: notification.createdAt })),
    listReviewDocuments: vi.fn(async () => ({ documents: [reviewDocument] })),
    getReviewDocument: vi.fn(async () => ({ document: reviewDocument, dataBase64: uploadDocument.dataBase64 })),
    addReviewDocument: vi.fn(async () => reviewDocument),
    removeReviewDocument: vi.fn(async () => ({ id: reviewDocument.id })),
    createQuoteRequestDraft: vi.fn(async () => quoteDraft),
    listQuoteRequestDrafts: vi.fn(async () => ({ items: [], nextCursor: null })),
    getQuoteRequestDraft: vi.fn(async () => quoteDraft),
    getQuoteRequestPublication: vi.fn(async () => ({ publication: null })),
    listQuoteRequestEligibleSuppliers: vi.fn(async () => ({ items: [], nextCursor: null })),
    publishQuoteRequest: vi.fn(async () => receipt),
    listSupplierQuoteRequests: vi.fn(async () => ({ items: [], nextCursor: null })),
    getSupplierQuoteRequest: vi.fn(async () => supplierQuote),
    listQuoteRequestNotifications: vi.fn(async () => ({ items: [], nextCursor: null, hasUnread: false })),
    markQuoteRequestNotificationRead: vi.fn(async () => ({ requestId: operationId, supplierId, readAt: quoteDraft.createdAt })),
    publicProfile: vi.fn(async () => publicProfile),
    adminList: vi.fn(async () => {
      if (!reviewer) throw new HttpError(403, 'MARKETPLACE_FORBIDDEN', 'Forbidden')
      return { items: [profile], nextCursor: null }
    }),
    review: vi.fn(async () => profile),
  } satisfies MarketplaceRepository
  const authenticate = vi.fn(async (_token: string, requestId: string, options?: ActorAuthenticationOptions) => ({
    userId, identityIssuer: 'https://fixture.example/auth/v1', identitySubject: userId, requestId,
    hasVerifiedMfa: options?.verifyMfa && mfa,
    verifiedEmail: options?.includeVerifiedEmail && hasVerifiedEmail ? invitation.email : undefined,
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
    for (const path of ['/marketplace/context', '/suppliers/public/test-print-shop', '/admin/suppliers', documentsPath, `/admin${documentPath}`, notificationsPath, adminNotificationsPath, quotePublicationPath, quoteSuppliersPath, supplierRequestsPath, `${supplierRequestsPath}/${operationId}`, quoteNotificationsPath, quoteNotificationReadPath]) {
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

  it('takes the quote snapshot source from the authenticated draft request', async () => {
    const { request, repository } = harness()
    const path = '/marketplace/requests'
    const body = {
      workspaceId, projectId: quoteDraft.projectId, expectedProjectRevision: 1, operationId,
      title: quoteDraft.title, quantity: quoteDraft.quantity, notes: quoteDraft.notes,
    }
    expect((await request(path, 'POST', body, false)).status).toBe(401)
    expect((await request(path, 'POST', { ...body, spec: quoteDraft.spec })).status).toBe(422)
    expect((await request(path, 'POST', { ...body, expectedProjectRevision: 0 })).status).toBe(422)
    expect(repository.createQuoteRequestDraft).not.toHaveBeenCalled()
    expect((await request(path, 'POST', body)).status).toBe(201)
    expect(repository.createQuoteRequestDraft).toHaveBeenCalledWith(expect.objectContaining({ userId }), body)
    expect((await request(path + '?workspaceId=' + workspaceId + '&afterId=' + operationId)).status).toBe(422)
    expect((await request(path + '?workspaceId=' + workspaceId)).status).toBe(200)
    expect(repository.listQuoteRequestDrafts).toHaveBeenCalledWith(expect.objectContaining({ userId }), workspaceId, null)
    expect((await request(path + '/' + operationId)).payload.data).toEqual(quoteDraft)
  })

  it('publishes a saved request for the authenticated owner with an explicit bounded supplier set', async () => {
    const { request, repository } = harness()
    expect((await request(quotePublicationPath, 'POST', { supplierIds: [supplierId] }, false)).status).toBe(401)
    for (const body of [
      { supplierIds: [] }, { supplierIds: [supplierId, supplierId.toUpperCase()] },
      { supplierIds: Array.from({ length: 6 }, (_, index) => `11111111-1111-4111-8111-11111111111${index}`) },
      { supplierIds: [supplierId], userId }, { supplierIds: [supplierId], spec: quoteDraft.spec },
    ]) expect((await request(quotePublicationPath, 'POST', body)).status).toBe(422)
    expect(repository.publishQuoteRequest).not.toHaveBeenCalled()
    expect((await request(quotePublicationPath)).payload.data).toEqual({ publication: null })
    expect((await request(quotePublicationPath, 'POST', { supplierIds: [supplierId.toUpperCase()] })).payload.data).toEqual(receipt)
    expect(repository.publishQuoteRequest).toHaveBeenCalledWith(expect.objectContaining({ userId }), operationId, [supplierId])
    expect((await request(`${quoteSuppliersPath}?after=${supplierId}&after=${workspaceId}`)).status).toBe(422)
    expect((await request(`${quoteSuppliersPath}?after=${supplierId}`)).status).toBe(200)
    expect(repository.listQuoteRequestEligibleSuppliers).toHaveBeenCalledWith(expect.objectContaining({ userId }), operationId, supplierId)
  })

  it('authenticates and validates the supplier inbox and detail scope', async () => {
    const { request, repository } = harness()
    const detailPath = `${supplierRequestsPath}/${operationId}`
    expect((await request(detailPath, 'GET', undefined, false)).status).toBe(401)
    expect((await request(`${supplierRequestsPath}/invalid`)).status).toBe(422)
    expect(repository.getSupplierQuoteRequest).not.toHaveBeenCalled()
    expect((await request(`${supplierRequestsPath}?afterId=${operationId}`)).status).toBe(422)
    expect((await request(`${supplierRequestsPath}?afterId=${operationId}&afterCreatedAt=${receipt.publishedAt}`)).status).toBe(200)
    expect(repository.listSupplierQuoteRequests).toHaveBeenCalledWith(expect.objectContaining({ userId }), supplierId, { id: operationId, createdAt: receipt.publishedAt })
    expect((await request(detailPath)).payload.data).toEqual(supplierQuote)
    expect(repository.getSupplierQuoteRequest).toHaveBeenCalledWith(expect.objectContaining({ userId }), supplierId, operationId)
  })

  it('uses the full quote notification cursor and authenticated read scope', async () => {
    const { authenticate, request, repository } = harness()
    expect((await request(quoteNotificationsPath, 'GET', undefined, false)).status).toBe(401)
    expect((await request(quoteNotificationReadPath, 'POST', undefined, false)).status).toBe(401)
    const cursor = new URLSearchParams({
      afterCreatedAt: quoteDraft.createdAt, afterRequestId: operationId, afterSupplierId: supplierId,
    })
    expect((await request(`${quoteNotificationsPath}?afterCreatedAt=${quoteDraft.createdAt}&afterRequestId=${operationId}`)).status).toBe(422)
    expect((await request(`${quoteNotificationsPath}?${cursor}&afterSupplierId=${supplierId}`)).status).toBe(422)
    expect((await request(`${quoteNotificationsPath}?supplierId=${supplierId}`)).status).toBe(422)
    expect(repository.listQuoteRequestNotifications).not.toHaveBeenCalled()
    expect((await request(`${quoteNotificationsPath}?${cursor}`)).payload.data).toEqual({ items: [], nextCursor: null, hasUnread: false })
    expect(repository.listQuoteRequestNotifications).toHaveBeenCalledWith(expect.objectContaining({ userId }), {
      createdAt: quoteDraft.createdAt, requestId: operationId, supplierId,
    })
    expect((await request(`${supplierRequestsPath}/invalid/read`, 'POST')).status).toBe(422)
    expect(repository.markQuoteRequestNotificationRead).not.toHaveBeenCalled()
    const marked = await request(quoteNotificationReadPath, 'POST')
    expect(marked.status).toBe(200)
    expect(marked.payload.data).toEqual({ requestId: operationId, supplierId, readAt: quoteDraft.createdAt })
    expect(repository.markQuoteRequestNotificationRead).toHaveBeenCalledWith(expect.objectContaining({ userId }), supplierId, operationId)
    expect(authenticate).toHaveBeenLastCalledWith('fixture', expect.any(String), { verifyMfa: false })
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

  it('checks reviewer MFA on both the document list and private download', async () => {
    const unverified = harness({ reviewer: true })
    for (const path of [`/admin${documentsPath}`, `/admin${documentPath}`]) {
      expect(await unverified.request(path)).toMatchObject({ status: 403, payload: { error: { code: 'MARKETPLACE_MFA_REQUIRED' } } })
    }
    expect(unverified.repository.listReviewDocuments).not.toHaveBeenCalled()
    expect(unverified.repository.getReviewDocument).not.toHaveBeenCalled()

    const verified = harness({ reviewer: true, mfa: true })
    expect(await verified.request(`/admin${documentsPath}`)).toMatchObject({ status: 200, payload: { data: { documents: [reviewDocument] } } })
    const download = await verified.request(`/admin${documentPath}`)
    expect(download).toMatchObject({ status: 200, headers: { 'cache-control': 'no-store' }, payload: { data: { document: reviewDocument } } })
    expect(verified.repository.getReviewDocument).toHaveBeenCalledWith(expect.objectContaining({ userId, hasVerifiedMfa: true }), supplierId, operationId, true)
    expect((await verified.request(`/admin${documentPath}`, 'DELETE')).status).toBe(405)
    expect(verified.repository.removeReviewDocument).not.toHaveBeenCalled()
  })

  it('keeps notification audiences authenticated and requires MFA for reviewer list and read actions', async () => {
    const unverified = harness({ reviewer: true })
    const readPath = `${adminNotificationsPath}/${operationId}/read`
    expect((await unverified.request(notificationsPath, 'GET', undefined, false)).status).toBe(401)
    expect(await unverified.request(adminNotificationsPath)).toMatchObject({ status: 403, payload: { error: { code: 'MARKETPLACE_MFA_REQUIRED' } } })
    expect(await unverified.request(readPath, 'POST')).toMatchObject({ status: 403, payload: { error: { code: 'MARKETPLACE_MFA_REQUIRED' } } })
    expect(unverified.repository.listNotifications).not.toHaveBeenCalled()
    expect(unverified.repository.markNotificationRead).not.toHaveBeenCalled()

    const verified = harness({ reviewer: true, mfa: true })
    expect(await verified.request(adminNotificationsPath)).toMatchObject({ status: 200, headers: { 'cache-control': 'no-store' } })
    expect((await verified.request(readPath, 'POST')).status).toBe(200)
    expect(verified.repository.listNotifications).toHaveBeenCalledWith(expect.objectContaining({ userId, hasVerifiedMfa: true }), true, null)
    expect(verified.repository.markNotificationRead).toHaveBeenCalledWith(expect.objectContaining({ userId, hasVerifiedMfa: true }), true, operationId)
  })

  it('validates both cursor parts without rounding timestamp precision or allowing audience overrides', async () => {
    const { request, repository } = harness()
    for (const query of [`afterId=${operationId}`, 'asReviewer=true', `afterId=${operationId}&afterId=${operationId}`]) {
      expect((await request(`${notificationsPath}?${query}`)).status).toBe(422)
    }
    expect(repository.listNotifications).not.toHaveBeenCalled()
    const query = new URLSearchParams({ afterId: notification.id, afterCreatedAt: notification.createdAt })
    expect((await request(`${notificationsPath}?${query}`)).status).toBe(200)
    expect(repository.listNotifications).toHaveBeenCalledWith(expect.objectContaining({ userId }), false, {
      id: notification.id, createdAt: notification.createdAt,
    })
  })

  it('accepts only bounded document bytes that match the name and type', async () => {
    const { repository, request } = harness()
    expect((await request(documentsPath, 'POST', uploadDocument, false)).status).toBe(401)
    for (const extra of [
      { name: 'proof.html' },
      { name: '../proof.pdf' },
      { mimeType: 'image/png' },
      { dataBase64: '%%%=' },
      { dataBase64: Buffer.from('<html>content</html>').toString('base64') },
      { asReviewer: true },
    ]) {
      expect((await request(documentsPath, 'POST', { ...uploadDocument, ...extra })).status).toBe(422)
    }
    expect((await request(documentsPath, 'POST', { ...uploadDocument, dataBase64: 'a'.repeat(3 * 1024 * 1024) })).status).toBe(413)
    expect(repository.addReviewDocument).not.toHaveBeenCalled()
    expect((await request(documentsPath, 'POST', uploadDocument)).status).toBe(201)
    expect(repository.addReviewDocument).toHaveBeenCalledWith(expect.objectContaining({ userId }), supplierId, uploadDocument)
    expect((await request(documentPath, 'DELETE')).status).toBe(200)
    expect(repository.removeReviewDocument).toHaveBeenCalledWith(expect.objectContaining({ userId }), supplierId, operationId)
  })

  it('returns an invitation token only on creation and gives the repository its hash', async () => {
    const { authenticate, request, repository } = harness()
    const invitePath = `${teamPath}/invitations`
    expect((await request(invitePath, 'POST', { email: invitation.email, role: 'owner' })).status).toBe(422)
    expect(repository.invite).not.toHaveBeenCalled()
    const first = await request(invitePath, 'POST', { email: ' INVITED@example.test ', role: 'viewer' })
    expect(first).toMatchObject({ status: 201, headers: { 'cache-control': 'no-store' }, payload: { data: { invite: invitation } } })
    const token: string = first.payload.data.token
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(repository.invite).toHaveBeenCalledWith(expect.objectContaining({ userId }), supplierId, invitation.email, 'viewer',
      createHash('sha256').update(token).digest('hex'))
    expect(authenticate).toHaveBeenLastCalledWith('fixture', expect.any(String), { verifyMfa: false })
    const second = await request(invitePath, 'POST', { email: invitation.email, role: 'viewer' })
    expect(second.payload.data.token).not.toBe(token)
    const team = await request(teamPath)
    expect(team.payload.data).toEqual({ members: [teamMember], invites: [invitation] })
  })

  it('redeems only through an authenticated POST using verified identity email', async () => {
    const { authenticate, request, repository } = harness()
    const token = 'a'.repeat(43)
    expect((await request(acceptPath, 'GET')).status).toBe(405)
    expect((await request(acceptPath, 'POST', { token }, false)).status).toBe(401)
    expect((await request(acceptPath, 'POST', { token, email: invitation.email })).status).toBe(422)
    expect((await request(acceptPath, 'POST', { token: `${token}?` })).status).toBe(422)
    expect(repository.acceptInvite).not.toHaveBeenCalled()
    expect((await request(acceptPath, 'POST', { token })).payload.data.role).toBe('viewer')
    expect(authenticate).toHaveBeenLastCalledWith('fixture', expect.any(String), { verifyMfa: false, includeVerifiedEmail: true })
    expect(repository.acceptInvite).toHaveBeenCalledWith(expect.objectContaining({ userId }), invitation.email,
      createHash('sha256').update(token).digest('hex'))

    const unconfirmed = harness({ hasVerifiedEmail: false })
    expect(await unconfirmed.request(acceptPath, 'POST', { token })).toMatchObject({ status: 404 })
    expect(unconfirmed.repository.acceptInvite).not.toHaveBeenCalled()
  })

  it('routes team mutations with supplier and target IDs scoped to the authenticated actor', async () => {
    const { request, repository } = harness()
    const memberPath = `${teamPath}/members/${userId}`
    const invitePath = `${teamPath}/invitations/${invitation.id}`
    expect((await request(`${teamPath}/members/invalid`, 'DELETE')).status).toBe(422)
    expect((await request(memberPath, 'PUT', { role: 'staff', workspaceId })).status).toBe(422)
    expect(repository.changeMember).not.toHaveBeenCalled()
    expect(repository.removeMember).not.toHaveBeenCalled()
    expect((await request(memberPath, 'PUT', { role: 'staff' })).status).toBe(200)
    expect((await request(memberPath, 'DELETE')).status).toBe(200)
    expect((await request(invitePath, 'DELETE')).status).toBe(200)
    expect(repository.changeMember).toHaveBeenCalledWith(expect.objectContaining({ userId }), supplierId, userId, 'staff')
    expect(repository.removeMember).toHaveBeenCalledWith(expect.objectContaining({ userId }), supplierId, userId)
    expect(repository.revokeInvite).toHaveBeenCalledWith(expect.objectContaining({ userId }), supplierId, invitation.id)
  })
})
