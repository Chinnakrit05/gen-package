import { describe, expect, it } from 'vitest'
import type { ServerConfig } from '../config'
import type { SessionService } from '../modules/identity/sessionService'
import type { ProjectRepository } from '../modules/projects/projectRepository'
import { ProjectService } from '../modules/projects/projectService'
import { putProjectThumbnailInputSchema } from '../modules/projects/validation'
import { createApiRouter, type HttpRequest, type HttpResponse } from './router'

// ภาพย่อ 3D ของแกลเลอรีงาน: PUT /projects/:id/thumbnail, POST /projects/thumbnails, meta ในรายการงาน
const config: ServerConfig = { appEnv: 'test', allowedOrigins: [], supabase: null, ai: null }
const actor = {
  userId: '10000000-0000-4000-8000-000000000001',
  identityIssuer: 'https://test.supabase.local/auth/v1',
  identitySubject: 'subject-1',
  requestId: 'request-1',
}
const workspaceId = '20000000-0000-4000-8000-000000000001'
const projectId = '30000000-0000-4000-8000-000000000001'
const otherId = '30000000-0000-4000-8000-000000000002'
// WebP ขั้นต่ำที่ผ่าน magic bytes (RIFF....WEBP) + JPEG (FF D8 FF)
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x10, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(8)])
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])

function response() {
  let body = ''
  const res: HttpResponse = {
    statusCode: 0,
    setHeader() {},
    end(value) {
      body = value ?? ''
    },
  }
  return { res, readBody: () => JSON.parse(body) as Record<string, unknown> }
}

function repository(overrides: Partial<ProjectRepository> = {}): ProjectRepository {
  const never = async () => { throw new Error('must not be called') }
  return {
    list: async () => ({ items: [], nextCursor: null }),
    get: never,
    create: never,
    importLegacy: never,
    save: never,
    remove: never,
    putThumbnail: never,
    thumbnailMeta: async () => new Map(),
    thumbnails: never,
    ...overrides,
  }
}

function router(repo: ProjectRepository) {
  const sessionService: SessionService = {
    bootstrap: async () => { throw new Error('must not be called') },
    authenticate: async () => actor,
    getMe: async () => { throw new Error('must not be called') },
  }
  return createApiRouter(config, { sessionService, projectService: new ProjectService(repo) })
}

const json = (method: string, url: string, body: unknown): HttpRequest => ({
  method,
  url,
  headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
  body,
})

describe('ภาพย่อ 3D ของงาน — validation', () => {
  const ok = { mimeType: 'image/webp', imageBase64: webp.toString('base64'), kind: 'pouch', label: 'ถุงตั้งได้' }
  it('รับ WebP/JPEG ที่ magic bytes ตรงชนิด', () => {
    expect(putProjectThumbnailInputSchema.safeParse(ok).success).toBe(true)
    expect(putProjectThumbnailInputSchema.safeParse({ ...ok, mimeType: 'image/jpeg', imageBase64: jpeg.toString('base64') }).success).toBe(true)
  })
  it('ปฏิเสธชนิดไม่ตรงไฟล์, ใหญ่เกิน, ชนิดงาน/ช่องแปลก', () => {
    expect(putProjectThumbnailInputSchema.safeParse({ ...ok, mimeType: 'image/jpeg' }).success).toBe(false)
    expect(putProjectThumbnailInputSchema.safeParse({ ...ok, mimeType: 'image/png' }).success).toBe(false)
    const big = Buffer.concat([webp, Buffer.alloc(70_000)]).toString('base64')
    expect(putProjectThumbnailInputSchema.safeParse({ ...ok, imageBase64: big }).success).toBe(false)
    expect(putProjectThumbnailInputSchema.safeParse({ ...ok, kind: 'tube' }).success).toBe(false)
    expect(putProjectThumbnailInputSchema.safeParse({ ...ok, label: '' }).success).toBe(false)
    expect(putProjectThumbnailInputSchema.safeParse({ ...ok, workspaceId }).success).toBe(false)
  })
})

