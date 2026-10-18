// ทดลอง "ระดับ 2": AI ประกอบโครงสร้างกล่องใหม่ด้วยภาษาแผง (src/core/structure) แทนการเลือก template
// วงรอบ: AI เขียน JSON → parse → compile (วางแผง/ลิ้น + จำลองพับ + ตรวจ) → ถ้ามีข้อผิดพลาด ส่งรายการกลับให้ AI
// แก้ทั้งฉบับ (สูงสุด MAX_ROUNDS) — ผลผลิตได้จริงโดยโครงสร้าง เพราะ AI ไม่ได้วาดเส้นเอง
// เปิดเฉพาะ local dev (isLegacyAiRouteEnabled) — ยังไม่ผูกกับ billing/cloud
import type { IncomingMessage, ServerResponse } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import Anthropic from '@anthropic-ai/sdk'
import { getMaterial, MATERIALS } from '../src/core/materials'
import { compileStructure, describeIssues, type CompileResult } from '../src/core/structure/compile'
import { EXAMPLE_STRUCTURES, HANDLE_BOX_STRUCTURE, MAILER_STRUCTURE, TRAY_STRUCTURE, TUCK_END_STRUCTURE } from '../src/core/structure/examples'
import { parseStructure, STRUCTURE_SCHEMA, type BoxStructure, type StructureIssue } from '../src/core/structure/grammar'
import type { BoxParams } from '../src/core/types'
import {
  boxSpecModelOptions,
  cliEnv,
  extractJson,
  hasClaudeCli,
  readBody,
  resolveClaudeBin,
  send,
  SERVER_FALLBACK_BETA,
} from './boxSpec'
import { DEFAULT_AI_MODEL } from './config'
import { isLegacyAiRouteEnabled } from './http/legacyAiGuard'
import { readRequestApiKey } from './modules/ai/requestApiKey'

const execFileP = promisify(execFile)

export const MAX_ROUNDS = 3
const MAX_TOKENS = 16_000

const FOLDABLE = MATERIALS.filter((m) => m.foldable)

