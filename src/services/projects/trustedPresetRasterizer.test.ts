import { describe, expect, it, vi } from 'vitest'
import { freshProject } from '../../core/project'
import { rasterizeTrustedPresets } from './trustedPresetRasterizer'

describe('trusted preset rasterization policy', () => {
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
