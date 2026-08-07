import type { IncomingMessage, ServerResponse } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { MATERIALS } from '../src/core/materials'
import { TEMPLATES } from '../src/core/templates'

const execFileP = promisify(execFile)

export interface CurrentSpec {
  template: string
  materialId: string
  W: number
  D: number
  H: number
  handle: boolean
}

export interface BoxSpecResult {
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

const LIMITS = { W: [30, 250], D: [20, 150], H: [30, 300] } as const
const TEMPLATE_IDS = TEMPLATES.map((t) => t.id)

const clamp = (v: number, [lo, hi]: readonly [number, number]) =>
  Math.min(hi, Math.max(lo, Math.round(v * 2) / 2))

// ตารางขนาดของที่พบบ่อย (มม.) — ใช้ทั้งใน system prompt และโหมดจำลอง
// ลำดับสำคัญ: entry เฉพาะเจาะจง (ขวดซอส/น้ำพริก) ต้องมาก่อน entry กว้าง (ขวดน้ำ)
const COMMON_ITEMS = [
  { re: /แยม/, w: 65, d: 65, h: 110, label: 'ขวดแยม 200 มล. ≈ ⌀65×110 มม.', fragile: true },
  { re: /ขวดซอส|น้ำพริก/, w: 60, d: 60, h: 160, label: 'ขวดซอส 250 มล. ≈ ⌀60×160 มม.', fragile: true },
  { re: /ขวดน้ำ(?!พริก)|เครื่องดื่ม/, w: 65, d: 65, h: 210, label: 'ขวดน้ำ 500 มล. ≈ ⌀65×210 มม.', fragile: true },
  { re: /สบู่/, w: 90, d: 60, h: 28, label: 'สบู่ก้อน ≈ 90×60×28 มม.', fragile: false },
  { re: /แก้วมัค|แก้วกาแฟ|มัค/, w: 105, d: 85, h: 95, label: 'แก้วมัค ≈ ⌀85×95 มม. (รวมหูอีก 20)', fragile: true },
  { re: /เทียน/, w: 70, d: 70, h: 85, label: 'เทียนหอมในแก้ว ≈ ⌀70×85 มม.', fragile: true },
  { re: /ครีม|กระปุก/, w: 55, d: 55, h: 50, label: 'กระปุกครีม 50 มล. ≈ ⌀55×50 มม.', fragile: false },
  { re: /คุกกี้|ขนม/, w: 120, d: 45, h: 180, label: 'ซองคุกกี้ ≈ 120×45×180 มม.', fragile: false },
] as const

const SYSTEM = `คุณคือวิศวกรบรรจุภัณฑ์ หน้าที่คือแปลงคำอธิบายของลูกค้า (ภาษาพูด) เป็นสเปกกล่องที่คำนวณแล้ว โดยเรียก tool box_spec เสมอ

## รูปแบบกล่อง (template)
${TEMPLATES.map((t) => `- ${t.id}: ${t.nameTh} — ${t.detail}`).join('\n')}
แนวการเลือก: ของชิ้นเดียว/แนวตั้ง/รีเทล → tuck-end; ส่งไปรษณีย์/ของหลายชิ้น/ของแบน/เปิดง่าย → mailer; งานส่งที่เน้นแข็งแรง/พรีเมียม/ผลิตจำนวนมากแบบไม่ใช้กาว (subscription box, ของแตกง่าย) → fefco-0427; ชุดขวด/กระป๋องหลายใบแบบยกหิ้ว (4-pack, 6-pack, ของฝากโชว์ขวด) → bottle-carrier; แค่ปลอกรัดรอบสินค้าที่มีกล่องอยู่แล้ว → sleeve. สำหรับ mailer/fefco-0427: H คือความสูงกล่อง (มักเตี้ย เช่น 40-80) ส่วน W×D คือ footprint

## ความหมายของ W/D/H ต่อ template (สำคัญ)
- tuck-end / mailer / fefco-0427 / tray: W×D = footprint ด้านใน, H = ความสูงด้านใน
- tray: ถาดเปิดบน (ไม่มีฝา) ผนัง 4 ด้านพับขึ้น มุมมีลิ้นล็อกด้านใน — H คือความสูงผนัง (ถาดมักตื้น); ไม่รองรับรูหิ้ว (handle=false); ใช้เป็นถาด/ดิสเพลย์ หรือลิ้นชักคู่กับ sleeve
- fefco-0427: ผนังข้างเป็นสองชั้น (roll end) + ลิ้นล็อกเสียบฐาน ประกอบไม่ใช้กาว — แผ่นคลี่กว้างกว่า mailer ธรรมดา (เพิ่มข้างละ ~H) และไม่รองรับรูหิ้ว (handle ต้องเป็น false)
- วัสดุภาชนะ (pet-bottle / glass / aluminum): ระบบสร้างทรง revolve + dieline "ฉลาก" พันรอบตัวให้ — W = ⌀ตัวภาชนะ, D = ⌀ปาก/คอ (ต้องเล็กกว่า W), H = ความสูงภาชนะ; template จะถูกละเลย (ใส่ tuck-end ไปได้), handle ต้องเป็น false — ใช้เมื่อลูกค้าต้องการ "ผลิตตัวขวด/โหล/กระป๋องเอง" ไม่ใช่กล่องใส่มัน
- sleeve: W×D = หน้าตัดด้านในของท่อ (ต้องพอดีกับของที่สวม เช่น แก้ว ⌀90 → W≈92, D≈92), H = ความสูงของปลอก — ระบบคำนวณความยาวแผ่นพันรอบ (ปีกกาว + 2(W+D)) ให้เองอยู่แล้ว ห้ามเอาเส้นรอบวงของมาใส่ใน W เด็ดขาด
- sleeve เป็นท่อทรงตรง — ของทรงเรียว (แก้วกาแฟ) จะหลวมด้านแคบ ให้ประกาศเป็นข้อจำกัดใน assumptions
- bottle-carrier: W×D = footprint ด้านใน (เช่น ขวด ⌀66 วาง 2×2 → W,D ≈ 150), H = ความสูงขวด — ระบบสร้างให้เองอัตโนมัติ: แผ่นหูหิ้วกลางสูงกว่าขวด ~55 มม. พร้อมรูมือกลม, ผนังข้างสูง ~42% ของ H, หน้าต่างโชว์สินค้าสองช่องต่อผนัง (handle flag ไม่เกี่ยวกับ template นี้ — หูหิ้วมีในตัว)

## วัสดุที่มีในระบบ (materialId)
${MATERIALS.map(
  (m) =>
    `- ${m.id}: ${m.nameTh} (${m.detail}) หนา ${m.thickness} มม. ${m.foldable ? 'พับได้' : 'พับไม่ได้ — ' + m.process}`,
).join('\n')}

## แนวการเลือกวัสดุจากสไตล์ที่ลูกค้าบอก
- อีโค่ / รักษ์โลก / ธรรมชาติ → kraft-350
- หรู / พรีเมียม / ของขวัญจริงจัง → carton-400
- โชว์สินค้า / อยากให้มองเห็นข้างใน → pet-sheet
- ส่งไปรษณีย์ / ขนส่ง / กันกระแทก / แข็งแรง → corrugated-b (และ template ควรเป็น mailer)
- งานพิมพ์สวยแต่แข็งแรงเบา → corrugated-e
- ประหยัด / ทั่วไป / ไม่ระบุ → carton-300
- ถ้าลูกค้าต้องการ "กล่องใส่ขวด/แก้ว" ให้เลือกวัสดุกล่อง แต่ถ้าต้องการผลิตตัวขวด/กระป๋อง/โหลเอง → pet-bottle / aluminum / glass

## ตารางขนาดของที่พบบ่อย (มม.)
${COMMON_ITEMS.map((i) => `- ${i.label}${i.fragile ? ' (เปราะ)' : ''}`).join('\n')}

## วิธีคำนวณขนาดด้านใน (หน่วย มม. ทั้งหมด)
1. หา footprint ของแต่ละชิ้น (ทรงกระบอกใช้ ⌀ เป็นสี่เหลี่ยม)
2. จัด layout แถว × คอลัมน์: W = คอลัมน์×กว้างชิ้น + ช่องไฟ, D = แถว×ลึกชิ้น + ช่องไฟ
3. ช่องไฟระหว่างชิ้นและขอบ 3-5 มม. ของเปราะ (แก้ว เซรามิก ขวดแก้ว) เผื่อ 5-8 มม. ต่อด้านสำหรับวัสดุกันกระแทก
4. H = ความสูงชิ้น + 4-6 มม. (tuck-end/sleeve) — สำหรับ mailer ของมักวางนอน H = ความหนาชิ้น + เผื่อ
5. ขอบเขต: W 30-250, D 20-150, H 30-300 — ถ้าเกินให้จัด layout ใหม่ (เพิ่มแถว) จนอยู่ในช่วง

## เช็คให้ผ่านก่อนส่งคำตอบทุกครั้ง (fit check)
1. คำนวณพื้นที่ที่ของต้องใช้จริง (รวมช่องไฟ/กันกระแทก) เทียบกับ W×D×H ที่จะตอบ — ถ้าใส่ไม่ได้จริง ห้ามเขียน assumptions/layoutNote/reasoning เหมือนใส่ได้
2. ถ้าของหรือจำนวนที่ขอเกินลิมิตระบบ (ต้องใช้ W>250 / D>150 / H>300): ให้ assumptions ข้อแรกขึ้นต้นด้วย "ข้อจำกัด:" บอกตรงๆ ว่าใส่ไม่ได้ทั้งหมด ใส่ได้จริงกี่ชิ้น/ขนาดไหน พร้อมทางเลือก (แยกหลายกล่อง, ซ้อนหลายชั้น, ตัดจำนวน) — แล้วตั้ง W/D/H เป็นค่าที่ดีที่สุดเท่าที่ทำได้
3. prompt กำกวมระหว่าง "ผลิตภาชนะเอง" (ขวด/กระป๋อง/โหล) กับ "กล่องใส่มัน" → ประกาศการตีความที่เลือกไว้ใน assumptions ข้อแรก
4. handle=true กับของหนัก (เซรามิก/แก้ว/ขวดหลายชิ้น รวม >2 กก.) → เตือนใน assumptions ว่ารูหิ้วกระดาษรับน้ำหนักจำกัด ควรยกประคองก้นกล่อง

## ความสามารถของระบบ (สำคัญมาก — ห้ามอ้างเกินนี้)
สิ่งที่ระบบ gen ได้จริงมีเท่านี้: รูปแบบกล่องตามรายการข้างต้น, วัสดุจากรายการ, ขนาด W/D/H, รูหิ้วเจาะ (handle=true — tuck-end เจาะบนฝาเสียบบน, mailer เจาะผนังข้างสองด้าน; bottle-carrier มีหูหิ้ว+รูมือ+หน้าต่างในตัวอยู่แล้ว; sleeve/fefco-0427 ไม่รองรับ), และภาชนะขึ้นรูป (วัสดุ pet-bottle/glass/aluminum → ทรง revolve + dieline ฉลากพันรอบตัว)
สิ่งที่ยังทำไม่ได้: หูหิ้วเชือก/พลาสติก, หน้าต่างใส, ตัวล็อกพิเศษ, แผ่นกั้นด้านใน, ทรงภาชนะแบบกำหนดเอง (โปรไฟล์ fix ตามชนิดวัสดุ) ฯลฯ — ถ้าลูกค้าขอสิ่งเหล่านี้ ให้เลือกสิ่งใกล้เคียงที่มี (เช่น ขอหูหิ้ว/ที่จับ → handle=true) และเขียนใน reasoning ตรงๆ ว่าระบบยังไม่รองรับสิ่งที่ขอแบบเป๊ะๆ ห้ามอ้างใน assumptions ว่าทำสิ่งที่ทำไม่ได้ให้แล้ว

## รูปอ้างอิงจากลูกค้า (ถ้ามี)
ใช้รูปเพื่อ: ระบุชนิด/จำนวนของที่จะใส่, ประเมินขนาดจริงจากวัตถุบริบทในรูป (ฝ่ามือ ~180 มม., บัตรเครดิต 86 มม., ขวดน้ำมาตรฐาน ⌀65 ฯลฯ), และอนุมานสไตล์ (สี วัสดุ ความหรู) — ทุกอย่างที่อ่านจากรูปแล้วมีผลต่อ spec ให้ประกาศใน assumptions ขึ้นต้นด้วย "จากรูป:" ถ้ารูปขัดแย้งกับข้อความลูกค้า ให้ยึดข้อความ

## กติกาสำคัญ
- ห้ามถามกลับ ตัดสินใจเสมอ — ทุกค่าที่เดา (ขนาดของ จำนวน การจัดวาง ช่องไฟ วัสดุ รูปแบบกล่อง) ต้องประกาศใน assumptions เป็นภาษาไทยสั้นๆ ทีละข้อ เพื่อให้ลูกค้ากดแก้ได้
- ถ้ามี "สเปกปัจจุบัน" มาด้วย: ปกติคือลูกค้าขอปรับของเดิมต่อเนื่อง — แก้เฉพาะส่วนที่ข้อความเกี่ยวข้อง คงค่าที่เหลือ (รวม template) ไว้ตามเดิม แต่ถ้าข้อความชัดเจนว่าเป็นงานใหม่คนละชิ้น (เช่น สั่งกล่องใส่ของอย่างอื่นทั้งใบ) ให้คำนวณใหม่ทั้งหมดโดยไม่ยึดค่าเดิม
- layoutNote สั้นๆ เช่น "วางเรียง 3 × 1" (ถ้าไม่เกี่ยวกับการวางของ ใส่ "-")
- reasoning: 1-2 ประโยค ทำไมเลือกรูปแบบ/วัสดุ/ขนาดนี้`

const TOOL: Anthropic.Tool = {
  name: 'box_spec',
  description: 'ส่งสเปกบรรจุภัณฑ์ที่คำนวณเสร็จแล้วให้ระบบ gen กล่อง',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      template: { type: 'string', enum: TEMPLATE_IDS },
      materialId: { type: 'string', enum: MATERIALS.map((m) => m.id) },
      W: { type: 'number', description: 'กว้างด้านใน มม. (30-250)' },
      D: { type: 'number', description: 'ลึกด้านใน มม. (20-150)' },
      H: { type: 'number', description: 'สูงด้านใน มม. (30-300)' },
      handle: {
        type: 'boolean',
        description: 'เจาะรูหิ้ว (tuck-end/mailer เท่านั้น; sleeve ต้องเป็น false)',
      },
      assumptions: {
        type: 'array',
        items: { type: 'string' },
        description: 'ทุกค่าที่เดา ภาษาไทยสั้นๆ ทีละข้อ',
      },
      layoutNote: { type: 'string', description: 'การจัดวางของด้านใน เช่น "วางเรียง 3 × 1"' },
      reasoning: { type: 'string', description: 'เหตุผลสั้นๆ ที่เลือกรูปแบบ/วัสดุ/ขนาดนี้' },
    },
    required: ['template', 'materialId', 'W', 'D', 'H', 'handle', 'assumptions', 'layoutNote', 'reasoning'],
  },
}

