import { describe, expect, it } from 'vitest'
import type { CreateAssetUploadIntentInput } from '../../../shared/contracts/assets'
import type { CreateProjectInput, LegacyImportInput, SaveProjectInput } from '../../../shared/contracts/projects'
import { HttpError } from '../../http/errors'
import type { AssetRepository } from '../assets/assetRepository'
import { AssetService } from '../assets/assetService'
import type { ObjectStorage } from '../assets/objectStorage'
import type { ProjectRepository } from '../projects/projectRepository'
import { ProjectService } from '../projects/projectService'
import { StorageQuota, type StorageQuotaCheck, type StorageQuotaResult } from './storageQuota'

const actor = {
  userId: '10000000-0000-4000-8000-000000000001',
  identityIssuer: 'https://test.supabase.local/auth/v1',
  identitySubject: 'subject-1',
  requestId: '50000000-0000-4000-8000-000000000001',
}
const workspaceId = '20000000-0000-4000-8000-000000000001'
const projectId = '30000000-0000-4000-8000-000000000001'
const operationId = '40000000-0000-4000-8000-000000000001'
const document = { decos: [] } as unknown as CreateProjectInput['document']

const fits: StorageQuotaResult = { ok: true, plan: 'free', limitBytes: 20971520, usedBytes: 1000, projectedBytes: 1200 }
const full: StorageQuotaResult = { ok: false, plan: 'free', limitBytes: 20971520, usedBytes: 20971000, projectedBytes: 20972000 }

// repository ปลอม: บันทึกทุกการตรวจ (input + openAccess) แล้วคืนผลที่กำหนด
function quotaWith(result: StorageQuotaResult, openAccess = false) {
  const checks: [StorageQuotaCheck, boolean][] = []
  const quota = new StorageQuota({
    checkStorageQuota: async (_actor, input, open) => {
      checks.push([input, open])
      return result
    },
  }, { openAccess })
  return { quota, checks }
}

// ProjectRepository ปลอมที่จดลำดับการเรียก — ตรวจว่าโควตาถูกตรวจก่อนเขียน และไม่เขียนเมื่อเต็ม
function projectRepository(calls: string[]): ProjectRepository {
  return {
    list: async () => ({ items: [], nextCursor: null }),
    get: async () => { throw new Error('unused') },
    create: async () => {
      calls.push('create')
      return {} as never
    },
    importLegacy: async () => {
      calls.push('importLegacy')
      return {} as never
    },
    save: async () => {
      calls.push('save')
      return {} as never
    },
    remove: async () => {
      calls.push('remove')
      return {} as never
    },
    putThumbnail: async () => {
      calls.push('putThumbnail')
      return {} as never
    },
    thumbnailMeta: async () => new Map(),
    thumbnails: async () => [],
  }
}

describe('StorageQuota (โควตาพื้นที่เก็บงาน — ยังไม่เปิดใช้)', () => {
  it('passes when the work fits and sends the open access flag to the database', async () => {
    const { quota, checks } = quotaWith(fits, true)
    const input: StorageQuotaCheck = { workspaceId, projectId: null, operationId, document, extraBytes: 0 }
    await expect(quota.assert(actor, input)).resolves.toBeUndefined()
    expect(checks).toEqual([[input, true]])
  })

  it('refuses with 402 STORAGE_QUOTA_EXCEEDED and the usage the client can show', async () => {
    const { quota } = quotaWith(full)
    const failure = await quota.assert(actor, { workspaceId, projectId: null, operationId, document, extraBytes: 0 })
      .then(() => null, (thrown: unknown) => thrown)
    expect(failure).toBeInstanceOf(HttpError)
    expect(failure).toMatchObject({
      status: 402,
      code: 'STORAGE_QUOTA_EXCEEDED',
      details: { plan: 'free', limitBytes: 20971520, usedBytes: 20971000, projectedBytes: 20972000 },
    })
  })
})

