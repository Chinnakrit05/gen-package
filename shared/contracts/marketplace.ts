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
export const SUPPLIER_NOTIFICATION_ACTIONS = ['submitted', 'approve', 'request_changes', 'suspend', 'resume'] as const
export const SUPPLIER_NOTIFICATION_PAGE_SIZE = 24
export const SUPPLIER_REVIEW_DOCUMENT_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const
export const SUPPLIER_REVIEW_DOCUMENT_MAX_BYTES = 2 * 1024 * 1024
export const SUPPLIER_REVIEW_DOCUMENT_LIMIT = 3

export type SupplierKind = (typeof SUPPLIER_KINDS)[number]
export type SupplierCapability = (typeof SUPPLIER_CAPABILITIES)[number]
export type SupplierStatus = (typeof SUPPLIER_STATUSES)[number]
export type SupplierReviewAction = (typeof SUPPLIER_REVIEW_ACTIONS)[number]
export type MarketplaceRole = (typeof MARKETPLACE_ROLES)[number]
export type SupplierNotificationAction = (typeof SUPPLIER_NOTIFICATION_ACTIONS)[number]
export type SupplierReviewDocumentMime = (typeof SUPPLIER_REVIEW_DOCUMENT_MIME_TYPES)[number]

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

export interface SupplierTeamMember {
  userId: string
  displayName: string
  role: MarketplaceRole
  isWorkspaceOwner: boolean
}

export interface SupplierInvite {
  id: string
  email: string
  role: MarketplaceRole
  createdAt: string
  expiresAt: string
}

export interface SupplierTeam {
  members: SupplierTeamMember[]
  invites: SupplierInvite[]
}

export interface CreatedSupplierInvite {
  invite: SupplierInvite
  token: string
}

export interface SupplierNotificationCursor {
  createdAt: string
  id: string
}

export interface SupplierNotification extends SupplierNotificationCursor {
  supplierId: string
  supplierName: string
  action: SupplierNotificationAction
  readAt: string | null
}

export interface SupplierNotificationPage {
  items: SupplierNotification[]
  nextCursor: SupplierNotificationCursor | null
}

export interface SupplierReviewDocument {
  id: string
  name: string
  mimeType: SupplierReviewDocumentMime
  byteSize: number
  createdAt: string
}

export interface SupplierReviewDocumentUpload {
  operationId: string
  name: string
  mimeType: SupplierReviewDocumentMime
  dataBase64: string
}

export interface SupplierReviewDocumentDownload {
  document: SupplierReviewDocument
  dataBase64: string
}
