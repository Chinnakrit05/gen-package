// ตัวเรียก Claude API ของงานศิลป์ (apiAskWithUsage) กับ SDK ปลอม: timeout ต่อคำขอตามงบที่เหลือ, สะสม usage ทุกรอบ,
// เส้นทาง beta fallback ของรุ่นที่รองรับ, และการแยก refusal / max_tokens / ไม่ใช่ JSON เป็น ArtworkResponseError
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

import { apiAskWithUsage, ArtworkDeadlineError, ArtworkResponseError } from './aiArtwork'

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
    expect(first).toEqual({ raw: { a: 1 }, model: 'm-resolved' })
    const [params, options] = sdk.betaCreate.mock.calls[0] as [Record<string, unknown>, { timeout: number }]
    expect(params).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 24_000, fallbacks: 'default' })
    expect(options.timeout).toBeLessThanOrEqual(100_000)
    expect(options.timeout).toBeGreaterThan(90_000)

    await ask([{ role: 'user', content: 'y' }])
    expect(usage()).toEqual({ inputTokens: 110, outputTokens: 55, cacheReadTokens: 7, cacheCreationTokens: 0 })
    expect(sdk.create).not.toHaveBeenCalled()
  })

  it('ไม่เริ่มรอบใหม่เมื่อเวลาที่เหลือน้อยกว่าขั้นต่ำ และแยก refusal / max_tokens / ไม่ใช่ JSON เป็น ArtworkResponseError', async () => {
    const tight = apiAskWithUsage('sk-test', 'claude-test', { timeoutMs: 240_000, maxRetries: 0, deadlineMs: Date.now() + 10_000 })
    await expect(tight.ask([])).rejects.toBeInstanceOf(ArtworkDeadlineError)
    expect(sdk.create).not.toHaveBeenCalled()

    const open = apiAskWithUsage('sk-test', 'claude-test', { timeoutMs: 240_000, maxRetries: 0 })
    sdk.create.mockResolvedValueOnce(reply('', undefined, 'refusal'))
    await expect(open.ask([])).rejects.toMatchObject({ reason: 'refusal' })
    sdk.create.mockResolvedValueOnce(reply('{"cut', undefined, 'max_tokens'))
    await expect(open.ask([])).rejects.toMatchObject({ reason: 'max_tokens' })
    sdk.create.mockResolvedValueOnce(reply('not json'))
    const error = await open.ask([]).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ArtworkResponseError)
    expect((error as ArtworkResponseError).reason).toBe('invalid-json')
    // ไม่มี deadline → timeout = ค่าตั้งต้นของ limits; รุ่นที่ไม่อยู่ในชุด fallback ใช้ messages.create ปกติ
    expect(sdk.create.mock.calls[0][1]).toEqual({ timeout: 240_000 })
    expect(sdk.betaCreate).not.toHaveBeenCalled()
    // usage ยังสะสมแม้คำตอบใช้ไม่ได้ (จ่าย provider ไปแล้ว)
    expect(open.usage()).toEqual({ inputTokens: 300, outputTokens: 150, cacheReadTokens: 0, cacheCreationTokens: 0 })
  })
})
