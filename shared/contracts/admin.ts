/** Platform roles are provisioned separately from supplier ownership and review. */
export type MarketplaceAdminScope = 'operations' | 'support' | 'support_supervisor' | 'auditor' | 'user_moderator'
export type SupportPermission = 'messages' | 'message_files' | 'order_details' | 'order_files'
export interface MarketplaceAdminContext { scopes: MarketplaceAdminScope[]; requiresMfa: boolean }
export interface AdminDashboard { suppliers: Record<string, number>; requests: number; orders: Record<string, number>; openCases: number; overdueConfirmations: number }
export interface AdminSearchItem { id: string; kind: 'supplier' | 'request' | 'order'; title: string; status: string }
export interface AdminPage<T> { items: T[]; nextCursor: string | null }
export interface SupportCase { id: string; title: string; reason: string; assignedTo: string; createdBy: string; conversationId: string | null; orderId: string | null; permissions: SupportPermission[]; status: 'open' | 'closed'; revision: number; createdAt: string; expiresAt: string }
export interface CreateSupportCaseInput { operationId: string; title: string; reason: string; assignedTo: string; conversationId: string | null; orderId: string | null; permissions: SupportPermission[]; expiresAt: string }
export interface CloseSupportCaseInput { operationId: string; expectedRevision: number; reason: string }
export interface SupportAccessInput { reason: string; view: 'messages' | 'order_details'; beforeSequence?: number }
export interface SupportMessage { id: string; sequence: number; senderName: string; body: string; createdAt: string; files: { id: string; name: string; mimeType: string; byteSize: number }[] }
export interface SupportOrderDetails { id: string; requestId: string; supplierId: string; status: string; revision: number; supplierName: string; terms: Record<string, unknown>; requestSnapshot: Record<string, unknown>; proofs: { id: string; fileId: string; version: number; notes: string }[]; payments: { id: string; fileId: string | null; amountMinor: number; reference: string }[] }
export interface SupportAccessResult { case: SupportCase; messages: SupportMessage[] | null; nextBeforeSequence: number | null; order: SupportOrderDetails | null }
export interface SupportFileDownload { file: { id: string; name: string; mimeType: 'application/pdf' | 'image/png' | 'image/jpeg'; byteSize: number }; dataBase64: string }
export interface AdminAuditEvent { id: string; actorId: string; action: string; objectType: string; objectId: string | null; caseId: string | null; reason: string; createdAt: string }

export interface AdminUser { id: string; displayName: string; status: 'active' | 'suspended' | 'deleted'; revision: number; createdAt: string; canChangeStatus: boolean }
export interface AdminUserStatusInput { operationId: string; expectedRevision: number; status: 'active' | 'suspended'; reason: string }
export interface AdminMaintenanceInput { operationId: string; reason: string }
export interface AdminMaintenanceResult { expiredOrders: number; commerceNotifications: number; chatNotifications: number; chatFailures: number }
