// รุ่น Claude ที่ให้เลือกทดสอบงาน AI ช่วงพัฒนา + ราคา Claude API ต่อ 1M โทเคน (USD, ราคา ณ ต.ค. 2026)
// server คิดค่าใช้จ่ายจาก usage ที่ API คืน "ต่อคำขอ" ตามรุ่นที่ตอบจริง (server-side fallback อาจส่งต่อให้อีกรุ่น)
// แล้วส่งสรุปให้ client แสดง — ราคาเปลี่ยนแก้ที่นี่ที่เดียว (ตารางเทียบรุ่น: docs/billing-freemium-pro.md §6)

export const AI_MODEL_CHOICES = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
] as const

export type AiModelChoice = (typeof AI_MODEL_CHOICES)[number]['id']

export const isAiModelChoice = (value: unknown): value is AiModelChoice =>
  AI_MODEL_CHOICES.some((choice) => choice.id === value)

export interface AiModelPrice {
  input: number // input ที่ไม่ได้มาจาก cache
  output: number // รวมโทเคนที่โมเดลคิดก่อนตอบ (thinking) — เป็นก้อนใหญ่ของค่าใช้จ่ายงานออกแบบลาย
  cacheRead: number // อ่าน system prompt จาก cache
  // prompt ยาวเกินเกณฑ์คิดอีกอัตรา (Haiku 5.5: เกิน 100K โทเคน) — cache อ่านปรับตามสัดส่วนเดียวกัน
  longPrompt?: { above: number; input: number; output: number }
}

// เขียน cache = 1.25 เท่าของราคา input (TTL 5 นาที — server ใส่ cache_control ephemeral ค่าเริ่มต้น)
export const CACHE_WRITE_MULTIPLIER = 1.25

export const AI_MODEL_PRICES: Record<string, AiModelPrice> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, longPrompt: { above: 100_000, input: 0.5, output: 2.5 } },
  // รุ่นที่ server-side fallback ส่งต่อไปตอบแทนได้ — คิดตามรุ่นที่ตอบจริง
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
}

export interface AiTokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

// ค่าใช้จ่ายของหนึ่งคำขอ (USD) — รุ่นที่ไม่รู้ราคา = null (ห้ามเดา)
export function aiRequestCostUsd(model: string, usage: AiTokenUsage): number | null {
  const price = AI_MODEL_PRICES[model]
  if (!price) return null
  const prompt = usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens
  const long = price.longPrompt && prompt > price.longPrompt.above ? price.longPrompt : null
  const input = long ? long.input : price.input
  const output = long ? long.output : price.output
  const cacheRead = long ? price.cacheRead * (long.input / price.input) : price.cacheRead
  return (
    usage.inputTokens * input +
    usage.cacheCreationTokens * input * CACHE_WRITE_MULTIPLIER +
    usage.cacheReadTokens * cacheRead +
    usage.outputTokens * output
  ) / 1_000_000
}

// สรุปการใช้งานของงาน AI หนึ่งครั้ง (รวมรอบแรก + รอบแก้) ที่ server ส่งให้ client ช่วงพัฒนา
export interface AiUsageReport extends AiTokenUsage {
  model: string // รุ่นที่ตอบคำขอสุดท้าย
  requests: number // จำนวนคำขอถึง Claude API
  costUsd: number | null // null = มีคำขอจากรุ่นที่ไม่รู้ราคา
}

// รวมคำขอหนึ่งครั้งเข้าสรุป — ค่าใช้จ่ายคิดต่อคำขอตามรุ่นที่ตอบคำขอนั้น
export function addAiUsage(report: AiUsageReport | null, model: string, usage: AiTokenUsage): AiUsageReport {
  const cost = aiRequestCostUsd(model, usage)
  return {
    model,
    requests: (report?.requests ?? 0) + 1,
    inputTokens: (report?.inputTokens ?? 0) + usage.inputTokens,
    outputTokens: (report?.outputTokens ?? 0) + usage.outputTokens,
    cacheReadTokens: (report?.cacheReadTokens ?? 0) + usage.cacheReadTokens,
    cacheCreationTokens: (report?.cacheCreationTokens ?? 0) + usage.cacheCreationTokens,
    costUsd: cost === null || (report && report.costUsd === null) ? null : (report?.costUsd ?? 0) + cost,
  }
}

export const aiModelLabel = (model: string): string =>
  AI_MODEL_CHOICES.find((choice) => choice.id === model)?.label ?? model

// อัตราแลกเปลี่ยนโดยประมาณ ใช้แสดงเป็นบาทเท่านั้น (Anthropic เรียกเก็บเป็น USD)
export const APPROX_THB_PER_USD = 34
