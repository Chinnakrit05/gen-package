import Anthropic from '@anthropic-ai/sdk'
import {
  askClaudeWithUsage,
  BoxSpecResponseError,
  type BoxSpecResult,
  type ClaudeUsage,
  type CurrentSpec,
  type RefImage,
} from '../../boxSpec'
import {
  apiAskWithUsage,
  ArtworkDeadlineError,
  ArtworkResponseError,
  designArtwork,
  type ArtworkRequest,
  type ArtworkResult,
} from '../../aiArtwork'
import type { AiUsageReport } from '../../../shared/contracts/aiModels'
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

// งานออกแบบหน้าตา (artwork) บน cloud: payload เดียวกับ legacy /api/ai-artwork; ผลส่งถึงผู้ใช้ทั้งก้อน (plan + issues + rounds)
export type AiArtworkInput = ArtworkRequest
export interface AiArtworkOutput {
  result: ArtworkResult
  model: string
  usage: AiUsage | null // รวมทุกรอบ (รอบแรก + รอบแก้)
  report?: AiUsageReport | null // โทเคน + ค่าใช้จ่ายต่อรุ่นที่ตอบจริง — router ส่งให้ client เฉพาะช่วงพัฒนา
}

export interface AiService {
  generateBoxSpec(apiKey: string, input: AiBoxSpecInput): Promise<AiBoxSpecOutput>
  // model = รุ่นที่ผู้ทดสอบเลือก (ช่วงพัฒนา) — ไม่ส่ง = รุ่นของ server (BOX_SPEC_MODEL)
  generateArtwork(apiKey: string, input: AiArtworkInput, model?: string): Promise<AiArtworkOutput>
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

// เวลารอ provider บน cloud (box-spec): ตอบสั้น จึงคงไว้ 50 วินาที; ไม่ retry เพราะ retry ทำให้เกินเวลา function —
// ผู้ใช้กดใหม่ได้และเครดิตถูกคืนแล้ว
export const CLOUD_AI_LIMITS = { timeoutMs: 50_000, maxRetries: 0 } as const
// artwork ตอบยาวกว่ามาก (max_tokens 24k + อาจมีรอบแก้) — งบเวลารวมทุกรอบ 270 วินาที ต้องจบก่อน maxDuration 300 ของ
// api/backend.js ใน vercel.json (Hobby + Fluid compute) ให้เหลือเวลา settle/ตอบกลับ; รอบแก้ที่ไม่ทันงบ → คืนแบบรอบก่อน
export const CLOUD_ARTWORK_LIMITS = { timeoutMs: 240_000, maxRetries: 0, budgetMs: 270_000 } as const

export class AnthropicAiService implements AiService {
  constructor(
    private readonly model = DEFAULT_AI_MODEL,
    private readonly limits: { timeoutMs?: number; maxRetries?: number } = CLOUD_AI_LIMITS,
    private readonly artworkLimits: { timeoutMs: number; maxRetries: number; budgetMs: number } = CLOUD_ARTWORK_LIMITS,
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

  // ออกแบบหน้าตาบน template ที่เลือก: วงรอบ designArtwork เดิม (parse → ตรวจแผง → รอบแก้ ≤ 1) ใต้งบเวลารวม + สะสม usage ทุกรอบ
  async generateArtwork(apiKey: string, input: AiArtworkInput, model = this.model): Promise<AiArtworkOutput> {
    const { ask, usage, report } = apiAskWithUsage(apiKey, model, {
      timeoutMs: this.artworkLimits.timeoutMs,
      maxRetries: this.artworkLimits.maxRetries,
      deadlineMs: Date.now() + this.artworkLimits.budgetMs,
    })
    try {
      const result = await designArtwork(ask, input)
      // ตอบกลับมาแต่ไม่มีแบบให้ใช้เลย (ผิด schema ทุกรอบ) — นับเป็น provider ล้ม (คืนเครดิต) เหมือน box-spec ที่ไม่มีสเปก
      if (!result.plan) throw new AiProviderError('provider', new Error(result.issues[0]?.message ?? 'no usable plan'))
      return { result, model: result.model || model, usage: usage(), report: report() }
    } catch (error) {
      if (error instanceof AiProviderError) throw error
      if (error instanceof ArtworkResponseError) throw new AiProviderError(error.reason === 'refusal' ? 'refusal' : 'provider', error)
      if (error instanceof ArtworkDeadlineError) throw new AiProviderError('provider', error)
      if (error instanceof Anthropic.AuthenticationError) throw new AiProviderError('authentication', error)
      if (error instanceof Anthropic.RateLimitError) throw new AiProviderError('rate-limit', error)
      if (error instanceof Anthropic.APIError) throw new AiProviderError('provider', error)
      throw new AiProviderError('internal', error)
    }
  }
}
