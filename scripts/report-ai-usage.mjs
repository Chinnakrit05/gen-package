// รายงานการใช้ AI บน cloud จาก app_private.ai_requests (อ่านอย่างเดียว ใน transaction read only)
// ต่อโมเดล ในช่วงวันที่กำหนด: จำนวนคำขอตามสถานะ, สัดส่วนที่แนบรูป, โทเคนเฉลี่ย/p95 ต่อคำขอที่สำเร็จ, จำนวนครั้งที่คืนเครดิต
// ค่าใช้จ่ายเป็น "ประมาณการ" และคำนวณเฉพาะเมื่อ operator ส่งราคาเองทั้งสองค่า — ไม่ hardcode ราคาโมเดลในสคริปต์
//
// ใช้: [PACKIT_REPORT_DATABASE_URL=postgresql://…] node scripts/report-ai-usage.mjs [--since ISO] [--until ISO]
//        [--input-usd-per-mtok N --output-usd-per-mtok N]
// ฐานข้อมูล: env PACKIT_REPORT_DATABASE_URL (staging/production — ใช้ role ที่อ่าน app_private ได้, ต่อท้าย ?sslmode=require
// เมื่อ host บังคับ SSL); ไม่ตั้ง = Supabase local จาก `supabase status` (local มักไม่มีโทเคน เพราะ smoke ปิดคีย์ AI)
// รับ URL ทาง env เท่านั้น ไม่รับเป็น argument — กันรหัสผ่านค้างใน shell history/ps
// ค่าเริ่มต้น: 30 วันล่าสุดจนถึงตอนนี้; ผลเป็น JSON ทาง stdout (ไม่พิมพ์ URL/รหัสผ่าน; field database บอกแค่ local/env)
//
// หมายเหตุ: model/โทเคนถูกเก็บเฉพาะคำขอ succeeded (settle_ai_request) — คำขอ failed/reserved จึงอยู่ในกลุ่ม model = null
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { parseArgs } from 'node:util'
import postgres from 'postgres'

const DAY_MS = 24 * 60 * 60 * 1000

const options = readOptions()
const database = readDatabase()
const sql = postgres(database.url, { max: 1, idle_timeout: 2 })

