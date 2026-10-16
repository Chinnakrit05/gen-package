import Anthropic from '@anthropic-ai/sdk'
import {
  askClaudeWithUsage,
  BoxSpecResponseError,
  type BoxSpecResult,
  type ClaudeUsage,
  type CurrentSpec,
  type RefImage,
} from '../../boxSpec'
import { DEFAULT_AI_MODEL } from '../../config'
import { errorMessageForLog } from '../../logging'

export interface AiBoxSpecInput {
  prompt: string
  current?: CurrentSpec
  image?: RefImage
}

export type AiUsage = ClaudeUsage

// ผลของคำขอ AI บน cloud: spec ส่งถึงผู้ใช้; model/usage เก็บลง ai_requests ตอน settle เท่านั้น (ไม่ส่งให้ client)
export interface AiBoxSpecOutput {
  spec: BoxSpecResult
  model: string
  usage: AiUsage | null
}

export interface AiService {
  generateBoxSpec(apiKey: string, input: AiBoxSpecInput): Promise<AiBoxSpecOutput>
}

// refusal = โมเดลตอบ stop_reason "refusal" (ส่งซ้ำแบบเดิมก็ไม่ผ่าน ต้องปรับคำขอ) — คืนเครดิตเหมือน provider ล้ม
export type AiProviderFailureKind = 'authentication' | 'rate-limit' | 'refusal' | 'provider' | 'internal'

export class AiProviderError extends Error {
  // providerMessage = ข้อความจากต้นทางที่ผ่าน redact แล้ว ไว้ให้ router log (ไม่ส่งถึง client)
  readonly providerMessage: string

  constructor(readonly kind: AiProviderFailureKind, source?: unknown) {
    super(kind)
    this.name = 'AiProviderError'
    this.providerMessage = source === undefined ? kind : errorMessageForLog(source)
  }
}

// เวลารอ provider บน cloud: ต้องสั้นกว่า maxDuration ของ api/backend.js ใน vercel.json (60 วินาที)
// ไม่ retry เพราะ retry ทำให้เกินเวลา function — ผู้ใช้กดใหม่ได้และเครดิตถูกคืนแล้ว
export const CLOUD_AI_LIMITS = { timeoutMs: 50_000, maxRetries: 0 } as const

export class AnthropicAiService implements AiService {
  constructor(
    private readonly model = DEFAULT_AI_MODEL,
    private readonly limits: { timeoutMs?: number; maxRetries?: number } = CLOUD_AI_LIMITS,
  ) {}

  async generateBoxSpec(apiKey: string, input: AiBoxSpecInput): Promise<AiBoxSpecOutput> {
    try {
      return await askClaudeWithUsage(apiKey, this.model, input.prompt, input.current, input.image, this.limits)
    } catch (error) {
      // ตอบกลับมาแต่ไม่มีสเปก: refusal แยกข้อความให้ผู้ใช้ปรับคำขอ; JSON ถูกตัด/ไม่มี JSON ถือเป็น provider ล้ม
      if (error instanceof BoxSpecResponseError) {
        throw new AiProviderError(error.reason === 'refusal' ? 'refusal' : 'provider', error)
      }
      if (error instanceof Anthropic.AuthenticationError) throw new AiProviderError('authentication', error)
      if (error instanceof Anthropic.RateLimitError) throw new AiProviderError('rate-limit', error)
      if (error instanceof Anthropic.APIError) throw new AiProviderError('provider', error)
      throw new AiProviderError('internal', error)
    }
  }
}
