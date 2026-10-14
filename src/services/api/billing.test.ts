import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Entitlements, Order } from '../../../shared/contracts/billing'
import { ApiClientError } from './client'
import { authorizeExport, createOrder, devFulfilOrder, getEntitlements } from './billing'

afterEach(() => vi.unstubAllGlobals())

const entitlements: Entitlements = {
  workspaceId: 'space',
  plan: 'free',
  proUntil: null,
  credits: 0,
  licensedProjectIds: [],
  catalog: {
    design: { kind: 'design', amountMinor: 14900, currency: 'THB', credits: 10, periodDays: null },
    pro: { kind: 'pro', amountMinor: 39900, currency: 'THB', credits: 100, periodDays: 30 },
  },
  devFulfilAvailable: true,
  purchasesEnabled: true,
}

const order: Order = {
  id: 'order-1',
  workspaceId: 'space',
  kind: 'design',
  projectId: 'project-1',
  amountMinor: 14900,
  currency: 'THB',
  credits: 10,
  status: 'pending',
  provider: 'none',
  providerRef: null,
  checkoutUrl: null,
  createdAt: '2026-10-13T00:00:00.000Z',
  paidAt: null,
}

const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ data, requestId: crypto.randomUUID() }), {
  status,
  headers: { 'content-type': 'application/json' },
})

describe('billing API client', () => {
  it('reads entitlements for a workspace with bearer auth', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('/api/v1/billing/entitlements?workspaceId=space')
      expect(init.method).toBe('GET')
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer token')
      return ok(entitlements)
    }))

    await expect(getEntitlements('/api/v1', 'token', 'space')).resolves.toEqual(entitlements)
  })

  it('posts an export authorization and surfaces PAYMENT_REQUIRED as ApiClientError with details', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('/api/v1/projects/project-1/export-authorizations')
      expect(init.method).toBe('POST')
      expect(init.body).toBe('{}')
      return new Response(JSON.stringify({
        error: {
          code: 'PAYMENT_REQUIRED',
          message: 'ต้องซื้อแบบนี้ก่อนดาวน์โหลด',
          details: { projectId: 'project-1', price: entitlements.catalog.design },
        },
        requestId: crypto.randomUUID(),
      }), { status: 402, headers: { 'content-type': 'application/json' } })
    }))

    const failure = await authorizeExport('/api/v1', 'token', 'project-1').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ApiClientError)
    expect(failure).toMatchObject({ status: 402, code: 'PAYMENT_REQUIRED' })
    expect((failure as ApiClientError).details).toMatchObject({ projectId: 'project-1' })
  })

  it('returns the authorization with refreshed entitlements when licensed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ projectId: 'project-1', source: 'pro', entitlements })))
    await expect(authorizeExport('/api/v1', 'token', 'project-1')).resolves.toMatchObject({
      projectId: 'project-1',
      source: 'pro',
      entitlements: { plan: 'free' },
    })
  })

  it('creates an order with the full input body and no price fields', async () => {
    const input = { workspaceId: 'space', operationId: crypto.randomUUID(), kind: 'design' as const, projectId: 'project-1' }
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('/api/v1/billing/orders')
      expect(JSON.parse(String(init.body))).toEqual(input)
      return ok(order, 201)
    }))

    await expect(createOrder('/api/v1', 'token', input)).resolves.toMatchObject({ id: 'order-1', status: 'pending' })
  })

  it('surfaces PURCHASE_UNAVAILABLE (503) when the server has purchasing switched off', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'PURCHASE_UNAVAILABLE', message: 'ยังไม่เปิดขาย' },
      requestId: crypto.randomUUID(),
    }), { status: 503, headers: { 'content-type': 'application/json' } })))

    const input = { workspaceId: 'space', operationId: crypto.randomUUID(), kind: 'pro' as const }
    await expect(createOrder('/api/v1', 'token', input)).rejects.toMatchObject({ status: 503, code: 'PURCHASE_UNAVAILABLE' })
  })

  it('posts dev-fulfil to the order route', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('/api/v1/billing/orders/order-1/dev-fulfil')
      expect(init.method).toBe('POST')
      return ok({ ...order, status: 'paid', provider: 'dev', paidAt: '2026-10-13T00:01:00.000Z' })
    }))

    await expect(devFulfilOrder('/api/v1', 'token', 'order-1')).resolves.toMatchObject({ status: 'paid', provider: 'dev' })
  })
})
