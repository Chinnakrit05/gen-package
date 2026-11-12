import { elCenter, elH, elW, scaleDecos, textLocalBounds, type Deco } from './artwork'
import type { ArtFrontZone, PanelBox } from './aiArtwork'
import type { Pouch } from './pouch'
import { textFxPlan } from './textFx'
import type { Dieline, Vec2 } from './types'

export type ArtworkAnchorPanel = PanelBox & { sourcePanelId?: string }

export interface LegacyArtworkMatch {
  deco: Deco
  candidates: ArtworkAnchorPanel[]
}

export function isLegacyAiArtwork(deco: Deco): boolean {
  // The original Copilot compiler saved a base-36 timestamp in each layer ID.
  // Manual layers and user-created duplicates are issued new el- IDs.
  return !deco.panelAnchor && /^ai[0-9a-z]{8,}-/.test(deco.id)
}

function canAnchor(panel: PanelBox): boolean {
  return panel.print && panel.w > 0 && panel.h > 0
}

export function hexLabelFrontZone(panels: readonly PanelBox[], faceWidth: number): ArtFrontZone | null {
  const label = panels.find((panel) => panel.id === 'label')
  if (!label || !canAnchor(label) || !(faceWidth > 0)) return null
  // The midpoint of the printable label maps to the middle of the flat front face
  // in both a full wrap and a centered partial label. The glue overlap is separate.
  const inset = Math.max(0, (label.w - faceWidth) / 2)
  return { panel: label.id, x0: inset, x1: label.w - inset }
}

export function hexLabelAnchorPanels(panels: readonly PanelBox[], faceWidth: number): ArtworkAnchorPanel[] {
  const zone = hexLabelFrontZone(panels, faceWidth)
  const label = panels.find((panel) => panel.id === zone?.panel)
  if (!zone || !label) return [...panels]
  return [...panels, {
    ...label,
    id: 'label-front-face',
    sourcePanelId: label.id,
    x0: label.x0 + zone.x0,
    x1: label.x0 + zone.x1,
    w: zone.x1 - zone.x0,
  }]
}

export function pouchAnchorPanels(
  panels: readonly PanelBox[],
  pouch: Pick<Pouch, 'frontRect' | 'backRect' | 'backRectL' | 'spoutCorner'>,
): ArtworkAnchorPanel[] {
  const film = panels.find((panel) => panel.id === 'film')
  const regions: ArtworkAnchorPanel[] = [...panels]
  const addBody = (id: string, source: PanelBox | undefined, rect: Pouch['frontRect']) => {
    if (!source || !canAnchor(source)) return
    const x0 = Math.max(source.x0, rect.x)
    const x1 = Math.min(source.x1, rect.x + rect.w)
    // A corner spout cuts away a triangle above this horizontal line.
    const y0 = Math.max(source.y0, rect.y, pouch.spoutCorner?.c ?? 0)
    const y1 = Math.min(source.y1, rect.y + rect.h)
    if (x1 <= x0 || y1 <= y0) return
    regions.push({ ...source, id, sourcePanelId: source.id, x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 })
  }
  addBody('pouch-front-body', panels.find((panel) => panel.id === 'front') ?? film, pouch.frontRect)
  addBody('pouch-back-body', panels.find((panel) => panel.id === 'back') ?? film, pouch.backRect)
  if (pouch.backRectL) addBody('pouch-back-left-body', film, pouch.backRectL)
  return regions
}

