import { afterEach, describe, expect, it, vi } from 'vitest'
import { getRequestPreview } from '../../services/api/commerce'
import { referencePreviewNotice } from './RequestPreview'
afterEach(() => vi.unstubAllGlobals())
describe('scoped immutable reference previews', () => {
  it.each([
    [{ requestId:'request/a', revisionId:'revision/b' }, '/marketplace/requests/request%2Fa/revisions/revision%2Fb/preview'],
    [{ requestId:'request', revisionId:'revision', supplierId:'supplier/a' }, '/suppliers/supplier%2Fa/quote-requests/request/revisions/revision/preview'],
    [{ orderId:'order/a' }, '/marketplace/production-orders/order%2Fa/preview'],
  ])('uses exact scope and forwards cancellation', async (target, path) => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ data: { preview:null } }), {status:200}))
    vi.stubGlobal('fetch',fetcher)
    const controller = new AbortController()
    await expect(getRequestPreview('/api/v1','token',target,controller.signal)).resolves.toEqual({preview:null})
    expect(fetcher.mock.calls[0][0]).toBe(`/api/v1${path}`)
    expect(fetcher.mock.calls[0][1].signal).toBe(controller.signal)
    expect(new Headers(fetcher.mock.calls[0][1].headers).get('authorization')).toBe('Bearer token')
  })
  it('explicitly states initial reference is unverified and revised reference is original', () => {
    expect(referencePreviewNotice('unverified_reference')).toContain('ยังไม่สามารถยืนยัน')
    expect(referencePreviewNotice('original_reference')).toContain('คำขอฉบับเดิม')
    expect(referencePreviewNotice('original_reference')).toContain('ไม่ใช่ภาพที่ยืนยัน')
  })
  it('does not replace denied preview with another route or public image', async () => {
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({error:{code:'FORBIDDEN',message:'denied'}}),{status:403}))
    vi.stubGlobal('fetch',fetcher)
    await expect(getRequestPreview('/api/v1','token',{orderId:'o'})).rejects.toMatchObject({status:403})
    expect(fetcher).toHaveBeenCalledOnce()
  })
})