function sanitize(raw: Record<string, unknown>, mock: boolean): BoxSpecResult {
  const materialId = MATERIALS.some((m) => m.id === raw.materialId)
    ? (raw.materialId as string)
    : 'carton-300'
  const template = TEMPLATE_IDS.includes(raw.template as string)
    ? (raw.template as string)
    : 'tuck-end'
  return {
    template,
    materialId,
    W: clamp(Number(raw.W) || 80, LIMITS.W),
    D: clamp(Number(raw.D) || 50, LIMITS.D),
    H: clamp(Number(raw.H) || 120, LIMITS.H),
    handle: raw.handle === true && template !== 'sleeve',
    assumptions: Array.isArray(raw.assumptions)
      ? raw.assumptions.filter((a): a is string => typeof a === 'string').slice(0, 8)
      : [],
    layoutNote: typeof raw.layoutNote === 'string' ? raw.layoutNote : '-',
    reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : '',
    mock,
  }
}

// สร้าง CurrentSpec ใหม่จากค่า client แบบไม่เชื่ออะไรเลย — กัน bypass validation
// (client ส่ง string อิสระมาใน current ไม่ได้ ทุก field ถูก rebuild)
export function parseCurrent(v: unknown): CurrentSpec | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const o = v as Record<string, unknown>
  const W = Number(o.W)
  const D = Number(o.D)
  const H = Number(o.H)
  if (!Number.isFinite(W) || !Number.isFinite(D) || !Number.isFinite(H)) return undefined
  const materialId = MATERIALS.some((m) => m.id === o.materialId) ? (o.materialId as string) : undefined
  const template = TEMPLATE_IDS.includes(o.template as string) ? (o.template as string) : undefined
  if (!materialId || !template) return undefined
  return {
    template,
    materialId,
    W: clamp(W, LIMITS.W),
    D: clamp(D, LIMITS.D),
    H: clamp(H, LIMITS.H),
    handle: o.handle === true,
  }
}

