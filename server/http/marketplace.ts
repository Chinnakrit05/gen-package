import { createHash, randomBytes } from 'node:crypto'
import type { ZodType } from 'zod'
import type { MarketplaceContextData } from '../../shared/contracts/marketplace'
import type { Actor } from '../modules/identity/actor'
import type { ActorAuthenticationOptions } from '../modules/identity/sessionService'
import {
  createQuoteDraftInput,
  publishQuoteRequestInput,
  quoteDraftListQuery,
  quoteEligibleSupplierListQuery,
  supplierQuoteRequestListQuery,
} from '../modules/marketplace/quoteRequestValidation'
import type { MarketplaceRepository } from '../modules/marketplace/marketplaceRepository'
import {
  acceptSupplierInviteInput,
  addSupplierReviewDocumentInput,
  changeSupplierMemberInput,
  createSupplierInput,
  createSupplierInviteInput,
  expectedSupplierRevision,
  reviewSupplierInput,
  supplierAdminQuery,
  supplierIdSchema,
  supplierNotificationQuery,
  supplierReviewDocumentBodyLimit,
  supplierSlugSchema,
  updateSupplierInput,
} from '../modules/marketplace/validation'
import { HttpError } from './errors'

const marketplacePaths = [
  ['context', /^\/api\/v1\/marketplace\/context$/, ['GET']],
  ['notifications', /^\/api\/v1\/marketplace\/notifications$/, ['GET']],
  ['markNotificationRead', /^\/api\/v1\/marketplace\/notifications\/([^/]+)\/read$/, ['POST']],
  ['create', /^\/api\/v1\/suppliers$/, ['POST']],
  ['supplier', /^\/api\/v1\/suppliers\/([^/]+)$/, ['GET', 'PUT']],
  ['submit', /^\/api\/v1\/suppliers\/([^/]+)\/submit$/, ['POST']],
  ['team', /^\/api\/v1\/suppliers\/([^/]+)\/team$/, ['GET']],
  ['invite', /^\/api\/v1\/suppliers\/([^/]+)\/team\/invitations$/, ['POST']],
  ['revokeInvite', /^\/api\/v1\/suppliers\/([^/]+)\/team\/invitations\/([^/]+)$/, ['DELETE']],
  ['member', /^\/api\/v1\/suppliers\/([^/]+)\/team\/members\/([^/]+)$/, ['PUT', 'DELETE']],
  ['acceptInvite', /^\/api\/v1\/suppliers\/invitations\/accept$/, ['POST']],
  ['reviewDocuments', /^\/api\/v1\/suppliers\/([^/]+)\/review-documents$/, ['GET', 'POST']],
  ['reviewDocument', /^\/api\/v1\/suppliers\/([^/]+)\/review-documents\/([^/]+)$/, ['GET', 'DELETE']],
  ['publicProfile', /^\/api\/v1\/suppliers\/public\/([^/]+)$/, ['GET']],
  ['adminList', /^\/api\/v1\/admin\/suppliers$/, ['GET']],
  ['adminNotifications', /^\/api\/v1\/admin\/suppliers\/notifications$/, ['GET']],
  ['adminMarkNotificationRead', /^\/api\/v1\/admin\/suppliers\/notifications\/([^/]+)\/read$/, ['POST']],
  ['review', /^\/api\/v1\/admin\/suppliers\/([^/]+)\/review$/, ['POST']],
  ['adminReviewDocuments', /^\/api\/v1\/admin\/suppliers\/([^/]+)\/review-documents$/, ['GET']],
  ['adminReviewDocument', /^\/api\/v1\/admin\/suppliers\/([^/]+)\/review-documents\/([^/]+)$/, ['GET']],
  ['quoteDrafts', /^\/api\/v1\/marketplace\/requests$/, ['GET', 'POST']],
  ['quoteDraft', /^\/api\/v1\/marketplace\/requests\/([^/]+)$/, ['GET']],
  ['quotePublication', /^\/api\/v1\/marketplace\/requests\/([^/]+)\/publication$/, ['GET', 'POST']],
  ['quoteEligibleSuppliers', /^\/api\/v1\/marketplace\/requests\/([^/]+)\/eligible-suppliers$/, ['GET']],
  ['supplierQuoteRequests', /^\/api\/v1\/suppliers\/([^/]+)\/quote-requests$/, ['GET']],
  ['supplierQuoteRequest', /^\/api\/v1\/suppliers\/([^/]+)\/quote-requests\/([^/]+)$/, ['GET']],
] as const

