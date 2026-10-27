import { describe, expect, it } from 'vitest'
import { addAiUsage, aiModelLabel, aiRequestCostUsd, isAiModelChoice } from '../../shared/contracts/aiModels'
import { approxThb, formatTokens, formatUsd, modelPriceLabel, usageRows } from './aiUsage'

// โทเคนจริงของงานออกแบบลายบน staging (Opus 5.5, ai_requests 22 ต.ค. 2026): คำขอแรกเขียน system prompt ลง cache, คำขอถัดมาอ่าน
const coldRun = { inputTokens: 1013, cacheCreationTokens: 9710, cacheReadTokens: 0, outputTokens: 11844 }
const warmRun = { inputTokens: 439, cacheCreationTokens: 0, cacheReadTokens: 9710, outputTokens: 11092 }

describe('aiRequestCostUsd (ค่าใช้จ่ายต่อคำขอตามราคา Claude API)', () => {
  it('ตรงกับค่าที่คำนวณจาก usage จริงบน staging (Opus 5.5: $4/$20, เขียน cache 1.25 เท่า, อ่าน cache $0.20)', () => {
    expect(aiRequestCostUsd('claude-opus-5-5', coldRun)).toBeCloseTo(0.289482, 6)
    expect(aiRequestCostUsd('claude-opus-5-5', warmRun)).toBeCloseTo(0.225538, 6)
  })

  it('งานเดียวกันบน Sonnet 5.5 ครึ่งราคา และ Haiku 5.5 ถูกกว่า ~40 เท่า (ถ้าใช้โทเคนเท่ากัน)', () => {
    expect(aiRequestCostUsd('claude-sonnet-5-5', coldRun)).toBeCloseTo(0.144741, 6)
    expect(aiRequestCostUsd('claude-haiku-5-5', coldRun)).toBeCloseTo(0.00723705, 8)
  })

  it('Haiku 5.5 prompt เกิน 100K โทเคนคิดอัตรา $0.50 / $2.50; รุ่นที่ไม่รู้ราคาคืน null (ไม่เดา)', () => {
    expect(aiRequestCostUsd('claude-haiku-5-5', { inputTokens: 150_000, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 1000 })).toBeCloseTo(0.0775, 6)
    expect(aiRequestCostUsd('claude-unknown', coldRun)).toBeNull()
  })

  it('รวมหลายคำขอ (รอบแก้) คิดราคาตามรุ่นที่ตอบแต่ละคำขอ — มีรุ่นที่ไม่รู้ราคาปน = ค่าใช้จ่ายรวม null', () => {
    const one = addAiUsage(null, 'claude-opus-5-5', coldRun)
    const two = addAiUsage(one, 'claude-opus-5-5', warmRun)
    expect(two).toMatchObject({ model: 'claude-opus-5-5', requests: 2, inputTokens: 1452, outputTokens: 22936, cacheReadTokens: 9710, cacheCreationTokens: 9710 })
    expect(two.costUsd).toBeCloseTo(0.289482 + 0.225538, 6)
    expect(addAiUsage(two, 'claude-unknown', warmRun).costUsd).toBeNull()
    expect(addAiUsage(addAiUsage(null, 'claude-unknown', warmRun), 'claude-opus-5-5', warmRun).costUsd).toBeNull()
  })

  it('รับเฉพาะ 3 รุ่นที่ให้เลือก และแสดงชื่อรุ่นที่อ่านง่าย', () => {
    expect(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'].every(isAiModelChoice)).toBe(true)
    expect(isAiModelChoice('claude-opus-4-8')).toBe(false)
    expect(isAiModelChoice(undefined)).toBe(false)
    expect(aiModelLabel('claude-haiku-5-5')).toBe('Haiku 5.5')
    expect(aiModelLabel('claude-opus-4-8')).toBe('claude-opus-4-8')
  })
})

describe('aiUsage (จัดรูปตัวเลขบนการ์ด)', () => {
  it('จัดรูปเงิน/บาท/โทเคน/ป้ายราคา', () => {
    expect(formatUsd(0.289482)).toBe('$0.289')
    expect(formatUsd(0.00723705)).toBe('$0.0072')
    expect(formatUsd(0)).toBe('$0')
    expect(approxThb(0.289482)).toBe('9.8')
    expect(approxThb(0.00723705)).toBe('0.25')
    expect(formatTokens(11844)).toBe('11,844')
    expect(modelPriceLabel('claude-sonnet-5-5')).toBe('$2 / $10')
    expect(modelPriceLabel('claude-unknown')).toBe('')
  })

  it('แถวรายละเอียดครบทุกชนิดโทเคน + จำนวนคำขอ', () => {
    const rows = usageRows(addAiUsage(null, 'claude-opus-5-5', coldRun))
    expect(rows.map((r) => [r.en, r.value])).toEqual([
      ['input', '1,013'],
      ['cache read', '0'],
      ['cache write', '9,710'],
      ['output (incl. thinking)', '11,844'],
      ['API requests', '1'],
    ])
  })
})
