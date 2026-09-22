import { describe, expect, it, vi } from 'vitest'
import type { SaveProjectInput, SaveReceipt } from '../../../shared/contracts/projects'
import { freshProject, type Project } from '../../core/project'
import { MemoryProjectDraftStore, projectDraftKey } from '../drafts/projectDraftStore'
import { ProjectAssetSidecar, type AssetSidecarScope } from './cloudProjectCodec'
import { DurableProjectSaveQueue, type DurableSaveQueueOptions } from './durableSaveQueue'

const scope: AssetSidecarScope = {
  appUserId: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
}

function project(id = '33333333-3333-4333-8333-333333333333', qty = 500): Project {
  return { ...freshProject(1), id, qty, name: `งาน ${qty}` }
}

function queueOptions(
  store: MemoryProjectDraftStore,
  save: DurableSaveQueueOptions['save'],
  overrides: Partial<DurableSaveQueueOptions> = {},
): DurableSaveQueueOptions {
  const initial = project()
  const sidecar = new ProjectAssetSidecar(scope).snapshot()
  return {
    scope,
    clientId: 'tab-a',
    projectId: initial.id,
    initialRevision: 1,
    initialProject: initial,
    initialSidecar: sidecar,
    store,
    prepare: async (draft) => ({
      name: draft.project.name,
      documentSchemaVersion: 1,
      document: {
        live: draft.project.live,
        qty: draft.project.qty,
        fillColor: draft.project.fillColor,
        decos: [],
        history: [],
        histIdx: -1,
      },
    }),
    save,
    isOnline: () => true,
    debounceMs: 60_000,
    maxWaitMs: 60_000,
    retryBaseMs: 1,
    ...overrides,
  }
}

