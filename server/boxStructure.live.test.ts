// เช็คสด: ให้ AI จริงออกแบบโครงสร้างด้วยภาษาแผงผ่านวงรอบตรวจ/แก้ — ข้ามเสมอเว้นแต่ตั้ง PACKIT_LIVE_STRUCTURE=1
// ใช้ claude CLI ในเครื่อง (login ของ Claude Code) ถ้าไม่มี ANTHROPIC_API_KEY; ผลเขียนเป็น JSON ลงไฟล์ที่
// PACKIT_LIVE_STRUCTURE_OUT (ค่าเริ่มต้น: scratch/structure-live.json) เพื่อเปิดดูในหน้า tests/browser/structure.html
//   PACKIT_LIVE_STRUCTURE=1 npx vitest run server/boxStructure.live.test.ts
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getMaterial } from '../src/core/materials'
import { compileStructure } from '../src/core/structure/compile'
import { apiAsk, cliAsk, designStructure, type AskStructure, type StructureRequest } from './boxStructure'
import { DEFAULT_AI_MODEL } from './config'

const live = process.env.PACKIT_LIVE_STRUCTURE === '1'
const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
const outFile = process.env.PACKIT_LIVE_STRUCTURE_OUT ?? path.resolve('scratch', 'structure-live.json')

const PROMPTS: StructureRequest[] = [
  { prompt: 'กล่องใส่สบู่ก้อน ฝาเสียบบน-ล่าง มีลิ้นกันฝุ่น', box: { W: 95, D: 35, H: 65 }, materialId: 'carton-300' },
  { prompt: 'ถาดใส่ขนมเปี๊ยะ 6 ชิ้น เปิดด้านบน ผนังเตี้ย ลิ้นมุมทากาว', box: { W: 180, D: 120, H: 35 }, materialId: 'carton-400' },
  { prompt: 'กล่องไปรษณีย์ฝาพับใส่เสื้อยืด ฝาเปิดจากด้านหลัง มีลิ้นเสียบด้านหน้าและปีกข้างฝาห่อลงนอกผนัง', box: { W: 240, D: 180, H: 60 }, materialId: 'corrugated-e' },
  { prompt: 'กล่องท่อฝาเสียบแบบกลับด้าน (reverse tuck): ฝาบนต่อจากผนังหน้า ฝาล่างต่อจากผนังหลัง', box: { W: 70, D: 40, H: 110 }, materialId: 'carton-300' },
]

describe.skipIf(!live)('live: AI designs box structures through the check/fix loop', () => {
  it('produces compilable structures', { timeout: 20 * 60_000 }, async () => {
    const ask: AskStructure = apiKey ? apiAsk(apiKey, process.env.BOX_SPEC_MODEL || DEFAULT_AI_MODEL) : cliAsk(process.env.BOX_SPEC_MODEL, undefined)
    const results = []
    for (const req of PROMPTS) {
      const started = Date.now()
      const out = await designStructure(ask, req)
      const compiled = out.structure ? compileStructure(out.structure, req.box, getMaterial(req.materialId)) : null
      results.push({
        prompt: req.prompt,
        box: req.box,
        materialId: req.materialId,
        ok: out.ok,
        model: out.model,
        rounds: out.rounds.map((r) => ({ attempt: r.attempt, ok: r.ok, errors: r.issues.filter((i) => i.severity === 'error').map((i) => i.message) })),
        seconds: Math.round((Date.now() - started) / 1000),
        name: out.structure?.name,
        explanation: out.structure?.explanation,
        panels: out.structure?.panels.length,
        flaps: out.structure?.flaps.length,
        stages: compiled?.stages,
        coverage: compiled?.coverage,
        warnings: compiled?.issues.filter((i) => i.severity !== 'error').map((i) => i.message),
        structure: out.structure,
      })
      mkdirSync(path.dirname(outFile), { recursive: true })
      writeFileSync(outFile, JSON.stringify(results, null, 2))
    }
    expect(results.filter((r) => r.ok).length).toBeGreaterThan(0)
  })
})
