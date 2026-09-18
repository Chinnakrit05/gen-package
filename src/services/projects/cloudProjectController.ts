import type { CloudProject, SaveProjectInput, SaveReceipt } from '../../../shared/contracts/projects'
import { parseProject, type Project } from '../../core/project'
import type { ProjectDraftStore } from '../drafts/projectDraftStore'
import { projectDraftKey } from '../drafts/projectDraftStore'
import {
  ProjectAssetSidecar,
  dehydrateProject,
  hydrateProject,
  type AssetSidecarScope,
  type ProjectAssetTransfer,
} from './cloudProjectCodec'
import {
  DurableProjectSaveQueue,
  type ProjectSaveStatus,
} from './durableSaveQueue'

export type CloudProjectControllerState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; project: Project; save: ProjectSaveStatus }
  | { status: 'error'; error: Error }

export interface CloudProjectControllerOptions {
  scope: AssetSidecarScope
  clientId: string
  store: ProjectDraftStore
  transfer: ProjectAssetTransfer
  save(input: SaveProjectInput, signal?: AbortSignal): Promise<SaveReceipt>
  isOnline?: () => boolean
  debounceMs?: number
  maxWaitMs?: number
}

type Listener = (state: CloudProjectControllerState) => void

/** Owns one active cloud project at a time. App/UI bindings remain deliberately thin. */
export class CloudProjectController {
  private state: CloudProjectControllerState = { status: 'idle' }
  private readonly listeners = new Set<Listener>()
  private queue: DurableProjectSaveQueue | null = null
  private sidecar: ProjectAssetSidecar | null = null
  private abortController: AbortController | null = null
  private epoch = 0
  private unsubscribeQueue: (() => void) | null = null

