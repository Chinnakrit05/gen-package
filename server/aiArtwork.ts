// AI ออกแบบ "หน้าตา" ลงบน template ที่มี: คำสั่ง + รูปอ้างอิง + โลโก้ → แผนงานศิลป์ (src/core/aiArtwork) → client แปลงเป็น Deco
// วงรอบ: AI เขียน JSON ตาม ARTWORK_SCHEMA → parse → ตรวจกับผังแผงจริง → ถ้ามี error (เช่น อ้างแผงที่ไม่มี) ส่งกลับให้แก้
// (สูงสุด MAX_ROUNDS) — ตำแหน่ง/ขนาดที่ล้นแผงไม่ต้องให้ AI แก้ เพราะ compileArtworkPlan ดันเข้ากรอบเองได้
// เปิดเฉพาะ local dev (isLegacyAiRouteEnabled) — cloud/เครดิตตามมาทีหลัง (ต้องมีงานเบื้องหลังเพราะคำตอบยาวกว่า box-spec มาก)
import type { IncomingMessage, ServerResponse } from 'node:http'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import Anthropic from '@anthropic-ai/sdk'
import {
  ART_MAX_ELEMENTS,
  ART_MIN_TEXT_MM,
  ART_SAFE_MM,
  ARTWORK_SCHEMA,
  checkArtworkPlan,
  describeArtIssues,
  parseArtworkPlan,
  type ArtFrontZone,
  type ArtIssue,
  type ArtworkPlan,
  type PanelBox,
} from '../src/core/aiArtwork'
import { FONTS } from '../src/core/artwork'
import { getMaterial, MATERIALS } from '../src/core/materials'
import { PRESETS } from '../src/core/presets'
import {
  boxSpecModelOptions,
  cliEnv,
  extractJson,
  hasClaudeCli,
  parseImage,
  readBody,
  resolveClaudeBin,
  send,
  SERVER_FALLBACK_BETA,
  type ClaudeUsage,
  type RefImage,
} from './boxSpec'
import { DEFAULT_AI_MODEL } from './config'
import { isLegacyAiRouteEnabled } from './http/legacyAiGuard'
import { readRequestApiKey } from './modules/ai/requestApiKey'

const execFileP = promisify(execFile)

export const MAX_ROUNDS = 2
const MAX_TOKENS = 24_000
export const MAX_IMAGES = 4
const MAX_PANELS = 80

export type ImageRole = 'reference' | 'logo'
export interface ArtworkImage extends RefImage {
  role: ImageRole
  assetId?: string // เฉพาะ logo: id ที่ client ใช้แทนรูปจริงตอนแปลง (src "asset:<id>")
  note?: string
}

export interface ArtworkRequest {
  prompt: string
  kind: 'box' | 'vessel' | 'pouch'
  template: string
  materialId: string
  box: { W: number; D: number; H: number }
  sheet: { w: number; h: number }
  panels: PanelBox[]
  fillColor: string | null
  existing: number // จำนวนชิ้นงานเดิม (0 = งานว่าง)
  images: ArtworkImage[]
  front?: ArtFrontZone | null // ภาชนะทรงกระบอก: ช่วงด้านหน้าที่อ่านได้ตรง (client คำนวณจาก labelFrontZone)
}

export interface ArtworkRound {
  attempt: number
  plan: ArtworkPlan | null
  issues: ArtIssue[]
  ok: boolean
}

export interface ArtworkResult {
  ok: boolean
  plan: ArtworkPlan | null
  issues: ArtIssue[]
  rounds: ArtworkRound[]
  model: string
  mock: boolean
}

// raw = JSON ที่แกะได้ (null = คำตอบไม่มี JSON object → designArtwork ส่งกลับให้แก้เป็นรอบถัดไป), text = คำตอบดิบไว้เล่นซ้ำในรอบแก้
export type AskArtwork = (messages: Anthropic.MessageParam[]) => Promise<{ raw: unknown; model: string; text?: string }>

// โมเดลตอบกลับมาแต่ใช้ไม่ได้ (refusal / ถูกตัดที่ max_tokens) — cloud แยก refusal ไว้บอกผู้ใช้ให้ปรับคำขอ และคืนเครดิต
// (คำตอบที่ไม่มี JSON ไม่ใช่ error: คืน raw null ให้วงรอบส่งกลับไปแก้)
export class ArtworkResponseError extends Error {
  constructor(readonly reason: 'refusal' | 'max_tokens', message: string) {
    super(message)
    this.name = 'ArtworkResponseError'
  }
}

