import { describe, expect, it } from 'vitest'
import { compileArtworkPlan, panelBoxes } from '../src/core/aiArtwork'
import { getMaterial } from '../src/core/materials'
import { TEMPLATES } from '../src/core/templates'
import { ArtworkDeadlineError, buildArtworkUserContent, designArtwork, firstUserMessage, mockArtwork, parseArtworkRequest, type ArtworkRequest } from './aiArtwork'

const dieline = TEMPLATES.find((t) => t.id === 'tuck-end')!.generate({ W: 80, D: 50, H: 120, handle: false }, getMaterial('carton-300'))
const panels = panelBoxes(dieline)
const base = (): ArtworkRequest => ({
  prompt: 'ชาดอกอัญชัน 20 ซอง โทนคราม',
  kind: 'box',
  template: 'tuck-end',
  materialId: 'carton-300',
  box: { W: 80, D: 50, H: 120 },
  sheet: { w: dieline.width, h: dieline.height },
  panels,
  fillColor: null,
  existing: 0,
  images: [],
})
const png = 'iVBORw0KGgo' + 'A'.repeat(120)

describe('parseArtworkRequest', () => {
  it('รับคำขอจาก client พร้อมแผงและรูป (บทบาท reference/logo)', () => {
    const req = parseArtworkRequest({
      ...base(),
      images: [
        { data: png, mediaType: 'image/png', role: 'reference', note: 'mood' },
        { data: png, mediaType: 'image/png', role: 'logo', assetId: 'my logo!' },
      ],
    } as unknown as Record<string, unknown>)
    expect(req.panels).toHaveLength(panels.length)
    expect(req.panels.find((p) => p.id === 'glue')?.print).toBe(false)
    expect(req.images.map((i) => i.role)).toEqual(['reference', 'logo'])
    expect(req.images[1].assetId).toBe('mylogo')
  })

  it('ปฏิเสธ prompt ว่าง แผงผิดรูป และรูปเกินจำนวน', () => {
    expect(() => parseArtworkRequest({ ...base(), prompt: ' ' } as unknown as Record<string, unknown>)).toThrow('prompt')
    expect(() => parseArtworkRequest({ ...base(), panels: [{ id: 'front', x0: 10, y0: 0, x1: 5, y1: 10 }] } as unknown as Record<string, unknown>)).toThrow('panel')
    const many = Array.from({ length: 5 }, () => ({ data: png, mediaType: 'image/png', role: 'reference' }))
    expect(() => parseArtworkRequest({ ...base(), images: many } as unknown as Record<string, unknown>)).toThrow('images')
  })
})

describe('prompt building', () => {
  it('บอกแผง ขนาด บทบาท และรูปที่แนบ (โลโก้ระบุ asset id) และรูปมาก่อนข้อความ', () => {
    const req: ArtworkRequest = { ...base(), fillColor: '#112233', existing: 3, images: [{ data: png, mediaType: 'image/png', role: 'logo', assetId: 'logo' }] }
    const text = buildArtworkUserContent(req)
    expect(text).toContain('front:')
    expect(text).toContain('ผนังหน้า')
    expect(text).toContain('asset:logo')
    expect(text).toContain('#112233')
    expect(text).toContain('ชิ้นงานเดิม 3')
    const msg = firstUserMessage(req)
    const content = msg.content as { type: string }[]
    expect(content.map((c) => c.type)).toEqual(['text', 'image', 'text'])
  })
})