  constructor(private readonly options: CloudProjectControllerOptions) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.getState())
    return () => this.listeners.delete(listener)
  }

  getState(): CloudProjectControllerState {
    return this.state.status === 'ready'
      ? { status: 'ready', project: structuredClone(this.state.project), save: { ...this.state.save } }
      : this.state
  }

  async open(cloudProject: CloudProject): Promise<Project> {
    this.stopActive()
    const epoch = ++this.epoch
    const abortController = new AbortController()
    this.abortController = abortController
    this.publish({ status: 'loading' })

    try {
      const draftKey = projectDraftKey(this.options.scope, cloudProject.id, this.options.clientId)
      const persisted = await this.options.store.get(draftKey)
      const hasPendingDraft = persisted !== null
        && (persisted.inFlight !== null || persisted.savedGeneration < persisted.latestDraft.generation)
      const online = this.options.isOnline?.()
        ?? (typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean' ? true : navigator.onLine)
      const usePersistedDraft = persisted !== null && (hasPendingDraft || !online)

      let initialProject: Project
      let sidecar: ProjectAssetSidecar
      if (usePersistedDraft) {
        sidecar = new ProjectAssetSidecar(this.options.scope, persisted.latestDraft.sidecar)
        initialProject = validateDraftProject(persisted.latestDraft.project, cloudProject.id)
      } else {
        sidecar = new ProjectAssetSidecar(this.options.scope)
        initialProject = await hydrateProject({
          cloudProject,
          sidecar,
          transfer: this.options.transfer,
          signal: abortController.signal,
        })
      }
      if (this.epoch !== epoch || abortController.signal.aborted) throw new DOMException('stale project open', 'AbortError')

      const queue = new DurableProjectSaveQueue({
        scope: this.options.scope,
        clientId: this.options.clientId,
        projectId: cloudProject.id,
        initialRevision: cloudProject.revision,
        initialProject,
        initialSidecar: sidecar.snapshot(),
        store: this.options.store,
        isOnline: this.options.isOnline,
        debounceMs: this.options.debounceMs,
        maxWaitMs: this.options.maxWaitMs,
        prepare: async (draft) => {
          const draftSidecar = new ProjectAssetSidecar(this.options.scope, draft.sidecar)
          const dehydrated = await dehydrateProject({
            project: draft.project,
            workspaceId: this.options.scope.workspaceId,
            sidecar: draftSidecar,
            transfer: this.options.transfer,
            signal: abortController.signal,
          })
          if (this.epoch === epoch && !abortController.signal.aborted) this.sidecar = draftSidecar
          return {
            name: dehydrated.name,
            documentSchemaVersion: 1,
            document: dehydrated.document,
            sidecar: draftSidecar.snapshot(),
          }
        },
        save: (input) => this.options.save(input, abortController.signal),
      })
      this.queue = queue
      this.sidecar = sidecar
      const started = await queue.start()
      if (this.epoch !== epoch || abortController.signal.aborted) throw new DOMException('stale project open', 'AbortError')
      initialProject = started.draft.project
      this.sidecar = new ProjectAssetSidecar(this.options.scope, started.draft.sidecar)
      this.unsubscribeQueue = queue.subscribe((save) => {
        if (this.epoch !== epoch || this.state.status !== 'ready') return
        this.publish({ status: 'ready', project: this.state.project, save })
      })
      this.publish({ status: 'ready', project: initialProject, save: queue.getStatus() })
      return structuredClone(initialProject)
    } catch (value) {
      const error = toError(value)
      if (this.epoch === epoch && !abortController.signal.aborted) this.publish({ status: 'error', error })
      throw error
    }
  }

  async capture(project: Project): Promise<void> {
    const queue = this.requireQueue(project.id)
    if (this.state.status === 'ready' && JSON.stringify(this.state.project) === JSON.stringify(project)) return
    const sidecar = this.sidecar
    if (!sidecar) throw new Error('project sidecar ยังไม่พร้อม')
    await queue.capture(project, sidecar.snapshot())
    if (this.state.status === 'ready' && this.state.project.id === project.id) {
      this.publish({ status: 'ready', project: structuredClone(project), save: queue.getStatus() })
    }
  }

  async switchProject(currentProject: Project, nextCloudProject: CloudProject): Promise<Project> {
    await this.capture(currentProject)
    return this.open(nextCloudProject)
  }

  flush(): Promise<void> {
    return this.queue?.flush() ?? Promise.resolve()
  }

  retry(): Promise<void> {
    return this.queue?.retry() ?? Promise.resolve()
  }

  setOnline(online: boolean): void {
    this.queue?.setOnline(online)
  }

  async discardDraft(): Promise<void> {
    if (this.state.status !== 'ready') throw new Error('ไม่มี draft ที่เปิดอยู่')
    const projectId = this.state.project.id
    this.epoch += 1
    this.stopActive()
    await this.options.store.delete(projectDraftKey(this.options.scope, projectId, this.options.clientId))
    this.publish({ status: 'idle' })
  }

  dispose(): void {
    this.epoch += 1
    this.stopActive()
    this.listeners.clear()
    this.state = { status: 'idle' }
  }

  private requireQueue(projectId: string): DurableProjectSaveQueue {
    if (!this.queue || this.state.status !== 'ready' || this.state.project.id !== projectId) {
      throw new Error('project ไม่ใช่งานที่ controller เปิดอยู่')
    }
    return this.queue
  }

  private stopActive(): void {
    this.unsubscribeQueue?.()
    this.unsubscribeQueue = null
    this.queue?.dispose()
    this.queue = null
    this.sidecar = null
    this.abortController?.abort()
    this.abortController = null
  }

  private publish(state: CloudProjectControllerState): void {
    this.state = state
    for (const listener of this.listeners) listener(this.getState())
  }
}

function validateDraftProject(project: Project, projectId: string): Project {
  const parsed = parseProject(project, 0)
  if (!parsed || parsed.id !== projectId || parsed.decos.length !== project.decos.length) {
    throw new Error('draft project เสียหายหรือไม่ตรงกับ cloud project')
  }
  return parsed
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}
