import type { ZodType } from 'zod'
import type { MarketplaceContextData } from '../../shared/contracts/marketplace'
import type { Actor } from '../modules/identity/actor'
import type { MarketplaceRepository } from '../modules/marketplace/marketplaceRepository'
import {
  createSupplierInput,
  expectedSupplierRevision,
  reviewSupplierInput,
  supplierAdminQuery,
  supplierIdSchema,
  supplierSlugSchema,
  updateSupplierInput,
} from '../modules/marketplace/validation'
import { HttpError } from './errors'

const marketplacePaths = [
  ['context', /^\/api\/v1\/marketplace\/context$/, ['GET']],
  ['create', /^\/api\/v1\/suppliers$/, ['POST']],
  ['supplier', /^\/api\/v1\/suppliers\/([^/]+)$/, ['GET', 'PUT']],
  ['submit', /^\/api\/v1\/suppliers\/([^/]+)\/submit$/, ['POST']],
  ['publicProfile', /^\/api\/v1\/suppliers\/public\/([^/]+)$/, ['GET']],
  ['adminList', /^\/api\/v1\/admin\/suppliers$/, ['GET']],
  ['review', /^\/api\/v1\/admin\/suppliers\/([^/]+)\/review$/, ['POST']],
] as const

interface MarketplaceRoute {
  kind: (typeof marketplacePaths)[number][0]
  methods: readonly string[]
  parameter?: string
}

export function matchMarketplaceRoute(path: string): MarketplaceRoute | null {
  for (const [kind, pattern, methods] of marketplacePaths) {
    const match = pattern.exec(path)
    if (match) return { kind, methods, parameter: match[1] }
  }
  return null
}

function validated<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (result.success) return result.data
  throw new HttpError(422, 'VALIDATION_ERROR', 'ข้อมูล Marketplace ไม่ถูกต้อง', {
    fields: [...new Set(result.error.issues.map((issue) => issue.path.join('.')).filter(Boolean))],
  })
}

export async function serveMarketplaceRoute(
  route: MarketplaceRoute,
  request: {
    method: string
    query: URLSearchParams
    authenticate(verifyMfa: boolean): Promise<Actor>
    readBody(): Promise<unknown>
  },
  repository: MarketplaceRepository,
): Promise<{ status: number; data: unknown }> {
  const { kind, parameter } = route
  if (kind === 'publicProfile') {
    return { status: 200, data: await repository.publicProfile(validated(supplierSlugSchema, parameter)) }
  }

  const isAdminRoute = kind === 'adminList' || kind === 'review'
  const actor = await request.authenticate(isAdminRoute || kind === 'context')
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
