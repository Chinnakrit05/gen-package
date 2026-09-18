import { describe, expect, it, vi } from 'vitest'
import type { CloudProject, SaveProjectInput } from '../../../shared/contracts/projects'
import type { Project } from '../../core/project'
import { MemoryProjectDraftStore, projectDraftKey } from '../drafts/projectDraftStore'
import type { AssetSidecarScope, ProjectAssetTransfer } from './cloudProjectCodec'
import { CloudProjectController } from './cloudProjectController'

const scope: AssetSidecarScope = {
  appUserId: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
}

const transfer: ProjectAssetTransfer = {
  upload: vi.fn(async () => { throw new Error('unexpected upload') }),
  download: vi.fn(async () => []),
}

describe('cloud project controller', () => {
  it('hydrates, captures and saves through the durable queue', async () => {
    const store = new MemoryProjectDraftStore()
    const saves: SaveProjectInput[] = []
    const controller = new CloudProjectController({
      scope,
      clientId: 'tab-a',
      store,
      transfer,
      debounceMs: 60_000,
      maxWaitMs: 60_000,
      save: async (input) => {
        saves.push(structuredClone(input))
        return {
          projectId: input.projectId,
          revision: 2,
          updatedAt: '2026-09-18T00:01:00.000Z',
          operationId: input.operationId,
        }
      },
    })
    const opened = await controller.open(cloudProject('33333333-3333-4333-8333-333333333333', 500))
    const edited = { ...opened, qty: 900, name: 'แก้แล้ว' }
    await controller.capture(edited)
    await controller.flush()

    expect(saves).toHaveLength(1)
    expect(saves[0]).toMatchObject({ expectedRevision: 1, name: 'แก้แล้ว', document: { qty: 900 } })
    expect(controller.getState()).toMatchObject({
      status: 'ready',
      project: { qty: 900 },
      save: { state: 'clean', baseRevision: 2 },
    })
    controller.dispose()
  })

  it('captures the current editor state before switching projects', async () => {
    const store = new MemoryProjectDraftStore()
    const controller = new CloudProjectController({
      scope,
      clientId: 'tab-switch',
      store,
      transfer,
      debounceMs: 60_000,
      maxWaitMs: 60_000,
      save: vi.fn(async () => { throw new Error('unexpected save') }),
    })
    const first = await controller.open(cloudProject('33333333-3333-4333-8333-333333333333', 500))
    const edited = { ...first, qty: 777 }
    const second = await controller.switchProject(
      edited,
      cloudProject('44444444-4444-4444-8444-444444444444', 600),
    )

    const persisted = await store.get(projectDraftKey(scope, first.id, 'tab-switch'))
    expect(persisted?.latestDraft.project.qty).toBe(777)
    expect(persisted?.savedGeneration).toBeLessThan(persisted!.latestDraft.generation)
    expect(second).toMatchObject({ id: '44444444-4444-4444-8444-444444444444', qty: 600 })
    controller.dispose()
  })

  it('restores an unsent tab-scoped draft without downloading cloud assets again', async () => {
    const store = new MemoryProjectDraftStore()
    const cloud = cloudProject('33333333-3333-4333-8333-333333333333', 500)
    const first = new CloudProjectController({
      scope,
      clientId: 'tab-restore',
      store,
      transfer,
      debounceMs: 60_000,
      maxWaitMs: 60_000,
      save: vi.fn(async () => { throw new Error('unexpected save') }),
    })
    const opened = await first.open(cloud)
    await first.capture({ ...opened, qty: 1234 })
    first.dispose()

    const noDownload: ProjectAssetTransfer = {
      upload: vi.fn(async () => { throw new Error('unexpected upload') }),
      download: vi.fn(async () => { throw new Error('unexpected download') }),
    }
    const restored = new CloudProjectController({
      scope,
      clientId: 'tab-restore',
      store,
      transfer: noDownload,
      debounceMs: 60_000,
      maxWaitMs: 60_000,
      save: vi.fn(async () => { throw new Error('unexpected save') }),
    })
    await expect(restored.open(cloud)).resolves.toMatchObject({ qty: 1234 })
    expect(noDownload.download).not.toHaveBeenCalled()
    restored.dispose()
  })
})

function cloudProject(id: string, qty: number): CloudProject {
  const project: Project = {
    id,
    name: `งาน ${qty}`,
    updatedAt: Date.parse('2026-09-18T00:00:00.000Z'),
    live: { template: 'tuck-end', materialId: 'carton-300', W: 80, D: 50, H: 120, handle: false },
    qty,
    fillColor: null,
    decos: [],
    history: [],
    histIdx: -1,
  }
  return {
    id,
    workspaceId: scope.workspaceId,
    name: project.name,
    documentSchemaVersion: 1,
    document: {
      live: project.live,
      qty,
      fillColor: null,
      decos: [],
      history: [],
      histIdx: -1,
    },
    revision: 1,
    createdAt: '2026-09-18T00:00:00.000Z',
    updatedAt: '2026-09-18T00:00:00.000Z',
    assets: [],
  }
}