describe('designArtwork', () => {
  const goodPlan = {
    name: 'ทดสอบ',
    fillColor: '#1d2a78',
    background: null,
    explanation: 'ok',
    elements: [
      { type: 'text', panel: 'front', x: 40, y: 20, anchor: 'center', text: 'ฟ้าคราม', size: 12, color: '#ffffff' },
      { type: 'shape', panel: 'front', x: 0, y: 100, shape: 'rect', w: 80, h: 20, fill: '#ffffff', stroke: 'none', strokeW: 0 },
    ],
  }

  it('งบเวลาหมดก่อนรอบแก้ → คืนแบบจากรอบแรก (ok=false) แทนการล้มทั้งคำขอ', async () => {
    let calls = 0
    const r = await designArtwork(async () => {
      calls++
      if (calls === 1) return { raw: { ...goodPlan, elements: [{ ...goodPlan.elements[0], panel: 'lid-top' }] }, model: 'fake' }
      throw new ArtworkDeadlineError()
    }, base(), 2)
    expect(calls).toBe(2)
    expect(r.ok).toBe(false)
    expect(r.plan?.name).toBe('ทดสอบ')
    expect(r.rounds).toHaveLength(1)
    // ยังไม่มีแบบเลยตอนหมดเวลา → โยนต่อให้ service คืนเครดิต
    await expect(designArtwork(async () => { throw new ArtworkDeadlineError() }, base(), 2)).rejects.toBeInstanceOf(ArtworkDeadlineError)
  })

  it('คำตอบรอบแรกไม่มี JSON → รอบแก้ได้คำตอบเดิมเป็นข้อความ assistant แล้วผ่านรอบสอง', async () => {
    const seen: unknown[] = []
    const r = await designArtwork(async (messages) => {
      seen.push(messages.length)
      if (messages.length === 1) return { raw: null, model: 'fake', text: 'ขอโทษครับ ลืมใส่ JSON' }
      expect(messages[1]).toEqual({ role: 'assistant', content: 'ขอโทษครับ ลืมใส่ JSON' })
      expect(String(messages[2].content)).toContain('คำตอบไม่ใช่ JSON object')
      return { raw: goodPlan, model: 'fake' }
    }, base(), 2)
    expect(seen).toEqual([1, 3])
    expect(r.ok).toBe(true)
    expect(r.rounds.map((x) => x.ok)).toEqual([false, true])
  })

  it('ผ่านรอบแรกเมื่อแผนถูกต้อง', async () => {
    const r = await designArtwork(async () => ({ raw: goodPlan, model: 'fake' }), base())
    expect(r.ok).toBe(true)
    expect(r.rounds).toHaveLength(1)
    expect(r.plan?.elements).toHaveLength(2)
    expect(r.model).toBe('fake')
  })

  it('อ้างแผงที่ไม่มี → ส่ง feedback ภาษาไทยกลับแล้วรับฉบับแก้ในรอบสอง', async () => {
    const seen: string[] = []
    const ask = async (messages: { role: string; content: unknown }[]) => {
      if (messages.length === 1) return { raw: { ...goodPlan, elements: [{ ...goodPlan.elements[0], panel: 'lid-top' }] }, model: 'fake' }
      seen.push(String(messages[messages.length - 1].content))
      return { raw: goodPlan, model: 'fake' }
    }
    const r = await designArtwork(ask, base())
    expect(r.ok).toBe(true)
    expect(r.rounds.map((x) => x.ok)).toEqual([false, true])
    expect(seen[0]).toContain('ไม่มีแผง "lid-top"')
    expect(seen[0]).toContain('front')
  })

  it('ชิ้นที่ผิดถูกตัดทิ้ง ถ้ายังเหลือ ≥ 4 ชิ้นดีไม่เสียรอบแก้', async () => {
    const plan = {
      ...goodPlan,
      elements: [
        ...goodPlan.elements,
        { type: 'shape', panel: 'front', x: 0, y: 0, shape: 'rect', w: 10, h: 10, fill: '#000000', stroke: 'none', strokeW: 0 },
        { type: 'shape', panel: 'front', x: 0, y: 0, shape: 'rect', w: 10, h: 10, fill: '#000000', stroke: 'none', strokeW: 0 },
        { type: 'image', panel: 'front', x: 0, y: 0, w: 10, src: 'preset:nope:#000000' },
      ],
    }
    let calls = 0
    const r = await designArtwork(async () => { calls++; return { raw: plan, model: 'fake' } }, base())
    expect(calls).toBe(1)
    expect(r.ok).toBe(true)
    expect(r.plan?.elements).toHaveLength(4)
    expect(r.issues.some((i) => i.code === 'preset-unknown')).toBe(true)
  })

  it('parse ไม่ผ่านทุกรอบ → ok:false พร้อมปัญหาของรอบสุดท้าย', async () => {
    const r = await designArtwork(async () => ({ raw: { elements: [] }, model: 'fake' }), base(), 2)
    expect(r.ok).toBe(false)
    expect(r.rounds).toHaveLength(2)
    expect(r.plan).toBeNull()
    expect(r.issues[0].code).toBe('no-elements')
  })
})

describe('mockArtwork', () => {
  it('วางชื่อแบรนด์บนแผงหน้า + ข้อมูลหลัง และคอมไพล์ลง tuck-end ได้โดยไม่มีชิ้นหลุด', () => {
    const req = { ...base(), images: [{ data: png, mediaType: 'image/png', role: 'logo' as const, assetId: 'logo' }] }
    const plan = mockArtwork(req)
    expect(plan.elements.some((e) => e.panel === 'front' && e.type === 'text')).toBe(true)
    expect(plan.elements.some((e) => e.panel === 'back')).toBe(true)
    expect(plan.elements.some((e) => e.type === 'image' && e.src === 'asset:logo')).toBe(true)
    const out = compileArtworkPlan(plan, panels, { assets: { logo: { src: 'data:image/png;base64,AAAA', aspect: 1 } } })
    expect(out.decos.length).toBe(plan.elements.length)
    expect(out.warnings.filter((w) => w.code !== 'moved' && w.code !== 'text-shrunk')).toEqual([])
    expect(out.fillColor).toMatch(/^#/)
  })

  it('ฉลากขวด (แผง label) ก็ใช้ได้', () => {
    const req: ArtworkRequest = { ...base(), kind: 'vessel', panels: [{ id: 'label', x0: 0, y0: 0, x1: 240, y1: 90, w: 240, h: 90, role: 'ฉลาก', print: true }] }
    const plan = mockArtwork(req)
    expect(plan.elements.every((e) => e.panel === 'label')).toBe(true)
  })
})
