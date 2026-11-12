import { describe, expect, it, vi } from 'vitest'
import { matchConversationRoute, serveConversationRoute } from './conversations'
import type { ConversationRepository } from '../modules/conversations/conversationRepository'
const id = '00000000-0000-4000-8000-000000000001'
const actor = { userId: id, identityIssuer: 'test', identitySubject: id, requestId: 'test' }
function setup(path: string, method = 'GET', body: unknown = {}, query = '') {
  const repository = { list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }), ensure: vi.fn(), get: vi.fn(), messages: vi.fn(), send: vi.fn(), read: vi.fn(), upload: vi.fn(), download: vi.fn() } satisfies ConversationRepository
  const request = { method, query: new URLSearchParams(query), authenticate: vi.fn().mockResolvedValue(actor), readBody: vi.fn().mockResolvedValue(body) }
  const route = matchConversationRoute(path)!
  return { repository, request, run: () => serveConversationRoute(route, request, repository) }
}
describe('conversation HTTP contracts', () => {
  it('matches only bounded conversation routes', () => {
    expect(matchConversationRoute('/api/v1/marketplace/conversations')).not.toBeNull()
    expect(matchConversationRoute(`/api/v1/marketplace/conversations/${id}/files/${id}`)?.methods).toEqual(['GET'])
    expect(matchConversationRoute('/api/v1/marketplace/conversations-extra')).toBeNull()
  })
  it('authenticates and lists only actor-scoped rooms', async () => {
    const s = setup('/api/v1/marketplace/conversations')
    await s.run()
    expect(s.request.authenticate).toHaveBeenCalledWith({ verifyMfa: false })
    expect(s.repository.list).toHaveBeenCalledWith(actor, null)
  })
  it('rejects unsupported methods before mutation', async () => {
    const s = setup('/api/v1/marketplace/conversations', 'DELETE')
    await expect(s.run()).rejects.toMatchObject({ status: 405 })
    expect(s.repository.list).not.toHaveBeenCalled()
  })
  it('rejects duplicate query and forged actor input', async () => {
    const s = setup('/api/v1/marketplace/conversations', 'GET', {}, `after=${id}&after=${id}`)
    await expect(s.run()).rejects.toMatchObject({ status: 422 })
    const post = setup('/api/v1/marketplace/conversations', 'POST', { requestId: id, supplierId: id, actorId: id })
    await expect(post.run()).rejects.toMatchObject({ status: 422 })
  })
  it('preserves operation ID and canonical message body for retries', async () => {
    const s = setup(`/api/v1/marketplace/conversations/${id}/messages`, 'POST', { operationId: id, body: ' Hello ', attachmentIds: [] })
    await s.run()
    expect(s.repository.send).toHaveBeenCalledWith(actor, id, { operationId: id, body: 'Hello', attachmentIds: [] })
  })
  it.each([
    { operationId: id, body: '', attachmentIds: [] },
    { operationId: id, body: 'x', attachmentIds: [id, id] },
    { operationId: id, body: 'x'.repeat(4001), attachmentIds: [] },
  ])('rejects malformed messages without repository access', async body => {
    const s = setup(`/api/v1/marketplace/conversations/${id}/messages`, 'POST', body)
    await expect(s.run()).rejects.toMatchObject({ status: 422 })
    expect(s.repository.send).not.toHaveBeenCalled()
  })
  it('uses a bounded upload body and rejects path names', async () => {
    const s = setup(`/api/v1/marketplace/conversations/${id}/files`, 'POST', { operationId: id, name: '../secret.pdf', mimeType: 'application/pdf', dataBase64: 'JVBERi0=' })
    await expect(s.run()).rejects.toMatchObject({ status: 422 })
    expect(s.request.readBody).toHaveBeenCalledWith(2900000)
    expect(s.repository.upload).not.toHaveBeenCalled()
  })
  it('parses integer sequence cursor and rejects unsafe cursor', async () => {
    const s = setup(`/api/v1/marketplace/conversations/${id}/messages`, 'GET', {}, 'before=41')
    await s.run()
    expect(s.repository.messages).toHaveBeenCalledWith(actor, id, 41)
    const bad = setup(`/api/v1/marketplace/conversations/${id}/messages`, 'GET', {}, 'before=9007199254740992')
    await expect(bad.run()).rejects.toMatchObject({ status: 422 })
  })
})