export function captureArtworkPanelAnchor(
  deco: Deco,
  panel: PanelBox,
  regions: readonly ArtworkAnchorPanel[] = [],
): Deco {
  if (!canAnchor(panel)) return deco
  const center = elCenter(deco)
  const anchorPanel = regions.find((region) => region.sourcePanelId === panel.id && containsArtwork(region, deco)) ?? panel
  return {
    ...deco,
    panelAnchor: {
      panelId: anchorPanel.id,
      panelW: anchorPanel.w,
      panelH: anchorPanel.h,
      u: clamp(center.x - anchorPanel.x0, 0, anchorPanel.w) / anchorPanel.w,
      v: clamp(center.y - anchorPanel.y0, 0, anchorPanel.h) / anchorPanel.h,
      scale: 1,
    },
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function rotatedSize(deco: Deco): { width: number; height: number } {
  const angle = deco.rot * Math.PI / 180
  const cos = Math.abs(Math.cos(angle))
  const sin = Math.abs(Math.sin(angle))
  const width = elW(deco)
  const height = elH(deco)
  return { width: cos * width + sin * height, height: sin * width + cos * height }
}

function containsArtwork(panel: PanelBox, deco: Deco): boolean {
  const { x, y } = elCenter(deco)
  const { width, height } = rotatedSize(deco)
  const tolerance = 1e-6
  return x - width / 2 >= panel.x0 - tolerance && x + width / 2 <= panel.x1 + tolerance
    && y - height / 2 >= panel.y0 - tolerance && y + height / 2 <= panel.y1 + tolerance
}

type Bounds = Pick<PanelBox, 'x0' | 'x1' | 'y0' | 'y1'>
const MATCH_EPSILON = 1e-6

function artworkFrame(deco: Deco): Bounds {
  const w = elW(deco)
  const h = elH(deco)
  if (deco.type === 'text') {
    const bounds = textLocalBounds(deco)
    const paint = textFxPlan(deco)
    const pad = Math.max(paint.box?.pad ?? 0, (paint.main.strokeW ?? 0) / 2)
    const frame = { x0: bounds.x - pad, x1: bounds.x + bounds.w + pad, y0: bounds.y - pad, y1: bounds.y + bounds.h + pad }
    for (const layer of paint.under) {
      const extra = (layer.strokeW ?? 0) / 2 + (layer.blur ? 3 * layer.blur + 1 : 0)
      frame.x0 = Math.min(frame.x0, bounds.x + layer.dx - extra)
      frame.x1 = Math.max(frame.x1, bounds.x + bounds.w + layer.dx + extra)
      frame.y0 = Math.min(frame.y0, bounds.y + layer.dy - extra)
      frame.y1 = Math.max(frame.y1, bounds.y + bounds.h + layer.dy + extra)
    }
    return frame
  }

  const stroke = (deco.type === 'shape' || deco.type === 'path') && deco.stroke !== 'none' ? deco.strokeW / 2 : 0
  // Bézier control points can extend beyond the nominal path frame.
  const pathXs = deco.type === 'path' ? deco.anchors.flatMap((point) => [point.nx, point.ix ?? point.nx, point.ox ?? point.nx]) : []
  const pathYs = deco.type === 'path' ? deco.anchors.flatMap((point) => [point.ny, point.iy ?? point.ny, point.oy ?? point.ny]) : []
  return {
    x0: w * (Math.min(0, ...pathXs) - 0.5) - stroke,
    x1: w * (Math.max(1, ...pathXs) - 0.5) + stroke,
    y0: h * (Math.min(0, ...pathYs) - 0.5) - stroke,
    y1: h * (Math.max(1, ...pathYs) - 0.5) + stroke,
  }
}

function pointInRing(point: Vec2, ring: readonly Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j]
    if ((a.y > point.y) !== (b.y > point.y) && point.x < a.x + (b.x - a.x) * (point.y - a.y) / (b.y - a.y)) inside = !inside
  }
  return inside
}

// Clip a segment to each axis and see whether both intervals overlap.
function segmentRange(a: number, b: number, min: number, max: number): [number, number] | null {
  if (a === b) return a >= min && a <= max ? [0, 1] : null
  const from = (min - a) / (b - a)
  const to = (max - a) / (b - a)
  return [Math.min(from, to), Math.max(from, to)]
}