describe('durable project save queue', () => {
  it('announces a committed receipt only after the durable state becomes clean', async () => {
    const store = new MemoryProjectDraftStore()
    const onSaved = vi.fn()
    const save = vi.fn(async (input: SaveProjectInput) => receipt(input, 2))
    const queue = new DurableProjectSaveQueue(queueOptions(store, save, { onSaved }))
    await queue.start()
    await queue.capture(project(undefined, 550), new ProjectAssetSidecar(scope).snapshot())
    await queue.flush()

    expect(queue.getStatus().state).toBe('clean')
    expect(onSaved).toHaveBeenCalledOnce()
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }))
    queue.dispose()
  })

  it('stops explicit and scheduled saves after another tab reports a conflict', async () => {
    const store = new MemoryProjectDraftStore()
    const save = vi.fn(async (input: SaveProjectInput) => receipt(input, 2))
    const queue = new DurableProjectSaveQueue(queueOptions(store, save))
    await queue.start()
    await queue.capture(project(undefined, 551), new ProjectAssetSidecar(scope).snapshot())
    queue.markConflict()
    await queue.flush()

    expect(queue.getStatus().state).toBe('conflict')
    expect(save).not.toHaveBeenCalled()
    queue.dispose()
  })

  it('persists the latest editor draft before any network save', async () => {
    const store = new MemoryProjectDraftStore()
    const save = vi.fn<DurableSaveQueueOptions['save']>()
    const queue = new DurableProjectSaveQueue(queueOptions(store, save))
    await queue.start()
    const changed = project(undefined, 900)

    const generation = await queue.capture(changed, new ProjectAssetSidecar(scope).snapshot())
    const persisted = await store.get(projectDraftKey(scope, changed.id, 'tab-a'))
    expect(generation).toBe(1)
    expect(persisted?.latestDraft.project.qty).toBe(900)
    expect(persisted?.inFlight).toBeNull()
    expect(save).not.toHaveBeenCalled()
    expect(queue.getStatus().state).toBe('dirty')
    queue.dispose()
  })

  it('keeps edits made during an in-flight save and sends them at the next revision', async () => {
    const store = new MemoryProjectDraftStore()
    const first = deferred<SaveReceipt>()
    const calls: SaveProjectInput[] = []
    const save = vi.fn(async (input: SaveProjectInput) => {
      calls.push(structuredClone(input))
      if (calls.length === 1) return first.promise
      return receipt(input, 3)
    })
    const queue = new DurableProjectSaveQueue(queueOptions(store, save))
    await queue.start()
    await queue.capture(project(undefined, 600), new ProjectAssetSidecar(scope).snapshot())

    const firstFlush = queue.flush()
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    await queue.capture(project(undefined, 700), new ProjectAssetSidecar(scope).snapshot())
    first.resolve(receipt(calls[0], 2))
    await firstFlush
    await queue.flush()

    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({ expectedRevision: 1, document: { qty: 600 } })
    expect(calls[1]).toMatchObject({ expectedRevision: 2, document: { qty: 700 } })
    expect(queue.getStatus()).toMatchObject({ state: 'clean', baseRevision: 3, savedGeneration: 2 })
    queue.dispose()
  })

  it('replays the same operation after commit succeeded but the response was lost', async () => {
    const store = new MemoryProjectDraftStore()
    const receipts = new Map<string, SaveReceipt>()
    let serverRevision = 1
    const calls: SaveProjectInput[] = []
    const save = async (input: SaveProjectInput): Promise<SaveReceipt> => {
      calls.push(structuredClone(input))
      const prior = receipts.get(input.operationId)
      if (prior) return prior
      expect(input.expectedRevision).toBe(serverRevision)
      serverRevision += 1
      const result = receipt(input, serverRevision)
      receipts.set(input.operationId, result)
      throw Object.assign(new Error('response lost'), { status: 0 })
    }

    const firstQueue = new DurableProjectSaveQueue(queueOptions(store, save))
    await firstQueue.start()
    await firstQueue.capture(project(undefined, 800), new ProjectAssetSidecar(scope).snapshot())
    await firstQueue.flush()
    expect(firstQueue.getStatus().state).toBe('offline')
    firstQueue.dispose()

    const secondQueue = new DurableProjectSaveQueue(queueOptions(store, save, { isOnline: () => true }))
    const resumed = await secondQueue.start()
    expect(resumed.hasUnresolvedMutation).toBe(true)
    await secondQueue.flush()

    expect(calls).toHaveLength(2)
    expect(calls[1].operationId).toBe(calls[0].operationId)
    expect(calls[1]).toEqual(calls[0])
    expect(serverRevision).toBe(2)
    expect(secondQueue.getStatus()).toMatchObject({ state: 'clean', baseRevision: 2 })
    secondQueue.dispose()
  })

  it('uses CAS to make concurrent tabs explicit instead of silently overwriting', async () => {
    const store = new MemoryProjectDraftStore()
    let serverRevision = 1
    const save = async (input: SaveProjectInput): Promise<SaveReceipt> => {
      if (input.expectedRevision !== serverRevision) throw Object.assign(new Error('revision conflict'), { status: 409 })
      serverRevision += 1
      return receipt(input, serverRevision)
    }
    const tabA = new DurableProjectSaveQueue(queueOptions(store, save, { clientId: 'tab-a' }))
    const tabB = new DurableProjectSaveQueue(queueOptions(store, save, { clientId: 'tab-b' }))
    await Promise.all([tabA.start(), tabB.start()])
    await Promise.all([
      tabA.capture(project(undefined, 601), new ProjectAssetSidecar(scope).snapshot()),
      tabB.capture(project(undefined, 602), new ProjectAssetSidecar(scope).snapshot()),
    ])

    await Promise.all([tabA.flush(), tabB.flush()])
    expect([tabA.getStatus().state, tabB.getStatus().state].sort()).toEqual(['clean', 'conflict'])
    expect(serverRevision).toBe(2)
    expect(await store.get(projectDraftKey(scope, project().id, 'tab-a'))).not.toBeNull()
    expect(await store.get(projectDraftKey(scope, project().id, 'tab-b'))).not.toBeNull()
    const conflicted = tabA.getStatus().state === 'conflict' ? tabA : tabB
    await conflicted.capture(project(undefined, 603), new ProjectAssetSidecar(scope).snapshot())
    expect(conflicted.getStatus().state).toBe('conflict')
    tabA.dispose()
    tabB.dispose()
  })

  it('allows an explicit retry without changing the durable operation ID', async () => {
    const store = new MemoryProjectDraftStore()
    const calls: SaveProjectInput[] = []
    let available = false
    const save = async (input: SaveProjectInput): Promise<SaveReceipt> => {
      calls.push(structuredClone(input))
      if (!available) throw Object.assign(new Error('temporarily unavailable'), { status: 503 })
      return receipt(input, 2)
    }
    const queue = new DurableProjectSaveQueue(queueOptions(store, save, { maxRetries: 0 }))
    await queue.start()
    await queue.capture(project(undefined, 650), new ProjectAssetSidecar(scope).snapshot())
    await queue.flush()
    expect(queue.getStatus().state).toBe('error')

    available = true
    await queue.retry()
    expect(calls).toHaveLength(2)
    expect(calls[1].operationId).toBe(calls[0].operationId)
    expect(queue.getStatus()).toMatchObject({ state: 'clean', baseRevision: 2 })
    queue.dispose()
  })

  it('keeps an unsent draft on switch/dispose and ignores a late response', async () => {
    const store = new MemoryProjectDraftStore()
    const pending = deferred<SaveReceipt>()
    const save = vi.fn(async () => pending.promise)
    const queue = new DurableProjectSaveQueue(queueOptions(store, save))
    await queue.start()
    await queue.capture(project(undefined, 777), new ProjectAssetSidecar(scope).snapshot())
    const flushing = queue.flush()
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce())
    const before = await store.get(projectDraftKey(scope, project().id, 'tab-a'))
    expect(before?.inFlight).not.toBeNull()

    queue.dispose()
    pending.resolve(receipt(before!.inFlight!.input, 2))
    await flushing
    const after = await store.get(projectDraftKey(scope, project().id, 'tab-a'))
    expect(after?.latestDraft.project.qty).toBe(777)
    expect(after?.inFlight?.operationId).toBe(before?.inFlight?.operationId)
  })

  it('persists edits offline and resumes when connectivity returns', async () => {
    const store = new MemoryProjectDraftStore()
    let online = false
    const save = vi.fn(async (input: SaveProjectInput) => receipt(input, 2))
    const queue = new DurableProjectSaveQueue(queueOptions(store, save, { isOnline: () => online }))
    await queue.start()
    await queue.capture(project(undefined, 888), new ProjectAssetSidecar(scope).snapshot())
    await queue.flush()
    expect(queue.getStatus().state).toBe('offline')
    expect(save).not.toHaveBeenCalled()

    online = true
    queue.setOnline(true)
    await queue.flush()
    expect(save).toHaveBeenCalledOnce()
    expect(queue.getStatus().state).toBe('clean')
    queue.dispose()
  })
})

function receipt(input: SaveProjectInput, revision: number): SaveReceipt {
  return {
    projectId: input.projectId,
    revision,
    updatedAt: '2026-09-18T00:00:00.000Z',
    operationId: input.operationId,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
