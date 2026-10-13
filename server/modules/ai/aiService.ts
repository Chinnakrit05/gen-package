import Anthropic from '@anthropic-ai/sdk'
import {
  askClaude,
  type BoxSpecResult,
  type CurrentSpec,
  type RefImage,
} from '../../boxSpec'

export interface AiBoxSpecInput {
  prompt: string
  current?: CurrentSpec
  image?: RefImage
}

export interface AiService {
  generateBoxSpec(apiKey: string, input: AiBoxSpecInput): Promise<BoxSpecResult>
}

export type AiProviderFailureKind = 'authentication' | 'rate-limit' | 'provider' | 'internal'

export class AiProviderError extends Error {
  constructor(readonly kind: AiProviderFailureKind) {
    super(kind)
    this.name = 'AiProviderError'
  }
}

// เวลารอ provider บน cloud: ต้องสั้นกว่า maxDuration ของ api/backend.js ใน vercel.json (60 วินาที)
// ไม่ retry เพราะ retry ทำให้เกินเวลา function — ผู้ใช้กดใหม่ได้และเครดิตถูกคืนแล้ว
export const CLOUD_AI_LIMITS = { timeoutMs: 50_000, maxRetries: 0 } as const

export class AnthropicAiService implements AiService {
  constructor(
    private readonly model = 'claude-opus-4-8',
    private readonly limits: { timeoutMs?: number; maxRetries?: number } = CLOUD_AI_LIMITS,
  ) {}

  async generateBoxSpec(apiKey: string, input: AiBoxSpecInput): Promise<BoxSpecResult> {
    try {
      return await askClaude(apiKey, this.model, input.prompt, input.current, input.image, this.limits)
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) throw new AiProviderError('authentication')
      if (error instanceof Anthropic.RateLimitError) throw new AiProviderError('rate-limit')
      if (error instanceof Anthropic.APIError) throw new AiProviderError('provider')
      throw new AiProviderError('internal')
    }
  }
}
