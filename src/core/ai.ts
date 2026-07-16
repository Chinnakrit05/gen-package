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

export async function requestBoxSpec(
  prompt: string,
  current?: CurrentSpec,
  imageBase64?: string,
): Promise<AiBoxSpec> {
  const res = await fetch('/api/box-spec', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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