export const STRUCTURE_SYSTEM = `คุณคือวิศวกรโครงสร้างบรรจุภัณฑ์กระดาษ หน้าที่คือออกแบบ "โครงสร้างกล่องพับ" จากคำอธิบายของลูกค้า
โดยเขียนเป็น JSON ตาม schema ที่ระบบกำหนด (ภาษาแผง) — คุณไม่ต้องวาดเส้นหรือคำนวณระยะเผื่อความหนา ระบบจะวางแผงบนแผ่นคลี่
สร้างรูปร่างลิ้น คำนวณลำดับพับและชั้นวัสดุ แล้วตรวจความถูกต้องด้วยการจำลองพับจริงให้เอง

## ภาษาแผง
- แผ่นคลี่: แกน x ไปขวา y ลงล่าง หน่วย มม. แผงทุกแผงเป็นสี่เหลี่ยมผืนผ้า
- panels[]: มีแผงราก 1 แผง (attach = null, ระบุ w และ h) แผงอื่น "ต่อ" จากขอบของแผงแม่: attach = { to: id แผงแม่, edge: top|bottom|left|right, fold: 90|180 }
  แผงลูกยื่นออกไปนอกขอบนั้นเป็นระยะ size (ด้านที่ขนานกับขอบยาวเท่าขอบของแผงแม่เสมอ ไม่ต้องระบุ) — w/h ของแผงลูกใส่ null
- fold 90 = พับตั้งฉากเข้าด้านในกล่อง (ปกติ), 180 = พับทบแนบแผงแม่ (ผนังสองชั้น/ขอบม้วน), -90 = พับตั้งฉาก "ออกด้านนอก"
  (ใช้ทำแผงหูหิ้วที่ตั้งขึ้นจากปลายฝา), 0 = ต่อตรงไม่พับ (ยืดแผงให้สูงขึ้น เช่น ผนังหลังสูงเลยปากกล่องเป็นแผงป้าย)
- ขนาด (w, h, size, depth): ใช้สัญลักษณ์ "W" "D" "H" = ขนาดด้านในของกล่องที่ลูกค้าต้องการ (ระบบบวกความหนาวัสดุให้เอง),
  "W/2" "D/2" "H/2" = ครึ่งหนึ่ง, หรือตัวเลข มม. ตรง ๆ (1-400)
- kind ของแผง: "body" = ผนัง/ฐาน, "lid" = ฝาที่ปิดช่องเปิด (ระบบย่อให้สอดเข้าช่องได้เอง ตั้ง size เท่าความลึกของช่องที่ปิด เช่น ฝาปิดด้านบนของกล่องท่อ size "D"),
  "glue" = ปีกทากาวสำหรับประกบท่อ (size null = ความกว้างมาตรฐาน)
- flaps[]: ลิ้นจากคลังที่เกาะขอบว่างของแผง: on = id แผง, edge = ขอบ
  - "dust" ลิ้นกันฝุ่น คางหมู พับเข้าช่องเปิด (depth null = คำนวณจากช่องเปิด) — ใช้ที่ขอบปลายผนังข้างของกล่องท่อ หรือมุมถาด
  - "tuck" ลิ้นเสียบปลายฝา มุมมน ไถลเข้าด้านในผนังตรงข้าม — เกาะได้เฉพาะแผง kind "lid" ที่ขอบปลายฝา (depth null = ความยาวมาตรฐาน)
  - "tab" ลิ้นสี่เหลี่ยมมุมเฉียงอเนกประสงค์ (ลิ้นมุมถาด, ลิ้นล็อก, ปีกข้างฝา)
  - side: "in" (ปกติ ลิ้นอยู่ด้านในผนังที่มันไปแนบ) หรือ "out" (ปีกห่อลงด้านนอกผนัง เช่น ปีกข้างของฝากล่องไปรษณีย์ — ตั้ง depth "H")
- holes[]: รูเจาะบนแผง body/lid (ไม่ใช่ลิ้น): type "hand-hole" = รูมือทรงแคปซูล (หูหิ้ว/ช่องจับ), "window" = หน้าต่างมุมมน;
  anchor = ตำแหน่งตามแนวที่แผงยื่นจากบานพับ (near/center/far); length/height null = ขนาดมาตรฐานตามแผง
- orientation: "front" = แผงรากคือผนังหน้า (กล่องท่อตั้ง: ผนังเรียงต่อกันซ้าย-ขวา ฝาอยู่บน-ล่าง), "base" = แผงรากคือฐานวางพื้น (ถาด/กล่องไปรษณีย์: ผนังต่อรอบฐานสี่ด้าน)

## กติกาที่ระบบตรวจ (ผิดแล้วจะส่งรายการกลับให้แก้)
1. ขอบหนึ่งของแผงรับได้อย่างเดียว: แผงลูกหรือลิ้น และขอบที่แผงลูกใช้ต่อแผงแม่ (ด้านตรงข้ามของ edge) ถือว่าใช้แล้ว
2. แผง/ลิ้นต้องไม่ทับกันบนแผ่นคลี่ — คิดผังให้แผงกางออกไปคนละทิศ (ท่อ: เรียงซ้าย-ขวา; ถาด: ผนังรอบฐาน)
3. ฝา (lid) ลึกได้ไม่เกินช่องเปิด ลิ้นต้องไม่กวาดทะลุแผงอื่นตอนพับ
4. กล่องปิด = ทุกด้านมีผนังหรือฝา (ระบบรายงานด้านที่ยังเปิด — ถ้าตั้งใจเปิด เช่น ถาด/ปลอก ให้บอกใน explanation)
5. กล่องท่อต้องมีปีกทากาว 1 แผงที่ปลายท่อ (kind glue) เพื่อประกบ; ถาดใช้ลิ้นมุม (tab) จากผนังข้างพับเข้าในผนังหน้า-หลัง
6. ไม่เกิน 24 แผง + 24 ลิ้น แผ่นคลี่ไม่ควรเกิน 600 มม.
ลำดับพับและชั้นวัสดุไม่ต้องกำหนด — ระบบจำลองและจัดให้

## หูหิ้ว (ลูกค้าขอบ่อย) ทำได้ 2 แบบ
- รูมือเจาะบนฝาหรือผนัง: holes type "hand-hole" บนแผงนั้น (เช่น ฝาบนของกล่องท่อ หรือผนังข้างสองด้านของกล่องไปรษณีย์)
- แผงหูหิ้วตั้งขึ้น: ฝาบนแยกสองซีก (lid size "D/2" จากผนังหน้าและผนังหลัง) แต่ละซีกต่อแผง body ด้วย fold -90 (ตั้งขึ้นประกบกันกลางกล่อง
  ความสูง 35-50 มม.) แล้วเจาะ hand-hole ทั้งสองแผงด้วย anchor เดียวกันให้รูตรงกัน — ดูตัวอย่าง "กล่องหูหิ้วฝาประกบ"

## วิธีตอบ
- ตอบ JSON ตาม schema เท่านั้น ทุกครั้งที่ได้รายการข้อผิดพลาดกลับมา ให้ส่ง JSON ฉบับแก้แล้ว "ทั้งฉบับ" ไม่ใช่เฉพาะส่วนที่แก้
- ตั้ง id เป็นภาษาอังกฤษตัวเล็ก สื่อความหมาย (front, side-left, lid-top, dust-tl …)
- explanation: อธิบายให้ลูกค้า 1-2 ประโยค ว่ากล่องประกอบอย่างไร ถ้าสิ่งที่ขอทำในภาษาแผงไม่ได้ (ทรงโค้ง หน้าจั่ว แผงไม่ใช่สี่เหลี่ยม ก้นล็อกอัตโนมัติ) ให้ทำแบบใกล้เคียงแล้วบอกตรง ๆ
- ถ้ามี "โครงสร้างปัจจุบัน" แนบมา ลูกค้าต้องการแก้ต่อยอดจากของเดิม — แก้เฉพาะส่วนที่เกี่ยว คง id เดิมไว้

## ตัวอย่าง
กล่องฝาเสียบ (ท่อ 4 ผนัง + ปีกกาว ฝาบน-ล่างต่อจากผนังหลัง ลิ้นกันฝุ่นที่ผนังข้าง):
${JSON.stringify(TUCK_END_STRUCTURE)}

กล่องไปรษณีย์ฝาพับ (ฐานกลาง ผนัง 4 ด้าน ฝาต่อจากผนังหลัง ลิ้นเสียบลงหน้า ปีกข้างฝาห่อนอกผนังข้าง):
${JSON.stringify(MAILER_STRUCTURE)}

ถาดเปิด (ตั้งใจเปิดด้านบน):
${JSON.stringify(TRAY_STRUCTURE)}

กล่องหูหิ้วฝาประกบ (ฝาบนสองซีก + แผงหูหิ้ว fold -90 ประกบกัน + รูมือ):
${JSON.stringify(HANDLE_BOX_STRUCTURE)}

## วัสดุพับได้ (ลูกค้าเลือกไว้แล้ว ระบบส่งมาให้ — ใช้แค่ประกอบการตัดสินใจเรื่องขนาดลิ้น)
${FOLDABLE.map((m) => `- ${m.id}: ${m.nameTh} หนา ${m.thickness} มม.`).join('\n')}`

