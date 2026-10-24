import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpError } from '../../http/errors'
import {
  mapBillingDatabaseError,
  settleUsageParams,
  SupabaseBillingRepository,
  type BillingDatabaseError,
} from './billingRepository'

const actor = {
  userId: '10000000-0000-4000-8000-000000000001',
  identityIssuer: 'https://test.supabase.local/auth/v1',
  identitySubject: 'subject-1',
  requestId: '50000000-0000-4000-8000-000000000001',
}
const workspaceId = '20000000-0000-4000-8000-000000000001'
const projectId = '30000000-0000-4000-8000-000000000001'
const aiRequestId = '60000000-0000-4000-8000-000000000001'
const designPrice = { kind: 'design', amountMinor: 14900, currency: 'THB', credits: 10, periodDays: null }

// รูปแบบเดียวกับที่ PostgREST คืนเมื่อ RPC raise errcode P0001 (message = รหัสคงที่, details = detail)
function p0001(message: string, details: string | null = null): BillingDatabaseError {
  return { message, details, code: 'P0001' }
}

// SupabaseClient ปลอมที่มีแค่ rpc — บันทึกชื่อ function + พารามิเตอร์ แล้วคืนผลที่กำหนด
function fakeClient(result: { data?: unknown; error?: BillingDatabaseError | null }) {
  const calls: [string, Record<string, unknown>][] = []
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push([fn, args])
      return { data: result.data ?? null, error: result.error ?? null }
    },
  } as unknown as SupabaseClient
  return { client, calls }
}

function logLines(spy: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
  return spy.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>)
}

describe('mapBillingDatabaseError', () => {
  it.each([
    ['EXPORT_PAYMENT_REQUIRED', 402, 'PAYMENT_REQUIRED'],
    ['AI_CREDITS_EXHAUSTED', 402, 'AI_CREDITS_EXHAUSTED'],
    ['AI_CONCURRENCY_LIMIT', 429, 'AI_RATE_LIMITED'],
    ['AI_REQUEST_IN_PROGRESS', 409, 'AI_REQUEST_IN_PROGRESS'],
    ['AI_REQUEST_NOT_RESERVED', 409, 'AI_REQUEST_IN_PROGRESS'],
    ['IDEMPOTENCY_KEY_REUSED', 409, 'IDEMPOTENCY_KEY_REUSED'],
    ['ALREADY_LICENSED', 409, 'ALREADY_LICENSED'],
    ['PROJECT_NOT_FOUND', 404, 'NOT_FOUND'],
    ['ORDER_NOT_FOUND', 404, 'ORDER_NOT_FOUND'],
    ['ORDER_NOT_PAYABLE', 409, 'ORDER_NOT_PAYABLE'],
    ['APP_USER_NOT_ACTIVE', 403, 'USER_NOT_ACTIVE'],
  ] as const)('maps %s to %i %s', (message, status, code) => {
    const mapped = mapBillingDatabaseError(p0001(message))
    expect(mapped).toBeInstanceOf(HttpError)
    expect(mapped).toMatchObject({ status, code })
    // ข้อความถึงผู้ใช้เป็นภาษาไทยของ server ไม่ใช่รหัสดิบจาก DB
    expect(mapped.message).not.toContain(message)
  })

  it('tells the user that the workspace already has AI requests running when the cap is hit', () => {
    expect(mapBillingDatabaseError(p0001('AI_CONCURRENCY_LIMIT')).message)
      .toBe('มีคำขอ AI ของพื้นที่งานนี้กำลังทำงานอยู่ รอสักครู่แล้วลองใหม่')
  })

  it.each([
    p0001('PLAN_NOT_AVAILABLE'),
    { message: 'ORDER_KIND_INVALID', details: null, code: '22023' },
    { message: 'new row for relation "ai_requests" violates check constraint "ai_requests_input_tokens"', code: '23514' },
    { message: 'Could not find the function public.settle_ai_request in the schema cache', code: 'PGRST202' },
    { message: '' },
  ])('falls back to 503 DEPENDENCY_UNAVAILABLE without echoing the database text (%#)', (error) => {
    const mapped = mapBillingDatabaseError(error, { projectId })
    expect(mapped).toMatchObject({ status: 503, code: 'DEPENDENCY_UNAVAILABLE', details: undefined })
    if (error.message) expect(mapped.message).not.toContain(error.message)
  })

  it('attaches the project and the design price parsed from the PostgREST details to PAYMENT_REQUIRED', () => {
    expect(mapBillingDatabaseError(p0001('EXPORT_PAYMENT_REQUIRED', JSON.stringify(designPrice)), { projectId }).details)
      .toEqual({ projectId, price: designPrice })
    // ไม่มี projectId ใน context → แนบแค่ราคา
    expect(mapBillingDatabaseError(p0001('EXPORT_PAYMENT_REQUIRED', JSON.stringify(designPrice))).details)
      .toEqual({ price: designPrice })
  })

  it.each([
    ['missing details', null],
    ['non-JSON details', 'not json'],
    ['a price that breaks the catalog contract', JSON.stringify({ ...designPrice, amountMinor: -1 })],
    ['a price with unknown fields', JSON.stringify({ ...designPrice, discount: 1 })],
  ])('drops the price when the details carry %s', (_label, details) => {
    expect(mapBillingDatabaseError(p0001('EXPORT_PAYMENT_REQUIRED', details), { projectId }).details)
      .toEqual({ projectId })
  })

  it.each([
    ['pro', 'pro'],
    ['free', 'free'],
    [null, 'free'],
    ['enterprise', 'free'],
  ] as const)('reads AI_CREDITS_EXHAUSTED details %s as plan %s with zero credits', (details, plan) => {
    expect(mapBillingDatabaseError(p0001('AI_CREDITS_EXHAUSTED', details)).details).toEqual({ credits: 0, plan })
  })
})

