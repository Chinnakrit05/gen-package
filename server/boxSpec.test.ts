import type { IncomingMessage } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  askClaudeWithUsage,
  boxSpecModelOptions,
  BoxSpecResponseError,
  type CurrentSpec,
  type RefImage,
} from './boxSpec'
import { AiProviderError, AnthropicAiService } from './modules/ai/aiService'
import { readRequestApiKey } from './modules/ai/requestApiKey'

function request(value?: string | string[]): Pick<IncomingMessage, 'headers'> {
  return { headers: value === undefined ? {} : { 'x-packit-anthropic-api-key': value } }
}

describe('readRequestApiKey', () => {
  it('accepts one bounded, whitespace-free key', () => {
    expect(readRequestApiKey(request('  sk-ant-test-only  ').headers)).toBe('sk-ant-test-only')
  })

  it('distinguishes an absent key from malformed values', () => {
    expect(readRequestApiKey(request().headers)).toBeUndefined()
    expect(readRequestApiKey(request('short').headers)).toBeNull()
    expect(readRequestApiKey(request('sk-ant-has whitespace').headers)).toBeNull()
    expect(readRequestApiKey(request(['sk-ant-one', 'sk-ant-two']).headers)).toBeNull()
  })
})

const apiKey = 'sk-ant-test-key-for-box-spec'

interface SentRequest {
  url: URL
  headers: Headers
  body: Record<string, unknown>
}

interface SentOutputConfig {
  effort?: string
  format: {
    type: string
    schema: { additionalProperties: unknown; required: string[]; properties: Record<string, unknown> }
  }
}

// แทน fetch ที่ SDK ใช้ (SDK อ่าน global fetch ตอนสร้าง client ซึ่งสร้างใหม่ทุกคำขอ) — เก็บคำขอจริงที่ออกจาก SDK
// (URL/header/body) แล้วตอบด้วย message ที่กำหนด จึงตรวจรูปแบบคำขอบนสายได้โดยไม่เรียก API จริง
function stubAnthropic(reply: Record<string, unknown>): SentRequest[] {
  const sent: SentRequest[] = []
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    sent.push({ url: new URL(String(url)), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) })
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  return sent
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const modelSpec = {
  template: 'tuck-end',
  materialId: 'kraft-350',
  W: 66.2,
  D: 66,
  H: 999,
  handle: true,
  assumptions: ['ขวดแยม 200 มล. ≈ ⌀65×110 มม.'],
  layoutNote: 'วางเรียง 1 × 1',
  explanation: 'กล่องฝาเสียบเหมาะกับของชิ้นเดียวแนวตั้ง',
}

// รูปของคำตอบจาก Messages API: รุ่น 5.x ขึ้นต้นด้วย thinking ที่ข้อความว่าง (display ค่าเริ่มต้น omitted)
function reply(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text: JSON.stringify(modelSpec) },
    ],
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 5200, output_tokens: 640, cache_read_input_tokens: null, cache_creation_input_tokens: 0 },
    ...overrides,
  }
}

const current: CurrentSpec = { template: 'tuck-end', materialId: 'carton-300', W: 70, D: 70, H: 120, handle: false }

