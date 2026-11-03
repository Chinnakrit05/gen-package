// ลำดับออกจาก Editor ชุดเดียวทุกทางออก (ROUTES-PHASE-1.md §7 R4): flush debounce ของ App → await capture
// (ล้ม = หยุด ไม่ออกเอง) → อ่าน status หลัง capture → flush ≤ timeout → อ่านซ้ำ
// "synced" เฉพาะ state clean และ savedGeneration ≥ latestGeneration — flush() resolve เฉย ๆ ไม่นับ

export interface LeaveSaveStatus {
  state: 'loading' | 'clean' | 'dirty' | 'saving' | 'offline' | 'conflict' | 'error'
  latestGeneration: number
  savedGeneration: number
}

export type LeaveOutcome =
  | { kind: 'synced' }
  | { kind: 'local' } // ร่างอยู่ในเครื่องแล้ว ยังไม่ได้รับการยืนยันจาก server
  | { kind: 'conflict' }
  | { kind: 'capture-failed'; error: Error }

export interface LeaveDeps<P> {
  latest(): P | null
  capture(project: P): Promise<unknown>
  // null = ยังไม่มี save queue (งานใหม่ที่ยังไม่มี server ID) — ร่างอยู่ใน intent
  status(): LeaveSaveStatus | null
  flush(): Promise<void>
  timeoutMs?: number
}

export const LEAVE_FLUSH_TIMEOUT_MS = 3000

export async function leaveEditor<P>(deps: LeaveDeps<P>): Promise<LeaveOutcome> {
  const latest = deps.latest()
  if (latest) {
    try {
      await deps.capture(latest)
    } catch (error) {
      return { kind: 'capture-failed', error: error instanceof Error ? error : new Error(String(error)) }
    }
  }
  const before = deps.status()
  if (!before) return { kind: 'local' }
  if (before.state === 'conflict') return { kind: 'conflict' }
  if (isSynced(before)) return { kind: 'synced' }
  if (before.state === 'offline') return { kind: 'local' }
  await Promise.race([
    deps.flush().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, deps.timeoutMs ?? LEAVE_FLUSH_TIMEOUT_MS)),
  ])
  const after = deps.status()
  if (!after) return { kind: 'local' }
  if (after.state === 'conflict') return { kind: 'conflict' }
  return isSynced(after) ? { kind: 'synced' } : { kind: 'local' }
}

export function isSynced(status: LeaveSaveStatus): boolean {
  return status.state === 'clean' && status.savedGeneration >= status.latestGeneration
}
