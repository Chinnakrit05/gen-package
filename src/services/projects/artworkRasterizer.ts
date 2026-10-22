// งานศิลป์จาก AI บน cloud: cloud เก็บรูปเป็น asset PNG/JPEG เท่านั้น (cloudProjectCodec ปฏิเสธ SVG — บันทึกขึ้น cloud ไม่ได้
// ทั้งงาน) แต่รูปทุกชิ้นที่ compileArtworkPlan ให้มาเป็น SVG data URL → แปลงเป็นภาพ "ตอนวางลงงาน" (ไม่ใช่ตอนบันทึก:
// ตัวบันทึกตั้งใจไม่เรนเดอร์ SVG ที่มาจาก draft/ไฟล์ที่เก็บไว้)
//  - ลายไลบรารี (มี preset) → rasterizeTrustedPreset สร้างใหม่จาก id ในเครื่อง คง preset/presetColor ไว้เปลี่ยนสีได้เหมือนกดเพิ่มเอง
//  - SVG ที่ AI วาดเอง / รูปพื้นทั้งแผ่น → ถอด data URL → sanitizeSvg ซ้ำ (allowlist ชุดเดียวกับตอน compile) → วาดลง canvas
// ความละเอียด 12 px/มม. (≈ 305 dpi ผ่านเกณฑ์ DPI สีเขียว) ด้านยาวไม่เกิน 2048 ต่อชิ้น / 3072 สำหรับรูปพื้น — รูปพื้นวางบนสีพื้น
// อยู่แล้ว จึงทาสีพื้นรองแล้วเป็น JPEG (ไม่มีสีพื้น = PNG โปร่งใส ให้วัสดุโชว์ผ่านเหมือนเดิม)
// ชิ้นไหนแปลงไม่สำเร็จ → ตัดเฉพาะชิ้นนั้นพร้อมนับ dropped (เครดิตจ่ายไปแล้ว อย่าทิ้งทั้งแบบ)
import { sanitizeSvg } from '../../core/aiArtwork'
import type { Deco, FillImage } from '../../core/artwork'
import { presetById } from '../../core/presets'
import { svgToRasterDataUrl, type SvgRasterOptions } from './svgRaster'
import { rasterizeTrustedPreset, trustedPresetRasterSize } from './trustedPresetRasterizer'

export const ART_RASTER_PX_PER_MM = 12
const DECO_EDGE = { min: 256, max: 2048 }
const FILL_EDGE = { min: 1024, max: 3072 }
const FILL_MAX_BYTES = 9 * 1024 * 1024
const HEX = /^#[0-9a-fA-F]{6}$/

export interface ArtworkImages {
  decos: Deco[]
  fillImage: FillImage | null
}

export interface ArtworkRasterInput extends ArtworkImages {
  fillColor: string | null // สีพื้นของแบบ — ใช้รองรูปพื้นตอนแปลงเป็น JPEG
}

export interface ArtworkRasterDeps {
  preset(presetId: string, color: string, aspect: number): Promise<string>
  svg(svg: string, width: number, height: number, options?: SvgRasterOptions): Promise<string>
}

const browserDeps: ArtworkRasterDeps = { preset: rasterizeTrustedPreset, svg: svgToRasterDataUrl }

export const isSvgDataUrl = (src: string) => /^data:image\/svg\+xml[;,]/i.test(src)

// data:image/svg+xml;base64,… (presetDataUrl: base64 ของ UTF-8) หรือแบบ percent-encoded → markup
export function svgFromDataUrl(src: string): string | null {
  const m = /^data:image\/svg\+xml((?:;[^,]*)?),(.*)$/is.exec(src)
  if (!m) return null
  try {
    if (/;base64/i.test(m[1])) return new TextDecoder().decode(Uint8Array.from(atob(m[2].replace(/\s/g, '')), (c) => c.charCodeAt(0)))
    return decodeURIComponent(m[2])
  } catch {
    return null
  }
}

// ตั้ง width/height (พิกเซล) ที่ราก <svg> — SVG ที่มีแค่ viewBox ไม่มีขนาดในตัว บาง browser วาดลง canvas ไม่ได้/ไม่คม
export function withPixelSize(svg: string, width: number, height: number): string {
  return svg.replace(/<svg\b([^>]*)>/i, (_m, attrs: string) =>
    `<svg${attrs.replace(/\s(?:width|height)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')} width="${width}" height="${height}">`)
}

const edgeFor = (mm: number, edge: { min: number; max: number }) =>
  Math.min(edge.max, Math.max(edge.min, Math.ceil(mm * ART_RASTER_PX_PER_MM)))

async function rasterizeSvgSource(src: string, longEdge: number, deps: ArtworkRasterDeps, options?: SvgRasterOptions): Promise<string> {
  const markup = svgFromDataUrl(src)
  const clean = markup ? sanitizeSvg(markup) : null
  if (!clean) throw new Error('SVG ไม่ผ่านการตรวจ')
  const { width, height } = trustedPresetRasterSize(clean.aspect, longEdge)
  return deps.svg(withPixelSize(clean.svg, width, height), width, height, options)
}

export async function rasterizeArtworkImages(
  input: ArtworkRasterInput,
  sheet: { w: number; h: number },
  deps: ArtworkRasterDeps = browserDeps,
): Promise<ArtworkImages & { dropped: number }> {
  let dropped = 0
  const decos = await Promise.all(input.decos.map(async (d): Promise<Deco | null> => {
    if (d.type !== 'image' || !isSvgDataUrl(d.src)) return d
    try {
      const preset = d.preset ? presetById(d.preset) : undefined
      if (preset) {
        const color = HEX.test(d.presetColor ?? '') ? d.presetColor! : '#2f8a99'
        return { ...d, src: await deps.preset(preset.id, color, preset.aspect), aspect: preset.aspect, presetColor: color }
      }
      return { ...d, src: await rasterizeSvgSource(d.src, edgeFor(Math.max(d.w, d.h), DECO_EDGE), deps) }
    } catch {
      dropped += 1
      return null
    }
  }))
  let fillImage = input.fillImage
  if (fillImage && isSvgDataUrl(fillImage.src)) {
    try {
      const matte = input.fillColor && HEX.test(input.fillColor) ? input.fillColor : undefined
      const src = await rasterizeSvgSource(fillImage.src, edgeFor(Math.max(sheet.w, sheet.h), FILL_EDGE), deps, { ...(matte ? { matte } : {}), maxBytes: FILL_MAX_BYTES })
      fillImage = { ...fillImage, src }
    } catch {
      dropped += 1
      fillImage = null
    }
  }
  return { decos: decos.filter((d): d is Deco => d !== null), fillImage, dropped }
}
