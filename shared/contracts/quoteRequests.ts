export const QUOTE_REQUEST_DRAFT_PAGE_SIZE = 24

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
