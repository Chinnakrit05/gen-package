export type AiGenerationKind = 'artwork' | 'spec'

export interface AiHistoryEntry {
  id: string
  kind: AiGenerationKind | null
  status: 'reserved' | 'succeeded' | 'failed'
  createdAt: string
  settledAt: string | null
  creditUnits: number
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheCreationTokens: number | null
  hasImage: boolean | null
}

export interface AiHistoryPage {
  items: AiHistoryEntry[]
  nextCursor: string | null
}
