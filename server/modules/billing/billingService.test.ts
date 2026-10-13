import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Order } from '../../../shared/contracts/billing'
import { HttpError } from '../../http/errors'
import { BillingService, type BillingRepository, type StoredEntitlements } from './billingService'

const actor = {
  userId: '10000000-0000-4000-8000-000000000001',
  identityIssuer: 'https://test.supabase.local/auth/v1',
  identitySubject: 'subject-1',
  requestId: 'request-1',
}
const workspaceId = '20000000-0000-4000-8000-000000000001'
const projectId = '30000000-0000-4000-8000-000000000001'
const operationId = '40000000-0000-4000-8000-000000000001'
const orderId = '70000000-0000-4000-8000-000000000001'
const aiRequestId = '60000000-0000-4000-8000-000000000001'

const stored: StoredEntitlements = {
  workspaceId,
  plan: 'free',
  proUntil: null,
  credits: 3,
  licensedProjectIds: [],
  catalog: {
    design: { kind: 'design', amountMinor: 14900, currency: 'THB', credits: 10, periodDays: null },
    pro: { kind: 'pro', amountMinor: 39900, currency: 'THB', credits: 100, periodDays: 30 },
  },
}
const paidOrder: Order = {
  id: orderId,
  workspaceId,
  kind: 'design',
  projectId,
  amountMinor: 14900,
  currency: 'THB',
  credits: 10,
  status: 'paid',
  provider: 'dev',
  providerRef: 'request-1',
  checkoutUrl: null,
  createdAt: '2026-10-13T00:00:00.000Z',
  paidAt: '2026-10-13T00:00:01.000Z',
}

function repositoryStub(overrides: Partial<BillingRepository> = {}): BillingRepository {
  return {
    getEntitlements: async () => stored,
    authorizeExport: async () => { throw new Error('must not be called') },
    reserveAiCredit: async () => { throw new Error('must not be called') },
    settleAiRequest: async () => { throw new Error('must not be called') },
    createOrder: async () => { throw new Error('must not be called') },
    fulfilOrder: async () => { throw new Error('must not be called') },
    ...overrides,
  }
}

describe('BillingService', () => {
  let info: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    info = vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    info.mockRestore()
  })

  it('adds the dev-fulfil and purchases flags to entitlements and export authorizations', async () => {
    for (const [devFulfilEnabled, purchasesEnabled] of [[true, true], [false, false], [true, false]] as const) {
      const service = new BillingService(repositoryStub({
        authorizeExport: async () => ({ projectId, source: 'pro', entitlements: stored }),
      }), { devFulfilEnabled, purchasesEnabled })

      expect(await service.getEntitlements(actor, workspaceId)).toEqual({
        ...stored,
        devFulfilAvailable: devFulfilEnabled,
        purchasesEnabled,
      })
      expect(await service.authorizeExport(actor, projectId)).toEqual({
        projectId,
        source: 'pro',
        entitlements: { ...stored, devFulfilAvailable: devFulfilEnabled, purchasesEnabled },
      })
    }
  })

  it('refuses orders with 503 PURCHASE_UNAVAILABLE before touching the repository when purchases are off', async () => {
    let called = false
    const service = new BillingService(repositoryStub({
      createOrder: async () => {
        called = true
        throw new Error('must not be called')
      },
    }), { devFulfilEnabled: false, purchasesEnabled: false })

    const failure = await service.createOrder(actor, { workspaceId, operationId, kind: 'pro' })
      .then(() => null, (error: unknown) => error)
    expect(failure).toBeInstanceOf(HttpError)
    expect(failure).toMatchObject({ status: 503, code: 'PURCHASE_UNAVAILABLE' })
    expect(called).toBe(false)
    expect(info).not.toHaveBeenCalled()
  })

  it('hides dev fulfilment unless the environment allows it', async () => {
    let called = false
    const service = new BillingService(repositoryStub({
      fulfilOrder: async () => {
        called = true
        throw new Error('must not be called')
      },
    }), { devFulfilEnabled: false, purchasesEnabled: false })

    const failure = await service.devFulfilOrder(actor, orderId, 'request-1').then(() => null, (error: unknown) => error)
    expect(failure).toBeInstanceOf(HttpError)
    expect(failure).toMatchObject({ status: 404, code: 'NOT_FOUND' })
    expect(called).toBe(false)
  })

  it('fulfils with the dev provider and the request id as reference when enabled', async () => {
    const calls: unknown[] = []
    const service = new BillingService(repositoryStub({
      fulfilOrder: async (resolvedActor, resolvedOrderId, provider, providerRef) => {
        calls.push([resolvedActor?.userId, resolvedOrderId, provider, providerRef])
        return paidOrder
      },
    }), { devFulfilEnabled: true, purchasesEnabled: true })

    expect(await service.devFulfilOrder(actor, orderId, 'request-1')).toBe(paidOrder)
    expect(calls).toEqual([[actor.userId, orderId, 'dev', 'request-1']])
    // log หนึ่งบรรทัดต่อการชำระ: order/kind/workspace/provider — ไม่มีข้อมูลผู้ใช้
    expect(info).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(info.mock.calls[0][0]))).toEqual({
      level: 'info',
      event: 'order_fulfilled',
      requestId: 'request-1',
      orderId,
      kind: 'design',
      workspaceId,
      provider: 'dev',
    })
  })

  it('passes orders and AI credit bookkeeping through to the repository unchanged', async () => {
    const calls: unknown[] = []
    const service = new BillingService(repositoryStub({
      createOrder: async (resolvedActor, input) => {
        calls.push(['order', resolvedActor.userId, input])
        return { ...paidOrder, status: 'pending', provider: 'none', providerRef: null, paidAt: null }
      },
      reserveAiCredit: async (resolvedActor, resolvedWorkspaceId, resolvedOperationId) => {
        calls.push(['reserve', resolvedActor.userId, resolvedWorkspaceId, resolvedOperationId])
        return { requestId: aiRequestId, credits: 2 }
      },
      settleAiRequest: async (resolvedActor, requestId, outcome, usage) => {
        calls.push(['settle', resolvedActor.userId, requestId, outcome, usage])
        return { credits: 3 }
      },
    }), { devFulfilEnabled: true, purchasesEnabled: true })

    const input = { workspaceId, operationId, kind: 'design' as const, projectId }
    const usage = {
      hasImage: true,
      model: 'claude-test-model',
      inputTokens: 1200,
      outputTokens: 340,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    }
    expect(await service.createOrder(actor, input)).toMatchObject({ id: orderId, status: 'pending', checkoutUrl: null })
    expect(await service.reserveAiCredit(actor, workspaceId, operationId)).toEqual({ requestId: aiRequestId, credits: 2 })
    expect(await service.settleAiRequest(actor, aiRequestId, 'failed')).toEqual({ credits: 3 })
    expect(await service.settleAiRequest(actor, aiRequestId, 'succeeded', usage)).toEqual({ credits: 3 })
    expect(calls).toEqual([
      ['order', actor.userId, input],
      ['reserve', actor.userId, workspaceId, operationId],
      ['settle', actor.userId, aiRequestId, 'failed', undefined],
      ['settle', actor.userId, aiRequestId, 'succeeded', usage],
    ])
    expect(info).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(info.mock.calls[0][0]))).toEqual({
      level: 'info',
      event: 'order_created',
      requestId: actor.requestId,
      orderId,
      kind: 'design',
      workspaceId,
      provider: 'none',
    })
  })
})