// หมดงบเวลารวมทุกรอบ (cloud) ก่อนเริ่มรอบถัดไป — designArtwork คืนแบบล่าสุดที่มีแทนการล้มทั้งคำขอ
export class ArtworkDeadlineError extends Error {
  constructor() {
    super('หมดเวลาออกแบบ')
    this.name = 'ArtworkDeadlineError'
  }
}

// รอบหนึ่งต้องมีเวลาอย่างน้อยเท่านี้ ไม่งั้นไม่เริ่ม (เริ่มแล้วโดน timeout = เสียเงินเปล่า)
const MIN_ROUND_MS = 45_000

export interface ApiAskLimits {
  timeoutMs: number
  maxRetries: number
  deadlineMs?: number // epoch ms: งบเวลารวมทุกรอบ (cloud ต้องจบก่อน maxDuration ของ function)
}

export const ARTWORK_SYSTEM = `คุณคือนักออกแบบกราฟิกบรรจุภัณฑ์มืออาชีพ หน้าที่คือออกแบบ "หน้าตา" (ลาย ข้อความ โลโก้ ภาพประกอบ) ลงบนแผ่นคลี่ของบรรจุภัณฑ์
ที่ลูกค้าเลือกไว้แล้ว โดยเขียนเป็น JSON ตาม schema ที่ระบบกำหนด (แผนงานศิลป์) — คุณไม่ต้องรู้ผังแผ่นคลี่ ระบบให้ "รายการแผง" พร้อมขนาดและบทบาท
ทุกชิ้นงานอ้างแผงด้วย panel id และพิกัด x,y เป็น มม. จากมุมซ้ายบนของแผงนั้น ระบบจะวางลงแผ่นคลี่ วัดความกว้างข้อความด้วยฟอนต์จริง
ตัดบรรทัด/ย่อชิ้นที่ล้นแผง และกันระยะขอบ ${ART_SAFE_MM} มม. ให้เอง

## ชิ้นงาน (elements เรียงจากชั้นล่างสุดขึ้นบน: แถบสี/พื้น ก่อน แล้วค่อยรูปและข้อความ)
- text: ข้อความ (หลายบรรทัดด้วย \\n) size = ความสูงตัวอักษร มม. (ชื่อแบรนด์บนหน้ากล่อง 10-18, ชื่อสินค้า 6-10, ข้อมูล 3-4, เล็กสุด ${ART_MIN_TEXT_MM})
  anchor: "center" ทำให้ x เป็นจุดกึ่งกลางข้อความ (จัดกลางแผง: x = กว้างแผง/2) · font: ${FONTS.map((f) => `${f.id} (${f.nameTh})`).join(', ')}
  weight "700" = หนา · ls ระยะห่างตัวอักษร % · grad ไล่สีตัวอักษร · fx เอฟเฟกต์ (drop/background/hollow/splice/double/echo/glow/long) ใช้พอประมาณ
  curve ใช้ได้เฉพาะข้อความอังกฤษ/ตัวเลข (ภาษาไทยห้าม สระจะหลุด)
- shape: rect/ellipse/line/triangle/polygon/star — แถบสี กรอบ เส้นคั่น พื้นหลังป้าย (fill/stroke เป็น #rrggbb หรือ none, grad ไล่สีได้)
- image: src เป็นหนึ่งใน
  · "preset:<id>:<#สี>" ลายจากไลบรารี: ${PRESETS.map((p) => `${p.id} (${p.nameTh})`).join(', ')}
  · "asset:<id>" รูปที่ลูกค้าอัปโหลด (ระบบบอก id ให้ในคำขอ เช่น โลโก้) — ต้องใช้เมื่อลูกค้าแนบโลโก้ วางให้เด่นบนหน้ากล่อง
  · "svg:<svg viewBox=\\"0 0 W H\\">…</svg>" ภาพเวกเตอร์ที่คุณวาดเอง (ภาพหลัก ไอคอน ลายประดับ บาร์โค้ดจำลอง) ใช้ path/rect/circle/ellipse/polygon/
    text/linearGradient ได้ ห้าม script/style/image/use/ลิงก์ภายนอก ความยาวต่อรูปไม่เกิน 60,000 ตัวอักษร — วาดให้เรียบง่ายแต่สวย (flat/line art)
  w = กว้าง มม. (h ไม่ใส่ = ตามสัดส่วนรูป)
- path: รูปวาดเองจากจุด anchors (0..1 ในกรอบ w×h) สำหรับเส้นโค้ง/คลื่น/รูปปิดง่าย ๆ
- nutrition: ตารางโภชนาการแบบ อย. (ใช้กับอาหาร/เครื่องดื่ม) ความสูงระบบคำนวณเอง (~1.2×w)
- ทุกชิ้นมี rot (องศา), opacity, finish (ฟอยล์ทอง/เงิน/โรสโกลด์, spot UV, ปั๊มนูน/จม — ใช้กับชื่อแบรนด์หรือตราเท่านั้น ถ้าเหมาะกับงานพรีเมียม)
- fillColor = สีพื้นทั้งแพ็กเกจ; background = SVG ยืดคลุมทั้งแผ่น (ลายพื้น/ไล่สี) ใส่เมื่อต้องการพื้นที่ไม่ใช่สีเรียบ

## หลักการออกแบบ
- อ่านบทบาทของแผงจากรายการที่ระบบให้: ผนังหน้า = ชื่อแบรนด์ ชื่อสินค้า สโลแกน ภาพหลัก ปริมาณสุทธิ · ผนังหลัง = ส่วนประกอบ วิธีใช้/เก็บ ผู้ผลิต
  บาร์โค้ด เลขทะเบียน · ผนังข้าง = จุดขาย/ตารางโภชนาการ · ฝา = แบรนด์ซ้ำเล็ก ๆ · ปีกทากาว ห้ามวาง · ลิ้นกันฝุ่น/ลิ้นเสียบ วางได้แค่ลายพื้น
- ฉลากขวด/หลอด (แผง label): ด้านหน้าอยู่กึ่งกลางความกว้างของฉลาก ด้านหลังอยู่สองข้าง (ซ้าย-ขวาสุดคือหลังขวด) · ถุง: แผง front/back แยก หรือ film ผืนเดียว
- ใช้สีไม่เกิน 3-4 สี มีลำดับชั้นชัด (ใหญ่-กลาง-เล็ก) เว้นที่ว่าง ไม่ยัดจนแน่น ตัวอักษรสีตัดกับพื้นให้อ่านออก
- ข้อมูลที่ต้องถูกต้องตามกฎหมาย (เลข อย., บาร์โค้ด GS1, ส่วนประกอบจริง, ที่อยู่ผู้ผลิต) ถ้าลูกค้าไม่ได้ให้ ให้ใส่เป็นช่องกรอก เช่น "เลขสารบบอาหาร: [กรอก]"
  ห้ามแต่งตัวเลขขึ้นเอง บาร์โค้ดวาดเป็นภาพจำลองแล้วเขียนกำกับว่า "ตัวอย่างบาร์โค้ด"
- รูปอ้างอิงที่ลูกค้าแนบ = แรงบันดาลใจเรื่องโทนสี อารมณ์ สไตล์ตัวอักษร (ห้ามลอกยกมา) · โลโก้ที่แนบ = ต้องวางจริงด้วย asset id
- จำนวนชิ้น 8-${Math.min(60, ART_MAX_ELEMENTS)} ชิ้นกำลังดี ตั้ง id สื่อความหมาย (brand, product-name, slogan, hero, ingredients …)

## วิธีตอบ
- ตอบ JSON ตาม schema เท่านั้น ถ้าได้รายการข้อผิดพลาดกลับมา ให้ส่ง JSON ฉบับแก้แล้ว "ทั้งฉบับ"
- explanation: อธิบายแนวคิด 1-3 ประโยคเป็นภาษาไทย และบอกสิ่งที่ลูกค้าต้องกรอกเอง`

