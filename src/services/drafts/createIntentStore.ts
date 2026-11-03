// ที่เก็บ "ความตั้งใจสร้างงาน" ของ /editor/new (ROUTES-PHASE-1.md §7 R2–R3) — IndexedDB แยก database
// จาก draft/journal เดิม เพื่อไม่ต้องขึ้น version ของ store ที่มีอยู่
import type { CloudProject, CreateProjectInput } from '../../../shared/contracts/projects'
import type { Project } from '../../core/project'

const DATABASE_NAME = 'packit-editor-intents'
const DATABASE_VERSION = 1
const STORE_NAME = 'create-intents'
const SCOPE_INDEX = 'scope-key'

export interface CreateIntentScope {
  appUserId: string
  workspaceId: string
}

export type CreateIntentStatus = 'local' | 'sending' | 'created' | 'failed'

export interface CreateIntentRecord {
  version: 1
  key: string
  scopeKey: string
  scope: CreateIntentScope
  intentId: string
  status: CreateIntentStatus
  // ร่างล่าสุดก่อนมี server ID (การแก้หลังตรึง payload ก็ยังเข้าที่นี่)
  latest: { generation: number; project: Project }
  // payload ที่ส่ง POST — ตรึงครั้งเดียว ห้ามเปลี่ยนภายใต้ operationId เดิม
  frozen: { generation: number; operationId: string; payload: CreateProjectInput } | null
  result: CloudProject | null
  error: { code: string; message: string } | null
  createdAt: number
  updatedAt: number
}

export interface CreateIntentStore {
  get(key: string): Promise<CreateIntentRecord | null>
  put(record: CreateIntentRecord): Promise<void>
  delete(key: string): Promise<void>
  list(scope: CreateIntentScope): Promise<CreateIntentRecord[]>
}

// mode อยู่ใน key เผื่อ local-demo ใช้ในอนาคต — ตอนนี้มีแต่ cloud
export function createIntentScopeKey(scope: CreateIntentScope): string {
  return `cloud:${scope.appUserId}:${scope.workspaceId}`
}

export function createIntentKey(scope: CreateIntentScope, intentId: string): string {
  return `${createIntentScopeKey(scope)}:${intentId}`
}

export class IndexedDbCreateIntentStore implements CreateIntentStore {
  private databasePromise: Promise<IDBDatabase> | null = null

  async get(key: string): Promise<CreateIntentRecord | null> {
    const database = await this.database()
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const result = await requestResult<CreateIntentRecord | undefined>(transaction.objectStore(STORE_NAME).get(key))
    await transactionDone(transaction)
    return result ?? null
  }

  async put(record: CreateIntentRecord): Promise<void> {
    const database = await this.database()
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(record)
    await transactionDone(transaction)
  }

  async delete(key: string): Promise<void> {
    const database = await this.database()
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).delete(key)
    await transactionDone(transaction)
  }

  async list(scope: CreateIntentScope): Promise<CreateIntentRecord[]> {
    const database = await this.database()
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const result = await requestResult<CreateIntentRecord[]>(
      transaction.objectStore(STORE_NAME).index(SCOPE_INDEX).getAll(createIntentScopeKey(scope)),
    )
    await transactionDone(transaction)
    return result.sort((left, right) => right.updatedAt - left.updatedAt)
  }

  private database(): Promise<IDBDatabase> {
    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve, reject) => {
        if (!globalThis.indexedDB) {
          reject(new Error('browser นี้ไม่รองรับ IndexedDB สำหรับงานใหม่ที่ยังไม่ส่ง'))
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
        request.onerror = () => reject(new Error('เปิดที่เก็บงานใหม่ไม่สำเร็จ', { cause: request.error }))
        request.onblocked = () => reject(new Error('ที่เก็บงานใหม่ถูก tab อื่นบล็อก'))
      })
    }
    return this.databasePromise
  }
}

export class MemoryCreateIntentStore implements CreateIntentStore {
  private readonly records = new Map<string, CreateIntentRecord>()
  failPut: Error | null = null

  async get(key: string): Promise<CreateIntentRecord | null> {
    const record = this.records.get(key)
    return record ? structuredClone(record) : null
  }

  async put(record: CreateIntentRecord): Promise<void> {
    if (this.failPut) throw this.failPut
    this.records.set(record.key, structuredClone(record))
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key)
  }

  async list(scope: CreateIntentScope): Promise<CreateIntentRecord[]> {
    const scopeKey = createIntentScopeKey(scope)
    return [...this.records.values()]
      .filter((record) => record.scopeKey === scopeKey)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((record) => structuredClone(record))
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('อ่าน/เขียนที่เก็บงานใหม่ไม่สำเร็จ', { cause: request.error }))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(new Error('เขียนที่เก็บงานใหม่ไม่สำเร็จ', { cause: transaction.error }))
    transaction.onabort = () => reject(new Error('transaction ของที่เก็บงานใหม่ถูกยกเลิก', { cause: transaction.error }))
  })
}
