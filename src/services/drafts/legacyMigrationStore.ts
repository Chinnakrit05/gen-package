import type { Project } from '../../core/project'
import type { AssetSidecarScope, AssetSidecarSnapshot } from '../projects/cloudProjectCodec'

const DATABASE_NAME = 'gen-package-legacy-migrations-v1'
const DATABASE_VERSION = 1
const STORE_NAME = 'migration-journals'

export type LegacyMigrationConsent = 'pending' | 'accepted' | 'declined'
export type LegacyMigrationItemStatus =
  | 'pending'
  | 'uploading'
  | 'importing'
  | 'complete'
  | 'skipped'
  | 'conflict'
  | 'error'

export interface LegacyRawBackup {
  storageKey: string
  raw: string
  sha256: string
  capturedAt: number
}

export interface LegacyMigrationItem {
  sourceProjectKey: string
  sourceHash: string
  operationId: string
  status: LegacyMigrationItemStatus
  project: Project | null
  sidecar: AssetSidecarSnapshot | null
  warnings: string[]
  error: string | null
  targetProjectId: string | null
}

export interface LegacyMigrationJournal {
  version: 1
  key: string
  scope: AssetSidecarScope
  installationId: string
  consent: LegacyMigrationConsent
  rawBackups: LegacyRawBackup[]
  items: LegacyMigrationItem[]
  createdAt: number
  updatedAt: number
}

export interface LegacyMigrationStore {
  get(key: string): Promise<LegacyMigrationJournal | null>
  put(journal: LegacyMigrationJournal): Promise<void>
}

export class IndexedDbLegacyMigrationStore implements LegacyMigrationStore {
  private databasePromise: Promise<IDBDatabase> | null = null

  async get(key: string): Promise<LegacyMigrationJournal | null> {
    const database = await this.database()
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const result = await requestResult<LegacyMigrationJournal | undefined>(transaction.objectStore(STORE_NAME).get(key))
    await transactionDone(transaction)
    return result ? structuredClone(result) : null
  }

  async put(journal: LegacyMigrationJournal): Promise<void> {
    const database = await this.database()
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(structuredClone(journal))
    await transactionDone(transaction)
  }

  private database(): Promise<IDBDatabase> {
    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve, reject) => {
        if (!globalThis.indexedDB) {
          reject(new Error('browser นี้ไม่รองรับ IndexedDB สำหรับ migration journal'))
          return
        }
        const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(STORE_NAME)) {
            request.result.createObjectStore(STORE_NAME, { keyPath: 'key' })
          }
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(new Error('เปิด migration journal ไม่สำเร็จ', { cause: request.error }))
        request.onblocked = () => reject(new Error('migration journal ถูก tab อื่นบล็อก'))
      })
    }
    return this.databasePromise
  }
}

export class MemoryLegacyMigrationStore implements LegacyMigrationStore {
  private readonly records = new Map<string, LegacyMigrationJournal>()

  async get(key: string): Promise<LegacyMigrationJournal | null> {
    const value = this.records.get(key)
    return value ? structuredClone(value) : null
  }

  async put(journal: LegacyMigrationJournal): Promise<void> {
    this.records.set(journal.key, structuredClone(journal))
  }
}

export function legacyMigrationKey(scope: AssetSidecarScope, installationId: string): string {
  return `${scope.appUserId}:${scope.workspaceId}:${installationId}`
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('อ่าน migration journal ไม่สำเร็จ', { cause: request.error }))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(new Error('เขียน migration journal ไม่สำเร็จ', { cause: transaction.error }))
    transaction.onabort = () => reject(new Error('transaction ของ migration journal ถูกยกเลิก', { cause: transaction.error }))
  })
}
