import { describe, expect, it, vi } from 'vitest'
import type { CloudProject, LegacyImportInput } from '../../../shared/contracts/projects'
import { freshProject } from '../../core/project'
import { MemoryLegacyMigrationStore } from '../../services/drafts/legacyMigrationStore'
import type { ProjectAssetTransfer } from '../../services/projects/cloudProjectCodec'
import {
  LEGACY_PROJECTS_STORAGE_KEY,
  discoverLegacyMigration,
  reopenLegacyMigrationConsent,
  resumeLegacyMigration,
  runLegacyMigration,
  setLegacyMigrationConsent,
  type LegacyStorage,
} from './legacyMigration'

const scope = {
  appUserId: '10000000-0000-4000-8000-000000000001',
  workspaceId: '20000000-0000-4000-8000-000000000001',
}

class MemoryStorage implements LegacyStorage {
  readonly values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

const transfer: ProjectAssetTransfer = {
  upload: async () => { throw new Error('no upload expected') },
  download: async () => [],
}

function cloudFrom(input: LegacyImportInput): CloudProject {
  return {
    id: '30000000-0000-4000-8000-000000000001',
    workspaceId: input.workspaceId,
    name: input.name,
    documentSchemaVersion: 1,
    document: input.document,
    revision: 1,
    createdAt: '2026-09-18T00:00:00.000Z',
    updatedAt: '2026-09-18T00:00:00.000Z',
    assets: [],
  }
}

describe('legacy migration journal', () => {
  it('backs up exact raw input, repairs candidates, and detects changed source content', async () => {
    const storage = new MemoryStorage()
    const store = new MemoryLegacyMigrationStore()
    const project = freshProject(1)
    project.id = 'legacy-project'
    project.live.W = 999
    const raw = JSON.stringify({ projects: [project] })
    storage.setItem(LEGACY_PROJECTS_STORAGE_KEY, raw)

    const journal = await discoverLegacyMigration(scope, store, storage)
    expect(journal?.rawBackups[0].raw).toBe(raw)
    expect(journal?.items[0]).toMatchObject({
      sourceProjectKey: 'projects:id:legacy-project',
      status: 'pending',
      project: { live: { W: 250 } },
    })
    expect(journal?.items[0].warnings[0]).toContain('W')

    project.name = 'เปลี่ยนหลังเริ่มย้าย'
    storage.setItem(LEGACY_PROJECTS_STORAGE_KEY, JSON.stringify({ projects: [project] }))
    const changed = await discoverLegacyMigration(scope, store, storage)
    expect(changed?.items[0]).toMatchObject({ status: 'conflict' })
    expect(changed?.rawBackups).toHaveLength(2)
  })

  it('keeps malformed raw data as a durable skipped item', async () => {
    const storage = new MemoryStorage()
    const store = new MemoryLegacyMigrationStore()
    storage.setItem(LEGACY_PROJECTS_STORAGE_KEY, '{broken')

    const journal = await discoverLegacyMigration(scope, store, storage)
    expect(journal?.rawBackups[0].raw).toBe('{broken')
    expect(journal?.items[0]).toMatchObject({ status: 'skipped', project: null })
  })

  it('reopens declined consent without changing the source backup or migration items', async () => {
    const storage = new MemoryStorage()
    const store = new MemoryLegacyMigrationStore()
    const source = freshProject(1)
    source.id = 'reopen-project'
    storage.setItem(LEGACY_PROJECTS_STORAGE_KEY, JSON.stringify({ projects: [source] }))
    const discovered = await discoverLegacyMigration(scope, store, storage)
    if (!discovered) throw new Error('journal missing')
    const declined = await setLegacyMigrationConsent(discovered, store, false)

    const reopened = await reopenLegacyMigrationConsent(declined, store)

    expect(reopened.consent).toBe('pending')
    expect(reopened.rawBackups).toEqual(declined.rawBackups)
    expect(reopened.items).toEqual(declined.items)
    await expect(store.get(reopened.key)).resolves.toMatchObject({ consent: 'pending' })
  })

  it('resumes verification with the same operation ID and completes without duplicate import', async () => {
    const storage = new MemoryStorage()
    const store = new MemoryLegacyMigrationStore()
    const source = freshProject(1)
    source.id = 'legacy-project'
    storage.setItem(LEGACY_PROJECTS_STORAGE_KEY, JSON.stringify({ projects: [source] }))
    const discovered = await discoverLegacyMigration(scope, store, storage)
    if (!discovered) throw new Error('journal missing')
    const accepted = await setLegacyMigrationConsent(discovered, store, true)
    const inputs: LegacyImportInput[] = []
    let verificationAttempts = 0
    let imported: CloudProject | null = null
    const importProject = vi.fn(async (input: LegacyImportInput) => {
      inputs.push(structuredClone(input))
      imported ??= cloudFrom(input)
      return {
        sourceInstallationId: input.sourceInstallationId,
        sourceProjectKey: input.sourceProjectKey,
        sourceHash: input.sourceHash,
        project: imported,
        completedAt: '2026-09-18T00:00:00.000Z',
      }
    })
    const getProject = vi.fn(async () => {
      verificationAttempts += 1
      if (verificationAttempts === 1) throw new Error('lost response after import')
      return imported!
    })

    const failed = await runLegacyMigration({ journal: accepted, store, transfer, importProject, getProject })
    expect(failed.items[0].status).toBe('error')
    const completed = await runLegacyMigration({ journal: failed, store, transfer, importProject, getProject })
    expect(completed.items[0]).toMatchObject({ status: 'complete', targetProjectId: imported!.id })
    expect(inputs).toHaveLength(2)
    expect(inputs[0].operationId).toBe(inputs[1].operationId)
    expect(inputs[0].sourceHash).toBe(inputs[1].sourceHash)
  })

  it('coalesces StrictMode-style concurrent resumes in one page', async () => {
    const storage = new MemoryStorage()
    const store = new MemoryLegacyMigrationStore()
    const source = freshProject(1)
    source.id = 'strict-project'
    storage.setItem(LEGACY_PROJECTS_STORAGE_KEY, JSON.stringify({ projects: [source] }))
    const discovered = await discoverLegacyMigration(scope, store, storage)
    if (!discovered) throw new Error('journal missing')
    const accepted = await setLegacyMigrationConsent(discovered, store, true)
    let cloud: CloudProject | null = null
    const importProject = vi.fn(async (input: LegacyImportInput) => {
      await Promise.resolve()
      cloud ??= cloudFrom(input)
      return {
        sourceInstallationId: input.sourceInstallationId,
        sourceProjectKey: input.sourceProjectKey,
        sourceHash: input.sourceHash,
        project: cloud,
        completedAt: '2026-09-18T00:00:00.000Z',
      }
    })
    const options = {
      journal: accepted,
      store,
      transfer,
      importProject,
      getProject: async () => cloud!,
    }

    const [left, right] = await Promise.all([
      resumeLegacyMigration(options),
      resumeLegacyMigration(options),
    ])

    expect(importProject).toHaveBeenCalledTimes(1)
    expect(left.items[0].status).toBe('complete')
    expect(right.items[0].status).toBe('complete')
  })

  it('persists each uploaded asset before a later upload fails and reuses it on retry', async () => {
    const storage = new MemoryStorage()
    const store = new MemoryLegacyMigrationStore()
    const source = freshProject(1)
    source.id = 'asset-project'
    source.decos = [
      { id: 'one', type: 'image', src: pngDataUrl([0]), aspect: 1, x: 0, y: 0, rot: 0, w: 10, h: 10 },
      { id: 'two', type: 'image', src: pngDataUrl([1]), aspect: 1, x: 10, y: 0, rot: 0, w: 10, h: 10 },
    ]
    storage.setItem(LEGACY_PROJECTS_STORAGE_KEY, JSON.stringify({ projects: [source] }))
    const discovered = await discoverLegacyMigration(scope, store, storage)
    if (!discovered) throw new Error('journal missing')
    const accepted = await setLegacyMigrationConsent(discovered, store, true)
    const uploaded = new Map<string, Awaited<ReturnType<ProjectAssetTransfer['upload']>>>()
    let failSecond = true
    let uploadCalls = 0
    const resumableTransfer: ProjectAssetTransfer = {
      download: async () => [],
      upload: async (input) => {
        uploadCalls += 1
        if (input.bytes.at(-1) === 1 && failSecond) {
          failSecond = false
          throw new Error('temporary upload failure')
        }
        const asset = {
          id: input.bytes.at(-1) === 1
            ? '40000000-0000-4000-8000-000000000002'
            : '40000000-0000-4000-8000-000000000001',
          workspaceId: input.workspaceId,
          purpose: input.purpose,
          state: 'ready' as const,
          mimeType: input.mimeType,
          byteSize: input.bytes.byteLength,
          sha256: input.sourceSha256,
          width: 1,
          height: 1,
          createdAt: '2026-09-18T00:00:00.000Z',
        }
        uploaded.set(asset.id, asset)
        return asset
      },
    }
    let cloud: CloudProject | null = null
    const importProject = async (input: LegacyImportInput) => {
      cloud = { ...cloudFrom(input), assets: [...uploaded.values()] }
      return {
        sourceInstallationId: input.sourceInstallationId,
        sourceProjectKey: input.sourceProjectKey,
        sourceHash: input.sourceHash,
        project: cloud,
        completedAt: '2026-09-18T00:00:00.000Z',
      }
    }

    const failed = await runLegacyMigration({
      journal: accepted, store, transfer: resumableTransfer, importProject, getProject: async () => cloud!,
    })
    expect(failed.items[0].status).toBe('error')
    expect(failed.items[0].sidecar?.entries).toHaveLength(1)
    const completed = await runLegacyMigration({
      journal: failed, store, transfer: resumableTransfer, importProject, getProject: async () => cloud!,
    })
    expect(completed.items[0].status).toBe('complete')
    expect(uploadCalls).toBe(3)
  })
})

function pngDataUrl(suffix: number[]): string {
  const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...suffix])
  return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`
}
