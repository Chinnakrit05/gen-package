import { z } from 'zod'
import { QUOTE_REQUEST_DRAFT_PAGE_SIZE } from '../../../shared/contracts/quoteRequests'

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

export const quoteDraftListQuery = z.object({
  workspaceId: z.uuid(),
  afterCreatedAt: timestamp.optional(),
  afterId: z.uuid().optional(),
}).strict().refine((query) => Boolean(query.afterCreatedAt) === Boolean(query.afterId))
  .transform(({ workspaceId, afterCreatedAt, afterId }) => ({
    workspaceId,
    after: afterCreatedAt && afterId ? { createdAt: afterCreatedAt, id: afterId } : null,
  }))

const draftSummary = draftCursor.extend({ projectName: z.string().min(1), title, quantity }).strict()
const dimension = z.number().positive()
export const quoteDraft = draftSummary.extend({
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  projectRevision,
  notes,
  spec: z.object({
    template: z.string().min(1),
    materialId: z.string().min(1),
    W: dimension,
    D: dimension,
    H: dimension,
    handle: z.boolean(),
  }).strict(),
}).strict()
export const quoteDraftPage = z.object({
  items: z.array(draftSummary).max(QUOTE_REQUEST_DRAFT_PAGE_SIZE),
  nextCursor: draftCursor.nullable(),
}).strict()
