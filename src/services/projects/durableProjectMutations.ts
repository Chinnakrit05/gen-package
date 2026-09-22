import type {
  CloudProject,
  CreateProjectInput,
  DeleteProjectInput,
  DeleteReceipt,
} from '../../../shared/contracts/projects'
import {
  projectMutationKey,
  projectMutationScopeKey,
  type PersistedProjectMutation,
  type ProjectMutationStore,
} from '../drafts/projectMutationStore'
import type { AssetSidecarScope } from './cloudProjectCodec'

export interface DurableProjectMutationOptions {
  scope: AssetSidecarScope
  store: ProjectMutationStore
  create(input: CreateProjectInput): Promise<CloudProject>
  remove(input: DeleteProjectInput): Promise<DeleteReceipt>
}

const activeMutations = new Map<string, Promise<unknown>>()

export async function executeDurableCreate(
  options: DurableProjectMutationOptions,
  input: CreateProjectInput,
): Promise<CloudProject> {
  assertWorkspace(options.scope, input.workspaceId)
  const pending = (await options.store.list(options.scope)).find((record) => (
    record.kind === 'create' && sameCreateIntent(record.input, input)
  )) as Extract<PersistedProjectMutation, { kind: 'create' }> | undefined
  if (pending) {
    return coalesce(pending.key, async () => {
      const result = await sendCreate(options, pending)
      await options.store.delete(pending.key)
      return result
    })
  }
  const record = await persistMutation(options, 'create', input)
  return coalesce(record.key, async () => {
    const result = await sendCreate(options, record)
    await options.store.delete(record.key)
    return result
  })
}

export async function executeDurableDelete(
  options: DurableProjectMutationOptions,
  input: DeleteProjectInput,
): Promise<DeleteReceipt> {
  const pending = (await options.store.list(options.scope)).find((record) => (
    record.kind === 'delete' && record.input.projectId === input.projectId
  )) as Extract<PersistedProjectMutation, { kind: 'delete' }> | undefined
  if (pending) {
    return coalesce(pending.key, async () => {
      const result = await sendDelete(options, pending)
      await options.store.delete(pending.key)
      return result
    })
  }
  const record = await persistMutation(options, 'delete', input)
  return coalesce(record.key, async () => {
    const result = await sendDelete(options, record)
    await options.store.delete(record.key)
    return result
  })
}

export async function replayDurableProjectMutations(
  options: DurableProjectMutationOptions,
): Promise<{ replayed: number; created: CloudProject[]; deleted: DeleteReceipt[] }> {
  const records = await options.store.list(options.scope)
  let replayed = 0
  const created: CloudProject[] = []
  const deleted: DeleteReceipt[] = []
  for (const record of records) {
    assertRecordScope(options.scope, record)
    const existing = activeMutations.get(record.key)
    if (existing) {
      await existing
      replayed += 1
      continue
    }
    await coalesce(record.key, async () => {
      if (record.kind === 'create') created.push(await sendCreate(options, record))
      else deleted.push(await sendDelete(options, record))
      await options.store.delete(record.key)
    })
    replayed += 1
  }
  return { replayed, created, deleted }
}

async function persistMutation(
  options: DurableProjectMutationOptions,
  kind: 'create',
  input: CreateProjectInput,
): Promise<Extract<PersistedProjectMutation, { kind: 'create' }>>
async function persistMutation(
  options: DurableProjectMutationOptions,
  kind: 'delete',
  input: DeleteProjectInput,
): Promise<Extract<PersistedProjectMutation, { kind: 'delete' }>>
async function persistMutation(
  options: DurableProjectMutationOptions,
  kind: PersistedProjectMutation['kind'],
  input: CreateProjectInput | DeleteProjectInput,
): Promise<PersistedProjectMutation> {
  if (input.operationId.length === 0) throw new Error('operationId ของ mutation ห้ามว่าง')
  const key = projectMutationKey(options.scope, input.operationId)
  const existing = await options.store.get(key)
  if (existing) {
    if (existing.kind !== kind || canonicalJson(existing.input) !== canonicalJson(input)) {
      throw new Error('operationId นี้มี mutation อื่นค้างอยู่')
    }
    return existing
  }
  const now = Date.now()
  const base = {
    version: 1 as const,
    key,
    scopeKey: projectMutationScopeKey(options.scope),
    scope: { ...options.scope },
    operationId: input.operationId,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  }
  const record = kind === 'create'
    ? { ...base, kind, input: structuredClone(input as CreateProjectInput) }
    : { ...base, kind, input: structuredClone(input as DeleteProjectInput) }
  await options.store.put(record)
  return record
}

async function sendCreate(
  options: DurableProjectMutationOptions,
  record: Extract<PersistedProjectMutation, { kind: 'create' }>,
): Promise<CloudProject> {
  await incrementAttempts(options.store, record)
  const result = await options.create(structuredClone(record.input))
  if (
    result.workspaceId !== options.scope.workspaceId
    || result.name !== record.input.name
    || result.documentSchemaVersion !== record.input.documentSchemaVersion
    || canonicalJson(result.document) !== canonicalJson(record.input.document)
  ) throw new Error('create receipt ไม่ตรงกับ mutation ที่ส่ง')
  return result
}

async function sendDelete(
  options: DurableProjectMutationOptions,
  record: Extract<PersistedProjectMutation, { kind: 'delete' }>,
): Promise<DeleteReceipt> {
  await incrementAttempts(options.store, record)
  const result = await options.remove(structuredClone(record.input))
  if (result.operationId !== record.operationId || result.projectId !== record.input.projectId) {
    throw new Error('delete receipt ไม่ตรงกับ mutation ที่ส่ง')
  }
  return result
}

async function incrementAttempts(store: ProjectMutationStore, record: PersistedProjectMutation): Promise<void> {
  record.attempts += 1
  record.updatedAt = Date.now()
  await store.put(record)
}

function coalesce<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = activeMutations.get(key)
  if (existing) return existing as Promise<T>
  const pending = run()
  activeMutations.set(key, pending)
  void pending.finally(() => {
    if (activeMutations.get(key) === pending) activeMutations.delete(key)
  }).catch(() => undefined)
  return pending
}

function assertWorkspace(scope: AssetSidecarScope, workspaceId: string): void {
  if (scope.workspaceId !== workspaceId) throw new Error('create mutation อยู่คนละ workspace')
}

function assertRecordScope(scope: AssetSidecarScope, record: PersistedProjectMutation): void {
  if (
    record.scope.appUserId !== scope.appUserId
    || record.scope.workspaceId !== scope.workspaceId
    || record.scopeKey !== projectMutationScopeKey(scope)
  ) throw new Error('project mutation journal อยู่คนละบัญชีหรือ workspace')
  if (record.kind === 'create') assertWorkspace(scope, record.input.workspaceId)
}

function sameCreateIntent(left: CreateProjectInput, right: CreateProjectInput): boolean {
  const { operationId: _leftOperation, ...leftIntent } = left
  const { operationId: _rightOperation, ...rightIntent } = right
  return canonicalJson(leftIntent) === canonicalJson(rightIntent)
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`
  }
  return JSON.stringify(value)
}
