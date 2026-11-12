import { elCenter, elH, elW, scaleDecos, type Deco } from './artwork'
import type { ArtFrontZone, PanelBox } from './aiArtwork'
import type { Pouch } from './pouch'

export type ArtworkAnchorPanel = PanelBox & { sourcePanelId?: string }

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
