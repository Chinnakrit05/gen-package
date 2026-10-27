// ตัวเรียก Claude API ของงานศิลป์ (apiAskWithUsage) กับ SDK ปลอม: schema ไปทาง system prompt (ไม่ใช่ output_config.format —
// เกินเพดาน union ของ structured outputs), timeout ต่อคำขอตามงบที่เหลือ, สะสม usage ทุกรอบ, เส้นทาง beta fallback,
// refusal / max_tokens เป็น ArtworkResponseError และคำตอบที่ไม่มี JSON คืน raw null ให้วงรอบส่งไปแก้
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({ create: vi.fn(), betaCreate: vi.fn() }))

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: sdk.create }
    beta = { messages: { create: sdk.betaCreate } }
    static APIError = class extends Error {}
    static AuthenticationError = class extends Error {}
    static RateLimitError = class extends Error {}
    constructor(readonly options: unknown) {}
  }
  return { default: MockAnthropic }
})

import { apiAskWithUsage, ArtworkDeadlineError, JSON_INSTRUCTION } from './aiArtwork'

const reply = (
  text: string,
  usage: Record<string, number> = { input_tokens: 100, output_tokens: 50 },
  stop_reason = 'end_turn',
) => ({ model: 'm-resolved', stop_reason, content: [{ type: 'text', text }], usage })

describe('apiAskWithUsage', () => {
  beforeEach(() => {
    sdk.create.mockReset()
    sdk.betaCreate.mockReset()
  })

  it('ส่ง timeout ต่อคำขอตามงบที่เหลือ สะสม usage ทุกรอบ และใช้เส้นทาง beta fallback สำหรับรุ่นที่รองรับ', async () => {
    sdk.betaCreate.mockResolvedValueOnce(reply('{"a":1}', { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 7 }))
    sdk.betaCreate.mockResolvedValueOnce(reply('{"a":2}', { input_tokens: 10, output_tokens: 5 }))
    const deadlineMs = Date.now() + 100_000
    const { ask, usage } = apiAskWithUsage('sk-test', 'claude-opus-5-5', { timeoutMs: 240_000, maxRetries: 0, deadlineMs })
    expect(usage()).toBeNull()

    const first = await ask([{ role: 'user', content: 'x' }])
    expect(first).toEqual({ raw: { a: 1 }, model: 'm-resolved', text: '{"a":1}' })
    const [params, options] = sdk.betaCreate.mock.calls[0] as [Record<string, unknown>, { timeout: number }]
    expect(params).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 24_000, fallbacks: 'default' })
    // schema อยู่ใน system (cache ได้) — ห้ามส่ง output_config.format: schema นี้มีช่อง union เกินเพดาน API (16)
    expect(params.output_config).toEqual({ effort: 'medium' })
    expect(params.system).toEqual([{ type: 'text', text: expect.stringContaining(JSON_INSTRUCTION), cache_control: { type: 'ephemeral' } }])
    expect(options.timeout).toBeLessThanOrEqual(100_000)
    expect(options.timeout).toBeGreaterThan(90_000)

    await ask([{ role: 'user', content: 'y' }])
    expect(usage()).toEqual({ inputTokens: 110, outputTokens: 55, cacheReadTokens: 7, cacheCreationTokens: 0 })
    expect(sdk.create).not.toHaveBeenCalled()
  })

  it('สรุปโทเคน + ค่าใช้จ่ายต่อคำขอตามรุ่นที่ตอบจริง (รวมคำขอที่ถูกปฏิเสธ เพราะคิดเงินแล้ว)', async () => {
    const reply55 = (model: string, usage: Record<string, number>, stop_reason = 'end_turn') =>
      ({ model, stop_reason, content: [{ type: 'text', text: '{"a":1}' }], usage })
    const { ask, report } = apiAskWithUsage('sk-test', 'claude-haiku-5-5', { timeoutMs: 240_000, maxRetries: 0 })
    expect(report()).toBeNull()
    sdk.create.mockResolvedValueOnce(reply55('claude-haiku-5-5', { input_tokens: 1000, output_tokens: 10_000, cache_creation_input_tokens: 9000 }))
    await ask([{ role: 'user', content: 'x' }])
    expect(report()).toEqual({
      model: 'claude-haiku-5-5', requests: 1, inputTokens: 1000, outputTokens: 10_000, cacheReadTokens: 0, cacheCreationTokens: 9000,
      costUsd: expect.closeTo((1000 * 0.1 + 9000 * 0.1 * 1.25 + 10_000 * 0.5) / 1e6, 10),
    })
    sdk.create.mockResolvedValueOnce(reply55('claude-haiku-5-5', { input_tokens: 500, output_tokens: 20, cache_read_input_tokens: 9000 }, 'refusal'))
    await expect(ask([{ role: 'user', content: 'y' }])).rejects.toMatchObject({ reason: 'refusal' })
    expect(report()).toMatchObject({ requests: 2, inputTokens: 1500, outputTokens: 10_020, cacheReadTokens: 9000 })
  })

  it('ไม่เริ่มรอบใหม่เมื่อเวลาที่เหลือน้อยกว่าขั้นต่ำ, แยก refusal / max_tokens เป็น error และคืน raw null เมื่อไม่มี JSON', async () => {
    const tight = apiAskWithUsage('sk-test', 'claude-test', { timeoutMs: 240_000, maxRetries: 0, deadlineMs: Date.now() + 10_000 })
    await expect(tight.ask([])).rejects.toBeInstanceOf(ArtworkDeadlineError)
    expect(sdk.create).not.toHaveBeenCalled()

    const open = apiAskWithUsage('sk-test', 'claude-test', { timeoutMs: 240_000, maxRetries: 0 })
    sdk.create.mockResolvedValueOnce(reply('', undefined, 'refusal'))
    await expect(open.ask([])).rejects.toMatchObject({ reason: 'refusal' })
    sdk.create.mockResolvedValueOnce(reply('{"cut', undefined, 'max_tokens'))
    await expect(open.ask([])).rejects.toMatchObject({ reason: 'max_tokens' })
    // ไม่มี JSON → ไม่ throw: วงรอบส่งกลับไปแก้ด้วยข้อความเดิม; มีข้อความ/fence ล้อมก็ยังแกะ JSON ได้
    sdk.create.mockResolvedValueOnce(reply('not json'))
    await expect(open.ask([])).resolves.toEqual({ raw: null, model: 'm-resolved', text: 'not json' })
    sdk.create.mockResolvedValueOnce(reply('นี่คือแบบ:\n```json\n{"name":"x"}\n```'))
    await expect(open.ask([])).resolves.toMatchObject({ raw: { name: 'x' } })
    // ไม่มี deadline → timeout = ค่าตั้งต้นของ limits; รุ่นที่ไม่อยู่ในชุด fallback ใช้ messages.create ปกติ
    expect(sdk.create.mock.calls[0][1]).toEqual({ timeout: 240_000 })
    expect(sdk.betaCreate).not.toHaveBeenCalled()
    // usage ยังสะสมแม้คำตอบใช้ไม่ได้ (จ่าย provider ไปแล้ว)
    expect(open.usage()).toEqual({ inputTokens: 400, outputTokens: 200, cacheReadTokens: 0, cacheCreationTokens: 0 })
    // รุ่นที่ไม่มี effort (ไม่ใช่ตระกูล 5) ไม่ส่ง output_config เลย
    expect(sdk.create.mock.calls[0][0]).not.toHaveProperty('output_config')
  })
})
