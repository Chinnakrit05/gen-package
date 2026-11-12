import type { CommercePage, Quotation, SaveQuotationInput, QuotationActionInput } from '../../../shared/contracts/commerce'
import { requestApi } from './client'
const id = encodeURIComponent
export function commerceRead<T>(base: string, token: string, path: string, signal?: AbortSignal): Promise<T> {
  return requestApi(`${base}${path}`, token, { method: 'GET', signal })
}
export function commerceWrite<T>(base: string, token: string, path: string, input: unknown, method = 'POST'): Promise<T> {
  return requestApi(`${base}${path}`, token, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
}
export const quotationPath = (supplierId: string, requestId: string) => `/suppliers/${id(supplierId)}/quote-requests/${id(requestId)}/quotation`
export const listBuyerQuotations = (base: string, token: string, requestId: string, cursor: string | null, signal?: AbortSignal) => commerceRead<CommercePage<Quotation>>(base, token, `/marketplace/requests/${id(requestId)}/quotations${cursor ? `?cursor=${id(cursor)}` : ''}`, signal)
export const listSupplierQuotations = (base: string, token: string, supplierId: string, cursor: string | null, signal?: AbortSignal) => commerceRead<CommercePage<Quotation>>(base, token, `/suppliers/${id(supplierId)}/quotations${cursor ? `?cursor=${id(cursor)}` : ''}`, signal)
export const getQuotation = (base: string, token: string, supplierId: string, requestId: string, signal?: AbortSignal) => commerceRead<{ quotation: Quotation | null }>(base, token, quotationPath(supplierId, requestId), signal)
export const saveQuotation = (base: string, token: string, supplierId: string, requestId: string, input: SaveQuotationInput) => commerceWrite<Quotation>(base, token, quotationPath(supplierId, requestId), input, 'PUT')
export const actQuotation = (base: string, token: string, supplierId: string, requestId: string, action: 'send' | 'withdraw', input: QuotationActionInput) => commerceWrite<Quotation>(base, token, `${quotationPath(supplierId, requestId)}/${action}`, input)

export const listProductionOrders = (base: string, token: string, supplierId: string | undefined, cursor: string | null, signal?: AbortSignal) => commerceRead<import('../../../shared/contracts/commerce').CommercePage<import('../../../shared/contracts/commerce').ProductionOrder>>(base, token, `${supplierId ? `/suppliers/${id(supplierId)}` : '/marketplace'}/production-orders${cursor ? `?cursor=${id(cursor)}` : ''}`, signal)
export const getProductionOrder = (base: string, token: string, orderId: string, signal?: AbortSignal) => commerceRead<import('../../../shared/contracts/commerce').ProductionOrder>(base, token, `/marketplace/production-orders/${id(orderId)}`, signal)
export const selectQuotation = (base: string, token: string, requestId: string, input: import('../../../shared/contracts/commerce').SelectQuotationInput) => commerceWrite<import('../../../shared/contracts/commerce').ProductionOrder>(base, token, `/marketplace/requests/${id(requestId)}/select-quotation`, input)
export const actProductionOrder = (base: string, token: string, orderId: string, action: string, input: import('../../../shared/contracts/commerce').ProductionOrderActionInput & Record<string, unknown>) => commerceWrite<import('../../../shared/contracts/commerce').ProductionOrder>(base, token, `/marketplace/production-orders/${id(orderId)}/${id(action)}`, input)
export const downloadOrderFile = (base: string, token: string, orderId: string, fileId: string, signal?: AbortSignal) => commerceRead<import('../../../shared/contracts/conversations').ConversationFileDownload>(base, token, `/marketplace/production-orders/${id(orderId)}/files/${id(fileId)}`, signal)
export const getRequestTrading = (base: string, token: string, requestId: string, supplierId?: string, signal?: AbortSignal) => commerceRead<import('../../../shared/contracts/commerce').RequestTrading>(base, token, supplierId ? `/suppliers/${id(supplierId)}/quote-requests/${id(requestId)}/trading` : `/marketplace/requests/${id(requestId)}/trading`, signal)
export const reviseRequest = (base: string, token: string, requestId: string, input: import('../../../shared/contracts/commerce').ReviseRequestInput) => commerceWrite<import('../../../shared/contracts/commerce').RequestTrading>(base, token, `/marketplace/requests/${id(requestId)}/revisions`, input)
export const getQuotationHistory = (base: string, token: string, quotationId: string, supplierId: string | undefined, cursor: number | null, signal?: AbortSignal) => commerceRead<import('../../../shared/contracts/commerce').QuotationHistoryPage>(base, token, `${supplierId ? `/suppliers/${id(supplierId)}` : '/marketplace'}/quotations/${id(quotationId)}/history${cursor ? `?cursor=${cursor}` : ''}`, signal)
export const getRequestHistory = (base: string, token: string, requestId: string, supplierId: string | undefined, cursor: number | null, signal?: AbortSignal) => commerceRead<import('../../../shared/contracts/commerce').RequestRevisionPage>(base, token, `${supplierId ? `/suppliers/${id(supplierId)}/quote-requests` : '/marketplace/requests'}/${id(requestId)}/revisions${cursor ? `?cursor=${cursor}` : ''}`, signal)
export const listCommerceNotifications = (base: string, token: string, cursor: string | null, signal?: AbortSignal) => commerceRead<import('../../../shared/contracts/commerce').CommercePage<import('../../../shared/contracts/commerce').CommerceNotification>>(base, token, `/marketplace/commerce-notifications${cursor ? `?cursor=${id(cursor)}` : ''}`, signal)
export const readCommerceNotification = (base: string, token: string, notificationId: string) => commerceWrite<{ id: string; readAt: string }>(base, token, `/marketplace/commerce-notifications/${id(notificationId)}/read`, {})
export type RequestPreviewTarget = { orderId: string } | { requestId: string; revisionId: string; supplierId?: string }
export function getRequestPreview(base: string, token: string, target: RequestPreviewTarget, signal?: AbortSignal) {
  const path = 'orderId' in target
    ? `/marketplace/production-orders/${id(target.orderId)}/preview`
    : `${target.supplierId ? `/suppliers/${id(target.supplierId)}/quote-requests` : '/marketplace/requests'}/${id(target.requestId)}/revisions/${id(target.revisionId)}/preview`
  return commerceRead<import('../../../shared/contracts/commerce').RequestPreview>(base, token, path, signal)
}
