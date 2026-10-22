import { describe, expect, it, vi } from 'vitest'
import { compileArtworkPlan, panelBoxes, parseArtworkPlan } from '../../core/aiArtwork'
import type { Deco, ImageEl } from '../../core/artwork'
import { getMaterial } from '../../core/materials'
import { presetById, presetDataUrl } from '../../core/presets'
import { TEMPLATES } from '../../core/templates'
import { rasterizeArtworkImages, svgFromDataUrl, withPixelSize, type ArtworkRasterDeps } from './artworkRasterizer'
import { parseImageDataUrl } from './cloudProjectCodec'

// PNG 1×1 จริง (signature ถูก) — ตัวตรวจของ cloud (parseImageDataUrl) ต้องรับได้
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

const fakeDeps = (): ArtworkRasterDeps & { calls: unknown[] } => {
  const calls: unknown[] = []
  return {
    calls,
    preset: vi.fn(async (id: string, color: string, aspect: number) => { calls.push(['preset', id, color, aspect]); return PNG }),
    svg: vi.fn(async (svg: string, width: number, height: number, options?: unknown) => { calls.push(['svg', svg, width, height, options]); return PNG }),
  }
}

const tuckEnd = () => TEMPLATES.find((t) => t.id === 'tuck-end')!.generate({ W: 70, D: 25, H: 96, handle: false }, getMaterial('carton-400'))

describe('rasterizeArtworkImages (งานศิลป์จาก AI → รูปที่บันทึกขึ้น cloud ได้)', () => {
  it('แปลงทุกรูปของแผนจริง (ลายไลบรารี + SVG ที่ AI วาด + รูปพื้น) จนผ่านตัวตรวจรูปของ cloud และไม่เหลือ SVG', async () => {
    const d = tuckEnd()
    const boxes = panelBoxes(d)
    const parsed = parseArtworkPlan({
      name: 'ทดสอบ', fillColor: '#2a1460', explanation: 'x',
      background: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100" fill="#2a1460"/></svg>',
      elements: [
        { type: 'image', panel: 'front', x: 5, y: 5, src: 'preset:badge-burst:#ffcc00', w: 20 },
        { type: 'image', panel: 'front', x: 5, y: 40, src: 'svg:<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 20"><rect width="10" height="20" fill="#ff3399"/></svg>', w: 30 },
        { type: 'text', panel: 'front', x: 5, y: 80, text: 'FLUKE TCG', size: 6, color: '#ffffff' },
      ],
    })
    if (!parsed.ok) throw new Error('parse')
    const compiled = compileArtworkPlan(parsed.plan, boxes, { idPrefix: 't' })
    const images = compiled.decos.filter((x): x is ImageEl => x.type === 'image')
    expect(images.every((x) => x.src.startsWith('data:image/svg+xml'))).toBe(true)
    expect(compiled.fillImage?.src.startsWith('data:image/svg+xml')).toBe(true)

    const deps = fakeDeps()
    const out = await rasterizeArtworkImages({ decos: compiled.decos, fillImage: compiled.fillImage, fillColor: compiled.fillColor }, { w: d.width, h: d.height }, deps)
    expect(out.dropped).toBe(0)
    expect(out.decos).toHaveLength(compiled.decos.length)
    for (const x of out.decos) if (x.type === 'image') await expect(parseImageDataUrl(x.src)).resolves.toMatchObject({ mimeType: 'image/png' })
    await expect(parseImageDataUrl(out.fillImage!.src)).resolves.toMatchObject({ mimeType: 'image/png' })
    expect(JSON.stringify(out)).not.toContain('image/svg+xml')

    // ลายไลบรารีสร้างใหม่จาก id (ไม่เรนเดอร์ SVG ที่แนบมา) และคง preset/presetColor ให้เปลี่ยนสีภายหลังได้
    const preset = presetById('badge-burst')!
    expect(deps.calls[0]).toEqual(['preset', 'badge-burst', '#ffcc00', preset.aspect])
    const presetEl = out.decos.find((x) => x.type === 'image' && x.preset === 'badge-burst') as ImageEl
    expect(presetEl).toMatchObject({ preset: 'badge-burst', presetColor: '#ffcc00', src: PNG })
    // SVG ที่ AI วาด: ตั้งขนาดพิกเซลที่ราก ~12 px/มม. ตามสัดส่วน viewBox (กว้าง 30 มม. สูง 60 → ด้านยาว 720)
    const svgCall = deps.calls.find((c) => (c as unknown[])[0] === 'svg' && (c as unknown[])[4] === undefined) as [string, string, number, number]
    expect(svgCall[2]).toBe(360)
    expect(svgCall[3]).toBe(720)
    expect(svgCall[1]).toMatch(/^<svg[^>]* width="360" height="720">/)
    // รูปพื้นทั้งแผ่น: ด้านยาวตามแผ่น (ไม่เกิน 3072) รองด้วยสีพื้นของแบบ (→ JPEG) และจำกัดขนาดไฟล์
    const fillCall = deps.calls.find((c) => (c as unknown[])[0] === 'svg' && (c as unknown[])[4] !== undefined) as [string, string, number, number, unknown]
    expect(fillCall[2]).toBe(Math.min(3072, Math.max(1024, Math.ceil(Math.max(d.width, d.height) * 12))))
    expect(fillCall[4]).toEqual({ matte: '#2a1460', maxBytes: 9 * 1024 * 1024 })
    // ข้อความ/รูปทรงไม่ถูกแตะ
    expect(out.decos.find((x) => x.type === 'text')).toEqual(compiled.decos.find((x) => x.type === 'text'))
  })

  it('ตัดเฉพาะชิ้นที่แปลงไม่สำเร็จหรือ SVG ไม่ผ่าน sanitize และปล่อยรูป PNG เดิมไว้', async () => {
    const base = { x: 0, y: 0, rot: 0, aspect: 1, w: 10, h: 10 }
    const decos = [
      { ...base, id: 'png', type: 'image', src: PNG },
      { ...base, id: 'bad', type: 'image', src: presetDataUrl('<svg viewBox="0 0 10 10"><script>alert(1)</script></svg>') },
      { ...base, id: 'fail', type: 'image', src: presetDataUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>') },
    ] as Deco[]
    const deps = fakeDeps()
    deps.svg = vi.fn(async () => { throw new Error('canvas') })
    const out = await rasterizeArtworkImages({ decos, fillImage: null, fillColor: null }, { w: 100, h: 100 }, deps)
    expect(out.decos.map((x) => x.id)).toEqual(['png'])
    expect(out.dropped).toBe(2)
    expect(out.fillImage).toBeNull()
  })

  it('ถอด SVG data URL ได้ทั้ง base64 (UTF-8 ไทย) และ percent-encoded แล้วตั้งขนาดพิกเซลแทนของเดิม', () => {
    const svg = '<svg viewBox="0 0 4 2"><text>ฟ้า</text></svg>'
    expect(svgFromDataUrl(presetDataUrl(svg))).toBe(svg)
    expect(svgFromDataUrl('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg))).toBe(svg)
    expect(svgFromDataUrl(PNG)).toBeNull()
    expect(withPixelSize('<svg width="10" height=\'5\' viewBox="0 0 4 2"><g/></svg>', 400, 200)).toBe('<svg viewBox="0 0 4 2" width="400" height="200"><g/></svg>')
  })
})
