// เพดานความซับซ้อนของ structured outputs (output_config.format / strict tools) ตามเอกสาร API — รวมทุก schema ในคำขอเดียว:
// ช่องที่เป็น union (anyOf หรือ type แบบ array เช่น ["string","null"]) ≤ 16 และช่อง optional (ไม่อยู่ใน required) ≤ 24
// เกินแล้ว API ตอบ 400 ทันที — schema งานศิลป์ (ARTWORK_SCHEMA ~75 union) จึงส่งเป็นข้อความใน prompt แทน (ดู server/aiArtwork.ts)
// เทสต์นี้กันไม่ให้ schema ที่ยังส่งผ่าน output_config.format โตจนเกินเพดานโดยไม่รู้ตัว (ตัวเรียกจริงไม่มีในเทสต์หน่วยอื่น)
import { describe, expect, it } from 'vitest'
import { STRUCTURE_SCHEMA } from '../src/core/structure/grammar'
import { BOX_SPEC_SCHEMA } from './boxSpec'

const MAX_UNION_PARAMS = 16
const MAX_OPTIONAL_PARAMS = 24

function complexity(schema: unknown): { unions: number; optional: number } {
  let unions = 0
  let optional = 0
  const walk = (s: unknown) => {
    if (Array.isArray(s)) return s.forEach(walk)
    if (!s || typeof s !== 'object') return
    const o = s as Record<string, unknown>
    if (Array.isArray(o.type) || Array.isArray(o.anyOf)) unions++
    if (o.properties && typeof o.properties === 'object') {
      const required = new Set(Array.isArray(o.required) ? (o.required as string[]) : [])
      for (const key of Object.keys(o.properties)) if (!required.has(key)) optional++
    }
    Object.values(o).forEach(walk)
  }
  walk(schema)
  return { unions, optional }
}

describe('structured outputs schemas stay inside the API complexity limits', () => {
  it.each([
    ['BOX_SPEC_SCHEMA (box-spec, local + cloud)', BOX_SPEC_SCHEMA],
    ['STRUCTURE_SCHEMA (ภาษาแผง)', STRUCTURE_SCHEMA],
  ])('%s', (_name, schema) => {
    const c = complexity(schema)
    expect(c.unions).toBeLessThanOrEqual(MAX_UNION_PARAMS)
    expect(c.optional).toBeLessThanOrEqual(MAX_OPTIONAL_PARAMS)
  })

  it('ตัวนับจับ nullable แบบ type array และ anyOf ได้', () => {
    expect(complexity({ type: 'object', properties: { a: { type: ['string', 'null'] }, b: { anyOf: [{ type: 'string' }, { type: 'null' }] }, c: { type: 'string' } }, required: ['a', 'b'] }))
      .toEqual({ unions: 2, optional: 1 })
  })
})
