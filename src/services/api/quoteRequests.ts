import type {
  CreateQuoteRequestDraftInput,
  QuoteRequestCursor,
  QuoteRequestDraft,
  QuoteRequestDraftPage,
} from '../../../shared/contracts/quoteRequests'
import { requestApi } from './client'

export function listQuoteRequestDrafts(base: string, token: string, workspaceId: string, after: QuoteRequestCursor | null, signal?: AbortSignal): Promise<QuoteRequestDraftPage> {
  const query = new URLSearchParams({ workspaceId })
  if (after) {
    query.set('afterCreatedAt', after.createdAt)
    query.set('afterId', after.id)
  }
  return requestApi(`${base}/marketplace/requests?${query}`, token, { method: 'GET', signal })
}

export function getQuoteRequestDraft(base: string, token: string, id: string, signal?: AbortSignal): Promise<QuoteRequestDraft> {
  return requestApi(`${base}/marketplace/requests/${encodeURIComponent(id)}`, token, { method: 'GET', signal })
}

export function createQuoteRequestDraft(base: string, token: string, input: CreateQuoteRequestDraftInput, signal?: AbortSignal): Promise<QuoteRequestDraft> {
  return requestApi(`${base}/marketplace/requests`, token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
}