export interface RefImage {
  data: string
  mediaType: string
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

// รูปอ้างอิงจาก client: base64 (ไม่มี data: prefix) ขนาดไม่เกิน ~3.7MB หลัง decode
export function parseImage(v: unknown): RefImage | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const o = v as Record<string, unknown>
  if (typeof o.data !== 'string' || o.data.length < 100 || o.data.length > 5_000_000) return undefined
  const data = o.data.replace(/\s/g, '')
  if (!/^[A-Za-z0-9+/]+=*$/.test(data)) return undefined
  const mediaType = IMAGE_TYPES.has(o.mediaType as string) ? (o.mediaType as string) : 'image/jpeg'
  return { data, mediaType }
}

// โหมดจำลอง: ใช้ตอนยังไม่ได้ตั้ง ANTHROPIC_API_KEY เพื่อให้ทดสอบ UX ได้ครบวงจร
export function mockSpec(prompt: string, current?: CurrentSpec, image?: RefImage): BoxSpecResult {
  const assumptions: string[] = []
  if (image) assumptions.push('แนบรูปมา แต่โหมดจำลองยังวิเคราะห์รูปไม่ได้ — ใช้ข้อความอย่างเดียว')
  let materialId = current?.materialId ?? 'carton-300'
  let template = current?.template ?? 'tuck-end'
  let handle = current?.handle ?? false
  if (/หิ้ว|ที่จับ|หูหิ้ว|มือจับ|ถือสะดวก/.test(prompt)) handle = true

  if (/หิ้ว.{0,10}ขวด|ขวด.{0,10}หิ้ว|แพ็[คก]|carrier/i.test(prompt)) template = 'bottle-carrier'
  else if (/ไปรษณีย์|ส่งของ|ขนส่ง|พัสดุ/.test(prompt)) template = 'mailer'
  else if (/ปลอก|สวม|แบนด์|รัด/.test(prompt)) template = 'sleeve'

  if (/อีโค่|รักษ์โลก|ธรรมชาติ|คราฟท์/.test(prompt)) materialId = 'kraft-350'
  else if (/หรู|พรีเมียม/.test(prompt)) materialId = 'carton-400'
  else if (/ใส(?![่-๋])|โชว์|มองเห็น/.test(prompt)) materialId = 'pet-sheet'
  else if (/ไปรษณีย์|ขนส่ง|กันกระแทก|แข็งแรง|พัสดุ/.test(prompt)) materialId = 'corrugated-b'
  else if (/ถูก|ประหยัด/.test(prompt)) materialId = 'carton-300'

  const mat = MATERIALS.find((m) => m.id === materialId)
  assumptions.push(`วัสดุ: ${mat?.nameTh ?? materialId}`)
  assumptions.push(`รูปแบบ: ${TEMPLATES.find((t) => t.id === template)?.nameTh ?? template}`)

  let count = Math.max(1, Number(/(\d+)\s*(?:ขวด|ชิ้น|ก้อน|ใบ|กระปุก|อัน|เล่ม)/.exec(prompt)?.[1] ?? 1))
  const item = COMMON_ITEMS.find((i) => i.re.test(prompt))

  if (!item) {
    if (current) {
      assumptions.push('ไม่พบของชิ้นใหม่ในคำสั่ง — คงขนาดเดิมไว้')
      return sanitize(
        { ...current, materialId, template, handle, assumptions, layoutNote: '-', reasoning: 'ปรับตามคำสั่งโดยคงขนาดเดิม (โหมดจำลอง)' },
        true,
      )
    }
    assumptions.push('ไม่ทราบของด้านใน — ใช้ขนาดกล่องมาตรฐาน 80×50×120 มม.')
    return sanitize(
      { materialId, template, handle, W: 80, D: 50, H: 120, assumptions, layoutNote: '-', reasoning: 'ขนาดมาตรฐานเริ่มต้น (โหมดจำลอง)' },
      true,
    )
  }

  assumptions.push(item.label)
  const gap = 5
  const pad = item.fragile ? 8 : 4
  if (item.fragile) assumptions.push(`ของเปราะ — เผื่อกันกระแทกด้านละ ${pad} มม.`)
  assumptions.push(`ช่องไฟระหว่างชิ้น ${gap} มม.`)

  // ความจุสูงสุดของกล่องเดียวตามลิมิตขนาด — ถ้าเกินให้คิดที่จำนวนที่ใส่ได้จริง
  const maxCols = Math.max(1, Math.floor((LIMITS.W[1] - pad * 2 + gap) / (item.w + gap)))
  const maxRows = Math.max(1, Math.floor((LIMITS.D[1] - pad * 2 + gap) / (item.d + gap)))
  if (count > maxCols * maxRows) {
    assumptions.push(`จำนวน ${count} ชิ้นเกินความจุกล่องเดียว — คำนวณสำหรับ ${maxCols * maxRows} ชิ้น`)
    count = maxCols * maxRows
  }

  let rows = 1
  let cols = count
  while (cols > maxCols && rows < maxRows) {
    rows += 1
    cols = Math.ceil(count / rows)
  }
  const W = cols * item.w + (cols - 1) * gap + pad * 2
  const D = rows * item.d + (rows - 1) * gap + pad * 2
  const H = item.h + 6

  return sanitize(
    {
      materialId,
      template,
      handle,
      W,
      D,
      H,
      assumptions,
      layoutNote: `วางเรียง ${cols} × ${rows}`,
      reasoning: `คำนวณจากของ ${count} ชิ้นพร้อมช่องไฟ (โหมดจำลอง — ยังไม่ได้ใช้ AI จริง)`,
    },
    true,
  )
}

