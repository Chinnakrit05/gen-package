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

export class AnthropicAiService implements AiService {
  constructor(private readonly model = 'claude-opus-4-8') {}

  async generateBoxSpec(apiKey: string, input: AiBoxSpecInput): Promise<BoxSpecResult> {
    try {
      return await askClaude(apiKey, this.model, input.prompt, input.current, input.image)
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) throw new AiProviderError('authentication')
      if (error instanceof Anthropic.RateLimitError) throw new AiProviderError('rate-limit')
      if (error instanceof Anthropic.APIError) throw new AiProviderError('provider')
      throw new AiProviderError('internal')
    }
  }
}
