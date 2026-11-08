import type {
  CreateQuoteRequestDraftInput,
  PublishQuoteRequestInput,
  QuoteRequestCursor,
  QuoteRequestDraft,
  QuoteRequestDraftPage,
  QuoteRequestEligibleSupplierPage,
  QuoteRequestPublication,
  SupplierQuoteRequest,
  SupplierQuoteRequestPage,
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

export function getQuoteRequestPublication(base: string, token: string, id: string, signal?: AbortSignal): Promise<{ publication: QuoteRequestPublication | null }> {
  return requestApi(`${base}/marketplace/requests/${encodeURIComponent(id)}/publication`, token, { method: 'GET', signal })
}

export function listQuoteRequestEligibleSuppliers(base: string, token: string, id: string, after: string | null, signal?: AbortSignal): Promise<QuoteRequestEligibleSupplierPage> {
  const query = after ? `?${new URLSearchParams({ after })}` : ''
  return requestApi(`${base}/marketplace/requests/${encodeURIComponent(id)}/eligible-suppliers${query}`, token, { method: 'GET', signal })
}

export function publishQuoteRequest(base: string, token: string, id: string, input: PublishQuoteRequestInput, signal?: AbortSignal): Promise<QuoteRequestPublication> {
  return requestApi(`${base}/marketplace/requests/${encodeURIComponent(id)}/publication`, token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
}

export function listSupplierQuoteRequests(base: string, token: string, supplierId: string, after: QuoteRequestCursor | null, signal?: AbortSignal): Promise<SupplierQuoteRequestPage> {
  const query = after ? `?${new URLSearchParams({ afterCreatedAt: after.createdAt, afterId: after.id })}` : ''
  return requestApi(`${base}/suppliers/${encodeURIComponent(supplierId)}/quote-requests${query}`, token, { method: 'GET', signal })
}

export function getSupplierQuoteRequest(base: string, token: string, supplierId: string, id: string, signal?: AbortSignal): Promise<SupplierQuoteRequest> {
  return requestApi(`${base}/suppliers/${encodeURIComponent(supplierId)}/quote-requests/${encodeURIComponent(id)}`, token, { method: 'GET', signal })
}
