import { z } from 'zod'
import { QUOTE_REQUEST_DRAFT_PAGE_SIZE, QUOTE_REQUEST_MAX_SUPPLIERS, QUOTE_REQUEST_PUBLICATION_PAGE_SIZE } from '../../../shared/contracts/quoteRequests'
import { supplierPublicProfile } from './validation'

const timestamp = z.iso.datetime({ offset: true })
const draftCursor = z.object({ createdAt: timestamp, id: z.uuid() }).strict()
const title = z.string().trim().min(1).max(100)
const quantity = z.int().min(1).max(1_000_000)
const notes = z.string().trim().max(1000)
const projectRevision = z.int().positive()

export const createQuoteDraftInput = z.object({
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  expectedProjectRevision: projectRevision,
  operationId: z.uuid(),
  title,
  quantity,
  notes,
}).strict()

const listCursorQuery = z.object({
  afterCreatedAt: timestamp.optional(),
  afterId: z.uuid().optional(),
}).strict()
const hasCompleteCursor = (query: z.infer<typeof listCursorQuery>) => Boolean(query.afterCreatedAt) === Boolean(query.afterId)
const quoteRequestAfter = ({ afterCreatedAt, afterId }: z.infer<typeof listCursorQuery>) =>
  afterCreatedAt && afterId ? { createdAt: afterCreatedAt, id: afterId } : null

export const quoteDraftListQuery = listCursorQuery.extend({ workspaceId: z.uuid() }).refine(hasCompleteCursor)
  .transform((query) => ({ workspaceId: query.workspaceId, after: quoteRequestAfter(query) }))

export const supplierQuoteRequestListQuery = listCursorQuery.refine(hasCompleteCursor).transform(quoteRequestAfter)
export const quoteEligibleSupplierListQuery = z.object({ after: z.uuid().optional() }).strict()
  .transform(({ after }) => after ?? null)

const draftSummary = draftCursor.extend({ projectName: z.string().min(1), title, quantity }).strict()
const dimension = z.number().positive()
const quoteSpec = z.object({
  template: z.string().min(1),
  materialId: z.string().min(1),
  W: dimension,
  D: dimension,
  H: dimension,
  handle: z.boolean(),
}).strict()
export const quoteDraft = draftSummary.extend({
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  projectRevision,
  notes,
  spec: quoteSpec,
}).strict()

export const publishQuoteRequestInput = z.object({
  supplierIds: z.array(z.uuid().toLowerCase()).min(1).max(QUOTE_REQUEST_MAX_SUPPLIERS)
    .refine((ids) => new Set(ids).size === ids.length),
}).strict()

const publicationSupplier = supplierPublicProfile.pick({ id: true, name: true })
const eligibleSupplier = supplierPublicProfile.pick({ id: true, name: true, kind: true, capabilities: true })
export const quoteEligibleSupplierPage = z.object({
  items: z.array(eligibleSupplier).max(QUOTE_REQUEST_PUBLICATION_PAGE_SIZE),
  nextCursor: z.uuid().nullable(),
}).strict()

export const quoteRequestPublication = z.object({
  revisionId: z.uuid(),
  publishedAt: timestamp,
  suppliers: z.array(publicationSupplier).min(1).max(QUOTE_REQUEST_MAX_SUPPLIERS),
}).strict()
export const quoteRequestPublicationState = z.object({ publication: quoteRequestPublication.nullable() }).strict()

const supplierQuoteRequestSummary = z.object({ id: z.uuid(), revisionId: z.uuid(), title, quantity, publishedAt: timestamp }).strict()
export const supplierQuoteRequest = supplierQuoteRequestSummary.extend({ notes, spec: quoteSpec })
export const supplierQuoteRequestPage = z.object({
  items: z.array(supplierQuoteRequestSummary).max(QUOTE_REQUEST_PUBLICATION_PAGE_SIZE),
  nextCursor: draftCursor.nullable(),
}).strict()

export const quoteRequestNotificationQuery = z.object({
  afterCreatedAt: timestamp.optional(),
  afterRequestId: z.uuid().optional(),
  afterSupplierId: z.uuid().optional(),
}).strict().refine(({ afterCreatedAt, afterRequestId, afterSupplierId }) =>
  Boolean(afterCreatedAt) === Boolean(afterRequestId) && Boolean(afterCreatedAt) === Boolean(afterSupplierId),
).transform(({ afterCreatedAt, afterRequestId, afterSupplierId }) => afterCreatedAt && afterRequestId && afterSupplierId
  ? { createdAt: afterCreatedAt, requestId: afterRequestId, supplierId: afterSupplierId }
  : null)

const quoteRequestNotificationCursor = z.object({ createdAt: timestamp, requestId: z.uuid(), supplierId: z.uuid() }).strict()
const quoteRequestNotification = quoteRequestNotificationCursor.extend({
  supplierName: publicationSupplier.shape.name,
  requestTitle: title,
  readAt: timestamp.nullable(),
})
export const quoteRequestNotificationPage = z.object({
  items: z.array(quoteRequestNotification).max(QUOTE_REQUEST_PUBLICATION_PAGE_SIZE),
  nextCursor: quoteRequestNotificationCursor.nullable(),
  hasUnread: z.boolean(),
}).strict()
export const quoteRequestNotificationRead = z.object({ requestId: z.uuid(), supplierId: z.uuid(), readAt: timestamp }).strict()
export const quoteDraftPage = z.object({
  items: z.array(draftSummary).max(QUOTE_REQUEST_DRAFT_PAGE_SIZE),
  nextCursor: draftCursor.nullable(),
}).strict()
