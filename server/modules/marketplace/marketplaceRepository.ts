import type {
  MarketplaceContextData,
  MarketplaceRole,
  SupplierAccess,
  SupplierAdminPage,
  SupplierInvite,
  SupplierNotificationCursor,
  SupplierNotificationPage,
  SupplierProfile,
  SupplierProfileInput,
  SupplierPublicProfile,
  SupplierReviewAction,
  SupplierReviewDocument,
  SupplierReviewDocumentDownload,
  SupplierReviewDocumentUpload,
  SupplierStatus,
  SupplierTeam,
  SupplierTeamMember,
} from '../../../shared/contracts/marketplace'
import type {
  CreateQuoteRequestDraftInput,
  QuoteRequestCursor,
  QuoteRequestDraft,
  QuoteRequestDraftPage,
  QuoteRequestEligibleSupplierPage,
  QuoteRequestNotificationCursor,
  QuoteRequestNotificationPage,
  QuoteRequestNotificationRead,
  QuoteRequestPublication,
  SupplierQuoteRequest,
  SupplierQuoteRequestPage,
} from '../../../shared/contracts/quoteRequests'
import type { Actor } from '../identity/actor'

export interface MarketplaceRepository {
  context(actor: Actor): Promise<{ suppliers: MarketplaceContextData['suppliers']; isSupplierReviewer: boolean }>
  create(actor: Actor, operationId: string, profile: SupplierProfileInput): Promise<SupplierAccess>
  get(actor: Actor, supplierId: string): Promise<SupplierAccess>
  update(actor: Actor, supplierId: string, expectedRevision: number, profile: SupplierProfileInput): Promise<SupplierAccess>
  submit(actor: Actor, supplierId: string, expectedRevision: number): Promise<SupplierAccess>
  team(actor: Actor, supplierId: string): Promise<SupplierTeam>
  invite(actor: Actor, supplierId: string, email: string, role: MarketplaceRole, tokenHash: string): Promise<SupplierInvite>
  acceptInvite(actor: Actor, verifiedEmail: string, tokenHash: string): Promise<SupplierAccess>
  changeMember(actor: Actor, supplierId: string, userId: string, role: MarketplaceRole): Promise<SupplierTeamMember>
  removeMember(actor: Actor, supplierId: string, userId: string): Promise<{ userId: string }>
  revokeInvite(actor: Actor, supplierId: string, inviteId: string): Promise<{ id: string }>
  listNotifications(actor: Actor, asReviewer: boolean, after: SupplierNotificationCursor | null): Promise<SupplierNotificationPage>
  markNotificationRead(actor: Actor, asReviewer: boolean, id: string): Promise<{ id: string; readAt: string }>
  listReviewDocuments(actor: Actor, supplierId: string, asReviewer: boolean): Promise<{ documents: SupplierReviewDocument[] }>
  getReviewDocument(actor: Actor, supplierId: string, documentId: string, asReviewer: boolean): Promise<SupplierReviewDocumentDownload>
  addReviewDocument(actor: Actor, supplierId: string, input: SupplierReviewDocumentUpload): Promise<SupplierReviewDocument>
  removeReviewDocument(actor: Actor, supplierId: string, documentId: string): Promise<{ id: string }>
  createQuoteRequestDraft(actor: Actor, input: CreateQuoteRequestDraftInput): Promise<QuoteRequestDraft>
  listQuoteRequestDrafts(actor: Actor, workspaceId: string, after: QuoteRequestCursor | null): Promise<QuoteRequestDraftPage>
  getQuoteRequestDraft(actor: Actor, id: string): Promise<QuoteRequestDraft>
  getQuoteRequestPublication(actor: Actor, id: string): Promise<{ publication: QuoteRequestPublication | null }>
  listQuoteRequestEligibleSuppliers(actor: Actor, id: string, after: string | null): Promise<QuoteRequestEligibleSupplierPage>
  publishQuoteRequest(actor: Actor, id: string, supplierIds: string[]): Promise<QuoteRequestPublication>
  listSupplierQuoteRequests(actor: Actor, supplierId: string, after: QuoteRequestCursor | null): Promise<SupplierQuoteRequestPage>
  getSupplierQuoteRequest(actor: Actor, supplierId: string, id: string): Promise<SupplierQuoteRequest>
  listQuoteRequestNotifications(actor: Actor, after: QuoteRequestNotificationCursor | null): Promise<QuoteRequestNotificationPage>
  markQuoteRequestNotificationRead(actor: Actor, supplierId: string, requestId: string): Promise<QuoteRequestNotificationRead>
  publicProfile(slug: string): Promise<SupplierPublicProfile>
  adminList(actor: Actor, status: SupplierStatus, after?: string): Promise<SupplierAdminPage>
  review(actor: Actor, supplierId: string, expectedRevision: number, action: SupplierReviewAction, reason: string): Promise<SupplierProfile>
}