const KIND_TH: Record<ArtworkRequest['kind'], string> = { box: 'กล่องพับ', vessel: 'ฉลากภาชนะ (ขวด/โหล/หลอด)', pouch: 'ถุงฟิล์ม' }

export function buildArtworkUserContent(req: ArtworkRequest): string {
  const mat = MATERIALS.find((m) => m.id === req.materialId)
  const lines: string[] = [
    `ชนิดงาน: ${KIND_TH[req.kind]} (template ${req.template}) วัสดุ ${mat ? `${mat.nameTh} (${mat.id})` : req.materialId} ขนาด W×D×H = ${req.box.W}×${req.box.D}×${req.box.H} มม.`,
    `แผ่นคลี่ ${req.sheet.w.toFixed(1)}×${req.sheet.h.toFixed(1)} มม. — แผงที่วางชิ้นงานได้ (id: กว้าง×สูง มม. — บทบาท):`,
    ...req.panels.map((p) => `- ${p.id}: ${p.w.toFixed(1)}×${p.h.toFixed(1)} — ${p.role}`),
    req.fillColor ? `สีพื้นปัจจุบัน ${req.fillColor} (เปลี่ยนได้)` : 'ยังไม่มีสีพื้น',
    req.existing > 0 ? `งานนี้มีชิ้นงานเดิม ${req.existing} ชิ้น — แบบใหม่ของคุณจะใช้แทนหรือเพิ่มต่อตามที่ลูกค้าเลือก ออกแบบให้ครบในตัว` : 'งานว่าง ออกแบบใหม่ทั้งหมด',
  ]
  if (req.front) {
    const fw = req.front.x1 - req.front.x0
    lines.push(
      `ด้านหน้าที่อ่านได้ตรงของภาชนะทรงกระบอก: แผง ${req.front.panel} ช่วง x = ${req.front.x0.toFixed(1)}–${req.front.x1.toFixed(1)} มม. (กว้าง ${fw.toFixed(1)} มม.) — ` +
        `ชื่อแบรนด์ ข้อความหลัก และโลโก้ต้องอยู่ในช่วงนี้และกว้างไม่เกิน ${fw.toFixed(0)} มม. (ส่วนที่เลยจะอ้อมขอบโค้งจนอ่านไม่ออก ระบบจะตัดบรรทัด/ย่อให้เอง); ` +
        `ด้านข้าง/ด้านหลังใช้วางข้อมูลรอง แถบสีหรือลายพื้นพันรอบได้`,
    )
  }
  if (req.images.length) {
    lines.push('รูปที่แนบมา (ตามลำดับ):')
    req.images.forEach((im, i) => {
      lines.push(
        im.role === 'logo'
          ? `[${i + 1}] โลโก้ของลูกค้า — วางด้วย src "asset:${im.assetId ?? 'logo'}"${im.note ? ` (${im.note})` : ''}`
          : `[${i + 1}] รูปอ้างอิงสไตล์${im.note ? ` (${im.note})` : ''}`,
      )
    })
  }
  lines.push(`คำขอลูกค้า: ${req.prompt}`)
  return lines.join('\n')
}

