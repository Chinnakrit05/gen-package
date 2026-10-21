export interface AiBoxSpec {
  template: string
  materialId: string
  W: number
  D: number
  H: number
  handle: boolean
  assumptions: string[]
  layoutNote: string
  reasoning: string
  mock: boolean
}

export interface CurrentSpec {
  template: string
  materialId: string
  W: number
  D: number
  H: number
  handle: boolean
}

// --- AI ออกแบบหน้าตาบน template ที่มี (local legacy route /api/ai-artwork; cloud ตามมาทีหลัง) ---

export interface ArtworkPanelInput {
  id: string
  x0: number
  y0: number
  x1: number
  y1: number
  w: number
  h: number
  role: string
  print: boolean
}

export interface ArtworkImageInput {
  data: string // base64 ไม่มี prefix
  mediaType: string
  role: 'reference' | 'logo'
  assetId?: string
  note?: string
}

export interface ArtworkRequestInput {
  prompt: string
  kind: 'box' | 'vessel' | 'pouch'
  template: string
  materialId: string
  box: { W: number; D: number; H: number }
  sheet: { w: number; h: number }
  panels: ArtworkPanelInput[]
  fillColor: string | null
  existing: number
  images: ArtworkImageInput[]
}

export interface ArtworkIssue {
  severity: 'error' | 'warning'
  code: string
  index?: number
  message: string
}

// plan เป็น ArtworkPlan ของ src/core/aiArtwork (ประกาศหลวม ๆ ที่นี่เพื่อไม่ให้ core ผูกกับ client API)
export interface ArtworkResponse {
  ok: boolean
  plan: unknown | null
  issues: ArtworkIssue[]
  rounds: { attempt: number; ok: boolean; issues: ArtworkIssue[] }[]
  model: string
  mock: boolean
}

export async function requestArtworkPlan(input: ArtworkRequestInput, anthropicApiKey?: string): Promise<ArtworkResponse> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (anthropicApiKey) headers['x-packit-anthropic-api-key'] = anthropicApiKey
  const res = await fetch('/api/ai-artwork', { method: 'POST', headers, body: JSON.stringify(input) })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `เกิดข้อผิดพลาด (${res.status})`)
  }
  return (await res.json()) as ArtworkResponse
}

export async function requestBoxSpec(
  prompt: string,
  current?: CurrentSpec,
  imageBase64?: string,
  anthropicApiKey?: string,
): Promise<AiBoxSpec> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (anthropicApiKey) headers['x-packit-anthropic-api-key'] = anthropicApiKey
  const res = await fetch('/api/box-spec', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      prompt,
      current,
      image: imageBase64 ? { data: imageBase64, mediaType: 'image/jpeg' } : undefined,
    }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `เกิดข้อผิดพลาด (${res.status})`)
  }
  return (await res.json()) as AiBoxSpec
}
