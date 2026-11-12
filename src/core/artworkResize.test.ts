import { describe, expect, it } from 'vitest'
import { panelBoxes } from './aiArtwork'
import { elCenter, type ImageEl, type ShapeEl } from './artwork'
import {
  applyLegacyArtworkMatches,
  captureArtworkPanelAnchor,
  hexLabelAnchorPanels,
  hexLabelFrontZone,
  pouchAnchorPanels,
  previewLegacyArtworkMatches,
  refreshArtworkPanelAnchors,
  resizePanelArtwork,
} from './artworkResize'
import { getMaterial } from './materials'
import { generatePouch } from './pouch'
import { generateTuckEndBox } from './templates/tuckEnd'
import type { Panel } from './types'
import { bottleSectionPoint, generateVessel } from './vessel'

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

describe('hexagonal bottle artwork', () => {
  it('moves a logo within the flat front face across full and partial labels without stretching or losing its original placement', () => {
    const wrap = generateVessel({ W: 82, D: 34, H: 216 }, getMaterial('glass'), 'body', { polygon: true })
    const partial = generateVessel({ W: 100, D: 34, H: 216 }, getMaterial('glass'), 'body', {
      polygon: true, label: { w: 28, h: 80 },
    })
    const sourcePanels = panelBoxes(wrap.label)
    const sourceLabel = sourcePanels.find((panel) => panel.id === 'label')!
    const sourceZone = hexLabelFrontZone(sourcePanels, wrap.rect!.a)!
    const source = hexLabelAnchorPanels(sourcePanels, wrap.rect!.a)
    const target = hexLabelAnchorPanels(panelBoxes(partial.label), partial.rect!.a)
    const centerX = sourceLabel.x0 + sourceZone.x0 + 0.65 * (sourceZone.x1 - sourceZone.x0)
    const logo: ImageEl = {
      id: 'logo', type: 'image', src: 'data:image/png;base64,AA==', aspect: 2, w: 16, h: 8,
      x: centerX - 8, y: sourceLabel.y0 + sourceLabel.h / 3 - 4, rot: 0,
    }
    const wide = { ...logo, id: 'wrap-art', x: sourceLabel.x0 + 12, w: sourceLabel.w - 24 }
    const anchoredLogo = captureArtworkPanelAnchor(logo, sourceLabel, source)
    const anchoredWide = captureArtworkPanelAnchor(wide, sourceLabel, source)
    const [resized, resizedWide] = resizePanelArtwork([anchoredLogo, anchoredWide], target, 3)
    const nextLogo = resized as ImageEl
    const [restored] = resizePanelArtwork([resized], source, 3)

    expect(sourceZone.x1 - sourceZone.x0).toBeCloseTo(41)
    expect(sourceLabel.w).toBeCloseTo(wrap.circ)
    expect(wrap.label.width).toBeGreaterThan(sourceLabel.w)
    expect(anchoredLogo.panelAnchor?.panelId).toBe('label-front-face')
    expect(anchoredWide.panelAnchor?.panelId).toBe('label')
    expect(resizedWide.panelAnchor?.panelId).toBe('label')
    expect(elCenter(nextLogo).x).toBeCloseTo(28 * 0.65)
    expect(elCenter(nextLogo).y).toBeCloseTo(80 / 3)
    expect(nextLogo.w / nextLogo.h).toBeCloseTo(2)
    expect(nextLogo.x).toBeGreaterThanOrEqual(0)
    expect(nextLogo.x + nextLogo.w).toBeLessThanOrEqual(28)
    const faceZ = partial.rect!.b
    for (const x of [nextLogo.x, nextLogo.x + nextLogo.w]) {
      expect(bottleSectionPoint(partial.rect!, x - partial.label.width / 2)[1]).toBeCloseTo(faceZ)
    }
    expect(restored.x).toBeCloseTo(logo.x, 8)
    expect(restored.y).toBeCloseTo(logo.y, 8)
    expect(restored.w).toBeCloseTo(logo.w, 8)
  })
})

