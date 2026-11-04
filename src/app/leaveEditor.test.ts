import { describe, expect, it } from 'vitest'
import { leaveEditor, type LeaveSaveStatus } from './leaveEditor'

function harness(initial: LeaveSaveStatus, options: { flushTo?: LeaveSaveStatus; captureError?: Error; latest?: string | null } = {}) {
  let status: LeaveSaveStatus | null = { ...initial }
  const captured: string[] = []
  let flushed = 0
  return {
    captured,
    flushed: () => flushed,
    deps: {
      latest: () => (options.latest === undefined ? 'แก้ล่าสุด' : options.latest),
      capture: async (project: string) => {
        if (options.captureError) throw options.captureError
        captured.push(project)
        // capture สร้าง generation ใหม่ แม้ก่อนกดจะ clean
        if (status) status = { ...status, state: status.state === 'clean' ? 'dirty' : status.state, latestGeneration: status.latestGeneration + 1 }
      },
      status: () => status,
      flush: async () => {
        flushed += 1
        if (options.flushTo) status = { ...options.flushTo }
      },
      timeoutMs: 20,
    },
    setStatus: (next: LeaveSaveStatus | null) => { status = next },
  }
}

describe('leaveEditor', () => {
  it('clean ก่อนกด แต่มีการแก้ใน debounce → capture แล้วต้อง flush ไม่ถือว่า synced ทันที', async () => {
    const h = harness({ state: 'clean', latestGeneration: 3, savedGeneration: 3 }, {
      flushTo: { state: 'clean', latestGeneration: 4, savedGeneration: 4 },
    })
    expect(await leaveEditor(h.deps)).toEqual({ kind: 'synced' })
    expect(h.captured).toEqual(['แก้ล่าสุด'])
    expect(h.flushed()).toBe(1)
  })

  it('flush resolve แต่ server ยังไม่ยืนยัน generation ล่าสุด → local ไม่ใช่ synced', async () => {
    const h = harness({ state: 'dirty', latestGeneration: 5, savedGeneration: 4 }, {
      flushTo: { state: 'error', latestGeneration: 6, savedGeneration: 4 },
    })
    expect(await leaveEditor(h.deps)).toEqual({ kind: 'local' })
  })

  it('capture ล้ม → capture-failed และไม่ flush', async () => {
    const h = harness({ state: 'dirty', latestGeneration: 1, savedGeneration: 0 }, { captureError: new Error('QuotaExceededError') })
    const outcome = await leaveEditor(h.deps)
    expect(outcome.kind).toBe('capture-failed')
    expect(h.flushed()).toBe(0)
  })

  it('offline → local ทันทีโดยไม่รอ flush', async () => {
    const h = harness({ state: 'offline', latestGeneration: 2, savedGeneration: 1 })
    expect(await leaveEditor(h.deps)).toEqual({ kind: 'local' })
    expect(h.flushed()).toBe(0)
  })

  it('conflict → ถามผู้ใช้ ไม่เขียนทับ', async () => {
    const h = harness({ state: 'conflict', latestGeneration: 2, savedGeneration: 1 })
    expect(await leaveEditor(h.deps)).toEqual({ kind: 'conflict' })
  })

  it('flush ค้างเกิน timeout → local', async () => {
    const h = harness({ state: 'saving', latestGeneration: 2, savedGeneration: 1 })
    h.deps.flush = () => new Promise(() => undefined)
    expect(await leaveEditor(h.deps)).toEqual({ kind: 'local' })
  })

  it('งานใหม่ที่ยังไม่มี server ID (ไม่มี save queue) → local หลัง capture ลง intent', async () => {
    const h = harness({ state: 'clean', latestGeneration: 0, savedGeneration: 0 })
    h.setStatus(null)
    expect(await leaveEditor(h.deps)).toEqual({ kind: 'local' })
    expect(h.captured).toHaveLength(1)
  })
})
