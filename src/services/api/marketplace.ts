import type {
  CreatedSupplierInvite,
  MarketplaceContextData,
  MarketplaceRole,
  SupplierAccess,
  SupplierAdminPage,
  SupplierProfile,
  SupplierProfileInput,
  SupplierPublicProfile,
  SupplierReviewAction,
  SupplierStatus,
  SupplierTeam,
  SupplierTeamMember,
} from '../../../shared/contracts/marketplace'
import { requestApi, requestPublicApi } from './client'

const json = (method: 'POST' | 'PUT', input: object, signal?: AbortSignal): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(input),
  signal,
})

export const marketplaceContextKey = (appUserId: string) => ['cloud', appUserId, 'marketplace', 'context'] as const

export function getMarketplaceContext(base: string, token: string, signal?: AbortSignal): Promise<MarketplaceContextData> {
  return requestApi(`${base}/marketplace/context`, token, { method: 'GET', signal })
}

export function createSupplier(base: string, token: string, input: SupplierProfileInput & { operationId: string }): Promise<SupplierAccess> {
  return requestApi(`${base}/suppliers`, token, json('POST', input))
}

export function getSupplier(base: string, token: string, id: string, signal?: AbortSignal): Promise<SupplierAccess> {
  return requestApi(`${base}/suppliers/${encodeURIComponent(id)}`, token, { method: 'GET', signal })
}

export function updateSupplier(base: string, token: string, id: string, input: SupplierProfileInput & { expectedRevision: number }): Promise<SupplierAccess> {
  return requestApi(`${base}/suppliers/${encodeURIComponent(id)}`, token, json('PUT', input))
}

export function submitSupplier(base: string, token: string, id: string, expectedRevision: number): Promise<SupplierAccess> {
  return requestApi(`${base}/suppliers/${encodeURIComponent(id)}/submit`, token, json('POST', { expectedRevision }))
}

const supplierTeamUrl = (base: string, id: string) => `${base}/suppliers/${encodeURIComponent(id)}/team`

export function getSupplierTeam(base: string, token: string, id: string, signal?: AbortSignal): Promise<SupplierTeam> {
  return requestApi(supplierTeamUrl(base, id), token, { method: 'GET', signal })
}

export function inviteSupplierMember(base: string, token: string, id: string, input: { email: string; role: MarketplaceRole }): Promise<CreatedSupplierInvite> {
  return requestApi(`${supplierTeamUrl(base, id)}/invitations`, token, json('POST', input))
}

export function updateSupplierMember(base: string, token: string, id: string, userId: string, role: MarketplaceRole): Promise<SupplierTeamMember> {
  return requestApi(`${supplierTeamUrl(base, id)}/members/${encodeURIComponent(userId)}`, token, json('PUT', { role }))
}

export function removeSupplierMember(base: string, token: string, id: string, userId: string): Promise<{ userId: string }> {
  return requestApi(`${supplierTeamUrl(base, id)}/members/${encodeURIComponent(userId)}`, token, { method: 'DELETE' })
}

export function revokeSupplierInvite(base: string, token: string, id: string, inviteId: string): Promise<{ id: string }> {
  return requestApi(`${supplierTeamUrl(base, id)}/invitations/${encodeURIComponent(inviteId)}`, token, { method: 'DELETE' })
}

export function acceptSupplierInvite(base: string, token: string, invitationToken: string): Promise<SupplierAccess> {
  return requestApi(`${base}/suppliers/invitations/accept`, token, json('POST', { token: invitationToken }))
}

export function getPublicSupplier(base: string, slug: string, signal?: AbortSignal): Promise<SupplierPublicProfile> {
  return requestPublicApi(`${base}/suppliers/public/${encodeURIComponent(slug)}`, signal)
}

export function listAdminSuppliers(base: string, token: string, status: SupplierStatus, after: string | null, signal?: AbortSignal): Promise<SupplierAdminPage> {
  const params = new URLSearchParams({ status })
  if (after) params.set('after', after)
  return requestApi(`${base}/admin/suppliers?${params}`, token, { method: 'GET', signal })
}

export function reviewSupplier(base: string, token: string, id: string, input: { expectedRevision: number; action: SupplierReviewAction; reason: string }): Promise<SupplierProfile> {
  return requestApi(`${base}/admin/suppliers/${encodeURIComponent(id)}/review`, token, json('POST', input))
}