function ringIntersectsFrame(ring: readonly Vec2[], frame: Bounds, inset: number): boolean {
  return ring.some((a, index) => {
    const b = ring[(index + 1) % ring.length]
    const x = segmentRange(a.x, b.x, frame.x0 + inset, frame.x1 - inset)
    const y = segmentRange(a.y, b.y, frame.y0 + inset, frame.y1 - inset)
    return x !== null && y !== null && Math.max(0, x[0], y[0]) <= Math.min(1, x[1], y[1])
  })
}

export function previewLegacyArtworkMatches(
  decos: readonly Deco[],
  regions: readonly ArtworkAnchorPanel[],
  dieline: Pick<Dieline, 'panels'>,
): LegacyArtworkMatch[] {
  const geometry = new Map(dieline.panels.map((panel) => [panel.id, panel]))
  const broadPanels = new Set(regions.map((region) => region.sourcePanelId))
  const printable = regions.filter((region) => canAnchor(region) && !broadPanels.has(region.id) && !region.id.startsWith('fin-'))

  return decos.filter(isLegacyAiArtwork).map((deco) => {
    const frame = artworkFrame(deco)
    const center = elCenter(deco)
    const angle = deco.rot * Math.PI / 180
    const cos = Math.cos(angle), sin = Math.sin(angle)
    const flipX = deco.flipX ? -1 : 1
    const flipY = deco.flipY ? -1 : 1
    const toLocal = ({ x, y }: Vec2): Vec2 => ({
      x: flipX * ((x - center.x) * cos + (y - center.y) * sin),
      y: flipY * (-(x - center.x) * sin + (y - center.y) * cos),
    })
    const frameCenter = { x: (frame.x0 + frame.x1) / 2, y: (frame.y0 + frame.y1) / 2 }
    const coversFrame = (ring: Vec2[]) => pointInRing(frameCenter, ring) && !ringIntersectsFrame(ring, frame, MATCH_EPSILON)

    const candidates = printable.filter((region) => {
      if (!containsArtwork(region, deco)) return false
      const source = geometry.get(region.sourcePanelId ?? region.id)
      if (!source || !coversFrame(source.outline.map(toLocal))) return false
      if (region.sourcePanelId && !coversFrame([
        { x: region.x0, y: region.y0 }, { x: region.x1, y: region.y0 },
        { x: region.x1, y: region.y1 }, { x: region.x0, y: region.y1 },
      ].map(toLocal))) return false
      return !source.holes?.some((hole) => {
        const local = hole.map(toLocal)
        return pointInRing(frameCenter, local) || ringIntersectsFrame(local, frame, -MATCH_EPSILON)
      })
    })
    return { deco, candidates }
  })
}

export function applyLegacyArtworkMatches(
  decos: Deco[],
  preview: readonly LegacyArtworkMatch[],
  choices: ReadonlyMap<string, string>,
): Deco[] {
  if (!choices.size) return decos
  const byId = new Map(preview.map((match) => [match.deco.id, match]))
  let changed = false
  const next = decos.map((deco) => {
    const match = byId.get(deco.id)
    if (match?.deco !== deco || !isLegacyAiArtwork(deco)) return deco
    const panelId = choices.get(deco.id)
    const panel = match.candidates.find((candidate) => candidate.id === panelId)
    if (!panel) return deco
    changed = true
    return captureArtworkPanelAnchor(deco, panel)
  })
  return changed ? next : decos
}

function fitCenter(value: number, min: number, max: number, halfSize: number): number {
  if (halfSize * 2 >= max - min) return (min + max) / 2
  return clamp(value, min + halfSize, max - halfSize)
}

