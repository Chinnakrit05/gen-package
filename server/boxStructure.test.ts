import { describe, expect, it } from 'vitest'
import { MAILER_STRUCTURE, TUCK_END_STRUCTURE } from '../src/core/structure/examples'
import { buildStructureUserContent, designStructure, mockStructure, STRUCTURE_SYSTEM, type AskStructure } from './boxStructure'

const req = { prompt: 'กล่องฝาเสียบใส่ครีม', box: { W: 80, D: 50, H: 120 }, materialId: 'carton-300' }

describe('designStructure (วงรอบ AI → ตรวจ → แก้)', () => {
  it('accepts a valid structure on the first round and reports warnings only', async () => {
    const calls: number[] = []
    const ask: AskStructure = async (messages) => {
      calls.push(messages.length)
      return { raw: JSON.parse(JSON.stringify(TUCK_END_STRUCTURE)), model: 'test-model' }
    }
    const out = await designStructure(ask, req)
    expect(out.ok).toBe(true)
    expect(out.rounds).toHaveLength(1)
    expect(calls).toEqual([1])
    expect(out.structure?.name).toBe('กล่องฝาเสียบ')
    expect(out.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(out.model).toBe('test-model')
  })

  it('feeds parse and compile errors back in Thai and accepts the corrected version', async () => {
    const broken = { ...TUCK_END_STRUCTURE, panels: TUCK_END_STRUCTURE.panels.map((p) => (p.id === 'back' ? { ...p, attach: { to: 'nowhere', edge: 'right', fold: 90 } } : p)) }
    const tooDeep = { ...TUCK_END_STRUCTURE, panels: TUCK_END_STRUCTURE.panels.map((p) => (p.id === 'tuck-top' ? { ...p, size: 140 } : p)) }
    const answers = [broken, tooDeep, TUCK_END_STRUCTURE]
    const seen: string[] = []
    const ask: AskStructure = async (messages) => {
      const last = messages[messages.length - 1]
      seen.push(typeof last.content === 'string' ? last.content : '')
      return { raw: JSON.parse(JSON.stringify(answers.shift())), model: 'm' }
    }
    const out = await designStructure(ask, req)
    expect(out.ok).toBe(true)
    expect(out.rounds.map((r) => r.ok)).toEqual([false, false, true])
    // รอบ 2 ได้รับข้อผิดพลาดของรอบ 1 (อ้างอิง id ที่ไม่มี), รอบ 3 ได้รับของรอบ 2 (ฝาลึกเกิน) — ภาษาไทยทั้งคู่
    expect(seen[1]).toContain('nowhere')
    expect(seen[2]).toContain('ฝา "tuck-top"')
    expect(seen[2]).toContain('แก้แล้วส่ง JSON ใหม่ทั้งฉบับ')
    // บทสนทนาสะสม: คำขอ → JSON → ข้อผิดพลาด → JSON → ข้อผิดพลาด (5 ข้อความตอนรอบ 3)
    expect(out.rounds).toHaveLength(3)
  })

  it('gives up after the round limit but still returns the last parseable attempt', async () => {
    const tooDeep = { ...TUCK_END_STRUCTURE, panels: TUCK_END_STRUCTURE.panels.map((p) => (p.id === 'tuck-top' ? { ...p, size: 140 } : p)) }
    const ask: AskStructure = async () => ({ raw: JSON.parse(JSON.stringify(tooDeep)), model: 'm' })
    const out = await designStructure(ask, req, 2)
    expect(out.ok).toBe(false)
    expect(out.rounds).toHaveLength(2)
    expect(out.structure?.name).toBe('กล่องฝาเสียบ')
    expect(out.issues.map((i) => i.code)).toContain('lid-deep')
  })

  it('passes the current structure along for edits', () => {
    const text = buildStructureUserContent({ ...req, current: MAILER_STRUCTURE })
    expect(text).toContain('โครงสร้างปัจจุบัน')
    expect(text).toContain('"id":"lid"')
    expect(text).toContain('80×50×120')
  })
})

describe('mock + prompt', () => {
  it('mock picks an example by keyword and marks it as simulated', () => {
    expect(mockStructure('ถาดใส่ขนม').name).toBe('ถาดเปิด')
    expect(mockStructure('กล่องไปรษณีย์').name).toBe('กล่องไปรษณีย์ฝาพับ')
    expect(mockStructure('กล่องครีม').explanation).toContain('จำลอง')
  })

  it('system prompt carries the grammar, the rules and the three examples', () => {
    expect(STRUCTURE_SYSTEM).toContain('ภาษาแผง')
    expect(STRUCTURE_SYSTEM).toContain('"orientation":"base"')
    expect(STRUCTURE_SYSTEM).toContain('carton-300')
    expect(STRUCTURE_SYSTEM.length).toBeLessThan(12_000)
  })
})