try {
  const { models, refunds } = await sql.begin('read only', async (tx) => {
    const models = await tx`
      select
        model,
        count(*)::integer as requests,
        count(*) filter (where state = 'reserved')::integer as reserved,
        count(*) filter (where state = 'succeeded')::integer as succeeded,
        count(*) filter (where state = 'failed')::integer as failed,
        count(has_image)::integer as image_known,
        count(*) filter (where has_image)::integer as with_image,
        count(input_tokens) filter (where state = 'succeeded')::integer as usage_rows,
        avg(input_tokens) filter (where state = 'succeeded')::float8 as avg_input_tokens,
        percentile_cont(0.95) within group (order by input_tokens::float8)
          filter (where state = 'succeeded') as p95_input_tokens,
        avg(output_tokens) filter (where state = 'succeeded')::float8 as avg_output_tokens,
        percentile_cont(0.95) within group (order by output_tokens::float8)
          filter (where state = 'succeeded') as p95_output_tokens,
        coalesce(sum(input_tokens) filter (where state = 'succeeded'), 0)::float8 as total_input_tokens,
        coalesce(sum(output_tokens) filter (where state = 'succeeded'), 0)::float8 as total_output_tokens,
        coalesce(sum(cache_read_tokens) filter (where state = 'succeeded'), 0)::float8 as total_cache_read_tokens,
        coalesce(sum(cache_creation_tokens) filter (where state = 'succeeded'), 0)::float8 as total_cache_creation_tokens
      from app_private.ai_requests
      where created_at >= ${options.since} and created_at < ${options.until}
      group by model
      order by model nulls last
    `
    // การคืนเครดิต (settle failed + แถวค้างที่ถูกคืนเอง) นับจาก ledger ตามเวลาที่คืน
    const [refunds] = await tx`
      select count(*)::integer as refunds
      from app_private.credit_ledger
      where reason = 'ai_refund'
        and created_at >= ${options.since} and created_at < ${options.until}
    `
    return { models, refunds }
  })

  const modelReports = models.map((row) => modelReport(row))
  const totals = {
    requests: sum(models, 'requests'),
    byState: {
      reserved: sum(models, 'reserved'),
      succeeded: sum(models, 'succeeded'),
      failed: sum(models, 'failed'),
    },
    hasImageShare: share(sum(models, 'with_image'), sum(models, 'image_known')),
    refunds: refunds.refunds,
    succeededTokens: {
      input: sum(models, 'total_input_tokens'),
      output: sum(models, 'total_output_tokens'),
      cacheRead: sum(models, 'total_cache_read_tokens'),
      cacheCreation: sum(models, 'total_cache_creation_tokens'),
    },
    estimatedCostUsd: options.pricing
      ? round(modelReports.reduce((total, report) => total + (report.estimatedCostUsd ?? 0), 0), 6)
      : null,
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'read-only',
    database: database.source,
    range: { since: options.since.toISOString(), until: options.until.toISOString() },
    pricing: options.pricing
      ? {
          inputUsdPerMTok: options.pricing.input,
          outputUsdPerMTok: options.pricing.output,
          note: 'ประมาณการจากราคาที่ operator ส่งมา × โทเคนของคำขอที่สำเร็จ; ไม่รวมโทเคน cache และคำขอที่ล้ม',
        }
      : null,
    totals,
    models: modelReports,
    note: 'model/โทเคนเก็บเฉพาะคำขอที่สำเร็จ — คำขอ failed/reserved อยู่ในกลุ่ม model = null; hasImageShare นับเฉพาะแถวที่รู้ค่า has_image',
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} finally {
  await sql.end({ timeout: 1 }).catch(() => undefined)
}

function modelReport(row) {
  const succeededTokens = {
    rowsWithUsage: row.usage_rows,
    avgInput: round(row.avg_input_tokens, 1),
    p95Input: round(row.p95_input_tokens, 1),
    avgOutput: round(row.avg_output_tokens, 1),
    p95Output: round(row.p95_output_tokens, 1),
    totalInput: row.total_input_tokens,
    totalOutput: row.total_output_tokens,
    totalCacheRead: row.total_cache_read_tokens,
    totalCacheCreation: row.total_cache_creation_tokens,
  }
  return {
    model: row.model,
    requests: row.requests,
    byState: { reserved: row.reserved, succeeded: row.succeeded, failed: row.failed },
    hasImageShare: share(row.with_image, row.image_known),
    succeededTokens,
    estimatedCostUsd: options.pricing
      ? round(
        (row.total_input_tokens * options.pricing.input + row.total_output_tokens * options.pricing.output) / 1_000_000,
        6,
      )
      : null,
  }
}

function readOptions() {
  let parsed
  try {
    parsed = parseArgs({
      options: {
        since: { type: 'string' },
        until: { type: 'string' },
        'input-usd-per-mtok': { type: 'string' },
        'output-usd-per-mtok': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: false,
    }).values
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
  if (parsed.help) {
    process.stdout.write([
      'node scripts/report-ai-usage.mjs [--since ISO] [--until ISO] [--input-usd-per-mtok N --output-usd-per-mtok N]',
      'ค่าเริ่มต้น: 30 วันล่าสุด; ค่าใช้จ่ายคำนวณเฉพาะเมื่อส่งราคาครบทั้งสองค่า (USD ต่อ 1 ล้านโทเคน)',
      'ฐานข้อมูล: env PACKIT_REPORT_DATABASE_URL (cloud, เติม ?sslmode=require ถ้าต้องใช้ SSL); ไม่ตั้ง = Supabase local',
      '',
    ].join('\n'))
    process.exit(0)
  }

  const until = parsed.until === undefined ? new Date() : parseInstant(parsed.until, '--until')
  const since = parsed.since === undefined ? new Date(until.getTime() - 30 * DAY_MS) : parseInstant(parsed.since, '--since')
  if (since.getTime() >= until.getTime()) fail('--since ต้องมาก่อน --until')

  const inputPrice = parsed['input-usd-per-mtok']
  const outputPrice = parsed['output-usd-per-mtok']
  if ((inputPrice === undefined) !== (outputPrice === undefined)) {
    fail('ต้องส่ง --input-usd-per-mtok และ --output-usd-per-mtok คู่กัน (หรือไม่ส่งทั้งคู่)')
  }
  const pricing = inputPrice === undefined
    ? null
    : {
        input: parsePrice(inputPrice, '--input-usd-per-mtok'),
        output: parsePrice(outputPrice, '--output-usd-per-mtok'),
      }
  return { since, until, pricing }
}

function parseInstant(value, flag) {
  // รับเฉพาะรูปแบบ ISO (วันที่ หรือวันที่+เวลา) — กันการตีความวันที่แบบท้องถิ่นของ Date.parse
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value)) {
    fail(`${flag} ต้องเป็นวันที่ ISO เช่น 2026-10-01 หรือ 2026-10-01T00:00:00Z`)
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) fail(`${flag} ไม่ใช่วันที่ที่ถูกต้อง`)
  return date
}

function parsePrice(value, flag) {
  const price = Number(value)
  if (!Number.isFinite(price) || price < 0) fail(`${flag} ต้องเป็นตัวเลข ≥ 0 (USD ต่อ 1 ล้านโทเคน)`)
  return price
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0)
}

function share(part, whole) {
  return whole > 0 ? round(part / whole, 4) : null
}

function round(value, digits) {
  if (value === null || value === undefined) return null
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  const factor = 10 ** digits
  return Math.round(number * factor) / factor
}

function fail(message) {
  process.stderr.write(`report-ai-usage: ${message}\n`)
  process.exit(2)
}

// cloud ผ่าน env (ตั้งไว้แต่ว่าง = ผิดพลาด ไม่ตกไปใช้ local เงียบ ๆ) ไม่งั้น Supabase local
function readDatabase() {
  const url = process.env.PACKIT_REPORT_DATABASE_URL
  if (url !== undefined) {
    if (!/^postgres(?:ql)?:\/\/\S+$/.test(url.trim())) {
      fail('PACKIT_REPORT_DATABASE_URL ต้องเป็น connection string แบบ postgresql://…')
    }
    return { url: url.trim(), source: 'env:PACKIT_REPORT_DATABASE_URL' }
  }
  return { url: readLocalStatus().DB_URL, source: 'supabase-local' }
}

function readLocalStatus() {
  const cli = path.resolve('node_modules', 'supabase', 'dist', 'supabase.js')
  const result = spawnSync(process.execPath, [cli, 'status', '-o', 'json'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    fail('Supabase local ไม่ได้รันอยู่ — เปิด stack ก่อน หรือตั้ง PACKIT_REPORT_DATABASE_URL เพื่ออ่านจาก cloud')
  }
  return JSON.parse(result.stdout)
}