describe('ProjectService + StorageQuota', () => {
  const create: CreateProjectInput = { workspaceId, operationId, name: 'งาน', documentSchemaVersion: 1, document }
  const save: SaveProjectInput = { projectId, operationId, expectedRevision: 3, name: 'งาน', documentSchemaVersion: 1, document }
  const legacy: LegacyImportInput = {
    workspaceId,
    operationId,
    sourceInstallationId: '60000000-0000-4000-8000-000000000001',
    sourceProjectKey: 'local-1',
    sourceHash: 'a'.repeat(64),
    name: 'งาน',
    documentSchemaVersion: 1,
    document,
  }

  it('checks every write path before writing: new work by workspace, saves by project', async () => {
    const calls: string[] = []
    const { quota, checks } = quotaWith(fits)
    const service = new ProjectService(projectRepository(calls), quota)
    await service.create(actor, create)
    await service.save(actor, save)
    await service.importLegacy(actor, legacy)
    expect(checks.map(([input]) => input)).toEqual([
      { workspaceId, projectId: null, operationId, document, extraBytes: 0 },
      { workspaceId: null, projectId, operationId, document, extraBytes: 0 },
      { workspaceId, projectId: null, operationId, document, extraBytes: 0 },
    ])
    expect(calls).toEqual(['create', 'save', 'importLegacy'])
  })

  it('writes nothing when the work does not fit; deleting and gallery thumbnails are never checked', async () => {
    const calls: string[] = []
    const { quota, checks } = quotaWith(full)
    const service = new ProjectService(projectRepository(calls), quota)
    await expect(service.create(actor, create)).rejects.toMatchObject({ code: 'STORAGE_QUOTA_EXCEEDED' })
    await expect(service.save(actor, save)).rejects.toMatchObject({ code: 'STORAGE_QUOTA_EXCEEDED' })
    await expect(service.importLegacy(actor, legacy)).rejects.toMatchObject({ code: 'STORAGE_QUOTA_EXCEEDED' })
    await service.remove(actor, { projectId, operationId, expectedRevision: 3 })
    // ภาพย่อ 3D ≤ 64 KiB เป็นของระบบ (migration project_thumbnails) ไม่นับโควตา
    await service.putThumbnail(actor, projectId, { mimeType: 'image/webp', imageBase64: 'AAAA', kind: 'box', label: 'กล่อง' })
    expect(calls).toEqual(['remove', 'putThumbnail'])
    expect(checks).toHaveLength(3)
  })

  it('without a quota (the current setting) writes exactly as before', async () => {
    const calls: string[] = []
    const service = new ProjectService(projectRepository(calls))
    await service.create(actor, create)
    await service.save(actor, save)
    expect(calls).toEqual(['create', 'save'])
  })
})

describe('AssetService + StorageQuota', () => {
  const intent: CreateAssetUploadIntentInput = {
    workspaceId,
    purpose: 'project-decoration',
    declaredMime: 'image/png',
    declaredSize: 512000,
    operationId,
  }

  function assetService(quota: StorageQuota | null) {
    const intents: unknown[] = []
    const repository = {
      createIntent: async (_actor: unknown, input: unknown) => {
        intents.push(input)
        return { state: 'ready' }
      },
    } as unknown as AssetRepository
    return { service: new AssetService(repository, {} as ObjectStorage, quota), intents }
  }

  it('checks the declared image size against the space left before issuing an upload ticket', async () => {
    const { quota, checks } = quotaWith(fits)
    const { service, intents } = assetService(quota)
    await service.createIntent(actor, intent).catch(() => undefined)
    expect(checks.map(([input]) => input)).toEqual([
      { workspaceId, projectId: null, operationId, document: null, extraBytes: 512000 },
    ])
    expect(intents).toHaveLength(1)
  })

  it('issues no ticket when the image does not fit', async () => {
    const { quota } = quotaWith(full)
    const { service, intents } = assetService(quota)
    await expect(service.createIntent(actor, intent)).rejects.toMatchObject({ code: 'STORAGE_QUOTA_EXCEEDED' })
    expect(intents).toEqual([])
  })
})
