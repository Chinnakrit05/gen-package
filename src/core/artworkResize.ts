import { elCenter, elH, elW, scaleDecos, type Deco } from './artwork'
import type { PanelBox } from './aiArtwork'

function canAnchor(panel: PanelBox): boolean {
  return panel.print && panel.w > 0 && panel.h > 0
}

export function captureArtworkPanelAnchor(deco: Deco, panel: PanelBox): Deco {
  if (!canAnchor(panel)) return deco
  const center = elCenter(deco)
  return {
    ...deco,
    panelAnchor: {
      panelId: panel.id,
      panelW: panel.w,
      panelH: panel.h,
      u: clamp(center.x - panel.x0, 0, panel.w) / panel.w,
      v: clamp(center.y - panel.y0, 0, panel.h) / panel.h,
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

export function refreshArtworkPanelAnchors(previous: readonly Deco[], next: Deco[], panels: readonly PanelBox[]): Deco[] {
  if (!next.some((deco) => deco.panelAnchor)) return next
  const previousById = new Map(previous.map((deco) => [deco.id, deco]))
  const printable = panels.filter(canAnchor)
  let changed = false
  const refreshed = next.map((deco): Deco => {
    const anchor = deco.panelAnchor
    if (!anchor) return deco
    const prior = previousById.get(deco.id)
    if (prior === deco || (prior && prior.x === deco.x && prior.y === deco.y && prior.rot === deco.rot
      && elW(prior) === elW(deco) && elH(prior) === elH(deco))) return deco

    const center = elCenter(deco)
    const staysOnPanel = printable.find((panel) => panel.id === anchor.panelId
      && center.x > panel.x0 && center.x < panel.x1 && center.y > panel.y0 && center.y < panel.y1)
    if (staysOnPanel) {
      changed = true
      return captureArtworkPanelAnchor(deco, staysOnPanel)
    }

    const { width, height } = rotatedSize(deco)
    const candidates = printable.filter((panel) => center.x - width / 2 >= panel.x0 && center.x + width / 2 <= panel.x1
      && center.y - height / 2 >= panel.y0 && center.y + height / 2 <= panel.y1)
    changed = true
    if (candidates.length === 1) return captureArtworkPanelAnchor(deco, candidates[0])
    const { panelAnchor, ...unanchored } = deco
    return unanchored
  })
  return changed ? refreshed : next
}