describe('ภาพย่อ 3D ของงาน — routes', () => {
  it('PUT /projects/:id/thumbnail บันทึกด้วย actor จาก token แล้วคืน version', async () => {
    const calls: unknown[] = []
    const handler = router(repository({
      putThumbnail: async (a, id, input) => {
        calls.push({ userId: a.userId, id, kind: input.kind })
        return { projectId: id, version: '2026-10-24T08:00:00.000Z' }
      },
    }))
    const target = response()
    await handler(json('PUT', `/api/v1/projects/${projectId}/thumbnail`, {
      mimeType: 'image/webp',
      imageBase64: webp.toString('base64'),
      kind: 'box',
      label: 'กล่องฝาเสียบ',
    }), target.res)
    expect(target.res.statusCode).toBe(200)
    expect(target.readBody()).toMatchObject({ data: { projectId, version: '2026-10-24T08:00:00.000Z' } })
    expect(calls).toEqual([{ userId: actor.userId, id: projectId, kind: 'box' }])
  })

  it('PUT ไฟล์ที่ไม่ใช่รูปตามชนิด → 422 ไม่ถึง repository', async () => {
    const handler = router(repository())
    const target = response()
    await handler(json('PUT', `/api/v1/projects/${projectId}/thumbnail`, {
      mimeType: 'image/webp',
      imageBase64: Buffer.from('<svg onload=alert(1)>').toString('base64'),
      kind: 'box',
      label: 'x',
    }), target.res)
    expect(target.res.statusCode).toBe(422)
    expect(target.readBody()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
  })

  it('POST /projects/thumbnails คืนตัวรูปตาม id (จำกัดจำนวน/ห้ามซ้ำ) — ไม่ชนกับ /projects/:id', async () => {
    const handler = router(repository({
      thumbnails: async (_a, ws, ids) => ids.map((id) => ({
        projectId: id,
        version: '2026-10-24T08:00:00.000Z',
        mimeType: 'image/webp' as const,
        imageBase64: `${ws === workspaceId ? 'ok' : 'bad'}`,
      })),
    }))
    const target = response()
    await handler(json('POST', '/api/v1/projects/thumbnails', { workspaceId, projectIds: [projectId, otherId] }), target.res)
    expect(target.res.statusCode).toBe(200)
    expect(target.readBody()).toMatchObject({ data: { items: [{ projectId, imageBase64: 'ok' }, { projectId: otherId }] } })

    const dup = response()
    await handler(json('POST', '/api/v1/projects/thumbnails', { workspaceId, projectIds: [projectId, projectId] }), dup.res)
    expect(dup.res.statusCode).toBe(422)
    const many = response()
    const ids = Array.from({ length: 25 }, (_, i) => `30000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    await handler(json('POST', '/api/v1/projects/thumbnails', { workspaceId, projectIds: ids }), many.res)
    expect(many.res.statusCode).toBe(422)
  })

  it('รายการงานติด meta ภาพย่อ; อ่าน meta ไม่ได้ (ฐานข้อมูลยังไม่ migrate) รายการยังได้ครบ', async () => {
    const summary = (id: string) => ({ id, workspaceId, name: 'งาน', revision: 1, updatedAt: '2026-10-24T07:00:00.000Z' })
    const list = async () => ({ items: [summary(projectId), summary(otherId)], nextCursor: null })
    const withMeta = router(repository({
      list,
      thumbnailMeta: async () => new Map([[projectId, { version: '2026-10-24T08:00:00.000Z', kind: 'vessel' as const, label: 'ขวด PET' }]]),
    }))
    const target = response()
    await withMeta({ method: 'GET', url: `/api/v1/projects?workspaceId=${workspaceId}`, headers: { authorization: 'Bearer token' } }, target.res)
    expect(target.res.statusCode).toBe(200)
    const items = (target.readBody().data as { items: Record<string, unknown>[] }).items
    expect(items[0].thumbnail).toEqual({ version: '2026-10-24T08:00:00.000Z', kind: 'vessel', label: 'ขวด PET' })
    expect(items[1].thumbnail).toBeUndefined()

    const broken = router(repository({ list, thumbnailMeta: async () => { throw new Error('function does not exist') } }))
    const fallback = response()
    await broken({ method: 'GET', url: `/api/v1/projects?workspaceId=${workspaceId}`, headers: { authorization: 'Bearer token' } }, fallback.res)
    expect(fallback.res.statusCode).toBe(200)
    expect((fallback.readBody().data as { items: unknown[] }).items).toHaveLength(2)
  })
})