describe('pouch artwork regions', () => {
  const pouchMat = getMaterial('pouch-foil')

  it('keeps artwork on each stand-up pouch body when only the bottom gusset grows', () => {
    const initial = generatePouch({ W: 100, D: 25, H: 160 }, pouchMat)
    const resized = generatePouch({ W: 100, D: 70, H: 160 }, pouchMat)
    const source = pouchAnchorPanels(panelBoxes(initial.label), initial)
    const target = pouchAnchorPanels(panelBoxes(resized.label), resized)
    const sample = (id: 'front' | 'back') => {
      const panel = source.find((entry) => entry.id === id)!
      return captureArtworkPanelAnchor({
        id, type: 'image', src: 'data:image/png;base64,AA==', aspect: 2, w: 20, h: 10,
        x: panel.x0 + 40, y: initial.frontRect.y + 40, rot: 0,
      }, panel, source)
    }
    const artwork = [sample('front'), sample('back')]
    expect(artwork.map((deco) => deco.panelAnchor?.panelId)).toEqual(['pouch-front-body', 'pouch-back-body'])
    expect(resized.label.height).toBeGreaterThan(initial.label.height)
    expect(resizePanelArtwork(artwork, target, 3)).toBe(artwork)
  })

  it('keeps art on the correct half of a pillow pouch back and leaves seam-spanning art tied to the film', () => {
    const initial = generatePouch({ W: 80, D: 20, H: 150 }, pouchMat, { style: 'pillow' })
    const resized = generatePouch({ W: 120, D: 20, H: 160 }, pouchMat, { style: 'pillow' })
    const source = pouchAnchorPanels(panelBoxes(initial.label), initial)
    const target = pouchAnchorPanels(panelBoxes(resized.label), resized)
    const film = source.find((panel) => panel.id === 'film')!
    const original = initial.backRectL!
    const mark: ShapeEl = {
      id: 'mark', type: 'shape', shape: 'ellipse', fill: '#12ab34', stroke: 'none', strokeW: 0,
      w: 8, h: 8, x: original.x + original.w / 2 - 4, y: original.y + original.h / 4 - 4, rot: 0,
    }
    const spanning = { ...mark, id: 'span', x: film.x0 + 4, w: film.w - 8 }
    const artwork = [captureArtworkPanelAnchor(mark, film, source), captureArtworkPanelAnchor(spanning, film, source)]
    const [nextMark, nextSpan] = resizePanelArtwork(artwork, target, 3)
    const nextLeft = resized.backRectL!
    expect(nextMark.panelAnchor?.panelId).toBe('pouch-back-left-body')
    expect(elCenter(nextMark).x).toBeCloseTo(nextLeft.x + nextLeft.w / 2)
    expect(elCenter(nextMark).y).toBeCloseTo(nextLeft.y + nextLeft.h / 4)
    expect(nextSpan.panelAnchor?.panelId).toBe('film')
  })
})

