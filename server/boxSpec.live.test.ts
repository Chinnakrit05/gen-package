import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TEMPLATES } from '../src/core/templates'
import { askClaudeWithUsage, parseImage } from './boxSpec'
import { CLOUD_AI_LIMITS } from './modules/ai/aiService'

// เช็คสดกับ Anthropic API — เสียเงินจริง (4 รุ่น × 2 คำขอ รวมไม่ถึง 1 USD) จึงข้ามเสมอ เว้นแต่ตั้งครบสองตัว:
//   PACKIT_LIVE_AI=1 ANTHROPIC_API_KEY=sk-ant-... npx vitest run server/boxSpec.live.test.ts
// เลือกรุ่นเองด้วย PACKIT_LIVE_AI_MODELS=claude-haiku-5-5,claude-opus-5-5 — ผลพิมพ์ JSON บรรทัดละคำขอ
// (รุ่นที่ตอบจริง เวลา โทเคน) ใช้ timeout/retry เดียวกับ cloud; คำขอแรกของ schema ช้ากว่าปกติ (คอมไพล์ grammar)
const apiKey = process.env.ANTHROPIC_API_KEY ?? ''
const live = process.env.PACKIT_LIVE_AI === '1' && apiKey !== ''
const models = (process.env.PACKIT_LIVE_AI_MODELS ?? 'claude-opus-4-8,claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5')
  .split(',')
  .map((model) => model.trim())
  .filter(Boolean)

describe.skipIf(!live)('live box-spec call (spends money)', () => {
  it.each(models)('%s answers a Thai prompt and a prompt with an image', async (model) => {
    const image = parseImage({
      data: readFileSync(new URL('../src/assets/packit-mark.png', import.meta.url)).toString('base64'),
      mediaType: 'image/png',
    })
    const cases = [
      { name: 'text', prompt: 'กล่องใส่ขวดน้ำพริก 2 ขวด ส่งไปรษณีย์ กันกระแทกดีๆ', image: undefined },
      { name: 'image', prompt: 'กล่องใส่สบู่ 3 ก้อน สไตล์อีโค่ โทนเดียวกับโลโก้ในรูป', image },
    ]
    for (const { name, prompt, image: refImage } of cases) {
      const started = Date.now()
      const { spec, model: answeredBy, usage } = await askClaudeWithUsage(
        apiKey, model, prompt, undefined, refImage, CLOUD_AI_LIMITS,
      )
      const { template, materialId, W, D, H } = spec
      console.log(JSON.stringify({ model, case: name, answeredBy, ms: Date.now() - started, ...usage, template, materialId, W, D, H }))
      expect(TEMPLATES.map((t) => t.id)).toContain(template)
      expect(spec.mock).toBe(false)
      expect(spec.reasoning).not.toBe('')
    }
  }, 150_000)
})