export function resizePanelArtwork(decos: Deco[], panels: readonly PanelBox[], safeMargin = 0): Deco[] {
  if (!decos.some((deco) => deco.panelAnchor)) return decos
  const byId = new Map(panels.filter(canAnchor).map((panel) => [panel.id, panel]))
  let changed = false
  const resized = decos.map((deco): Deco => {
    const anchor = deco.panelAnchor
    if (!anchor) return deco
    const panel = byId.get(anchor.panelId)
    if (!panel) return deco

    const { width, height } = rotatedSize(deco)
    const margin = deco.type === 'shape' || deco.type === 'path'
      ? 0 : Math.min(safeMargin, Math.min(panel.w, panel.h) / 6)
    // Preserve original clearances smaller than the default, such as an intentional
    // near-edge edit. Calculate them from the source so shrinking and growing back
    // does not retain temporary movement from fitting a narrower panel.
    const marginX = clamp(anchor.panelW * Math.min(anchor.u, 1 - anchor.u) - width / (2 * anchor.scale), 0, margin)
    const marginY = clamp(anchor.panelH * Math.min(anchor.v, 1 - anchor.v) - height / (2 * anchor.scale), 0, margin)
    const sourceScale = Math.min(panel.w / anchor.panelW, panel.h / anchor.panelH)
    const fitScale = Math.min((panel.w - 2 * marginX) / width, (panel.h - 2 * marginY) / height) * anchor.scale
    // The document parser clamps text to at least 1 mm. Apply the same bound
    // here so a very small panel cannot change text size on save/reopen.
    const minScale = deco.type === 'text' ? anchor.scale / deco.size : 0
    const scale = Math.max(minScale, Math.min(sourceScale, fitScale))
    const ratio = scale / anchor.scale
    let next = ratio === 1 ? deco : scaleDecos([deco], ratio)[0]
    if (ratio !== 1 && next.type === 'text' && next.boxW !== undefined) {
      next = { ...next, boxW: next.boxW * ratio }
    }
    const bounds = rotatedSize(next)
    const x = fitCenter(panel.x0 + panel.w * anchor.u, panel.x0 + marginX, panel.x1 - marginX, bounds.width / 2) - elW(next) / 2
    const y = fitCenter(panel.y0 + panel.h * anchor.v, panel.y0 + marginY, panel.y1 - marginY, bounds.height / 2) - elH(next) / 2
    if (next === deco && Math.abs(x - deco.x) < 1e-9 && Math.abs(y - deco.y) < 1e-9) return deco
    changed = true
    return { ...next, x, y, panelAnchor: { ...anchor, scale } }
  })
  return changed ? resized : decos
}

export function refreshArtworkPanelAnchors(previous: readonly Deco[], next: Deco[], panels: readonly ArtworkAnchorPanel[]): Deco[] {
  if (!next.some((deco) => deco.panelAnchor)) return next
  const previousById = new Map(previous.map((deco) => [deco.id, deco]))
  const printable = panels.filter((panel) => !panel.sourcePanelId && canAnchor(panel))
  const byId = new Map(panels.map((panel) => [panel.id, panel]))
  let changed = false
  const refreshed = next.map((deco): Deco => {
    const anchor = deco.panelAnchor
    if (!anchor) return deco
    const prior = previousById.get(deco.id)
    if (prior === deco || (prior && prior.x === deco.x && prior.y === deco.y && prior.rot === deco.rot
      && elW(prior) === elW(deco) && elH(prior) === elH(deco))) return deco

    const center = elCenter(deco)
    const previousPanelId = byId.get(anchor.panelId)?.sourcePanelId ?? anchor.panelId
    const staysOnPanel = printable.find((panel) => panel.id === previousPanelId
      && center.x > panel.x0 && center.x < panel.x1 && center.y > panel.y0 && center.y < panel.y1)
    if (staysOnPanel) {
      changed = true
      return captureArtworkPanelAnchor(deco, staysOnPanel, panels)
    }

    const candidates = printable.filter((panel) => containsArtwork(panel, deco))
    changed = true
    if (candidates.length === 1) return captureArtworkPanelAnchor(deco, candidates[0], panels)
    const { panelAnchor, ...unanchored } = deco
    return unanchored
  })
  return changed ? refreshed : next
}
