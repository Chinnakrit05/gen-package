import type { SaveProjectInput, SaveReceipt } from '../../../shared/contracts/projects'
import type { Project } from '../../core/project'
import type {
  PersistedProjectDraft,
  PersistedSaveMutation,
  ProjectDraftSnapshot,
  ProjectDraftStore,
} from '../drafts/projectDraftStore'
import { projectDraftKey, projectDraftScopeKey } from '../drafts/projectDraftStore'
import type { AssetSidecarSnapshot, AssetSidecarScope } from './cloudProjectCodec'

export type ProjectSaveState = 'loading' | 'clean' | 'dirty' | 'saving' | 'offline' | 'conflict' | 'error'

export interface ProjectSaveStatus {
  state: ProjectSaveState
  baseRevision: number
  latestGeneration: number
  savedGeneration: number
  error: Error | null
}

export interface PreparedProjectSave {
  name: string
  documentSchemaVersion: 1
  document: SaveProjectInput['document']
  sidecar?: AssetSidecarSnapshot
}

export interface DurableSaveQueueOptions {
  scope: AssetSidecarScope
  clientId: string
  projectId: string
  initialRevision: number
  initialProject: Project
  initialSidecar: AssetSidecarSnapshot
  store: ProjectDraftStore
  prepare(draft: ProjectDraftSnapshot): Promise<PreparedProjectSave>
  save(input: SaveProjectInput): Promise<SaveReceipt>
  onSaved?(receipt: SaveReceipt): void
  isOnline?: () => boolean
  createOperationId?: () => string
  debounceMs?: number
  maxWaitMs?: number
  retryBaseMs?: number
  maxRetries?: number
}

export interface DurableSaveQueueStartResult {
  draft: ProjectDraftSnapshot
  resumed: boolean
  hasUnresolvedMutation: boolean
}

type Listener = (status: ProjectSaveStatus) => void
type FailureKind = 'conflict' | 'offline' | 'retry' | 'fatal'

export class DurableProjectSaveQueue {
  private record: PersistedProjectDraft | null = null
  private status: ProjectSaveStatus
  private readonly listeners = new Set<Listener>()
  private mutationLock: Promise<void> = Promise.resolve()
  private work: Promise<void> | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private maxTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private online: boolean

