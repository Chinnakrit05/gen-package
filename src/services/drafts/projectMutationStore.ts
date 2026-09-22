import type {
  CreateProjectInput,
  DeleteProjectInput,
} from '../../../shared/contracts/projects'
import type { AssetSidecarScope } from '../projects/cloudProjectCodec'

const DATABASE_NAME = 'gen-package-project-mutations-v1'
const DATABASE_VERSION = 1
const STORE_NAME = 'project-mutations'
const SCOPE_INDEX = 'scope-key'

interface ProjectMutationBase {
  version: 1
  key: string
  scopeKey: string
  scope: AssetSidecarScope
  operationId: string
  attempts: number
  createdAt: number
  updatedAt: number
}

export interface PersistedCreateProjectMutation extends ProjectMutationBase {
  kind: 'create'
  input: CreateProjectInput
}

export interface PersistedDeleteProjectMutation extends ProjectMutationBase {
  kind: 'delete'
  input: DeleteProjectInput
}

export type PersistedProjectMutation = PersistedCreateProjectMutation | PersistedDeleteProjectMutation

export interface ProjectMutationStore {
  get(key: string): Promise<PersistedProjectMutation | null>
  put(record: PersistedProjectMutation): Promise<void>
  delete(key: string): Promise<void>
  list(scope: AssetSidecarScope): Promise<PersistedProjectMutation[]>
}

export class IndexedDbProjectMutationStore implements ProjectMutationStore {
  private databasePromise: Promise<IDBDatabase> | null = null

  async get(key: string): Promise<PersistedProjectMutation | null> {
    const database = await this.database()
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const result = await requestResult<PersistedProjectMutation | undefined>(transaction.objectStore(STORE_NAME).get(key))
    await transactionDone(transaction)
    return result ? structuredClone(result) : null
  }

  async put(record: PersistedProjectMutation): Promise<void> {
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

  async list(scope: AssetSidecarScope): Promise<PersistedProjectMutation[]> {
    const database = await this.database()
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const result = await requestResult<PersistedProjectMutation[]>(
      transaction.objectStore(STORE_NAME).index(SCOPE_INDEX).getAll(projectMutationScopeKey(scope)),
    )
    await transactionDone(transaction)
    return result
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((record) => structuredClone(record))
  }

  private database(): Promise<IDBDatabase> {
    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve, reject) => {
        if (!globalThis.indexedDB) {
          reject(new Error('browser นี้ไม่รองรับ IndexedDB สำหรับ project mutation journal'))
          return
        }
        const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
        request.onupgradeneeded = () => {
          const store = request.result.objectStoreNames.contains(STORE_NAME)
            ? request.transaction!.objectStore(STORE_NAME)
            : request.result.createObjectStore(STORE_NAME, { keyPath: 'key' })
          if (!store.indexNames.contains(SCOPE_INDEX)) store.createIndex(SCOPE_INDEX, 'scopeKey')
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(new Error('เปิด project mutation journal ไม่สำเร็จ', { cause: request.error }))
        request.onblocked = () => reject(new Error('project mutation journal ถูก tab อื่นบล็อก'))
      })
    }
    return this.databasePromise
  }
}

export class MemoryProjectMutationStore implements ProjectMutationStore {
  private readonly records = new Map<string, PersistedProjectMutation>()

  async get(key: string): Promise<PersistedProjectMutation | null> {
    const record = this.records.get(key)
    return record ? structuredClone(record) : null
  }

  async put(record: PersistedProjectMutation): Promise<void> {
    this.records.set(record.key, structuredClone(record))
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key)
  }

  async list(scope: AssetSidecarScope): Promise<PersistedProjectMutation[]> {
    const scopeKey = projectMutationScopeKey(scope)
    return [...this.records.values()]
      .filter((record) => record.scopeKey === scopeKey)
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((record) => structuredClone(record))
  }
}

export function projectMutationScopeKey(scope: AssetSidecarScope): string {
  return `${scope.appUserId}:${scope.workspaceId}`
}

export function projectMutationKey(scope: AssetSidecarScope, operationId: string): string {
  return `${projectMutationScopeKey(scope)}:${operationId}`
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('อ่าน project mutation journal ไม่สำเร็จ', { cause: request.error }))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(new Error('เขียน project mutation journal ไม่สำเร็จ', { cause: transaction.error }))
    transaction.onabort = () => reject(new Error('transaction ของ project mutation journal ถูกยกเลิก', { cause: transaction.error }))
  })
}