export interface StructureRequest {
  prompt: string
  box: BoxParams
  materialId: string
  current?: BoxStructure | null
}

export interface StructureRound {
  attempt: number
  structure: BoxStructure | null // null = parse ไม่ผ่าน
  issues: StructureIssue[]
  ok: boolean
}

export interface StructureResult {
  ok: boolean
  structure: BoxStructure | null // รอบที่ผ่าน หรือรอบสุดท้ายที่ parse ได้ (ให้ผู้ใช้เห็นว่า AI พยายามอะไร)
  issues: StructureIssue[] // ของ structure ที่คืน
  rounds: StructureRound[]
  model: string
  mock: boolean
}

// ขอ JSON โครงสร้างหนึ่งรอบจากโมเดล — messages สะสมทั้งบทสนทนา (คำขอ → JSON → ข้อผิดพลาด → JSON …)
export type AskStructure = (messages: Anthropic.MessageParam[]) => Promise<{ raw: unknown; model: string }>

export function buildStructureUserContent(req: StructureRequest): string {
  const mat = getMaterial(req.materialId)
  const lines = [
    `ขนาดด้านในที่ต้องการ W×D×H = ${req.box.W}×${req.box.D}×${req.box.H} มม., วัสดุ ${mat.id} (${mat.nameTh} หนา ${mat.thickness} มม.)`,
  ]
  if (req.current) lines.push(`โครงสร้างปัจจุบัน: ${JSON.stringify(req.current)}`)
  lines.push(`คำขอลูกค้า: ${req.prompt}`)
  return lines.join('\n\n')
}

function feedback(issues: StructureIssue[]): string {
  return `ระบบตรวจโครงสร้างแล้วพบปัญหา:\n${describeIssues(issues)}\n\nแก้แล้วส่ง JSON ใหม่ทั้งฉบับ (คง id เดิมเท่าที่ทำได้)`
}

