import type { SaveProjectInput } from '../../../shared/contracts/projects'
import type { Project } from '../../core/project'
import type { AssetSidecarSnapshot, AssetSidecarScope } from '../projects/cloudProjectCodec'

const DATABASE_NAME = 'gen-package-cloud-v1'
const DATABASE_VERSION = 1
const STORE_NAME = 'project-drafts'
const SCOPE_INDEX = 'scope-key'

export interface ProjectDraftSnapshot {
  generation: number
  project: Project
  sidecar: AssetSidecarSnapshot
  capturedAt: number
}

export interface PersistedSaveMutation {
  generation: number
  operationId: string
  input: SaveProjectInput
  attempts: number
}

export interface PersistedProjectDraft {
  version: 1
  key: string
  scopeKey: string
  scope: AssetSidecarScope
  clientId: string
  projectId: string
  baseRevision: number
  savedGeneration: number
  latestDraft: ProjectDraftSnapshot
  inFlight: PersistedSaveMutation | null
  updatedAt: number
}

export interface ProjectDraftStore {
  get(key: string): Promise<PersistedProjectDraft | null>
  put(record: PersistedProjectDraft): Promise<void>
  delete(key: string): Promise<void>
  list(scope: AssetSidecarScope): Promise<PersistedProjectDraft[]>
}

export class DraftPersistenceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DraftPersistenceError'
  }
}

export class IndexedDbProjectDraftStore implements ProjectDraftStore {
  private databasePromise: Promise<IDBDatabase> | null = null

  async get(key: string): Promise<PersistedProjectDraft | null> {
    const database = await this.database()
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const result = await requestResult<PersistedProjectDraft | undefined>(
      transaction.objectStore(STORE_NAME).get(key),
      'อ่าน draft จาก IndexedDB ไม่สำเร็จ',
    )
    await transactionDone(transaction)
    return result ? structuredClone(result) : null
  }

  async put(record: PersistedProjectDraft): Promise<void> {
    const database = await this.database()
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(structuredClone(record))
    await transactionDone(transaction)
  }

  async delete(key: string): Promise<void> {
    const database = await this.database()
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).delete(key)
    await transactionDone(transaction)
  }

  async list(scope: AssetSidecarScope): Promise<PersistedProjectDraft[]> {
    const database = await this.database()
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const index = transaction.objectStore(STORE_NAME).index(SCOPE_INDEX)
    const result = await requestResult<PersistedProjectDraft[]>(
      index.getAll(projectDraftScopeKey(scope)),
      'อ่านรายการ draft จาก IndexedDB ไม่สำเร็จ',
    )
    await transactionDone(transaction)
    return result.map((record) => structuredClone(record))
  }

  private database(): Promise<IDBDatabase> {
    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve, reject) => {
        if (!globalThis.indexedDB) {
          reject(new DraftPersistenceError('browser นี้ไม่รองรับ IndexedDB'))
          return
        }
        const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
        request.onupgradeneeded = () => {
          const database = request.result
          const store = database.objectStoreNames.contains(STORE_NAME)
            ? request.transaction!.objectStore(STORE_NAME)
            : database.createObjectStore(STORE_NAME, { keyPath: 'key' })
          if (!store.indexNames.contains(SCOPE_INDEX)) store.createIndex(SCOPE_INDEX, 'scopeKey')
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(new DraftPersistenceError('เปิด IndexedDB ไม่สำเร็จ', { cause: request.error }))
        request.onblocked = () => reject(new DraftPersistenceError('IndexedDB ถูก tab อื่นบล็อกการอัปเกรด'))
      })
    }
    return this.databasePromise
  }
}

export class MemoryProjectDraftStore implements ProjectDraftStore {
  private readonly records = new Map<string, PersistedProjectDraft>()

  async get(key: string): Promise<PersistedProjectDraft | null> {
    const record = this.records.get(key)
    return record ? structuredClone(record) : null
  }

  async put(record: PersistedProjectDraft): Promise<void> {
    this.records.set(record.key, structuredClone(record))
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key)
  }

  async list(scope: AssetSidecarScope): Promise<PersistedProjectDraft[]> {
    const scopeKey = projectDraftScopeKey(scope)
    return [...this.records.values()]
      .filter((record) => record.scopeKey === scopeKey)
      .map((record) => structuredClone(record))
  }
}

export function projectDraftScopeKey(scope: AssetSidecarScope): string {
  return `${scope.appUserId}:${scope.workspaceId}`
}

export function projectDraftKey(scope: AssetSidecarScope, projectId: string, clientId: string): string {
  return `${projectDraftScopeKey(scope)}:${projectId}:${clientId}`
}

export function getCloudDraftClientId(): string {
  const key = 'gen-package-cloud-client-v1'
  const created = crypto.randomUUID()
  try {
    const existing = sessionStorage.getItem(key)
    if (existing) return existing
    sessionStorage.setItem(key, created)
  } catch {
    // Privacy modes may disable sessionStorage; a per-page ID still prevents cross-tab clobbering.
  }
  return created
}

function requestResult<T>(request: IDBRequest<T>, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new DraftPersistenceError(message, { cause: request.error }))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(new DraftPersistenceError('เขียน IndexedDB ไม่สำเร็จ', { cause: transaction.error }))
    transaction.onabort = () => reject(new DraftPersistenceError('transaction ของ IndexedDB ถูกยกเลิก', { cause: transaction.error }))
  })
}