  constructor(private readonly options: DurableSaveQueueOptions) {
    this.online = options.isOnline?.()
      ?? (typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean' ? true : navigator.onLine)
    this.status = {
      state: 'loading',
      baseRevision: options.initialRevision,
      latestGeneration: 0,
      savedGeneration: 0,
      error: null,
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.getStatus())
    return () => this.listeners.delete(listener)
  }

  getStatus(): ProjectSaveStatus {
    return { ...this.status }
  }

  getDraft(): ProjectDraftSnapshot {
    if (!this.record) throw new Error('save queue ยังไม่ start')
    return structuredClone(this.record.latestDraft)
  }

  async start(): Promise<DurableSaveQueueStartResult> {
    if (this.record) {
      return {
        draft: this.getDraft(),
        resumed: true,
        hasUnresolvedMutation: this.record.inFlight !== null,
      }
    }
    const key = projectDraftKey(this.options.scope, this.options.projectId, this.options.clientId)
    const stored = await this.options.store.get(key)
    if (this.disposed) throw new Error('save queue ถูกปิดแล้ว')
    const validated = stored ? validateStoredRecord(stored, this.options) : null
    const hasPendingDraft = validated !== null
      && (validated.inFlight !== null || validated.savedGeneration < validated.latestDraft.generation)
    const resumed = hasPendingDraft
    this.record = hasPendingDraft ? validated : initialRecord(this.options)
    await this.options.store.put(this.record)
    this.publish(this.nextRestingState(), null)
    if (this.record.inFlight) this.schedule(0)
    else if (this.record.latestDraft.generation > this.record.savedGeneration) this.schedule()
    return {
      draft: this.getDraft(),
      resumed,
      hasUnresolvedMutation: this.record.inFlight !== null,
    }
  }

  async capture(project: Project, sidecar: AssetSidecarSnapshot): Promise<number> {
    try {
      return await this.exclusive(async () => {
        const record = this.requireRecord()
        const wasConflict = this.status.state === 'conflict'
        if (project.id !== this.options.projectId) throw new Error('draft projectId ไม่ตรงกับ save queue')
        assertSidecarScope(sidecar, this.options.scope)
        const generation = record.latestDraft.generation + 1
        const next: PersistedProjectDraft = {
          ...record,
          latestDraft: {
            generation,
            project: structuredClone(project),
            sidecar: structuredClone(sidecar),
            capturedAt: Date.now(),
          },
          updatedAt: Date.now(),
        }
        await this.options.store.put(next)
        this.record = next
        this.publish(wasConflict ? 'conflict' : this.online ? 'dirty' : 'offline', wasConflict ? this.status.error : null)
        if (!wasConflict) this.schedule()
        return generation
      })
    } catch (value) {
      this.publish('error', toError(value))
      throw value
    }
  }

  flush(): Promise<void> {
    this.clearSaveTimers()
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    if (this.disposed) return Promise.resolve()
    if (this.status.state === 'conflict') return Promise.resolve()
    if (!this.online) {
      this.publish('offline', null)
      return Promise.resolve()
    }
    if (this.work) return this.work
    this.work = this.runOne()
      .catch((error: unknown) => {
        if (!this.disposed && this.status.state !== 'conflict' && this.status.state !== 'offline') {
          this.publish('error', toError(error))
        }
      })
      .finally(() => {
        this.work = null
        if (!this.disposed && this.record && !this.record.inFlight
          && this.record.latestDraft.generation > this.record.savedGeneration) {
          this.schedule(0)
        }
      })
    return this.work
  }

  setOnline(online: boolean): void {
    this.online = online
    if (!online) {
      this.clearSaveTimers()
      this.publish('offline', null)
      return
    }
    if (this.record?.inFlight || (this.record && this.record.latestDraft.generation > this.record.savedGeneration)) {
      this.publish('dirty', null)
      this.schedule(0)
    } else {
      this.publish('clean', null)
    }
  }

  async retry(): Promise<void> {
    await this.exclusive(async () => {
      const current = this.requireRecord()
      if (!current.inFlight) return
      const next = {
        ...current,
        inFlight: { ...current.inFlight, attempts: 0 },
        updatedAt: Date.now(),
      }
      await this.options.store.put(next)
      this.record = next
    })
    this.publish(this.online ? 'dirty' : 'offline', null)
    if (this.online) await this.flush()
  }

  markConflict(error = new Error('งานนี้ถูกแก้ไขจากอีกแท็บ')): void {
    this.clearSaveTimers()
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.publish('conflict', error)
  }

  dispose(): void {
    this.disposed = true
    this.clearSaveTimers()
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.listeners.clear()
  }

  private async runOne(): Promise<void> {
    const existing = await this.exclusive(async () => this.requireRecord().inFlight
      ? structuredClone(this.requireRecord().inFlight)
      : null)
    let mutation = existing
    if (!mutation) {
      const draft = await this.exclusive(async () => structuredClone(this.requireRecord().latestDraft))
      const record = this.requireRecord()
      if (draft.generation <= record.savedGeneration) {
        this.publish('clean', null)
        return
      }
      this.publish('saving', null)
      const prepared = await this.options.prepare(draft)
      mutation = await this.exclusive(async () => {
        const current = this.requireRecord()
        if (this.disposed || current.latestDraft.generation !== draft.generation) return null
        const operationId = this.options.createOperationId?.() ?? crypto.randomUUID()
        const nextMutation: PersistedSaveMutation = {
          generation: draft.generation,
          operationId,
          input: {
            projectId: this.options.projectId,
            operationId,
            expectedRevision: current.baseRevision,
            name: prepared.name,
            documentSchemaVersion: prepared.documentSchemaVersion,
            document: structuredClone(prepared.document),
          },
          attempts: 0,
        }
        const next = {
          ...current,
          latestDraft: prepared.sidecar
            ? { ...current.latestDraft, sidecar: structuredClone(prepared.sidecar) }
            : current.latestDraft,
          inFlight: nextMutation,
          updatedAt: Date.now(),
        }
        await this.options.store.put(next)
        this.record = next
        return structuredClone(nextMutation)
      })
      if (!mutation) return
    }

    this.publish('saving', null)
    try {
      const receipt = await this.options.save(structuredClone(mutation.input))
      if (this.disposed) return
      if (receipt.operationId !== mutation.operationId || receipt.projectId !== this.options.projectId) {
        throw new Error('save receipt ไม่ตรงกับ mutation ที่ส่ง')
      }
      await this.exclusive(async () => {
        const current = this.requireRecord()
        if (current.inFlight?.operationId !== mutation!.operationId) return
        const next: PersistedProjectDraft = {
          ...current,
          baseRevision: receipt.revision,
          savedGeneration: Math.max(current.savedGeneration, mutation!.generation),
          inFlight: null,
          updatedAt: Date.now(),
        }
        await this.options.store.put(next)
        this.record = next
        this.publish(this.nextRestingState(), null)
        this.options.onSaved?.(structuredClone(receipt))
      })
    } catch (error) {
      if (this.disposed) return
      await this.handleFailure(mutation, error)
    }
  }

  private async handleFailure(mutation: PersistedSaveMutation, value: unknown): Promise<void> {
    const error = toError(value)
    const kind = classifyFailure(value, this.online)
    if (kind === 'conflict') {
      this.publish('conflict', error)
      return
    }
    if (kind === 'offline') {
      this.online = false
      this.publish('offline', error)
      return
    }
    if (kind === 'retry' && mutation.attempts < (this.options.maxRetries ?? 3)) {
      await this.exclusive(async () => {
        const current = this.requireRecord()
        if (current.inFlight?.operationId !== mutation.operationId) return
        const nextMutation = { ...current.inFlight, attempts: current.inFlight.attempts + 1 }
        const next = { ...current, inFlight: nextMutation, updatedAt: Date.now() }
        await this.options.store.put(next)
        this.record = next
      })
      const attempt = mutation.attempts + 1
      const base = this.options.retryBaseMs ?? 500
      const delay = base * 2 ** Math.max(0, attempt - 1)
      this.publish('saving', error)
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null
        void this.flush()
      }, delay)
      return
    }
    this.publish('error', error)
  }

  private nextRestingState(): ProjectSaveState {
    const record = this.requireRecord()
    if (!this.online) return 'offline'
    if (record.inFlight) return 'saving'
    return record.latestDraft.generation > record.savedGeneration ? 'dirty' : 'clean'
  }

  private schedule(delay = this.options.debounceMs ?? 1_000): void {
    if (this.disposed || !this.record || !this.online || this.status.state === 'conflict') return
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      void this.flush()
    }, delay)
    if (!this.maxTimer) {
      this.maxTimer = setTimeout(() => {
        this.maxTimer = null
        void this.flush()
      }, this.options.maxWaitMs ?? 5_000)
    }
  }

  private clearSaveTimers(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    if (this.maxTimer) clearTimeout(this.maxTimer)
    this.debounceTimer = null
    this.maxTimer = null
  }

  private publish(state: ProjectSaveState, error: Error | null): void {
    const record = this.record
    this.status = {
      state,
      baseRevision: record?.baseRevision ?? this.status.baseRevision,
      latestGeneration: record?.latestDraft.generation ?? this.status.latestGeneration,
      savedGeneration: record?.savedGeneration ?? this.status.savedGeneration,
      error,
    }
    for (const listener of this.listeners) listener(this.getStatus())
  }

  private requireRecord(): PersistedProjectDraft {
    if (!this.record) throw new Error('save queue ยังไม่ start')
    return this.record
  }

  private exclusive<T>(operation: () => Promise<T> | T): Promise<T> {
    const result = this.mutationLock.then(operation, operation)
    this.mutationLock = result.then(() => undefined, () => undefined)
    return result
  }
}

