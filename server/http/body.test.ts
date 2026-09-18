import { describe, expect, it } from 'vitest'
import { MAX_JSON_BODY_BYTES, readJsonBody } from './body'

describe('readJsonBody', () => {
  it('parses platform-provided strings and raw streams', async () => {
    await expect(readJsonBody({ method: 'POST', url: '/', headers: {}, body: '{"ok":true}' }))
      .resolves.toEqual({ ok: true })

    async function* raw() {
      yield Buffer.from('{"source":')
      yield Buffer.from('"stream"}')
    }
    await expect(readJsonBody({ method: 'POST', url: '/', headers: {}, raw: raw() }))
      .resolves.toEqual({ source: 'stream' })
  })

  it('applies the same 1 MiB limit to parsed bodies and streams', async () => {
    const oversized = { value: 'x'.repeat(MAX_JSON_BODY_BYTES) }
    await expect(readJsonBody({ method: 'POST', url: '/', headers: {}, body: oversized }))
      .rejects.toMatchObject({ status: 413, code: 'BODY_TOO_LARGE' })

    async function* raw() {
      yield Buffer.alloc(MAX_JSON_BODY_BYTES + 1)
    }
    await expect(readJsonBody({ method: 'POST', url: '/', headers: {}, raw: raw() }))
      .rejects.toMatchObject({ status: 413, code: 'BODY_TOO_LARGE' })
  })
})
