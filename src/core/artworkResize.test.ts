import { describe, expect, it } from 'vitest'
import { panelBoxes } from './aiArtwork'
import { elCenter, type ImageEl, type ShapeEl } from './artwork'
import { captureArtworkPanelAnchor, refreshArtworkPanelAnchors, resizePanelArtwork } from './artworkResize'
import { getMaterial } from './materials'
import { generateTuckEndBox } from './templates/tuckEnd'

const panels = (W = 80, D = 30, H = 120) => panelBoxes(generateTuckEndBox({ W, D, H }, getMaterial('carton-300')))

describe('resizePanelArtwork', () => {
  it('keeps a logo and side artwork on their own tuck-end panels as the sheet moves', () => {
    const source = panels()
    const target = panels(80, 85)
    const front = source.find((panel) => panel.id === 'front')!
    const nextFront = target.find((panel) => panel.id === 'front')!
    const side = source.find((panel) => panel.id === 'side-right')!
    const nextSide = target.find((panel) => panel.id === 'side-right')!
    const logo: ImageEl = {
      id: 'logo', type: 'image', src: 'data:image/png;base64,AA==', aspect: 2,
      w: 24, h: 12, x: front.x0 + front.w / 2 - 12, y: front.y0 + front.h / 4 - 6, rot: 0,
    }
    const band: ShapeEl = {
      id: 'side-art', type: 'shape', shape: 'rect', fill: '#12ab34', stroke: 'none', strokeW: 0,
      w: 10, h: 8, x: side.x0 + side.w * 0.6 - 5, y: side.y0 + side.h / 2 - 4, rot: 0,
    }
    const manual = { ...band, id: 'manual' }
    const [resizedLogo, resizedBand, retainedManual] = resizePanelArtwork([
      captureArtworkPanelAnchor(logo, front),
      captureArtworkPanelAnchor(band, side),
      manual,
    ], target, 3)

    expect(elCenter(resizedLogo).x).toBeCloseTo(nextFront.x0 + nextFront.w / 2)
    expect(elCenter(resizedLogo).y).toBeCloseTo(nextFront.y0 + nextFront.h / 4)
    expect(resizedLogo).toMatchObject({ w: 24, h: 12, aspect: 2, panelAnchor: { panelId: 'front' } })
    expect(elCenter(resizedBand).x).toBeCloseTo(nextSide.x0 + nextSide.w * 0.6)
    expect(elCenter(resizedBand).y).toBeCloseTo(nextSide.y0 + nextSide.h / 2)
    expect(retainedManual).toBe(manual)
  })

  it('recovers original placement and size after repeated narrow/large resizes', () => {
    const source = panels(140, 50, 160)
    const front = source.find((panel) => panel.id === 'front')!
    const target = panels(26, 85, 92)
    const nextFront = target.find((panel) => panel.id === 'front')!
    const logo = captureArtworkPanelAnchor({
      id: 'logo', type: 'image', src: 'data:image/png;base64,AA==', aspect: 2,
      w: 92, h: 46, x: front.x0 + 10, y: front.y0 + 25, rot: 20,
    }, front)

    let artwork = [logo]
    for (let cycle = 0; cycle < 10; cycle++) {
      artwork = resizePanelArtwork(artwork, target, 3)
      const reduced = artwork[0] as ImageEl
      expect(reduced.w).toBeLessThan(logo.w)
      expect(reduced.w / reduced.h).toBeCloseTo(2)
      expect(elCenter(reduced).x).toBeGreaterThan(nextFront.x0)
      expect(elCenter(reduced).x).toBeLessThan(nextFront.x1)
      artwork = resizePanelArtwork(artwork, source, 3)
    }
    const restored = artwork[0] as ImageEl
    expect(restored.x).toBeCloseTo(logo.x, 8)
    expect(restored.y).toBeCloseTo(logo.y, 8)
    expect(restored.w).toBeCloseTo(92, 8)
    expect(restored.h).toBeCloseTo(46, 8)
  })

  it('keeps artwork at its current position if a destination panel is missing', () => {
    const source = panels()
    const front = source.find((panel) => panel.id === 'front')!
    const decal = captureArtworkPanelAnchor({
      id: 'dot', type: 'shape', shape: 'ellipse', fill: '#12ab34', stroke: 'none', strokeW: 0,
      w: 6, h: 6, x: front.x0 + 10, y: front.y0 + 10, rot: 0,
    }, front)
    const artwork = [decal]
    expect(resizePanelArtwork(artwork, panels(80, 85).filter((panel) => panel.id !== 'front'))).toBe(artwork)
  })
})

describe('refreshArtworkPanelAnchors', () => {
  it('uses a deliberate move onto another panel for later resizing without snapping back', () => {
    const source = panels()
    const front = source.find((panel) => panel.id === 'front')!
    const back = source.find((panel) => panel.id === 'back')!
    const decal = captureArtworkPanelAnchor({
      id: 'dot', type: 'shape', shape: 'ellipse', fill: '#12ab34', stroke: 'none', strokeW: 0,
      w: 6, h: 6, x: front.x0 + 10, y: front.y0 + 10, rot: 0,
    }, front)
    const moved = { ...decal, x: back.x0 + back.w / 2 - 3, y: back.y0 + back.h / 2 - 3 }
    const target = panels(110, 85)
    const nextBack = target.find((panel) => panel.id === 'back')!
    const [resized] = resizePanelArtwork(refreshArtworkPanelAnchors([decal], [moved], source), target)
    expect(resized.panelAnchor?.panelId).toBe('back')
    expect(elCenter(resized).x).toBeCloseTo(nextBack.x0 + nextBack.w / 2)
    expect(elCenter(resized).y).toBeCloseTo(nextBack.y0 + nextBack.h / 2)
  })
})
