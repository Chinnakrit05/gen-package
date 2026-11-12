import type { SupplierPublicProfile } from './marketplace'

export const QUOTE_REQUEST_DRAFT_PAGE_SIZE = 24
export const QUOTE_REQUEST_PUBLICATION_PAGE_SIZE = 24
export const QUOTE_REQUEST_MAX_SUPPLIERS = 5

export interface QuoteRequestCursor {
  createdAt: string
  id: string
}

export interface QuoteRequestDraftSummary extends QuoteRequestCursor {
  projectName: string
  title: string
  quantity: number
}

export interface QuoteRequestDraft extends QuoteRequestDraftSummary {
  workspaceId: string
  projectId: string
  projectRevision: number
  notes: string
  spec: {
    template: string
    materialId: string
    W: number
    D: number
    H: number
    handle: boolean
  }
}

export interface QuoteRequestDraftPage {
  items: QuoteRequestDraftSummary[]
  nextCursor: QuoteRequestCursor | null
}

export interface CreateQuoteRequestDraftInput {
  workspaceId: string
  projectId: string
  expectedProjectRevision: number
  operationId: string
  title: string
  quantity: number
  notes: string
}

export interface PublishQuoteRequestInput {
  supplierIds: string[]
}

export interface QuoteRequestPublication {
  revisionId: string
  publishedAt: string
  suppliers: Pick<SupplierPublicProfile, 'id' | 'name'>[]
}

export type QuoteRequestEligibleSupplier = Pick<SupplierPublicProfile, 'id' | 'name' | 'kind' | 'capabilities'>

export interface QuoteRequestEligibleSupplierPage {
  items: QuoteRequestEligibleSupplier[]
  nextCursor: string | null
}

export interface SupplierQuoteRequestSummary {
  id: string
  revisionId: string
  title: string
  quantity: number
  publishedAt: string
}

export interface SupplierQuoteRequest extends SupplierQuoteRequestSummary {
  notes: string
  spec: QuoteRequestDraft['spec']
}

export interface SupplierQuoteRequestPage {
  items: SupplierQuoteRequestSummary[]
  nextCursor: QuoteRequestCursor | null
}

export interface QuoteRequestNotificationCursor {
  createdAt: string
  requestId: string
  supplierId: string
}

export interface QuoteRequestNotification extends QuoteRequestNotificationCursor {
  supplierName: string
  requestTitle: string
  readAt: string | null
}

export interface QuoteRequestNotificationPage {
  items: QuoteRequestNotification[]
  nextCursor: QuoteRequestNotificationCursor | null
  hasUnread: boolean
}

export interface QuoteRequestNotificationRead {
  requestId: string
  supplierId: string
  readAt: string
}
