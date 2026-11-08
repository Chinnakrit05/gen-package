import type {
  MarketplaceContextData,
  MarketplaceRole,
  SupplierAccess,
  SupplierAdminPage,
  SupplierInvite,
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
  listReviewDocuments(actor: Actor, supplierId: string, asReviewer: boolean): Promise<{ documents: SupplierReviewDocument[] }>
  getReviewDocument(actor: Actor, supplierId: string, documentId: string, asReviewer: boolean): Promise<SupplierReviewDocumentDownload>
  addReviewDocument(actor: Actor, supplierId: string, input: SupplierReviewDocumentUpload): Promise<SupplierReviewDocument>
  removeReviewDocument(actor: Actor, supplierId: string, documentId: string): Promise<{ id: string }>
  publicProfile(slug: string): Promise<SupplierPublicProfile>
  adminList(actor: Actor, status: SupplierStatus, after?: string): Promise<SupplierAdminPage>
  review(actor: Actor, supplierId: string, expectedRevision: number, action: SupplierReviewAction, reason: string): Promise<SupplierProfile>
}
