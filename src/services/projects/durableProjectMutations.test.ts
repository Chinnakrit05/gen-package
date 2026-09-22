import { describe, expect, it, vi } from 'vitest'
import type { CloudProject, CreateProjectInput, DeleteProjectInput } from '../../../shared/contracts/projects'
import {
  MemoryProjectMutationStore,
  projectMutationKey,
} from '../drafts/projectMutationStore'
import type { AssetSidecarScope } from './cloudProjectCodec'
import {
  executeDurableCreate,
  executeDurableDelete,
  replayDurableProjectMutations,
  type DurableProjectMutationOptions,
} from './durableProjectMutations'

const scope: AssetSidecarScope = {
  appUserId: '10000000-0000-4000-8000-000000000001',
  workspaceId: '20000000-0000-4000-8000-000000000001',
}

function createInput(operationId = '30000000-0000-4000-8000-000000000001'): CreateProjectInput {
  return {
    workspaceId: scope.workspaceId,
    operationId,
    name: 'Durable create',
    documentSchemaVersion: 1,
    document: {
      live: { template: 'tuck-end', materialId: 'carton-300', W: 80, D: 50, H: 120, handle: false },
      qty: 500,
      fillColor: null,
      decos: [],
      history: [],
      histIdx: -1,
    },
  }
}

function cloud(input: CreateProjectInput): CloudProject {
  return {
    id: '40000000-0000-4000-8000-000000000001',
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

function options(store: MemoryProjectMutationStore, overrides: Partial<DurableProjectMutationOptions> = {}): DurableProjectMutationOptions {
  return {
    scope,
    store,
    create: async (input) => cloud(input),
    remove: async (input) => ({
      projectId: input.projectId,
      operationId: input.operationId,
      revision: input.expectedRevision + 1,
      deletedAt: '2026-09-18T00:00:00.000Z',
    }),
    ...overrides,
  }
}

describe('durable project create/delete mutations', () => {
  it('persists the exact create payload before sending and clears only after a valid response', async () => {
    const store = new MemoryProjectMutationStore()
    const input = createInput()
    const create = vi.fn(async (sent: CreateProjectInput) => {
      const record = await store.get(projectMutationKey(scope, input.operationId))
      expect(record).toMatchObject({ kind: 'create', attempts: 1, input })
      return cloud(sent)
    })

    await expect(executeDurableCreate(options(store, { create }), input)).resolves.toMatchObject({ revision: 1 })
    expect(await store.list(scope)).toEqual([])
  })

  it('replays the same create operation after a committed response is lost', async () => {
    const store = new MemoryProjectMutationStore()
    const input = createInput()
    const sent: CreateProjectInput[] = []
    let loseResponse = true
    const create = vi.fn(async (value: CreateProjectInput) => {
      sent.push(structuredClone(value))
      if (loseResponse) {
        loseResponse = false
        throw new TypeError('response lost')
      }
      return cloud(value)
    })
    const configured = options(store, { create })

    await expect(executeDurableCreate(configured, input)).rejects.toThrow('response lost')
    expect(await store.list(scope)).toHaveLength(1)
    await expect(replayDurableProjectMutations(configured)).resolves.toMatchObject({
      replayed: 1,
      created: [{ id: '40000000-0000-4000-8000-000000000001' }],
      deleted: [],
    })
    expect(sent).toEqual([input, input])
    expect(await store.list(scope)).toEqual([])
  })

  it('rejects operation reuse with another pending payload before network I/O', async () => {
    const store = new MemoryProjectMutationStore()
    const create = vi.fn(async (input: CreateProjectInput) => {
      throw new TypeError(`offline ${input.name}`)
    })
    const configured = options(store, { create })
    const first = createInput()
    await expect(executeDurableCreate(configured, first)).rejects.toThrow('offline')

    await expect(executeDurableCreate(configured, { ...first, name: 'Changed' }))
      .rejects.toThrow('operationId นี้มี mutation อื่นค้างอยู่')
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('keeps the journal when a create response does not match the persisted payload', async () => {
    const store = new MemoryProjectMutationStore()
    const input = createInput()
    const create = vi.fn(async (sent: CreateProjectInput) => ({
      ...cloud(sent),
      name: 'Unrelated project',
    }))

    await expect(executeDurableCreate(options(store, { create }), input))
      .rejects.toThrow('create receipt ไม่ตรงกับ mutation ที่ส่ง')
    expect(await store.list(scope)).toHaveLength(1)
  })

  it('treats a repeated create intent with a new UI operation ID as recovery of the pending mutation', async () => {
    const store = new MemoryProjectMutationStore()
    const first = createInput()
    const sentOperationIds: string[] = []
    let loseResponse = true
    const create = vi.fn(async (input: CreateProjectInput) => {
      sentOperationIds.push(input.operationId)
      if (loseResponse) {
        loseResponse = false
        throw new TypeError('response lost')
      }
      return cloud(input)
    })
    const configured = options(store, { create })
    await expect(executeDurableCreate(configured, first)).rejects.toThrow('response lost')

    const recovered = await executeDurableCreate(configured, {
      ...first,
      operationId: '30000000-0000-4000-8000-000000000002',
    })

    expect(recovered.id).toBe('40000000-0000-4000-8000-000000000001')
    expect(sentOperationIds).toEqual([first.operationId, first.operationId])
    expect(await store.list(scope)).toEqual([])
  })

  it('replays an exact delete receipt after response loss', async () => {
    const store = new MemoryProjectMutationStore()
    const input: DeleteProjectInput = {
      projectId: '40000000-0000-4000-8000-000000000001',
      operationId: '50000000-0000-4000-8000-000000000001',
      expectedRevision: 7,
    }
    const sent: DeleteProjectInput[] = []
    let loseResponse = true
    const remove = vi.fn(async (value: DeleteProjectInput) => {
      sent.push(structuredClone(value))
      if (loseResponse) {
        loseResponse = false
        throw new TypeError('response lost')
      }
      return {
        projectId: value.projectId,
        operationId: value.operationId,
        revision: 8,
        deletedAt: '2026-09-18T00:00:00.000Z',
      }
    })
    const configured = options(store, { remove })

    await expect(executeDurableDelete(configured, input)).rejects.toThrow('response lost')
    await replayDurableProjectMutations(configured)
    expect(sent).toEqual([input, input])
    expect(await store.list(scope)).toEqual([])
  })

  it('coalesces concurrent callers for the same durable operation', async () => {
    const store = new MemoryProjectMutationStore()
    const input = createInput('30000000-0000-4000-8000-000000000099')
    const create = vi.fn(async (sent: CreateProjectInput) => {
      await Promise.resolve()
      return cloud(sent)
    })
    const configured = options(store, { create })

    const [left, right] = await Promise.all([
      executeDurableCreate(configured, input),
      executeDurableCreate(configured, input),
    ])
    expect(left.id).toBe(right.id)
    expect(create).toHaveBeenCalledTimes(1)
  })
})