interface MarketplaceRoute {
  kind: (typeof marketplacePaths)[number][0]
  methods: readonly string[]
  parameter?: string
  childId?: string
}

export function matchMarketplaceRoute(path: string): MarketplaceRoute | null {
  for (const [kind, pattern, methods] of marketplacePaths) {
    const match = pattern.exec(path)
    if (match) return { kind, methods, parameter: match[1], childId: match[2] }
  }
  return null
}

function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function validated<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (result.success) return result.data
  throw new HttpError(422, 'VALIDATION_ERROR', 'ข้อมูล Marketplace ไม่ถูกต้อง', {
    fields: [...new Set(result.error.issues.map((issue) => issue.path.join('.')).filter(Boolean))],
  })
}

function uniqueQuery(params: URLSearchParams): Record<string, string> {
  const query = Object.fromEntries(params)
  if (Object.keys(query).length !== params.size) throw new HttpError(422, 'VALIDATION_ERROR', 'query parameter ต้องไม่ซ้ำ')
  return query
}

export async function serveMarketplaceRoute(
  route: MarketplaceRoute,
  request: {
    method: string
    query: URLSearchParams
    authenticate(options: ActorAuthenticationOptions): Promise<Actor>
    readBody(maxBytes?: number): Promise<unknown>
  },
  repository: MarketplaceRepository,
): Promise<{ status: number; data: unknown }> {
  const { kind, parameter, childId } = route
  if (kind === 'publicProfile') {
    return { status: 200, data: await repository.publicProfile(validated(supplierSlugSchema, parameter)) }
  }

  const asReviewer = kind === 'adminReviewDocuments' || kind === 'adminReviewDocument'
    || kind === 'adminNotifications' || kind === 'adminMarkNotificationRead'
  const isAdminRoute = kind === 'adminList' || kind === 'review' || asReviewer
  const actor = await request.authenticate({
    verifyMfa: isAdminRoute || kind === 'context',
    ...(kind === 'acceptInvite' ? { includeVerifiedEmail: true } : {}),
  })
  if (isAdminRoute && actor.hasVerifiedMfa !== true) {
    throw new HttpError(403, 'MARKETPLACE_MFA_REQUIRED', 'ยืนยันตัวตนสองขั้นตอนก่อนใช้งานหน้าแอดมิน')
  }
  switch (kind) {
    case 'context': {
      const { suppliers, isSupplierReviewer } = await repository.context(actor)
      const data: MarketplaceContextData = {
        suppliers,
        staff: { canReviewSuppliers: isSupplierReviewer, requiresMfa: isSupplierReviewer && actor.hasVerifiedMfa !== true },
      }
      return { status: 200, data }
    }
    case 'notifications':
    case 'adminNotifications': {
      const after = validated(supplierNotificationQuery, uniqueQuery(request.query))
      return { status: 200, data: await repository.listNotifications(actor, asReviewer, after) }
    }
    case 'markNotificationRead':
    case 'adminMarkNotificationRead':
      return { status: 200, data: await repository.markNotificationRead(actor, asReviewer, validated(supplierIdSchema, parameter)) }
    case 'create': {
      const { operationId, ...profile } = validated(createSupplierInput, await request.readBody())
      return { status: 201, data: await repository.create(actor, operationId, profile) }
    }
    case 'supplier': {
      const supplierId = validated(supplierIdSchema, parameter)
      if (request.method === 'GET') return { status: 200, data: await repository.get(actor, supplierId) }
      const { expectedRevision, ...profile } = validated(updateSupplierInput, await request.readBody())
      return { status: 200, data: await repository.update(actor, supplierId, expectedRevision, profile) }
    }
    case 'submit': {
      const supplierId = validated(supplierIdSchema, parameter)
      const { expectedRevision } = validated(expectedSupplierRevision, await request.readBody())
      return { status: 200, data: await repository.submit(actor, supplierId, expectedRevision) }
    }
    case 'team':
      return { status: 200, data: await repository.team(actor, validated(supplierIdSchema, parameter)) }
    case 'invite': {
      const supplierId = validated(supplierIdSchema, parameter)
      const { email, role } = validated(createSupplierInviteInput, await request.readBody())
      const token = randomBytes(32).toString('base64url')
      const invite = await repository.invite(actor, supplierId, email, role, hashInviteToken(token))
      return { status: 201, data: { invite, token } }
    }
    case 'revokeInvite': {
      const supplierId = validated(supplierIdSchema, parameter)
      const inviteId = validated(supplierIdSchema, childId)
      return { status: 200, data: await repository.revokeInvite(actor, supplierId, inviteId) }
    }
    case 'member': {
      const supplierId = validated(supplierIdSchema, parameter)
      const memberId = validated(supplierIdSchema, childId)
      if (request.method === 'DELETE') return { status: 200, data: await repository.removeMember(actor, supplierId, memberId) }
      const { role } = validated(changeSupplierMemberInput, await request.readBody())
      return { status: 200, data: await repository.changeMember(actor, supplierId, memberId, role) }
    }
    case 'acceptInvite': {
      const { token } = validated(acceptSupplierInviteInput, await request.readBody())
      if (!actor.verifiedEmail) throw new HttpError(404, 'NOT_FOUND', 'ใช้คำเชิญนี้ไม่ได้ กรุณาตรวจบัญชีที่ใช้หรือขอลิงก์ใหม่')
      return { status: 200, data: await repository.acceptInvite(actor, actor.verifiedEmail, hashInviteToken(token)) }
    }
    case 'reviewDocuments':
    case 'adminReviewDocuments': {
      const supplierId = validated(supplierIdSchema, parameter)
      if (request.method === 'GET') return { status: 200, data: await repository.listReviewDocuments(actor, supplierId, asReviewer) }
      const input = validated(addSupplierReviewDocumentInput, await request.readBody(supplierReviewDocumentBodyLimit))
      return { status: 201, data: await repository.addReviewDocument(actor, supplierId, input) }
    }
    case 'reviewDocument':
    case 'adminReviewDocument': {
      const supplierId = validated(supplierIdSchema, parameter)
      const documentId = validated(supplierIdSchema, childId)
      if (request.method === 'DELETE') return { status: 200, data: await repository.removeReviewDocument(actor, supplierId, documentId) }
      return { status: 200, data: await repository.getReviewDocument(actor, supplierId, documentId, asReviewer) }
    }
    case 'quoteDrafts': {
      if (request.method === 'POST') {
        const input = validated(createQuoteDraftInput, await request.readBody())
        return { status: 201, data: await repository.createQuoteRequestDraft(actor, input) }
      }
      const { workspaceId, after } = validated(quoteDraftListQuery, uniqueQuery(request.query))
      return { status: 200, data: await repository.listQuoteRequestDrafts(actor, workspaceId, after) }
    }
    case 'quoteDraft':
      return { status: 200, data: await repository.getQuoteRequestDraft(actor, validated(supplierIdSchema, parameter)) }
    case 'quotePublication': {
      const id = validated(supplierIdSchema, parameter)
      if (request.method === 'GET') return { status: 200, data: await repository.getQuoteRequestPublication(actor, id) }
      const { supplierIds } = validated(publishQuoteRequestInput, await request.readBody())
      return { status: 200, data: await repository.publishQuoteRequest(actor, id, supplierIds) }
    }
    case 'quoteEligibleSuppliers': {
      const id = validated(supplierIdSchema, parameter)
      const after = validated(quoteEligibleSupplierListQuery, uniqueQuery(request.query))
      return { status: 200, data: await repository.listQuoteRequestEligibleSuppliers(actor, id, after) }
    }
    case 'supplierQuoteRequests': {
      const supplierId = validated(supplierIdSchema, parameter)
      const after = validated(supplierQuoteRequestListQuery, uniqueQuery(request.query))
      return { status: 200, data: await repository.listSupplierQuoteRequests(actor, supplierId, after) }
    }
    case 'supplierQuoteRequest': {
      const supplierId = validated(supplierIdSchema, parameter)
      const id = validated(supplierIdSchema, childId)
      return { status: 200, data: await repository.getSupplierQuoteRequest(actor, supplierId, id) }
    }
    case 'adminList': {
      const { status, after } = validated(supplierAdminQuery, Object.fromEntries(request.query))
      return { status: 200, data: await repository.adminList(actor, status, after) }
    }
    case 'review': {
      const supplierId = validated(supplierIdSchema, parameter)
      const { expectedRevision, action, reason } = validated(reviewSupplierInput, await request.readBody())
      return { status: 200, data: await repository.review(actor, supplierId, expectedRevision, action, reason) }
    }
  }
}
