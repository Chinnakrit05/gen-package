import { describe, expect, it, vi } from 'vitest'
import { freshProject } from '../../core/project'
import { rasterizeTrustedPresets, trustedPresetRasterSize } from './trustedPresetRasterizer'

describe('trusted preset rasterization policy', () => {
  it.each([
    { aspect: 1, longEdge: 2048, expected: { width: 2048, height: 2048 } },
    { aspect: 200 / 62, longEdge: 2048, expected: { width: 2048, height: 635 } },
    { aspect: 100 / 112, longEdge: 2048, expected: { width: 1829, height: 2048 } },
    { aspect: 200 / 62, longEdge: 1024, expected: { width: 1024, height: 317 } },
    { aspect: 100 / 112, longEdge: 4096, expected: { width: 3657, height: 4096 } },
  ])('keeps the aspect ratio at a deterministic $longEdge px long edge', ({ aspect, longEdge, expected }) => {
    expect(trustedPresetRasterSize(aspect, longEdge)).toEqual(expected)
  })

  it.each([
    { aspect: 0, longEdge: 2048 },
    { aspect: Number.NaN, longEdge: 2048 },
    { aspect: 1, longEdge: 0 },
    { aspect: 1, longEdge: 1.5 },
  ])('rejects an invalid internal raster size %#', ({ aspect, longEdge }) => {
    expect(() => trustedPresetRasterSize(aspect, longEdge)).toThrow('ขนาด preset ภายในไม่ถูกต้อง')
  })

  it('regenerates only a recognized preset and never renders a persisted SVG payload', async () => {
    const project = freshProject(1)
    project.decos = [
      {
        id: 'trusted', type: 'image', preset: 'icon-star', presetColor: '#abcdef',
        src: 'data:image/svg+xml;base64,ATTACKER', aspect: 9, x: 0, y: 0, rot: 0, w: 20, h: 20,
      },
      {
        id: 'unknown', type: 'image', preset: 'not-built-in',
        src: 'data:image/svg+xml;base64,KEEP', aspect: 1, x: 0, y: 0, rot: 0, w: 20, h: 20,
      },
    ]
    const rasterize = vi.fn(async () => 'data:image/png;base64,PNG')

    const result = await rasterizeTrustedPresets(project, rasterize)

    expect(rasterize).toHaveBeenCalledWith('icon-star', '#abcdef', 1)
    expect(result.rasterizedCount).toBe(1)
    expect(result.project.decos[0]).toMatchObject({ src: 'data:image/png;base64,PNG', aspect: 1 })
    expect(result.project.decos[1]).toMatchObject({ src: 'data:image/svg+xml;base64,KEEP' })
    expect(project.decos[0]).toMatchObject({ src: 'data:image/svg+xml;base64,ATTACKER' })
  })
})