export async function designStructure(ask: AskStructure, req: StructureRequest, maxRounds = MAX_ROUNDS): Promise<StructureResult> {
  const mat = getMaterial(req.materialId)
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: buildStructureUserContent(req) }]
  const rounds: StructureRound[] = []
  let model = ''
  let last: { structure: BoxStructure; issues: StructureIssue[] } | null = null
  for (let attempt = 1; attempt <= maxRounds; attempt++) {
    const answer = await ask(messages)
    model = answer.model
    const parsed = parseStructure(answer.raw)
    let issues: StructureIssue[]
    let structure: BoxStructure | null = null
    if (!parsed.ok) issues = parsed.issues
    else {
      structure = parsed.structure
      const compiled: CompileResult = compileStructure(structure, req.box, mat)
      issues = compiled.issues
      last = { structure, issues }
    }
    const ok = !issues.some((i) => i.severity === 'error')
    rounds.push({ attempt, structure, issues, ok })
    if (ok && structure) return { ok: true, structure, issues, rounds, model, mock: false }
    messages.push(
      { role: 'assistant', content: JSON.stringify(answer.raw) },
      { role: 'user', content: feedback(issues.filter((i) => i.severity === 'error')) },
    )
  }
  return { ok: false, structure: last?.structure ?? null, issues: last?.issues ?? rounds[rounds.length - 1].issues, rounds, model, mock: false }
}

// --- backends ---

function structureModelOptions(model: string) {
  // งานออกแบบโครงสร้างต้องคิดมากกว่าแปลงสเปก: รุ่นตระกูล 5 ใช้ effort medium (ค่าเริ่มต้นของ Opus 5.5)
  const base = boxSpecModelOptions(model)
  return { effort: base.effort ? ('medium' as const) : undefined, serverFallback: base.serverFallback }
}

export function apiAsk(apiKey: string, model: string): AskStructure {
  const client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 1 })
  const options = structureModelOptions(model)
  return async (messages) => {
    const params = {
      model,
      max_tokens: MAX_TOKENS,
      system: STRUCTURE_SYSTEM,
      messages,
      output_config: {
        format: { type: 'json_schema' as const, schema: STRUCTURE_SCHEMA },
        ...(options.effort ? { effort: options.effort } : {}),
      },
    }
    const msg = options.serverFallback
      ? await client.beta.messages.create({
          ...params,
          betas: [SERVER_FALLBACK_BETA],
          // @ts-expect-error fallbacks: "default" ยังไม่อยู่ใน type ของ SDK 0.111 (ดู boxSpec.ts)
          fallbacks: 'default',
        })
      : await client.messages.create(params)
    if (msg.stop_reason === 'refusal') throw new Error('โมเดลปฏิเสธคำขอ ลองปรับคำอธิบาย')
    if (msg.stop_reason === 'max_tokens') throw new Error('คำตอบยาวเกินไป ถูกตัดก่อนจบ')
    const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    return { raw: JSON.parse(text) as unknown, model: msg.model }
  }
}

const CLI_INSTRUCTION =
  `\n\n## รูปแบบคำตอบ (สำคัญมาก)\nตอบเป็น JSON object เดียวตาม schema นี้เท่านั้น ห้ามมีข้อความอื่นหรือ markdown fence:\n` +
  JSON.stringify(STRUCTURE_SCHEMA)