function feedback(issues: ArtIssue[]): string {
  return `ระบบตรวจแผนแล้วพบปัญหา:\n${describeArtIssues(issues)}\n\nแก้แล้วส่ง JSON ใหม่ทั้งฉบับ (คง id เดิมเท่าที่ทำได้)`
}

// รูปแนบไปกับข้อความรอบแรกเท่านั้น (รอบแก้ไขใช้บริบทเดิม)
export function firstUserMessage(req: ArtworkRequest): Anthropic.MessageParam {
  const content: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> = []
  req.images.forEach((im, i) => {
    content.push({ type: 'text', text: `[${i + 1}] ${im.role === 'logo' ? 'โลโก้ของลูกค้า' : 'รูปอ้างอิงสไตล์'}` })
    content.push({ type: 'image', source: { type: 'base64', media_type: im.mediaType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif', data: im.data } })
  })
  content.push({ type: 'text', text: buildArtworkUserContent(req) })
  return { role: 'user', content }
}

export async function designArtwork(ask: AskArtwork, req: ArtworkRequest, maxRounds = MAX_ROUNDS): Promise<ArtworkResult> {
  const messages: Anthropic.MessageParam[] = [firstUserMessage(req)]
  const rounds: ArtworkRound[] = []
  let model = ''
  let last: { plan: ArtworkPlan; issues: ArtIssue[] } | null = null
  for (let attempt = 1; attempt <= maxRounds; attempt++) {
    let answer: Awaited<ReturnType<AskArtwork>>
    try {
      answer = await ask(messages)
    } catch (error) {
      // งบเวลาหมดก่อนรอบแก้ แต่มีแบบจากรอบก่อนอยู่แล้ว → ส่งแบบนั้นไป (client ตัดชิ้นที่ผิดออกตอน compile) ดีกว่าล้มทั้งคำขอ
      if (error instanceof ArtworkDeadlineError && last) break
      throw error
    }
    model = answer.model
    const parsed = parseArtworkPlan(answer.raw)
    let issues: ArtIssue[]
    let plan: ArtworkPlan | null = null
    if (!parsed.ok) issues = parsed.issues
    else {
      plan = parsed.plan
      issues = [...parsed.issues, ...checkArtworkPlan(plan, req.panels)]
      last = { plan, issues }
    }
    const ok = plan !== null && !issues.some((i) => i.severity === 'error')
    rounds.push({ attempt, plan, issues, ok })
    if (ok && plan) return { ok: true, plan, issues, rounds, model, mock: false }
    // ชิ้นที่ผิดถูกตัดทิ้งตอน parse แล้ว — ถ้ายังเหลือชิ้นดีพอ ไม่ต้องเสียรอบแก้ (ประหยัดเวลา/ค่าใช้จ่าย)
    if (plan && plan.elements.length >= 4 && !issues.some((i) => i.code === 'panel-unknown')) {
      return { ok: true, plan, issues, rounds, model, mock: false }
    }
    messages.push(
      { role: 'assistant', content: answer.text || JSON.stringify(answer.raw) },
      { role: 'user', content: feedback(issues.filter((i) => i.severity === 'error')) },
    )
  }
  return { ok: false, plan: last?.plan ?? null, issues: last?.issues ?? rounds[rounds.length - 1].issues, rounds, model, mock: false }
}

// --- backends ---

function artworkModelOptions(model: string) {
  const base = boxSpecModelOptions(model)
  return { effort: base.effort ? ('medium' as const) : undefined, serverFallback: base.serverFallback }
}

// ตัวเรียก Claude API ที่สะสม usage ทุกรอบ (cloud เก็บลง ai_requests) และเคารพงบเวลารวม: แต่ละรอบรอไม่เกินเวลาที่เหลือ
export function apiAskWithUsage(
  apiKey: string,
  model: string,
  limits: ApiAskLimits = { timeoutMs: 240_000, maxRetries: 1 },
): { ask: AskArtwork; usage: () => ClaudeUsage | null } {
  const client = new Anthropic({ apiKey, timeout: limits.timeoutMs, maxRetries: limits.maxRetries })
  const options = artworkModelOptions(model)
  let total: ClaudeUsage | null = null
  const ask: AskArtwork = async (messages) => {
    let timeout = limits.timeoutMs
    if (limits.deadlineMs !== undefined) {
      const remaining = limits.deadlineMs - Date.now()
      if (remaining < MIN_ROUND_MS) throw new ArtworkDeadlineError()
      timeout = Math.min(timeout, remaining)
    }
    const params = {
      model,
      max_tokens: MAX_TOKENS,
      // system + schema คงที่ทุกคำขอ → cache ไว้ (รอบแก้/คำขอซ้ำภายใน 5 นาทีอ่านจาก cache)
      system: [{ type: 'text' as const, text: ARTWORK_SYSTEM + JSON_INSTRUCTION, cache_control: { type: 'ephemeral' as const } }],
      messages,
      ...(options.effort ? { output_config: { effort: options.effort } } : {}),
    }
    const msg = options.serverFallback
      ? await client.beta.messages.create(
          {
            ...params,
            betas: [SERVER_FALLBACK_BETA],
            // @ts-expect-error fallbacks: "default" ยังไม่อยู่ใน type ของ SDK 0.111 (ดู boxSpec.ts)
            fallbacks: 'default',
          },
          { timeout },
        )
      : await client.messages.create(params, { timeout })
    const u = msg.usage
    total = {
      inputTokens: (total?.inputTokens ?? 0) + u.input_tokens,
      outputTokens: (total?.outputTokens ?? 0) + u.output_tokens,
      cacheReadTokens: (total?.cacheReadTokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      cacheCreationTokens: (total?.cacheCreationTokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    }
    if (msg.stop_reason === 'refusal') throw new ArtworkResponseError('refusal', 'โมเดลปฏิเสธคำขอ ลองปรับคำอธิบายหรือรูปที่แนบ')
    if (msg.stop_reason === 'max_tokens') throw new ArtworkResponseError('max_tokens', 'แบบที่ออกแบบยาวเกินไป ถูกตัดก่อนจบ — ลองขอให้เรียบง่ายลง')
    const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    return { raw: extractJson(text), model: msg.model, text }
  }
  return { ask, usage: () => total }
}

export function apiAsk(apiKey: string, model: string): AskArtwork {
  return apiAskWithUsage(apiKey, model).ask
}

// schema ของงานศิลป์ส่งเป็น "ข้อความใน prompt" ทั้ง API และ CLI — ส่งเป็น structured outputs (output_config.format) ไม่ได้:
// มีช่อง nullable/anyOf ~75 ช่อง เกินเพดาน API 16 ช่องต่อคำขอ (400 "too many parameters with union types") และบีบให้ต่ำกว่านั้น
// ต้องใส่ค่าหลอกทุกช่องทุกชิ้น (คำตอบยาวขึ้นหลายพันโทเคน) — ตัว parse ใจกว้างอยู่แล้ว + คำตอบที่ไม่มี JSON ได้รอบแก้
export const JSON_INSTRUCTION =
  `\n\n## รูปแบบคำตอบ (สำคัญมาก)\nตอบเป็น JSON object เดียวตาม schema นี้เท่านั้น ห้ามมีข้อความอื่นหรือ markdown fence:\n` +
  JSON.stringify(ARTWORK_SCHEMA)

export function cliAsk(model: string | undefined, oauthToken: string | undefined, images: ArtworkImage[]): AskArtwork {
  return async (messages) => {
    // CLI รับรูปตรงไม่ได้ — เขียนเป็นไฟล์ชั่วคราวให้เปิดอ่านเอง (ลบทิ้งเมื่อเสร็จ)
    const files: string[] = []
    for (const im of images) {
      const ext = im.mediaType.split('/')[1].replace('jpeg', 'jpg')
      const p = path.join(os.tmpdir(), `art-ref-${randomUUID()}.${ext}`)
      await writeFile(p, Buffer.from(im.data, 'base64'))
      files.push(p)
    }
    try {
      const imgNote = files.length
        ? `ลูกค้าแนบรูปไว้ที่ไฟล์ (เปิดดูด้วยเครื่องมือ Read ก่อนออกแบบ):\n${files.map((f, i) => `[${i + 1}] ${images[i].role === 'logo' ? 'โลโก้' : 'รูปอ้างอิง'}: ${f}`).join('\n')}\n\n`
        : ''
      const transcript = messages
        .map((m) => {
          const body = typeof m.content === 'string' ? m.content : m.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n')
          return `## ${m.role === 'user' ? 'ลูกค้า/ระบบ' : 'คำตอบก่อนหน้าของคุณ'}\n${body}`
        })
        .join('\n\n')
      const args = ['-p', `${ARTWORK_SYSTEM}${JSON_INSTRUCTION}\n\n${imgNote}${transcript}`, '--output-format', 'json']
      if (model) args.push('--model', model)
      const pending = execFileP(resolveClaudeBin(), args, { timeout: 420_000, maxBuffer: 8 * 1024 * 1024, cwd: os.tmpdir(), env: cliEnv(oauthToken) })
      pending.child.stdin?.end()
      const { stdout } = await pending
      const envelope = JSON.parse(stdout) as { is_error?: boolean; result?: string }
      if (envelope.is_error || typeof envelope.result !== 'string') throw new Error('Claude CLI ตอบกลับผิดรูปแบบ')
      return { raw: extractJson(envelope.result), model: model ?? 'claude-cli', text: envelope.result }
    } finally {
      for (const f of files) void unlink(f).catch(() => {})
    }
  }
}

// โหมดจำลอง (ไม่มีคีย์/CLI): แบบง่าย ๆ จากคำขอ ให้ลอง UI ได้ครบวงจร
export function mockArtwork(req: ArtworkRequest): ArtworkPlan {
  const printable = req.panels.filter((p) => p.print)
  const byId = (id: string) => printable.find((p) => p.id === id)
  const main = byId('front') ?? byId('label') ?? byId('film') ?? byId('card') ?? byId('sticker') ?? [...printable].sort((a, b) => b.w * b.h - a.w * a.h)[0]
  if (!main) return { name: 'จำลอง', fillColor: null, background: null, elements: [], explanation: '(จำลอง) ไม่พบแผงที่พิมพ์ได้' }
  const back = byId('back')
  // \p{M}: สระ/วรรณยุกต์ไทยเป็นเครื่องหมายกำกับ ไม่ใช่ \p{L} — ไม่ใส่จะได้ "คร" แทน "ครีม"
  const words = req.prompt.replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  const brand = words.slice(0, 2).join(' ') || 'แบรนด์ของคุณ'
  const palettes = [['#1d4e5c', '#f4c27a', '#ffffff'], ['#5b2a86', '#ffd166', '#ffffff'], ['#2f5d3a', '#e9c46a', '#ffffff'], ['#8a2d3b', '#f2d7a7', '#ffffff']]
  const pal = palettes[[...req.prompt].reduce((h, c) => (h + c.charCodeAt(0)) % palettes.length, 0)]
  const logo = req.images.find((im) => im.role === 'logo')
  const cx = main.w / 2
  const elements: ArtworkPlan['elements'] = [
    { type: 'shape', id: 'band', panel: main.id, x: 0, y: main.h * 0.72, shape: 'rect', w: main.w, h: main.h * 0.28, fill: pal[1], stroke: 'none', strokeW: 0 },
    { type: 'text', id: 'brand', panel: main.id, x: cx, y: main.h * 0.12, anchor: 'center', text: brand, size: Math.min(14, main.w / 7), color: pal[2], font: 'prompt', weight: 700 },
    { type: 'text', id: 'product', panel: main.id, x: cx, y: main.h * 0.3, anchor: 'center', text: req.prompt.slice(0, 40), size: Math.min(6, main.w / 14), color: pal[2], font: 'sarabun' },
    { type: 'image', id: 'badge', panel: main.id, x: cx - Math.min(18, main.w / 4), y: main.h * 0.42, w: Math.min(36, main.w / 2), src: `preset:badge-seal:${pal[1]}` },
    { type: 'text', id: 'net', panel: main.id, x: cx, y: main.h * 0.82, anchor: 'center', text: 'ปริมาณสุทธิ [กรอก]', size: 4, color: pal[0], font: 'sarabun', weight: 700 },
  ]
  if (logo) elements.push({ type: 'image', id: 'logo', panel: main.id, x: main.w - Math.min(22, main.w / 4) - 4, y: 4, w: Math.min(18, main.w / 5), src: `asset:${logo.assetId ?? 'logo'}` })
  if (back) {
    elements.push(
      { type: 'text', id: 'ingredients', panel: back.id, x: 4, y: 6, text: 'ส่วนประกอบ: [กรอก]\nวิธีเก็บรักษา: [กรอก]\nผลิตโดย: [กรอก]', size: 3.5, color: pal[2], font: 'sarabun' },
      { type: 'text', id: 'fda', panel: back.id, x: 4, y: back.h - 14, text: 'เลขสารบบอาหาร: [กรอก]', size: 3, color: pal[2], font: 'sarabun' },
    )
  }
  return { name: `แบบจำลอง ${brand}`, fillColor: pal[0], background: null, elements, explanation: `(จำลอง — ไม่ได้เรียก AI) วางชื่อ "${brand}" เด่นบนแผง ${main.id} พร้อมแถบสีและตราประทับ ข้อมูลผลิตเป็นช่อง [กรอก]` }
}

// --- HTTP handler (Vite middleware, local dev เท่านั้น) ---

const HEX = /^#[0-9a-fA-F]{6}$/

export function parseArtworkRequest(body: Record<string, unknown>): ArtworkRequest {
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!prompt || prompt.length > 2000) throw new Error('prompt')
  const kind = body.kind === 'vessel' || body.kind === 'pouch' ? body.kind : 'box'
  const template = typeof body.template === 'string' ? body.template.slice(0, 40) : 'tuck-end'
  const materialId = typeof body.materialId === 'string' && MATERIALS.some((m) => m.id === body.materialId) ? body.materialId : getMaterial('carton-300').id
  const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null)
  const b = (body.box ?? {}) as Record<string, unknown>
  const W = num(b.W, 1, 2000), D = num(b.D, 1, 2000), H = num(b.H, 1, 2000)
  if (W === null || D === null || H === null) throw new Error('box')
  const s = (body.sheet ?? {}) as Record<string, unknown>
  const sw = num(s.w, 1, 5000), sh = num(s.h, 1, 5000)
  if (sw === null || sh === null) throw new Error('sheet')
  if (!Array.isArray(body.panels) || !body.panels.length || body.panels.length > MAX_PANELS) throw new Error('panels')
  const panels: PanelBox[] = body.panels.map((p: unknown) => {
    const o = (p ?? {}) as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id.slice(0, 40) : ''
    const x0 = num(o.x0, -5000, 5000), y0 = num(o.y0, -5000, 5000), x1 = num(o.x1, -5000, 5000), y1 = num(o.y1, -5000, 5000)
    if (!id || x0 === null || y0 === null || x1 === null || y1 === null || x1 <= x0 || y1 <= y0) throw new Error('panel')
    return { id, x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, role: typeof o.role === 'string' ? o.role.slice(0, 160) : `แผง ${id}`, print: o.print !== false }
  })
  const fillColor = typeof body.fillColor === 'string' && HEX.test(body.fillColor) ? body.fillColor : null
  const existing = num(body.existing, 0, 10_000) ?? 0
  const images: ArtworkImage[] = []
  if (Array.isArray(body.images)) {
    if (body.images.length > MAX_IMAGES) throw new Error('images')
    for (const raw of body.images) {
      const im = parseImage(raw)
      if (!im) throw new Error('image')
      const o = raw as Record<string, unknown>
      const role: ImageRole = o.role === 'logo' ? 'logo' : 'reference'
      const assetId = typeof o.assetId === 'string' ? o.assetId.replace(/[^\w-]/g, '').slice(0, 40) : undefined
      const note = typeof o.note === 'string' ? o.note.slice(0, 120) : undefined
      images.push({ ...im, role, ...(assetId ? { assetId } : {}), ...(note ? { note } : {}) })
    }
  }
  // ช่วงด้านหน้า (ไม่บังคับ): ต้องอ้างแผงที่มีและอยู่ในความกว้างแผง ไม่งั้นเมิน (เป็นแค่คำแนะนำให้ AI)
  let front: ArtFrontZone | null = null
  const f = (body.front ?? null) as Record<string, unknown> | null
  if (f && typeof f === 'object' && typeof f.panel === 'string') {
    const target = panels.find((p) => p.id === f.panel)
    const x0 = num(f.x0, 0, 5000), x1 = num(f.x1, 0, 5000)
    if (target && x0 !== null && x1 !== null && x1 > x0 && x1 <= target.w + 0.5) front = { panel: target.id, x0, x1 }
  }
  return { prompt, kind, template, materialId, box: { W, D, H }, sheet: { w: sw, h: sh }, panels, fillColor, existing, images, ...(front ? { front } : {}) }
}

export async function handleAiArtwork(req: IncomingMessage, res: ServerResponse, env: Record<string, string | undefined>): Promise<void> {
  if (!isLegacyAiRouteEnabled(env)) {
    send(res, 404, { error: 'endpoint นี้เปิดเฉพาะ local dev' })
    return
  }
  if (req.method !== 'POST') {
    send(res, 405, { error: 'ต้องเป็น POST เท่านั้น' })
    return
  }
  const origin = req.headers.origin
  const allowedOrigins = new Set(['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5175', 'http://127.0.0.1:5175'])
  if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && !allowedOrigins.has(origin))) {
    send(res, 403, { error: 'ต้องเรียกจากหน้าเว็บของแอปเท่านั้น' })
    return
  }
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
    send(res, 415, { error: 'content-type ต้องเป็น application/json' })
    return
  }
  let request: ArtworkRequest
  try {
    request = parseArtworkRequest(JSON.parse(await readBody(req)) as Record<string, unknown>)
  } catch {
    send(res, 400, { error: `รูปแบบคำขอไม่ถูกต้อง (prompt 1-2000 ตัวอักษร, panels 1-${MAX_PANELS}, รูปไม่เกิน ${MAX_IMAGES})` })
    return
  }
  const requestApiKey = readRequestApiKey(req.headers)
  if (requestApiKey === null) {
    send(res, 400, { error: 'รูปแบบ Anthropic API key ไม่ถูกต้อง' })
    return
  }
  const backend = requestApiKey ? 'api' : env.BOX_SPEC_BACKEND
  const apiKey = requestApiKey ?? env.ANTHROPIC_API_KEY
  const model = env.BOX_SPEC_MODEL || DEFAULT_AI_MODEL
  try {
    let ask: AskArtwork | null = null
    if (backend === 'api' || (!backend && apiKey)) {
      if (!apiKey) {
        send(res, 500, { error: 'BOX_SPEC_BACKEND=api แต่ไม่ได้ตั้ง ANTHROPIC_API_KEY' })
        return
      }
      ask = apiAsk(apiKey, model)
    } else if ((backend === 'cli' || !backend) && (await hasClaudeCli())) {
      ask = cliAsk(env.BOX_SPEC_MODEL, env.CLAUDE_CODE_OAUTH_TOKEN, request.images)
    } else if (backend === 'cli') {
      send(res, 500, { error: 'BOX_SPEC_BACKEND=cli แต่ไม่พบคำสั่ง claude ในเครื่อง' })
      return
    }
    if (!ask) {
      const plan = mockArtwork(request)
      const issues = checkArtworkPlan(plan, request.panels)
      const result: ArtworkResult = { ok: true, plan, issues, rounds: [{ attempt: 1, plan, issues, ok: true }], model: 'mock', mock: true }
      send(res, 200, result)
      return
    }
    send(res, 200, await designArtwork(ask, request))
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) send(res, 502, { error: 'Anthropic API key ไม่ถูกต้อง' })
    else if (err instanceof Anthropic.RateLimitError) send(res, 429, { error: 'เรียกถี่เกินไป รอสักครู่แล้วลองใหม่' })
    else if (err instanceof Anthropic.APIError) {
      send(res, 502, { error: `Claude API ขัดข้อง (${err.status ?? '?'}): ${err.message.replace(/sk-ant-[\w-]+/g, '[key]').slice(0, 400)}` })
    } else send(res, 502, { error: err instanceof Error ? err.message.slice(0, 300) : 'เกิดข้อผิดพลาดภายใน' })
  }
}
