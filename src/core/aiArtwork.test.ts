import { describe, expect, it } from 'vitest'
import {
  ART_MIN_TEXT_MM,
  ARTWORK_SCHEMA,
  checkArtworkPlan,
  compileArtworkPlan,
  estimateTextWidth,
  panelBoxes,
  parseArtworkPlan,
  sanitizeSvg,

} from './aiArtwork'
import { parseDecos } from './artwork'
import { getMaterial } from './materials'
import { TEMPLATES } from './templates'

const tuckEnd = () => {
  const tp = TEMPLATES.find((t) => t.id === 'tuck-end')!
  return tp.generate({ W: 80, D: 50, H: 120, handle: false }, getMaterial('carton-300'))
}

const plan = (elements: unknown[], extra: Record<string, unknown> = {}) => ({ name: 'ทดสอบ', fillColor: '#f3e9d2', background: null, elements, explanation: 'x', ...extra })

describe('ARTWORK_SCHEMA', () => {
  it('ใช้เฉพาะ keyword ที่ structured outputs รับ (เหมือนภาษาแผง)', () => {
    const banned = ['minimum', 'maximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern', 'uniqueItems', 'format']
    const text = JSON.stringify(ARTWORK_SCHEMA)
    for (const k of banned) expect(text.includes(`"${k}"`), k).toBe(false)
    // ทุก object ต้องปิด additionalProperties และ required ครบทุก property
    const walk = (s: unknown) => {
      if (typeof s !== 'object' || s === null) return
      const o = s as Record<string, unknown>
      if (o.type === 'object') {
        expect(o.additionalProperties).toBe(false)
        expect(o.required).toEqual(Object.keys(o.properties as object))
      }
      for (const v of Object.values(o)) walk(v)
    }
    walk(ARTWORK_SCHEMA)
  })
})

describe('panelBoxes', () => {
  it('ให้กรอบทุกแผงของ tuck-end พร้อมบทบาท และ glue เป็นแผงห้ามพิมพ์', () => {
    const boxes = panelBoxes(tuckEnd())
    const ids = boxes.map((b) => b.id)
    expect(ids).toEqual(expect.arrayContaining(['front', 'back', 'side-left', 'side-right', 'glue', 'tuck-top']))
    const front = boxes.find((b) => b.id === 'front')!
    expect(front.w).toBeGreaterThan(80) // ระยะ score บวกความหนาแล้ว
    expect(front.h).toBeGreaterThan(120)
    expect(front.print).toBe(true)
    expect(boxes.find((b) => b.id === 'glue')!.print).toBe(false)
    expect(front.role).toMatch(/หน้า/)
  })
})