describe('askClaudeWithUsage request per model', () => {
  it.each([
    ['claude-opus-4-8', undefined, false],
    ['claude-opus-5-5', 'low', true],
    ['claude-sonnet-5-5', 'low', true],
    ['claude-haiku-5-5', 'low', false],
  ] as const)('%s gets structured outputs, effort %s, server fallback %s', async (model, effort, serverFallback) => {
    const sent = stubAnthropic(reply({ model }))
    await askClaudeWithUsage(apiKey, model, 'กล่องใส่ขวดแยม 1 ขวด')

    expect(sent).toHaveLength(1)
    const [{ url, headers, body }] = sent
    // ไม่บังคับเรียก tool (Opus/Sonnet 5.5 ตอบ 400 กับ tool_choice แบบ tool/any) และไม่ส่ง thinking/sampling
    // (ส่ง thinking disabled ให้ Opus/Sonnet 5.5 = 400; temperature ถูกปฏิเสธในรุ่นใหม่)
    for (const key of ['tools', 'tool_choice', 'thinking', 'temperature', 'top_p', 'top_k', 'betas']) {
      expect(body).not.toHaveProperty(key)
    }
    expect(body).toMatchObject({ model, max_tokens: 16000, messages: [{ role: 'user' }] })
    const outputConfig = body.output_config as SentOutputConfig
    expect(outputConfig.format.type).toBe('json_schema')
    if (effort) expect(outputConfig.effort).toBe(effort)
    else expect(outputConfig).not.toHaveProperty('effort')

    if (serverFallback) {
      expect(url.pathname + url.search).toBe('/v1/messages?beta=true')
      expect(headers.get('anthropic-beta')).toBe('server-side-fallback-2026-07-01')
      expect(body.fallbacks).toBe('default')
    } else {
      expect(url.pathname + url.search).toBe('/v1/messages')
      expect(headers.get('anthropic-beta')).toBeNull()
      expect(body).not.toHaveProperty('fallbacks')
    }
  })

  it('asks for a strict schema with an explanation field and never a reasoning field', async () => {
    const sent = stubAnthropic(reply())
    await askClaudeWithUsage(apiKey, 'claude-opus-5-5', 'กล่องใส่สบู่ 3 ก้อน')

    const { body } = sent[0]
    const { schema } = (body.output_config as SentOutputConfig).format
    expect(schema.additionalProperties).toBe(false)
    expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort())
    // ช่อง JSON ชื่อ reasoning กระตุ้น refusal หมวด reasoning_extraction (คิดเงิน และไม่มี fallback)
    expect(schema.properties).toHaveProperty('explanation')
    expect(schema.properties).not.toHaveProperty('reasoning')
    // system prompt ต้องไม่สั่งให้เรียก tool ที่ไม่มีในคำขอ และไม่ขอช่อง reasoning
    expect(typeof body.system).toBe('string')
    expect(body.system).not.toMatch(/tool|reasoning/)
    expect(body.system).toContain('explanation')
  })

  it('sends the reference image before the text that carries the current spec', async () => {
    const sent = stubAnthropic(reply({ model: 'claude-haiku-5-5' }))
    const image: RefImage = { data: 'A'.repeat(120), mediaType: 'image/png' }
    await askClaudeWithUsage(apiKey, 'claude-haiku-5-5', 'ขยายให้ใส่ 2 ขวด', current, image)

    const [message] = sent[0].body.messages as Array<{ content: Array<{ type: string; text?: string; source?: unknown }> }>
    expect(message.content.map((block) => block.type)).toEqual(['image', 'text'])
    expect(message.content[0].source).toEqual({ type: 'base64', media_type: 'image/png', data: image.data })
    expect(message.content[1].text).toContain('สเปกปัจจุบัน: template=tuck-end')
    expect(message.content[1].text).toContain('ขยายให้ใส่ 2 ขวด')
  })

  it.each([
    ['claude-opus-5', { effort: 'low', serverFallback: true }],
    ['claude-fable-5-1', { effort: 'low', serverFallback: true }],
    ['claude-sonnet-5', { effort: 'low', serverFallback: false }],
    ['claude-haiku-4-5', { serverFallback: false }],
    ['claude-sonnet-4-6', { serverFallback: false }],
  ] as const)('derives %s options from its model family', (model, options) => {
    expect(boxSpecModelOptions(model)).toEqual(options)
  })
})

