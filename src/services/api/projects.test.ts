import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CloudProjectDocumentV1 } from '../../../shared/contracts/projects'
import { deleteProject, importLegacyProject, saveProject } from './projects'

afterEach(() => vi.unstubAllGlobals())

const document: CloudProjectDocumentV1 = {
  live: { template: 'tuck-end', materialId: 'carton-300', W: 80, D: 50, H: 120, handle: false },
  qty: 500,
  fillColor: null,
  decos: [],
  history: [],
  histIdx: -1,
}

describe('project API client', () => {
  it('sends save mutations without putting projectId in the body', async () => {
    const projectId = crypto.randomUUID()
    const operationId = crypto.randomUUID()
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(`/api/v1/projects/${projectId}`)
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer token')
      expect(JSON.parse(String(init.body))).toEqual({
        operationId,
        expectedRevision: 4,
        name: 'Saved',
        documentSchemaVersion: 1,
        document,
      })
      return new Response(JSON.stringify({
        data: { projectId, operationId, revision: 5, updatedAt: '2026-09-18T00:00:00.000Z' },
        requestId: crypto.randomUUID(),
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(saveProject('/api/v1', 'token', {
      projectId,
      operationId,
      expectedRevision: 4,
      name: 'Saved',
      documentSchemaVersion: 1,
      document,
    })).resolves.toMatchObject({ revision: 5 })
  })

  it('uses concurrency/idempotency headers and no DELETE body', async () => {
    const projectId = crypto.randomUUID()
    const operationId = crypto.randomUUID()
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const headers = new Headers(init.headers)
      expect(headers.get('x-expected-revision')).toBe('7')
      expect(headers.has('if-match')).toBe(false)
      expect(headers.get('idempotency-key')).toBe(operationId)
      expect(init.body).toBeUndefined()
      return new Response(JSON.stringify({
        data: { projectId, operationId, revision: 8, deletedAt: '2026-09-18T00:00:00.000Z' },
        requestId: crypto.randomUUID(),
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    await expect(deleteProject('/api/v1', 'token', { projectId, operationId, expectedRevision: 7 }))
      .resolves.toMatchObject({ revision: 8 })
  })

  it('posts the complete legacy source identity to the dedicated import endpoint', async () => {
    const input = {
      workspaceId: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      sourceInstallationId: crypto.randomUUID(),
      sourceProjectKey: 'projects:0',
      sourceHash: 'b'.repeat(64),
      name: 'Legacy',
      documentSchemaVersion: 1 as const,
      document,
    }
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('/api/v1/projects/import-legacy')
      expect(JSON.parse(String(init.body))).toEqual(input)
      return new Response(JSON.stringify({
        data: {
          sourceInstallationId: input.sourceInstallationId,
          sourceProjectKey: input.sourceProjectKey,
          sourceHash: input.sourceHash,
          project: {},
          completedAt: '2026-09-18T00:00:00.000Z',
        },
        requestId: crypto.randomUUID(),
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    await expect(importLegacyProject('/api/v1', 'token', input)).resolves.toMatchObject({
      sourceProjectKey: 'projects:0',
    })
  })
})
