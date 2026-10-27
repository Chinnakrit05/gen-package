// แคชภาพย่อ 3D ของงาน (แกลเลอรี) ในเบราว์เซอร์ — IndexedDB แยกจากข้อมูลงาน (localStorage ของ local demo เต็มเร็ว)
// cloud ใช้เป็นแคชตาม version ของ server: เปิดแกลเลอรีซ้ำไม่ต้องโหลดรูปเดิมอีก ขอเฉพาะที่ version เปลี่ยน
import type { ThumbnailKind } from '../../../shared/contracts/projects'

export interface ThumbRecord {
  key: string // `${scope}:${projectId}`
  scope: string // 'local' | workspaceId
  projectId: string
  version: string // cloud = version จาก server; local = updatedAt ของงานตอนถ่าย
  sourceUpdatedAt?: number // updatedAt ของงานตอนถ่ายบนเครื่องนี้ (ไม่รู้ = โหลดมาจาก cloud)
  blob: Blob
  kind?: ThumbnailKind
  label?: string
}

export interface ThumbStore {
  getMany(keys: string[]): Promise<ThumbRecord[]>
  put(record: ThumbRecord): Promise<void>
  delete(key: string): Promise<void>
}

const DATABASE_NAME = 'packit-thumbnails'
const DATABASE_VERSION = 1
const STORE_NAME = 'thumbnails'

export const thumbKey = (scope: string, projectId: string) => `${scope}:${projectId}`

export class IndexedDbThumbStore implements ThumbStore {
  private databasePromise: Promise<IDBDatabase> | null = null

  async getMany(keys: string[]): Promise<ThumbRecord[]> {
    const database = await this.database()
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const found = await Promise.all(
      keys.map((key) => requestResult<ThumbRecord | undefined>(store.get(key))),
    )
    return found.filter((record): record is ThumbRecord => !!record)
  }

  async put(record: ThumbRecord): Promise<void> {
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

  private database(): Promise<IDBDatabase> {
    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve, reject) => {
        if (!globalThis.indexedDB) {
          reject(new Error('browser นี้ไม่รองรับ IndexedDB สำหรับภาพย่อ'))
          return
        }
        const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(STORE_NAME)) {
            request.result.createObjectStore(STORE_NAME, { keyPath: 'key' })
          }
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(new Error('เปิดแคชภาพย่อไม่สำเร็จ', { cause: request.error }))
        request.onblocked = () => reject(new Error('แคชภาพย่อถูก tab อื่นบล็อก'))
      })
    }
    return this.databasePromise
  }
}

export class MemoryThumbStore implements ThumbStore {
  private readonly records = new Map<string, ThumbRecord>()
  async getMany(keys: string[]): Promise<ThumbRecord[]> {
    return keys.flatMap((key) => (this.records.has(key) ? [this.records.get(key)!] : []))
  }
  async put(record: ThumbRecord): Promise<void> {
    this.records.set(record.key, record)
  }
  async delete(key: string): Promise<void> {
    this.records.delete(key)
  }
}

// ภาพย่อที่โหลดแล้วในหน้านี้ + object URL ให้ <img> — แจ้งผู้ฟังเมื่อมีรูปใหม่ (useSyncExternalStore)
export class ThumbnailCache {
  private readonly records = new Map<string, ThumbRecord>()
  private readonly urls = new Map<string, string>()
  private readonly loaded = new Set<string>()
  private readonly listeners = new Set<() => void>()
  private tick = 0

  constructor(
    readonly scope: string,
    private readonly store: ThumbStore | null,
  ) {}

  record(projectId: string): ThumbRecord | undefined {
    return this.records.get(projectId)
  }

  url(projectId: string): string | undefined {
    const record = this.records.get(projectId)
    if (!record) return undefined
    let url = this.urls.get(projectId)
    if (!url) {
      url = URL.createObjectURL(record.blob)
      this.urls.set(projectId, url)
    }
    return url
  }

  version = () => this.tick

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // อ่านจากแคชถาวรเฉพาะ id ที่ยังไม่เคยอ่านในหน้านี้ (อ่านไม่ได้ = ไม่มีภาพย่อ แสดงไอคอนแทน)
  async load(projectIds: readonly string[]): Promise<void> {
    const pending = projectIds.filter((id) => !this.loaded.has(id))
    if (!pending.length || !this.store) return
    pending.forEach((id) => this.loaded.add(id))
    let found: ThumbRecord[] = []
    try {
      found = await this.store.getMany(pending.map((id) => thumbKey(this.scope, id)))
    } catch {
      return
    }
    let changed = false
    for (const record of found) {
      if (this.records.has(record.projectId)) continue // ถ่าย/โหลดใหม่ระหว่างรอ — อันใหม่กว่า
      this.records.set(record.projectId, record)
      changed = true
    }
    if (changed) this.emit()
  }

  async save(record: Omit<ThumbRecord, 'key' | 'scope'>): Promise<void> {
    const full: ThumbRecord = { ...record, key: thumbKey(this.scope, record.projectId), scope: this.scope }
    this.records.set(record.projectId, full)
    this.loaded.add(record.projectId)
    const old = this.urls.get(record.projectId)
    if (old) URL.revokeObjectURL(old)
    this.urls.delete(record.projectId)
    this.emit()
    try {
      await this.store?.put(full)
    } catch {
      // แคชถาวรเต็ม/ปิดไว้ — ยังแสดงในหน้านี้ได้
    }
  }

  async remove(projectId: string): Promise<void> {
    this.records.delete(projectId)
    const old = this.urls.get(projectId)
    if (old) URL.revokeObjectURL(old)
    this.urls.delete(projectId)
    this.emit()
    try {
      await this.store?.delete(thumbKey(this.scope, projectId))
    } catch {
      // ไม่มีผลต่อการทำงาน
    }
  }

  dispose(): void {
    for (const url of this.urls.values()) URL.revokeObjectURL(url)
    this.urls.clear()
    this.listeners.clear()
  }

  private emit(): void {
    this.tick++
    for (const listener of this.listeners) listener()
  }
}

// รูปภาพย่อ ↔ base64 (API ส่งเป็น JSON)
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('อ่านแคชภาพย่อไม่สำเร็จ', { cause: request.error }))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(new Error('เขียนแคชภาพย่อไม่สำเร็จ', { cause: transaction.error }))
    transaction.onabort = () => reject(new Error('transaction ของแคชภาพย่อถูกยกเลิก', { cause: transaction.error }))
  })
}