describe('parseArtworkPlan', () => {
  it('รับแผนปกติ ตัดชิ้นที่ผิดชนิดทิ้งพร้อม error', () => {
    const r = parseArtworkPlan(plan([
      { type: 'text', panel: 'front', x: 10, y: 20, text: 'รังทอง', size: 12, color: '#123456', weight: '700', anchor: 'center' },
      { type: 'blob', panel: 'front', x: 0, y: 0 },
      { type: 'shape', panel: 'front', x: 0, y: 100, shape: 'rect', w: 60, h: 10, fill: '#ff0000', stroke: 'none', strokeW: 0 },
    ]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.elements).toHaveLength(2)
    expect(r.plan.elements[0]).toMatchObject({ type: 'text', weight: 700, anchor: 'center', color: '#123456' })
    expect(r.issues.some((i) => i.code === 'type-unknown')).toBe(true)
    expect(r.plan.fillColor).toBe('#f3e9d2')
  })

  it('ปฏิเสธแผนที่ไม่มีชิ้นงานหรือไม่ใช่ object', () => {
    expect(parseArtworkPlan(null).ok).toBe(false)
    expect(parseArtworkPlan(plan([])).ok).toBe(false)
  })

  it('ตัด curve ออกจากข้อความไทย (สระ/วรรณยุกต์หลุดตอนดัดโค้ง) แต่คงไว้กับละติน', () => {
    const r = parseArtworkPlan(plan([
      { type: 'text', panel: 'front', x: 0, y: 0, text: 'น้ำผึ้ง', size: 10, color: '#000000', curve: 40 },
      { type: 'text', panel: 'front', x: 0, y: 0, text: 'HONEY', size: 10, color: '#000000', curve: 40 },
    ]))
    if (!r.ok) throw new Error('parse')
    expect((r.plan.elements[0] as { curve?: number }).curve).toBeUndefined()
    expect((r.plan.elements[1] as { curve?: number }).curve).toBe(40)
    expect(r.issues.some((i) => i.code === 'curve-thai')).toBe(true)
  })

  it('preset ที่ไม่มี = error, asset/svg ผ่านตัวกรอง', () => {
    const r = parseArtworkPlan(plan([
      { type: 'image', panel: 'front', x: 0, y: 0, w: 20, src: 'preset:nope:#ff0000' },
      { type: 'image', panel: 'front', x: 0, y: 0, w: 20, src: 'asset:logo' },
      { type: 'image', panel: 'front', x: 0, y: 0, w: 20, src: 'svg:<svg viewBox="0 0 10 20"><script>alert(1)</script><rect width="10" height="20" onclick="x()" fill="#fff"/></svg>' },
    ]))
    if (!r.ok) throw new Error('parse')
    expect(r.plan.elements.map((e) => e.type)).toEqual(['image', 'image'])
    expect(r.issues.some((i) => i.code === 'preset-unknown')).toBe(true)
    const svg = (r.plan.elements[1] as { src: string }).src
    expect(svg.startsWith('svg:<svg')).toBe(true)
    expect(svg).not.toMatch(/script|onclick/)
  })
})

describe('sanitizeSvg', () => {
  it('เก็บแท็กวาดรูปและ gradient ตัด script/style/image/use/event/ลิงก์ภายนอก', () => {
    const dirty = `<?xml version="1.0"?><!-- c --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="400" height="200">
      <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient>
      <style>.x{fill:red}</style></defs>
      <rect width="200" height="100" fill="url(#g)" style="stroke:red" onload="evil()"/>
      <image href="http://evil/x.png" width="10" height="10"/>
      <use href="#g"/>
      <a href="javascript:alert(1)"><circle cx="10" cy="10" r="5" fill="url(http://evil)"/></a>
      <text x="5" y="50" font-size="12" fill="#333">สวัสดี &amp; hi &lt;3</text>
      <foreignObject><div>x</div></foreignObject>
    </svg>`
    const r = sanitizeSvg(dirty)
    expect(r).not.toBeNull()
    const svg = r!.svg
    expect(r!.aspect).toBeCloseTo(2)
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 200 100" width="512" height="256"/)
    expect(svg).toContain('<linearGradient id="g"')
    expect(svg).toContain('fill="url(#g)"')
    expect(svg).toContain('<text x="5" y="50" font-size="12" fill="#333">สวัสดี &amp; hi &lt;3</text>')
    for (const bad of ['<style', '<image', '<use', '<a ', 'javascript', 'onload', 'style=', 'foreignObject', 'evil', '<?xml', '<!--']) {
      expect(svg, bad).not.toContain(bad)
    }
    // circle อยู่ใต้ <a> ที่ถูกตัดทั้งก้อน
    expect(svg).not.toContain('<circle')
  })

  it('ไม่มี viewBox แต่มี width/height → สร้าง viewBox; ไม่ใช่ svg หรือว่างเปล่า → null', () => {
    expect(sanitizeSvg('<svg width="30" height="10"><rect width="30" height="10"/></svg>')!.aspect).toBeCloseTo(3)
    expect(sanitizeSvg('<div>x</div>')).toBeNull()
    expect(sanitizeSvg('<svg viewBox="0 0 10 10"><defs></defs></svg>')).toBeNull()
    expect(sanitizeSvg('<svg viewBox="0 0 10 10"><rect width="1" height="1"></svg>')).toBeNull() // ปิดแท็กไม่ครบ
  })
})

describe('compileArtworkPlan', () => {
  const d = tuckEnd()
  const boxes = panelBoxes(d)
  const front = boxes.find((b) => b.id === 'front')!

  it('แปลงพิกัดอ้างแผงเป็นพิกัดแผ่นคลี่ และ anchor center จัดกึ่งกลางด้วยความกว้างที่วัด', () => {
    const measure = () => 40
    const p = parseArtworkPlan(plan([
      { type: 'text', panel: 'front', x: front.w / 2, y: 20, anchor: 'center', text: 'ABC', size: 8, color: '#000000' },
      { type: 'shape', panel: 'back', x: 5, y: 5, shape: 'rect', w: 30, h: 10, fill: '#ff0000', stroke: 'none', strokeW: 0 },
    ]))
    if (!p.ok) throw new Error('parse')
    const out = compileArtworkPlan(p.plan, boxes, { measure, idPrefix: 't' })
    expect(out.warnings).toEqual([])
    const text = out.decos[0] as { x: number; y: number; w: number; align?: string }
    expect(text.w).toBe(40)
    expect(text.x).toBeCloseTo(front.x0 + front.w / 2 - 20, 5)
    expect(text.y).toBeCloseTo(front.y0 + 20, 5)
    expect(text.align).toBe('center')
    const back = boxes.find((b) => b.id === 'back')!
    expect(out.decos[1]).toMatchObject({ type: 'shape', x: back.x0 + 5, y: back.y0 + 5, w: 30, h: 10 })
    // ผ่าน parser ของแอปได้ครบ (ไม่โดนตัด)
    expect(parseDecos(out.decos)).toHaveLength(2)
  })

  it('ชิ้นที่ล้นแผงถูกเลื่อนเข้ากรอบ ชิ้นที่ใหญ่เกินถูกย่อ ชิ้นบนปีกกาวถูกตัด', () => {
    const p = parseArtworkPlan(plan([
      { type: 'shape', panel: 'front', x: front.w - 5, y: front.h - 5, shape: 'rect', w: 20, h: 20, fill: '#ff0000', stroke: 'none', strokeW: 0 },
      { type: 'shape', panel: 'front', x: 0, y: 0, shape: 'ellipse', w: front.w * 2, h: 10, fill: '#ff0000', stroke: 'none', strokeW: 0 },
      { type: 'shape', panel: 'glue', x: 0, y: 0, shape: 'rect', w: 5, h: 5, fill: '#ff0000', stroke: 'none', strokeW: 0 },
    ]))
    if (!p.ok) throw new Error('parse')
    const out = compileArtworkPlan(p.plan, boxes, { idPrefix: 't' })
    expect(out.decos).toHaveLength(2)
    // แถบสี/รูปทรงชนขอบแผงได้ (safe = 0) แต่ห้ามล้นออกนอกแผง
    const moved = out.decos[0] as { x: number; y: number; w: number; h: number }
    expect(moved.x + moved.w).toBeLessThanOrEqual(front.x1 + 1e-6)
    expect(moved.y + moved.h).toBeLessThanOrEqual(front.y1 + 1e-6)
    const shrunk = out.decos[1] as { w: number; h: number }
    expect(shrunk.w).toBeLessThanOrEqual(front.w + 1e-6)
    expect(shrunk.h).toBeCloseTo(10 * (shrunk.w / (front.w * 2)), 5) // ย่อตามสัดส่วน
    expect(out.warnings.map((w) => w.code).sort()).toEqual(['glue-panel', 'moved', 'shrunk'])
  })

  it('ข้อความเล็กเกินถูกขยายถึงขั้นต่ำ และข้อความยาวเกินแผงถูกลดขนาดแต่ไม่ต่ำกว่าขั้นต่ำ', () => {
    const p = parseArtworkPlan(plan([
      { type: 'text', panel: 'side-left', x: 2, y: 2, text: 'เล็ก', size: 1, color: '#000000' },
      { type: 'text', panel: 'side-left', x: 2, y: 20, text: 'ข้อความยาวมากจนเกินความกว้างของผนังข้างแน่นอน', size: 12, color: '#000000' },
    ]))
    if (!p.ok) throw new Error('parse')
    const out = compileArtworkPlan(p.plan, boxes, { idPrefix: 't' })
    const small = out.decos[0] as { size: number }
    expect(small.size).toBe(ART_MIN_TEXT_MM)
    const side = boxes.find((b) => b.id === 'side-left')!
    const long = out.decos[1] as { size: number; w: number; text: string }
    expect(long.text).toContain('\n') // ตัดบรรทัดที่ขอบคำก่อน
    expect(long.size).toBeLessThanOrEqual(12)
    expect(long.size).toBeGreaterThanOrEqual(ART_MIN_TEXT_MM)
    expect(long.w).toBeLessThanOrEqual(side.w - 6 + 1e-6)
    expect(out.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['text-min', 'text-shrunk']))
  })

  it('รูป: preset ให้ data URL + aspect ของลาย, asset จากผู้ใช้, svg ที่ AI วาด, และรูปพื้นจาก background', () => {
    const p = parseArtworkPlan(plan(
      [
        { type: 'image', panel: 'front', x: 10, y: 10, w: 20, src: 'preset:icon-star:#ffaa00' },
        { type: 'image', panel: 'front', x: 10, y: 40, w: 20, src: 'asset:logo' },
        { type: 'image', panel: 'front', x: 10, y: 70, w: 20, src: 'svg:<svg viewBox="0 0 40 20"><circle cx="10" cy="10" r="8" fill="#0f0"/></svg>' },
        { type: 'image', panel: 'front', x: 10, y: 90, w: 20, src: 'asset:missing' },
      ],
      { background: '<svg viewBox="0 0 300 300"><rect width="300" height="300" fill="#eee"/></svg>' },
    ))
    if (!p.ok) throw new Error('parse')
    const out = compileArtworkPlan(p.plan, boxes, { idPrefix: 't', assets: { logo: { src: 'data:image/png;base64,AAAA', aspect: 2 } } })
    expect(out.decos).toHaveLength(3)
    const [preset, asset, svg] = out.decos as { src: string; aspect: number; h: number; preset?: string; presetColor?: string }[]
    expect(preset.src.startsWith('data:image/svg+xml;base64,')).toBe(true)
    expect(preset.preset).toBe('icon-star')
    expect(preset.presetColor).toBe('#ffaa00')
    expect(asset.src).toBe('data:image/png;base64,AAAA')
    expect(asset.h).toBeCloseTo(10)
    expect(svg.aspect).toBeCloseTo(2)
    expect(out.fillImage?.src.startsWith('data:image/svg+xml;base64,')).toBe(true)
    expect(out.warnings.some((w) => w.code === 'image-unresolved')).toBe(true)
    expect(parseDecos(out.decos)).toHaveLength(3)
  })

  it('checkArtworkPlan รายงานแผงที่ไม่มี และ estimateTextWidth ไม่นับสระบน/วรรณยุกต์', () => {
    const p = parseArtworkPlan(plan([{ type: 'text', panel: 'nope', x: 0, y: 0, text: 'x', size: 5, color: '#000000' }]))
    if (!p.ok) throw new Error('parse')
    const issues = checkArtworkPlan(p.plan, boxes)
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toContain('front')
    expect(estimateTextWidth('น้ำ', 10)).toBeCloseTo(estimateTextWidth('นำ', 10))
    expect(estimateTextWidth('ABCD', 10, undefined, 700)).toBeGreaterThan(estimateTextWidth('ABCD', 10))
  })
})
