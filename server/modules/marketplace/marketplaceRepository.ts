import type {
  MarketplaceContextData,
  SupplierAccess,
  SupplierAdminPage,
  SupplierProfile,
  SupplierProfileInput,
  SupplierPublicProfile,
  SupplierReviewAction,
  SupplierStatus,
} from '../../../shared/contracts/marketplace'
import type { Actor } from '../identity/actor'

export interface MarketplaceRepository {
  context(actor: Actor): Promise<{ suppliers: MarketplaceContextData['suppliers']; isSupplierReviewer: boolean }>
  create(actor: Actor, operationId: string, profile: SupplierProfileInput): Promise<SupplierAccess>
  get(actor: Actor, supplierId: string): Promise<SupplierAccess>
  update(actor: Actor, supplierId: string, expectedRevision: number, profile: SupplierProfileInput): Promise<SupplierAccess>
  submit(actor: Actor, supplierId: string, expectedRevision: number): Promise<SupplierAccess>
  publicProfile(slug: string): Promise<SupplierPublicProfile>
  adminList(actor: Actor, status: SupplierStatus, after?: string): Promise<SupplierAdminPage>
  review(actor: Actor, supplierId: string, expectedRevision: number, action: SupplierReviewAction, reason: string): Promise<SupplierProfile>
}
