/** Marketplace money is recorded in integer THB satang; no payment processing. */
export interface CommercePage<T> { items: T[]; nextCursor: string | null }
export interface QuotationTerms {
  requestRevisionId: string
  totalMinor: number
  currency: 'THB'
  leadDays: number
  validUntil: string
  depositMinor: number
  requiresProof: boolean
  notes: string
}
export interface QuotationRevision extends QuotationTerms {
  id: string
  quotationId: string
  revision: number
  sentAt: string
}
export interface Quotation {
  id: string
  requestId: string
  supplierId: string
  supplierName: string
  requestTitle: string
  revision: number
  status: 'draft' | 'sent' | 'withdrawn'
  draft: QuotationTerms | null
  current: QuotationRevision | null
  createdAt: string
  updatedAt: string
}
export interface SaveQuotationInput extends QuotationTerms { operationId: string; expectedRevision: number }
export interface QuotationActionInput { operationId: string; expectedRevision: number }
export type ProductionOrderStatus = 'pending_supplier_confirmation' | 'confirmed' | 'declined' | 'expired' | 'cancelled' | 'in_production' | 'shipped' | 'completed'
export interface ProductionProof { id: string; version: number; fileId: string; notes: string; createdAt: string; approvedAt: string | null }
export interface PaymentReport { id: string; amountMinor: number; reference: string; fileId: string | null; reportedAt: string; confirmedAt: string | null }
export interface ProductionOrder {
  id: string; requestId: string; supplierId: string; supplierName: string; requestTitle: string
  acceptedQuoteRevisionId: string; terms: QuotationRevision; status: ProductionOrderStatus
  revision: number; createdAt: string; confirmationDeadline: string
  proofs: ProductionProof[]; payments: PaymentReport[]; permissions: ProductionPermissions
  requestSnapshot: { title: string; quantity: number; notes: string; spec: Record<string, unknown> }
}
export interface SelectQuotationInput { operationId: string; quoteRevisionId: string }
export interface ProductionOrderActionInput { operationId: string; expectedRevision: number; reason?: string }
export interface ProductionPermissions {
  side: 'buyer' | 'supplier'; canConfirm: boolean; canApproveProof: boolean
  canReportPayment: boolean; canConfirmPayment: boolean; canUploadProof: boolean; canUpdateStatus: boolean; canCancel: boolean
}
export interface RequestSpecRevision {
 id:string; revision:number; title:string; quantity:number; notes:string
 spec: import('./quoteRequests').QuoteRequestDraft['spec']; createdAt:string
}
export interface RequestTrading {
 status:'open'|'closed'|'selection_pending'|'awarded'; acceptingUntil:string
 currentRevision:RequestSpecRevision; revisions:RequestSpecRevision[]; revisionsNextCursor:number|null
}
export interface ReviseRequestInput {
 operationId:string; expectedRevisionId:string; title:string; quantity:number; notes:string
 spec:import('./quoteRequests').QuoteRequestDraft['spec']; acceptingUntil:string
}
export interface CommerceNotification {
 id:string;requestId:string;supplierId:string;kind:string;entityId:string;createdAt:string;readAt:string|null;requestTitle:string;supplierName:string
}
export interface QuotationHistoryPage {items:QuotationRevision[];nextCursor:number|null}

export interface RequestRevisionPage {items:RequestSpecRevision[];nextCursor:number|null}
/** Legacy thumbnails have no verified image-to-project revision association. */
export interface RequestPreview {
 preview: {
  mimeType:'image/webp'|'image/jpeg';dataBase64:string;byteSize:number
  sourceProjectRevision:null;sourceRequestRevisionId:string
  frozenRequestProjectRevision:number;projectRevisionAtCapture:number
  thumbnailUpdatedAt:string;capturedAt:string;match:'unverified_reference'|'original_reference'
 }|null
}