function initialRecord(options: DurableSaveQueueOptions): PersistedProjectDraft {
  if (options.initialProject.id !== options.projectId) throw new Error('initial projectId ไม่ตรงกับ save queue')
  assertSidecarScope(options.initialSidecar, options.scope)
  const now = Date.now()
  return {
    version: 1,
    key: projectDraftKey(options.scope, options.projectId, options.clientId),
    scopeKey: projectDraftScopeKey(options.scope),
    scope: { ...options.scope },
    clientId: options.clientId,
    projectId: options.projectId,
    baseRevision: options.initialRevision,
    savedGeneration: 0,
    latestDraft: {
      generation: 0,
      project: structuredClone(options.initialProject),
      sidecar: structuredClone(options.initialSidecar),
      capturedAt: now,
    },
    inFlight: null,
    updatedAt: now,
  }
}

function validateStoredRecord(
  stored: PersistedProjectDraft,
  options: DurableSaveQueueOptions,
): PersistedProjectDraft {
  if (
    stored.version !== 1
    || stored.key !== projectDraftKey(options.scope, options.projectId, options.clientId)
    || stored.scope.appUserId !== options.scope.appUserId
    || stored.scope.workspaceId !== options.scope.workspaceId
    || stored.clientId !== options.clientId
    || stored.projectId !== options.projectId
    || stored.latestDraft.project.id !== options.projectId
  ) throw new Error('draft record ไม่ตรงกับ session/project ปัจจุบัน')
  assertSidecarScope(stored.latestDraft.sidecar, options.scope)
  return structuredClone(stored)
}

function assertSidecarScope(snapshot: AssetSidecarSnapshot, scope: AssetSidecarScope): void {
  if (snapshot.scope.appUserId !== scope.appUserId || snapshot.scope.workspaceId !== scope.workspaceId) {
    throw new Error('draft sidecar อยู่คนละบัญชีหรือ workspace')
  }
}

function classifyFailure(value: unknown, online: boolean): FailureKind {
  if (!online) return 'offline'
  const status = typeof value === 'object' && value !== null && 'status' in value
    ? Number((value as { status: unknown }).status)
    : null
  if (status === 409) return 'conflict'
  if (status === 429 || status === 503) return 'retry'
  if (status === 0) return 'offline'
  if (value instanceof TypeError) return 'retry'
  return 'fatal'
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}
