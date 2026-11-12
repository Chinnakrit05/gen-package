export type AiGenerationKind = 'artwork' | 'spec'

export interface AiHistoryEntry {
  id: string
  kind: AiGenerationKind | null
  status: 'reserved' | 'succeeded' | 'failed'
  createdAt: string
  settledAt: string | null
  creditUnits: number
}

export interface AiHistoryPage {
  items: AiHistoryEntry[]
  nextCursor: string | null
}
