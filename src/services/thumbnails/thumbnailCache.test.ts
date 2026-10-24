import { describe, expect, it } from 'vitest'
import { MemoryThumbStore, ThumbnailCache, base64ToBlob, blobToBase64, thumbKey } from './thumbnailCache'

// แคชภาพย่อแกลเลอรีในเบราว์เซอร์: เก็บ/อ่านตาม scope, แจ้งผู้ฟัง, object URL ใหม่เมื่อรูปเปลี่ยน
describe('ThumbnailCache', () => {
  const blob = (s: string) => new Blob([s], { type: 'image/webp' })

  it('save → มี url + แจ้งผู้ฟัง + เขียนแคชถาวรตาม scope; รูปใหม่ได้ url ใหม่', async () => {
    const store = new MemoryThumbStore()
    const cache = new ThumbnailCache('ws-1', store)
    let ticks = 0
    cache.subscribe(() => ticks++)
    await cache.save({ projectId: 'p1', version: 'v1', blob: blob('a') })
    const first = cache.url('p1')
    expect(first).toMatch(/^blob:/)
    expect(ticks).toBe(1)
    expect((await store.getMany([thumbKey('ws-1', 'p1')]))[0].version).toBe('v1')
    await cache.save({ projectId: 'p1', version: 'v2', blob: blob('b') })
    expect(cache.url('p1')).not.toBe(first)
    expect(cache.record('p1')?.version).toBe('v2')
    cache.dispose()
  })

  it('load อ่านจากแคชถาวรเฉพาะ scope ตัวเอง และไม่ทับรูปที่บันทึกใหม่ระหว่างรอ', async () => {
    const store = new MemoryThumbStore()
    await new ThumbnailCache('local', store).save({ projectId: 'p1', version: 'old', blob: blob('x') })
    await new ThumbnailCache('ws-2', store).save({ projectId: 'p2', version: 'cloud', blob: blob('y') })
    const cache = new ThumbnailCache('local', store)
    await cache.load(['p1', 'p2'])
    expect(cache.record('p1')?.version).toBe('old')
    expect(cache.record('p2')).toBeUndefined()

    const racing = new ThumbnailCache('local', store)
    const pending = racing.load(['p1'])
    await racing.save({ projectId: 'p1', version: 'fresh', blob: blob('z') })
    await pending
    expect(racing.record('p1')?.version).toBe('fresh')
  })

  it('base64 ↔ Blob ไปกลับได้ไบต์เดิม', async () => {
    const bytes = new Uint8Array(70_000).map((_, i) => (i * 31) % 256)
    const b64 = await blobToBase64(new Blob([bytes]))
    const back = new Uint8Array(await base64ToBlob(b64, 'image/webp').arrayBuffer())
    expect(back).toEqual(bytes)
  })
})