function buildUserContent(prompt: string, current?: CurrentSpec): string {
  return current
    ? `สเปกปัจจุบัน: template=${current.template}, วัสดุ=${current.materialId}, ด้านใน W×D×H = ${current.W}×${current.D}×${current.H} มม., รูหิ้ว=${current.handle ? 'มี' : 'ไม่มี'}\n\nข้อความล่าสุดจากลูกค้า: ${prompt}`
    : prompt
}

let client: Anthropic | null = null

export async function askClaude(
  apiKey: string,
  model: string,
  prompt: string,
  current?: CurrentSpec,
  image?: RefImage,
): Promise<BoxSpecResult> {
  client ??= new Anthropic({ apiKey })
  const content: Anthropic.ContentBlockParam[] = []
  if (image) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: image.mediaType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
        data: image.data,
      },
    })
  }
  content.push({ type: 'text', text: buildUserContent(prompt, current) })

  const msg = await client.messages.create({
    model,
    max_tokens: 2048,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'box_spec' },
    messages: [{ role: 'user', content }],
  })

  const block = msg.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'box_spec',
  )
  if (!block) throw new Error('ไม่พบผลลัพธ์จากโมเดล')
  return sanitize(block.input as Record<string, unknown>, false)
}

// --- backend: claude CLI (ใช้ login ของ Claude Code ในเครื่อง ไม่ต้องมี API key) ---