describe('askClaudeWithUsage reply parsing', () => {
  it('reads the JSON text after thinking blocks and maps explanation back to reasoning', async () => {
    stubAnthropic(reply())
    const result = await askClaudeWithUsage(apiKey, 'claude-opus-5-5', 'กล่องใส่ขวดแยม 1 ขวด')

    expect(result).toEqual({
      spec: {
        template: 'tuck-end',
        materialId: 'kraft-350',
        W: 66, // sanitize ปัดทีละ 0.5 มม.
        D: 66,
        H: 300, // sanitize clamp ตามลิมิต
        handle: true,
        assumptions: ['ขวดแยม 200 มล. ≈ ⌀65×110 มม.'],
        layoutNote: 'วางเรียง 1 × 1',
        reasoning: 'กล่องฝาเสียบเหมาะกับของชิ้นเดียวแนวตั้ง',
        mock: false,
      },
      model: 'claude-opus-5-5',
      usage: { inputTokens: 5200, outputTokens: 640, cacheReadTokens: 0, cacheCreationTokens: 0 },
    })
  })

  it('keeps the model that actually answered after a server-side fallback', async () => {
    stubAnthropic(reply({
      model: 'claude-opus-4-8',
      content: [
        { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-4-8' } },
        { type: 'text', text: JSON.stringify(modelSpec) },
      ],
      usage: {
        input_tokens: 5100,
        output_tokens: 310,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        iterations: [
          { type: 'message', model: 'claude-opus-5-5', input_tokens: 5200, output_tokens: 0 },
          { type: 'fallback_message', model: 'claude-opus-4-8', input_tokens: 5100, output_tokens: 310 },
        ],
      },
    }))
    const result = await askClaudeWithUsage(apiKey, 'claude-opus-5-5', 'กล่องใส่ขวดแยม 1 ขวด')

    expect(result.model).toBe('claude-opus-4-8')
    expect(result.spec).toMatchObject({ template: 'tuck-end', reasoning: modelSpec.explanation })
    expect(result.usage).toEqual({ inputTokens: 5100, outputTokens: 310, cacheReadTokens: 0, cacheCreationTokens: 0 })
  })

  it.each([
    ['before any output', [], { type: 'refusal', category: 'cyber', explanation: 'declined' }, 'cyber'],
    ['mid-answer', [{ type: 'text', text: '{"template":"tuck' }], { type: 'refusal', category: 'general_harms', explanation: null }, 'general_harms'],
    ['without a category', [], null, null],
  ])('throws a refusal error %s instead of reading the content', async (_case, content, stopDetails, category) => {
    stubAnthropic(reply({ content, stop_reason: 'refusal', stop_details: stopDetails }))
    const error = await askClaudeWithUsage(apiKey, 'claude-sonnet-5-5', 'กล่องของฝาก').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(BoxSpecResponseError)
    expect(error).toMatchObject({ reason: 'refusal', category })
  })

  it('throws when the JSON was cut off at max_tokens', async () => {
    stubAnthropic(reply({ content: [{ type: 'text', text: '{"template":"tuck-end","materialId":' }], stop_reason: 'max_tokens' }))
    await expect(askClaudeWithUsage(apiKey, 'claude-opus-4-8', 'กล่องของฝาก')).rejects.toMatchObject({
      name: 'BoxSpecResponseError',
      reason: 'max_tokens',
    })
  })

  it.each([
    ['only thinking', [{ type: 'thinking', thinking: '', signature: 'sig' }]],
    ['plain text', [{ type: 'text', text: 'ขอข้อมูลเพิ่มเติมครับ' }]],
    ['a JSON array', [{ type: 'text', text: '[1, 2]' }]],
  ])('throws no_output when the reply has %s', async (_case, content) => {
    stubAnthropic(reply({ content }))
    await expect(askClaudeWithUsage(apiKey, 'claude-haiku-5-5', 'กล่องของฝาก')).rejects.toMatchObject({
      name: 'BoxSpecResponseError',
      reason: 'no_output',
    })
  })
})

describe('AnthropicAiService', () => {
  it.each([
    ['refusal', { content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'general_harms', explanation: null } }],
    ['provider', { content: [{ type: 'text', text: '{"template":' }], stop_reason: 'max_tokens' }],
    ['provider', { content: [{ type: 'text', text: 'ขอโทษครับ' }] }],
  ] as const)('reports an unusable reply as AiProviderError %s so the route refunds the credit', async (kind, overrides) => {
    stubAnthropic(reply(overrides))
    const error = await new AnthropicAiService('claude-sonnet-5-5')
      .generateBoxSpec(apiKey, { prompt: 'กล่องของฝาก' })
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(AiProviderError)
    expect(error).toMatchObject({ kind })
    expect((error as AiProviderError).providerMessage).toContain('BoxSpecResponseError')
    expect((error as AiProviderError).providerMessage).not.toContain(apiKey)
  })

  it('returns the spec, the answering model and the usage on success', async () => {
    stubAnthropic(reply({ model: 'claude-haiku-5-5' }))
    const output = await new AnthropicAiService('claude-haiku-5-5').generateBoxSpec(apiKey, { prompt: 'กล่องใส่ขวดแยม' })

    expect(output.model).toBe('claude-haiku-5-5')
    expect(output.spec.reasoning).toBe(modelSpec.explanation)
    expect(output.usage).toEqual({ inputTokens: 5200, outputTokens: 640, cacheReadTokens: 0, cacheCreationTokens: 0 })
  })
})
