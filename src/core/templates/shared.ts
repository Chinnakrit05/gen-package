import type { Vec2 } from '../types'

export const P = (x: number, y: number): Vec2 => ({ x, y })

export function arcPts(cx: number, cy: number, r: number, a0: number, a1: number, n = 5): Vec2[] {
  const pts: Vec2[] = []
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n
    pts.push(P(cx + r * Math.cos(a), cy + r * Math.sin(a)))
  }
  return pts
}

export const rect = (xa: number, ya: number, xb: number, yb: number): Vec2[] => [
  P(xa, ya),
  P(xb, ya),
  P(xb, yb),
  P(xa, yb),
]

export const fmt = (v: number) => String(Math.round(v * 10) / 10)

// รูทรงแคปซูล (obround) สำหรับรูหิ้ว — length = ความยาวรวม, thick = ความกว้างรู
// vertical = แกนยาววางตามแกน y ของแผ่นคลี่
export function obroundPts(
  cx: number,
  cy: number,
  length: number,
  thick: number,
  vertical = false,
): Vec2[] {
  const r = thick / 2
  const half = Math.max(0, length / 2 - r)
  if (!vertical) {
    return [
      ...arcPts(cx - half, cy, r, Math.PI / 2, Math.PI * 1.5, 8),
      ...arcPts(cx + half, cy, r, -Math.PI / 2, Math.PI / 2, 8),
    ]
  }
  return [
    ...arcPts(cx, cy - half, r, Math.PI, Math.PI * 2, 8),
    ...arcPts(cx, cy + half, r, 0, Math.PI, 8),
  ]
}

export function roundedRectPts(x0: number, y0: number, x1: number, y1: number, r: number): Vec2[] {
  return [
    P(x0 + r, y0),
    ...arcPts(x1 - r, y0 + r, r, -Math.PI / 2, 0, 4),
    ...arcPts(x1 - r, y1 - r, r, 0, Math.PI / 2, 4),
    ...arcPts(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, 4),
    ...arcPts(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, 4),
  ]
}

export function roundedRectPath(x0: number, y0: number, x1: number, y1: number, r: number): string {
  return (
    `M ${x0 + r} ${y0} L ${x1 - r} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y0 + r} ` +
    `L ${x1} ${y1 - r} A ${r} ${r} 0 0 1 ${x1 - r} ${y1} L ${x0 + r} ${y1} ` +
    `A ${r} ${r} 0 0 1 ${x0} ${y1 - r} L ${x0} ${y0 + r} A ${r} ${r} 0 0 1 ${x0 + r} ${y0} Z`
  )
}

export function obroundPath(
  cx: number,
  cy: number,
  length: number,
  thick: number,
  vertical = false,
): string {
  const r = thick / 2
  const half = Math.max(0, length / 2 - r)
  if (!vertical) {
    return (
      `M ${cx - half} ${cy - r} L ${cx + half} ${cy - r} A ${r} ${r} 0 0 1 ${cx + half} ${cy + r} ` +
      `L ${cx - half} ${cy + r} A ${r} ${r} 0 0 1 ${cx - half} ${cy - r} Z`
    )
  }
  return (
    `M ${cx - r} ${cy - half} A ${r} ${r} 0 0 1 ${cx + r} ${cy - half} L ${cx + r} ${cy + half} ` +
    `A ${r} ${r} 0 0 1 ${cx - r} ${cy + half} Z`
  )
}