export function cliAsk(model: string | undefined, oauthToken: string | undefined): AskStructure {
  return async (messages) => {
    // CLI ไม่มี multi-turn แบบ API — รวมบทสนทนาเป็นข้อความเดียว
    const transcript = messages
      .map((m) => `## ${m.role === 'user' ? 'ลูกค้า/ระบบ' : 'คำตอบก่อนหน้าของคุณ'}\n${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
      .join('\n\n')
    const args = ['-p', `${STRUCTURE_SYSTEM}${CLI_INSTRUCTION}\n\n${transcript}`, '--output-format', 'json']
    if (model) args.push('--model', model)
    const pending = execFileP(resolveClaudeBin(), args, {
      timeout: 240_000,
      maxBuffer: 4 * 1024 * 1024,
      cwd: os.tmpdir(),
      env: cliEnv(oauthToken),
    })
    pending.child.stdin?.end()
    const { stdout } = await pending
    const envelope = JSON.parse(stdout) as { is_error?: boolean; result?: string }
    if (envelope.is_error || typeof envelope.result !== 'string') throw new Error('Claude CLI ตอบกลับผิดรูปแบบ')
    const obj = extractJson(envelope.result)
    if (!obj) throw new Error('แปลงคำตอบจาก Claude CLI เป็น JSON ไม่ได้')
    return { raw: obj, model: model ?? 'claude-cli' }
  }
}

// โหมดจำลอง: เลือกตัวอย่างตามคำ (ไม่ต้องมีคีย์) — ไว้ลอง UI/วงรอบตรวจ
export function mockStructure(prompt: string): BoxStructure {
  const pick = /ถาด|tray/i.test(prompt) ? TRAY_STRUCTURE
    : /ไปรษณีย์|mailer|ฝาพับ/i.test(prompt) ? MAILER_STRUCTURE
    : /หูหิ้ว|หิ้ว|handle/i.test(prompt) ? HANDLE_BOX_STRUCTURE
    : TUCK_END_STRUCTURE
  return { ...pick, explanation: `(จำลอง — ไม่ได้เรียก AI) ${pick.explanation}` }
}

export async function handleBoxStructure(
  req: IncomingMessage,
  res: ServerResponse,
  env: Record<string, string | undefined>,
): Promise<void> {
  if (!isLegacyAiRouteEnabled(env)) {
    send(res, 404, { error: 'endpoint ทดลองนี้เปิดเฉพาะ local dev' })
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
  let request: StructureRequest
  try {
    const body = JSON.parse(await readBody(req)) as Record<string, unknown>
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
    if (!prompt || prompt.length > 2000) throw new Error('prompt')
    const box = body.box as Record<string, unknown> | undefined
    const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && v >= lo && v <= hi ? v : null)
    const W = num(box?.W, 20, 400)
    const D = num(box?.D, 10, 400)
    const H = num(box?.H, 10, 400)
    if (W === null || D === null || H === null) throw new Error('box')
    const materialId = typeof body.materialId === 'string' && FOLDABLE.some((m) => m.id === body.materialId) ? body.materialId : 'carton-300'
    let current: BoxStructure | null = null
    if (body.current) {
      const parsed = parseStructure(body.current)
      if (parsed.ok) current = parsed.structure
    }
    request = { prompt, box: { W, D, H }, materialId, current }
  } catch {
    send(res, 400, { error: 'รูปแบบคำขอไม่ถูกต้อง (prompt 1-2000 ตัวอักษร, box.W/D/H 10-400)' })
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
    let ask: AskStructure | null = null
    if (backend === 'api' || (!backend && apiKey)) {
      if (!apiKey) {
        send(res, 500, { error: 'BOX_SPEC_BACKEND=api แต่ไม่ได้ตั้ง ANTHROPIC_API_KEY' })
        return
      }
      ask = apiAsk(apiKey, model)
    } else if ((backend === 'cli' || !backend) && (await hasClaudeCli())) {
      ask = cliAsk(env.BOX_SPEC_MODEL, env.CLAUDE_CODE_OAUTH_TOKEN)
    } else if (backend === 'cli') {
      send(res, 500, { error: 'BOX_SPEC_BACKEND=cli แต่ไม่พบคำสั่ง claude ในเครื่อง' })
      return
    }
    if (!ask) {
      const structure = mockStructure(request.prompt)
      const compiled = compileStructure(structure, request.box, getMaterial(request.materialId))
      const result: StructureResult = {
        ok: compiled.ok, structure, issues: compiled.issues,
        rounds: [{ attempt: 1, structure, issues: compiled.issues, ok: compiled.ok }], model: 'mock', mock: true,
      }
      send(res, 200, result)
      return
    }
    send(res, 200, await designStructure(ask, request))
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) send(res, 502, { error: 'Anthropic API key ไม่ถูกต้อง' })
    else if (err instanceof Anthropic.RateLimitError) send(res, 429, { error: 'เรียกถี่เกินไป รอสักครู่แล้วลองใหม่' })
    else if (err instanceof Anthropic.APIError) {
      // endpoint ทดลองใน local dev — แนบข้อความจาก Anthropic ให้ดีบักได้ (ไม่มีคีย์ในข้อความ; 400 มักเป็น schema)
      send(res, 502, { error: `Claude API ขัดข้อง (${err.status ?? '?'}): ${err.message.replace(/sk-ant-[\w-]+/g, '[key]').slice(0, 400)}` })
    }
    else send(res, 502, { error: err instanceof Error ? err.message.slice(0, 300) : 'เกิดข้อผิดพลาดภายใน' })
  }
}

export { EXAMPLE_STRUCTURES }