let cliAvailable: boolean | null = null

// บน Windows คำสั่ง `claude` คือ shim (.cmd/.ps1) หรือ native .exe ใน node_modules
// execFile ไม่ผ่าน shell จึง resolve นามสกุลให้ไม่ได้เอง (จะ ENOENT) — ต้องหา path เต็ม
// ของไฟล์ .exe ที่รันตรงได้ (เลี่ยง .cmd เพราะต้อง shell แล้ว argument ยาว ๆ จะโดน quote พัง)
let claudeBinCache: string | undefined
function resolveClaudeBin(): string {
  if (claudeBinCache !== undefined) return claudeBinCache
  if (process.platform !== 'win32') return (claudeBinCache = 'claude')
  const dirs = (process.env.PATH || '').split(path.delimiter)
  if (process.env.APPDATA) {
    dirs.push(path.join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin'))
  }
  for (const dir of dirs) {
    if (!dir) continue
    const exe = path.join(dir, 'claude.exe')
    if (existsSync(exe)) return (claudeBinCache = exe)
  }
  return (claudeBinCache = 'claude')
}

async function hasClaudeCli(): Promise<boolean> {
  if (cliAvailable !== null) return cliAvailable
  try {
    await execFileP(resolveClaudeBin(), ['--version'], { timeout: 10_000 })
    cliAvailable = true
  } catch {
    cliAvailable = false
  }
  return cliAvailable
}

const JSON_INSTRUCTION =
  `\n\n## รูปแบบคำตอบ (สำคัญมาก)\n` +
  `ตอบเป็น JSON object เดียวเท่านั้น ห้ามมีข้อความอื่นหรือ markdown fence นำหน้า/ตามหลัง:\n` +
  `{"template":"<${TEMPLATE_IDS.join('|')}>","materialId":"<id>","W":<number>,"D":<number>,"H":<number>,"handle":<true|false>,` +
  `"assumptions":["..."],"layoutNote":"...","reasoning":"..."}`

// ล้างตัวแปรแวดล้อมของ session อื่น (เช่น ANTHROPIC_BASE_URL จาก Claude Code
// ที่รัน dev server อยู่) ไม่ให้ shadow login ปกติของเครื่อง
// ถ้าผู้ใช้ตั้ง CLAUDE_CODE_OAUTH_TOKEN ใน .env (ได้จาก `claude setup-token`)
// ให้ส่งเข้า child โดยตรง — ทางนี้ไม่พึ่ง Keychain เลย ใช้ได้ทุกบริบท
function cliEnv(oauthToken?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(ANTHROPIC_|CLAUDE)/i.test(k)) continue
    env[k] = v
  }
  if (oauthToken) env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken
  return env
}

