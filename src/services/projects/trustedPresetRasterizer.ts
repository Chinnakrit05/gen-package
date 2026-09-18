import type { ImageEl } from '../../core/artwork'
import type { Project } from '../../core/project'
import { presetById } from '../../core/presets'

const DEFAULT_LONG_EDGE = 2048
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

export type PresetRasterizer = (presetId: string, color: string, aspect: number) => Promise<string>

export interface TrustedPresetRasterizationResult {
  project: Project
  rasterizedCount: number
}

export function trustedPresetRasterSize(
  aspect: number,
  longEdge = DEFAULT_LONG_EDGE,
): { width: number; height: number } {
  if (!Number.isFinite(aspect) || aspect <= 0 || !Number.isInteger(longEdge) || longEdge <= 0) {
    throw new Error('ขนาด preset ภายในไม่ถูกต้อง')
  }
  return aspect >= 1
    ? { width: longEdge, height: Math.max(1, Math.round(longEdge / aspect)) }
    : { width: Math.max(1, Math.round(longEdge * aspect)), height: longEdge }
}

/**
 * Only regenerates artwork from a known built-in preset ID. The SVG carried in
 * persisted input is never rendered, so legacy content cannot smuggle active SVG.
 */
export async function rasterizeTrustedPresets(
  source: Project,
  rasterize: PresetRasterizer = rasterizeTrustedPreset,
): Promise<TrustedPresetRasterizationResult> {
  const project = structuredClone(source)
  let rasterizedCount = 0
  project.decos = await Promise.all(project.decos.map(async (deco) => {
    if (deco.type !== 'image' || !deco.preset) return deco
    const preset = presetById(deco.preset)
    if (!preset) return deco
    const color = COLOR_PATTERN.test(deco.presetColor ?? '') ? deco.presetColor! : '#2f8a99'
    const src = await rasterize(preset.id, color, preset.aspect)
    rasterizedCount += 1
    return { ...deco, src, aspect: preset.aspect } satisfies ImageEl
  }))
  return { project, rasterizedCount }
}

export async function rasterizeTrustedPreset(
  presetId: string,
  color: string,
  aspect: number,
): Promise<string> {
  const preset = presetById(presetId)
  if (!preset || preset.aspect !== aspect || !COLOR_PATTERN.test(color)) {
    throw new Error('preset ภายในไม่ถูกต้อง')
  }
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    throw new Error('การแปลง preset เป็น PNG ต้องทำใน browser')
  }

  const { width, height } = trustedPresetRasterSize(aspect)
  const blob = new Blob([preset.svg(color)], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  try {
    const image = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('browser นี้ไม่รองรับ canvas 2D')
    context.drawImage(image, 0, 0, width, height)
    const png = await canvasBlob(canvas)
    return blobToDataUrl(png)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('แปลง preset เป็นภาพไม่สำเร็จ'))
    image.src = url
  })
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('เข้ารหัส preset เป็น PNG ไม่สำเร็จ'))
    }, 'image/png')
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('อ่าน PNG ที่แปลงแล้วไม่สำเร็จ'))
    reader.readAsDataURL(blob)
  })
}