describe('legacy artwork panel matching', () => {
  const oldMark = (name: string, x: number, y: number, w = 8, h = 6): ShapeEl => ({
    id: `aimilskc00-${name}`, name, x, y, w, h, rot: 0,
    type: 'shape', shape: 'rect', fill: '#12ab34', stroke: 'none', strokeW: 0,
  })

  it('previews only unanchored Copilot layers and binds the confirmed layer in place', () => {
    const dieline = generateTuckEndBox({ W: 80, D: 30, H: 120 }, getMaterial('carton-300'))
    const regions = panelBoxes(dieline)
    const front = regions.find((panel) => panel.id === 'front')!
    const back = regions.find((panel) => panel.id === 'back')!
    const logo: ImageEl = {
      id: 'aimilskc00-logo', type: 'image', aspect: 2, src: 'data:image/png;base64,AA==',
      w: 16, h: 8, rot: 0, x: front.x0 + front.w / 2 - 8, y: front.y0 + front.h / 3 - 4,
    }
    const manual = { ...logo, id: 'el-milskc00-0' }
    const other = { ...oldMark('back', back.x0 + 12, back.y0 + 12), locked: true, hidden: true }
    const spanning = oldMark('spanning', front.x1 - 4, front.y0 + 20)
    const glue = oldMark('glue', 2, front.y0 + 20)
    const alreadyAnchored = captureArtworkPanelAnchor({ ...logo, id: 'aimilskc00-bound' }, front)
    const decos = [logo, manual, other, spanning, glue, alreadyAnchored]
    const preview = previewLegacyArtworkMatches(decos, regions, dieline)

    expect(preview.map(({ deco, candidates }) => [deco.id, candidates.map((panel) => panel.id)])).toEqual([
      [logo.id, ['front']], [other.id, ['back']], [spanning.id, []], [glue.id, []],
    ])
    expect(logo.panelAnchor).toBeUndefined()
    const confirmed = applyLegacyArtworkMatches(decos, preview, new Map([
      [logo.id, 'front'], [manual.id, 'front'], [spanning.id, 'front'],
    ]))
    expect(confirmed[0]).toEqual({ ...logo, panelAnchor: {
      panelId: 'front', panelW: front.w, panelH: front.h, u: expect.closeTo(0.5), v: expect.closeTo(1 / 3), scale: 1,
    } })
    expect(confirmed.slice(1)).toEqual(decos.slice(1))
    expect(confirmed[2]).toBe(other)

    const resized = resizePanelArtwork(confirmed, panels(80, 85), 3)
    const nextFront = panels(80, 85).find((panel) => panel.id === 'front')!
    expect(elCenter(resized[0]).x).toBeCloseTo(nextFront.x0 + nextFront.w / 2)
    expect(elCenter(resized[0]).y).toBeCloseTo(nextFront.y0 + nextFront.h / 3)
    expect(resized[0]).toMatchObject({ w: 16, h: 8, aspect: 2, panelAnchor: { panelId: 'front' } })
    expect(resized[2]).toBe(other)
  })

  it('does not fall back to the whole film for layers spanning physical pouch or bottle faces', () => {
    const vessel = generateVessel({ W: 76, D: 30, H: 220 }, getMaterial('glass'), 'body', { polygon: true })
    const label = hexLabelAnchorPanels(panelBoxes(vessel.label), vessel.rect!.a)
    const face = label.find((region) => region.id === 'label-front-face')!
    const wrap = [oldMark('front', face.x0 + 10, face.y0 + 10), oldMark('spans', face.x1 - 4, face.y0 + 10)]
    expect(previewLegacyArtworkMatches(wrap, label, vessel.label).map(({ candidates }) => candidates.map(({ id }) => id)))
      .toEqual([['label-front-face'], []])

    const pouch = generatePouch({ W: 100, D: 40, H: 150 }, getMaterial('pouch-foil'))
    const film = pouchAnchorPanels(panelBoxes(pouch.label), pouch)
    const front = film.find((region) => region.id === 'pouch-front-body')!
    const back = film.find((region) => region.id === 'pouch-back-body')!
    const marks = [
      oldMark('front', front.x0 + 10, front.y0 + 10),
      oldMark('back', back.x0 + 10, back.y0 + 10),
      oldMark('spans', front.x0 + 10, front.y1 - 4),
    ]
    expect(previewLegacyArtworkMatches(marks, film, pouch.label).map(({ candidates }) => candidates.map(({ id }) => id)))
      .toEqual([['pouch-front-body'], ['pouch-back-body'], []])
  })

  it('excludes artwork overlapping holes and concave cutouts within a panel’s bounding box', () => {
    const outer: Panel = {
      id: 'front', parentId: null, stage: 0,
      outline: [
        { x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 12 }, { x: 12, y: 12 },
        { x: 12, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 24 }, { x: 0, y: 24 },
      ],
      holes: [[{ x: 18, y: 17 }, { x: 20, y: 17 }, { x: 20, y: 19 }, { x: 18, y: 19 }]],
    }
    const dieline = { panels: [outer] }
    const regions = panelBoxes(dieline)
    const marks = [
      oldMark('cutout', 5, 10, 10, 9), // Its center is inside the panel despite the top crossing the notch.
      oldMark('hole', 14, 14, 8, 8),
      { ...oldMark('clear', 3, 2, 2, 4), rot: 45 },
    ]
    expect(previewLegacyArtworkMatches(marks, regions, dieline).map(({ candidates }) => candidates.map(({ id }) => id)))
      .toEqual([[], [], ['front']])
  })

  it('returns all equally valid panels and accepts only a current, explicit choice', () => {
    const outline = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }]
    const dieline = { panels: [
      { id: 'front', parentId: null, stage: 0, outline },
      { id: 'back', parentId: null, stage: 0, outline },
    ] }
    const mark = oldMark('overlap', 6, 6)
    const decos = [mark]
    const preview = previewLegacyArtworkMatches(decos, panelBoxes(dieline), dieline)
    expect(preview[0].candidates.map(({ id }) => id)).toEqual(['front', 'back'])
    expect(applyLegacyArtworkMatches(decos, preview, new Map())).toBe(decos)
    const choice = new Map([[mark.id, 'back']])
    expect(applyLegacyArtworkMatches(decos, preview, choice)[0].panelAnchor?.panelId).toBe('back')
    const moved = [{ ...mark, x: 30 }]
    expect(applyLegacyArtworkMatches(moved, preview, choice)).toBe(moved)
  })
})
