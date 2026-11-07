export const SUPPLIER_KINDS = ['factory', 'print_shop'] as const
export const SUPPLIER_CAPABILITIES = [
  'offset_printing',
  'digital_printing',
  'flexographic_printing',
  'die_cutting',
  'lamination',
  'foil_stamping',
] as const
export const SUPPLIER_STATUSES = ['draft', 'pending', 'approved', 'suspended'] as const
export const SUPPLIER_REVIEW_ACTIONS = ['approve', 'request_changes', 'suspend', 'resume'] as const
export const MARKETPLACE_ROLES = ['manager', 'staff', 'viewer'] as const

export type SupplierKind = (typeof SUPPLIER_KINDS)[number]
export type SupplierCapability = (typeof SUPPLIER_CAPABILITIES)[number]
export type SupplierStatus = (typeof SUPPLIER_STATUSES)[number]
export type SupplierReviewAction = (typeof SUPPLIER_REVIEW_ACTIONS)[number]
export type MarketplaceRole = (typeof MARKETPLACE_ROLES)[number]

export interface SupplierProfileInput {
  kind: SupplierKind
  name: string
  slug: string
  description: string
  contactEmail: string
  capabilities: SupplierCapability[]
}

export interface SupplierProfile extends SupplierProfileInput {
  id: string
  workspaceId: string
  status: SupplierStatus
  revision: number
  reviewNote: string | null
  updatedAt: string
}

export interface SupplierAccess {
  profile: SupplierProfile
  role: MarketplaceRole
}

export interface MarketplaceContextData {
  suppliers: SupplierAccess[]
  staff: { canReviewSuppliers: boolean; requiresMfa: boolean }
}

export type SupplierPublicProfile = Pick<SupplierProfile, 'id' | 'kind' | 'name' | 'slug' | 'description' | 'capabilities'>

export interface SupplierAdminPage {
  items: SupplierProfile[]
  nextCursor: string | null
}
