import { describe, expect, it, vi } from 'vitest'
import { matchAdminRoute, serveAdminRoute } from './admin'
import type { SupabaseAdminRepository } from '../adapters/supabase/adminRepository'
import { createSupportCaseSchema, supportAccessSchema, adminUserStatusSchema, adminMaintenanceSchema } from '../modules/admin/validation'
const id = '10000000-0000-4000-8000-000000000001'
const input = { operationId: id, title: 'Investigate order', reason: 'Customer requested review', assignedTo: id, orderId: id, conversationId: null, permissions: ['order_details'], expiresAt: '2026-12-01T00:00:00Z' }
function setup(path: string, mfa = true, body: unknown = {}, query = '') {
 const context = vi.fn().mockResolvedValue({ scopes: ['operations'], requiresMfa: false })
 const dashboard = vi.fn().mockResolvedValue({ suppliers: {}, orders: {}, requests: 0, openCases: 0, overdueConfirmations: 0 })
 const repository = { context, dashboard, search: vi.fn().mockResolvedValue({ items: [], nextCursor: null }), cases: vi.fn().mockResolvedValue({ items: [], nextCursor: null }), createCase: vi.fn().mockResolvedValue({ id }), accessCase: vi.fn(), closeCase: vi.fn(), accessFile: vi.fn(), audit: vi.fn(), users: vi.fn(), userStatus: vi.fn().mockResolvedValue({ id }), maintenance: vi.fn().mockResolvedValue({ expiredOrders: 0, commerceNotifications: 0, chatNotifications: 0, chatFailures: 0 }) }
 const authenticate = vi.fn().mockResolvedValue({ userId: id, requestId: 'test', identityIssuer: 'test', identitySubject: 'test', hasVerifiedMfa: mfa })
 const run = (method = 'GET') => serveAdminRoute(matchAdminRoute(path)!, { method, query: new URLSearchParams(query), authenticate, readBody: async () => body }, repository as unknown as SupabaseAdminRepository)
 return { run, repository, authenticate }
}
describe('scoped Admin HTTP boundaries', () => {
 it('matches exact routes without taking existing supplier review routes', () => {
  expect(matchAdminRoute('/api/v1/admin/suppliers')).toBeNull()
  expect(matchAdminRoute('/api/v1/admin/dashboard/extra')).toBeNull()
  expect(matchAdminRoute(`/api/v1/admin/support-cases/${id}/files/${id}/access`)?.kind).toBe('file')
 })
 it('requests verified MFA even for context and reports need without sensitive data', async () => {
  const s = setup('/api/v1/admin/context', false)
  expect((await s.run()).data).toEqual({ scopes: ['operations'], requiresMfa: true })
  expect(s.authenticate).toHaveBeenCalledWith({ verifyMfa: true })
  expect(s.repository.dashboard).not.toHaveBeenCalled()
 })
 it.each(['/dashboard', '/search', '/support-cases', '/audit-log', '/users', '/maintenance'])("blocks %s before repository access without MFA", async path => {
  const s = setup(`/api/v1/admin${path}`, false)
  await expect(s.run()).rejects.toMatchObject({ status: 403, code: 'MARKETPLACE_MFA_REQUIRED' })
  expect(s.repository.dashboard).not.toHaveBeenCalled()
  expect(s.repository.search).not.toHaveBeenCalled()
  expect(s.repository.cases).not.toHaveBeenCalled()
  expect(s.repository.audit).not.toHaveBeenCalled()
 })
 it('validates search kind and duplicate query keys', async () => {
  await expect(setup('/api/v1/admin/search', true, {}, 'q=x&q=y&kind=supplier').run()).rejects.toMatchObject({ status: 422 })
  await expect(setup('/api/v1/admin/search', true, {}, 'q=x&kind=users').run()).rejects.toBeDefined()
  const s = setup('/api/v1/admin/search', true, {}, 'q=Pack&kind=supplier')
  await s.run()
  expect(s.repository.search).toHaveBeenCalledWith(id, 'Pack', 'supplier', null)
 })
 it('accepts a targeted case and never adds default permissions', async () => {
  const s = setup('/api/v1/admin/support-cases', true, input)
  await s.run('POST')
  expect(s.repository.createCase).toHaveBeenCalledWith(id, input)
 })
 it('rejects blanket, contradictory, duplicate or unknown case permissions', () => {
  expect(createSupportCaseSchema.safeParse({ ...input, orderId: null }).success).toBe(false)
  expect(createSupportCaseSchema.safeParse({ ...input, permissions: ['messages'] }).success).toBe(false)
  expect(createSupportCaseSchema.safeParse({ ...input, permissions: ['order_details', 'order_details'] }).success).toBe(false)
  expect(createSupportCaseSchema.safeParse({ ...input, permissions: ['all'] }).success).toBe(false)
  expect(createSupportCaseSchema.safeParse({ ...input, reason: ' ' }).success).toBe(false)
 })
 it('requires a reason for every sensitive read and enforces bounded pagination', () => {
  expect(supportAccessSchema.safeParse({ view: 'messages' }).success).toBe(false)
  expect(supportAccessSchema.safeParse({ view: 'messages', reason: 'Case analysis', beforeSequence: -1 }).success).toBe(false)
  expect(supportAccessSchema.safeParse({ view: 'messages', reason: 'Case analysis', beforeSequence: 50 }).success).toBe(true)
 })
 it('accepts only reversible account status changes with a reason and version', async () => {
  const body = { operationId: id, expectedRevision: 1, status: 'suspended', reason: 'Verified account review' }
  expect(adminUserStatusSchema.safeParse(body).success).toBe(true)
  expect(adminUserStatusSchema.safeParse({ ...body, status: 'deleted' }).success).toBe(false)
  expect(adminUserStatusSchema.safeParse({ ...body, expectedRevision: 0 }).success).toBe(false)
  expect(adminUserStatusSchema.safeParse({ ...body, reason: '' }).success).toBe(false)
  const s = setup(`/api/v1/admin/users/${id}/status`, true, body)
  await s.run('POST')
  expect(s.repository.userStatus).toHaveBeenCalledWith(id, id, body)
 })
 it('requires audited idempotent maintenance input, no caller-selected arbitrary limits', async () => {
  const body = { operationId: id, reason: 'Retry stalled notifications' }
  expect(adminMaintenanceSchema.safeParse({ ...body, limit: 100000 }).success).toBe(false)
  const s = setup('/api/v1/admin/maintenance', true, body)
  expect((await s.run('POST')).data).toMatchObject({ expiredOrders: 0, chatFailures: 0 })
  expect(s.repository.maintenance).toHaveBeenCalledWith(id, body)
 })
 it('validates case and file identifiers before access', async () => {
  const s = setup('/api/v1/admin/support-cases/not-a-uuid/files/not-a-uuid/access', true, { reason: 'Case analysis' })
  await expect(s.run('POST')).rejects.toBeDefined()
  expect(s.repository.accessFile).not.toHaveBeenCalled()
 })
})