function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

async function askClaudeCli(
  model: string | undefined,
  oauthToken: string | undefined,
  prompt: string,
  current?: CurrentSpec,
  image?: RefImage,
): Promise<BoxSpecResult> {
  // CLI รับรูปตรงๆ ไม่ได้ — เขียนเป็นไฟล์ชั่วคราวใน tmp (cwd ของ CLI) ให้เปิดอ่านเอง
  let imgPath: string | null = null
  if (image) {
    const ext = image.mediaType.split('/')[1].replace('jpeg', 'jpg')
    imgPath = path.join(os.tmpdir(), `box-ref-${randomUUID()}.${ext}`)
    await writeFile(imgPath, Buffer.from(image.data, 'base64'))
  }
  const imgNote = imgPath
    ? `ลูกค้าแนบรูปอ้างอิงไว้ที่ไฟล์: ${imgPath}\nเปิดดูรูปนี้ด้วยเครื่องมือ Read ก่อนคำนวณ แล้วประกาศสิ่งที่อ่านได้จากรูปใน assumptions ขึ้นต้นด้วย "จากรูป:"\n\n`
    : ''
  const full = `${SYSTEM}${JSON_INSTRUCTION}\n\n${imgNote}## คำขอลูกค้า\n${buildUserContent(prompt, current)}`
  const args = ['-p', full, '--output-format', 'json']
  if (model) args.push('--model', model)

  try {
    // cwd เป็น tmp เพื่อไม่ให้ CLI โหลด CLAUDE.md/บริบทของโปรเจกต์เข้าไปปนใน prompt
    const pending = execFileP(resolveClaudeBin(), args, {
      timeout: 180_000,
      maxBuffer: 4 * 1024 * 1024,
      cwd: os.tmpdir(),
      env: cliEnv(oauthToken),
    })
    pending.child.stdin?.end()
    const { stdout } = await pending

    const envelope = JSON.parse(stdout) as { is_error?: boolean; result?: string }
    if (envelope.is_error || typeof envelope.result !== 'string') {
      throw new Error('Claude CLI ตอบกลับผิดรูปแบบ')
    }
    const obj = extractJson(envelope.result)
    if (!obj) throw new Error('แปลงคำตอบจาก Claude CLI เป็น JSON ไม่ได้')
    return sanitize(obj, false)
  } finally {
    if (imgPath) void unlink(imgPath).catch(() => {})
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > 6 * 1024 * 1024) throw new Error('คำขอใหญ่เกินไป')
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

export async function handleBoxSpec(
  req: IncomingMessage,
  res: ServerResponse,
  env: Record<string, string | undefined>,
): Promise<void> {
  if (req.method !== 'POST') {
    send(res, 405, { error: 'ต้องเป็น POST เท่านั้น' })
    return
  }

  // กัน drive-by cross-site POST มาเผาโควต้า API: บังคับ same-origin + JSON เท่านั้น
  // (POST แบบ text/plain เป็น simple request ที่ browser ส่งข้ามเว็บได้โดยไม่มี preflight)
  const origin = req.headers.origin
  const allowedOrigins = new Set(['http://localhost:5173', 'http://127.0.0.1:5173'])
  if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && !allowedOrigins.has(origin))) {
    send(res, 403, { error: 'ต้องเรียกจากหน้าเว็บของแอปเท่านั้น' })
    return
  }
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
    send(res, 415, { error: 'content-type ต้องเป็น application/json' })
    return
  }

  let prompt: string
  let current: CurrentSpec | undefined
  let image: RefImage | undefined
  try {
    const body = JSON.parse(await readBody(req)) as {
      prompt?: unknown
      current?: unknown
      image?: unknown
    }
    if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 2000) {
      send(res, 400, { error: 'prompt ต้องเป็นข้อความ 1-2000 ตัวอักษร' })
      return
    }
    prompt = body.prompt.trim()
    current = parseCurrent(body.current)
    image = parseImage(body.image)
  } catch {
    send(res, 400, { error: 'รูปแบบคำขอไม่ถูกต้อง' })
    return
  }

  // ลำดับ backend: บังคับด้วย BOX_SPEC_BACKEND (api|cli|mock) หรืออัตโนมัติ:
  // มี ANTHROPIC_API_KEY → API, ไม่มีแต่มี claude CLI ในเครื่อง → CLI, ไม่มีทั้งคู่ → จำลอง
  const backend = env.BOX_SPEC_BACKEND
  const apiKey = env.ANTHROPIC_API_KEY
  const model = env.BOX_SPEC_MODEL

  try {
    if (backend === 'mock') {
      send(res, 200, mockSpec(prompt, current, image))
      return
    }
    if (backend === 'api' || (!backend && apiKey)) {
      if (!apiKey) {
        send(res, 500, { error: 'BOX_SPEC_BACKEND=api แต่ไม่ได้ตั้ง ANTHROPIC_API_KEY' })
        return
      }
      send(res, 200, await askClaude(apiKey, model || 'claude-opus-4-8', prompt, current, image))
      return
    }
    if (backend === 'cli' || !backend) {
      if (await hasClaudeCli()) {
        send(res, 200, await askClaudeCli(model, env.CLAUDE_CODE_OAUTH_TOKEN, prompt, current, image))
        return
      }
      if (backend === 'cli') {
        send(res, 500, { error: 'BOX_SPEC_BACKEND=cli แต่ไม่พบคำสั่ง claude ในเครื่อง' })
        return
      }
    }
    send(res, 200, mockSpec(prompt, current, image))
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      send(res, 401, { error: 'ANTHROPIC_API_KEY ไม่ถูกต้อง — ตรวจไฟล์ .env' })
    } else if (err instanceof Anthropic.RateLimitError) {
      send(res, 429, { error: 'เรียกถี่เกินไป รอสักครู่แล้วลองใหม่' })
    } else if (err instanceof Anthropic.APIError) {
      send(res, 502, { error: `Claude API ขัดข้อง (${err.status ?? '?'}) ลองใหม่อีกครั้ง` })
    } else if (isExecError(err)) {
      let detail: string
      if (err.killed) {
        detail = 'ใช้เวลานานเกินไป (timeout 3 นาที)'
      } else {
        // CLI พิมพ์ envelope ลง stdout แม้ exit ไม่เป็นศูนย์ — ดึงข้อความจริงมาแสดง
        const envelope = safeParseEnvelope(err.stdout)
        detail = (envelope?.result ?? err.stderr ?? err.message).slice(0, 300)
      }
      const hint = /authenticate|401/i.test(detail)
        ? ' — วิธีแก้: เปิด terminal รัน `claude setup-token` แล้วเอา token (sk-ant-oat01-…) ใส่ไฟล์ .env เป็น CLAUDE_CODE_OAUTH_TOKEN=… จากนั้นรีสตาร์ท dev server'
        : ''
      send(res, 502, { error: `เรียก Claude CLI ไม่สำเร็จ: ${detail}${hint}` })
    } else {
      send(res, 500, { error: 'เกิดข้อผิดพลาดภายใน ลองใหม่อีกครั้ง' })
    }
  }
}

function isExecError(
  e: unknown,
): e is Error & { killed?: boolean; stderr?: string; stdout?: string } {
  return e instanceof Error && ('killed' in e || 'stderr' in e)
}

function safeParseEnvelope(text: string | undefined): { result?: string } | null {
  if (!text) return null
  try {
    const v = JSON.parse(text) as { result?: unknown }
    return typeof v.result === 'string' ? { result: v.result } : null
  } catch {
    return null
  }
}