describe('settleUsageParams', () => {
  it('sends every usage parameter, null when absent', () => {
    expect(settleUsageParams(undefined)).toEqual({
      p_model: null,
      p_input_tokens: null,
      p_output_tokens: null,
      p_cache_read_tokens: null,
      p_cache_creation_tokens: null,
      p_has_image: null,
    })
    expect(settleUsageParams({ hasImage: false })).toMatchObject({ p_model: null, p_input_tokens: null, p_has_image: false })
  })

  it('drops values the database check constraints would reject instead of failing the settle', () => {
    expect(settleUsageParams({
      hasImage: true,
      model: '  ',
      inputTokens: -1,
      outputTokens: 1.5,
      cacheReadTokens: Number.NaN,
      cacheCreationTokens: 2 ** 31,
    })).toEqual({
      p_model: null,
      p_input_tokens: null,
      p_output_tokens: null,
      p_cache_read_tokens: null,
      p_cache_creation_tokens: null,
      p_has_image: true,
    })
    expect(settleUsageParams({ hasImage: true, model: 'm'.repeat(201) }).p_model).toBeNull()
  })
})

describe('SupabaseBillingRepository', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('settles with the usage columns and trims the model id', async () => {
    const { client, calls } = fakeClient({ data: { credits: 7 } })
    const repository = new SupabaseBillingRepository(client)

    await expect(repository.settleAiRequest(actor, aiRequestId, 'succeeded', {
      hasImage: true,
      model: ' claude-test-model ',
      inputTokens: 1200,
      outputTokens: 340,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    })).resolves.toEqual({ credits: 7 })
    await repository.settleAiRequest(actor, aiRequestId, 'failed')

    expect(calls).toEqual([
      ['settle_ai_request', {
        p_actor_user_id: actor.userId,
        p_request_id: aiRequestId,
        p_outcome: 'succeeded',
        p_model: 'claude-test-model',
        p_input_tokens: 1200,
        p_output_tokens: 340,
        p_cache_read_tokens: 0,
        p_cache_creation_tokens: 0,
        p_has_image: true,
      }],
      ['settle_ai_request', {
        p_actor_user_id: actor.userId,
        p_request_id: aiRequestId,
        p_outcome: 'failed',
        p_model: null,
        p_input_tokens: null,
        p_output_tokens: null,
        p_cache_read_tokens: null,
        p_cache_creation_tokens: null,
        p_has_image: null,
      }],
    ])
  })

  it('logs one redacted line for an unmapped database error and throws 503', async () => {
    const { client } = fakeClient({
      error: { message: 'connection to owner@example.test refused\nretry later', details: 'x', code: '08006' },
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const repository = new SupabaseBillingRepository(client)

    const failure = await repository.getEntitlements(actor, workspaceId).then(() => null, (thrown: unknown) => thrown)
    expect(failure).toMatchObject({ status: 503, code: 'DEPENDENCY_UNAVAILABLE' })
    expect(error).toHaveBeenCalledTimes(1)
    expect(String(error.mock.calls[0][0])).not.toContain('\n')
    expect(logLines(error)).toEqual([{
      level: 'error',
      event: 'billing_database_error',
      requestId: actor.requestId,
      route: 'rpc get_entitlements',
      code: 'DEPENDENCY_UNAVAILABLE',
      dbCode: '08006',
      error: 'connection to [redacted-email] refused retry later',
    }])
  })

  it('does not log mapped business refusals', async () => {
    const { client } = fakeClient({ error: p0001('AI_CONCURRENCY_LIMIT') })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const repository = new SupabaseBillingRepository(client)

    await expect(repository.reserveAiCredit(actor, workspaceId, aiRequestId))
      .rejects.toMatchObject({ status: 429, code: 'AI_RATE_LIMITED' })
    expect(error).not.toHaveBeenCalled()
  })

  it('logs only the offending field paths when an RPC breaks the result contract', async () => {
    const { client } = fakeClient({ data: { credits: -1, secret: 'value-not-logged' } })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const repository = new SupabaseBillingRepository(client)

    await expect(repository.settleAiRequest(actor, aiRequestId, 'failed'))
      .rejects.toMatchObject({ status: 503, code: 'DEPENDENCY_UNAVAILABLE' })
    const [line] = logLines(error)
    expect(line).toMatchObject({
      event: 'billing_contract_error',
      requestId: actor.requestId,
      route: 'rpc settle_ai_request',
      code: 'DEPENDENCY_UNAVAILABLE',
    })
    expect(JSON.stringify(line)).not.toContain('value-not-logged')
  })

  // โควตาพื้นที่เก็บงาน (ยังไม่เปิดใช้ — supabase/migrations/20261023000800_storage_quota.sql)
  it('checks the storage quota with every RPC parameter and returns the parsed result', async () => {
    const result = { ok: false, plan: 'free', limitBytes: 20971520, usedBytes: 20000000, projectedBytes: 21000000 }
    const { client, calls } = fakeClient({ data: result })
    const repository = new SupabaseBillingRepository(client)
    const document = { decos: [] }

    await expect(repository.checkStorageQuota(actor, {
      workspaceId: null,
      projectId,
      operationId: aiRequestId,
      document,
      extraBytes: 0,
    }, true)).resolves.toEqual(result)
    expect(calls).toEqual([['check_storage_quota', {
      p_actor_user_id: actor.userId,
      p_workspace_id: null,
      p_project_id: projectId,
      p_operation_id: aiRequestId,
      p_document: document,
      p_extra_bytes: 0,
      p_open_access: true,
    }]])
  })

  it('maps storage quota refusals and broken results like the other billing RPCs', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const notFound = new SupabaseBillingRepository(fakeClient({ error: p0001('PROJECT_NOT_FOUND') }).client)
    await expect(notFound.checkStorageQuota(actor, {
      workspaceId: null, projectId, operationId: aiRequestId, document: {}, extraBytes: 0,
    }, false)).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' })
    expect(error).not.toHaveBeenCalled()

    const broken = new SupabaseBillingRepository(fakeClient({ data: { ok: true, plan: 'free', limitBytes: 0 } }).client)
    await expect(broken.checkStorageQuota(actor, {
      workspaceId, projectId: null, operationId: aiRequestId, document: null, extraBytes: 10,
    }, false)).rejects.toMatchObject({ status: 503, code: 'DEPENDENCY_UNAVAILABLE' })
    expect(logLines(error)[0]).toMatchObject({ event: 'billing_contract_error', route: 'rpc check_storage_quota' })
  })
})
