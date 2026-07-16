import type { BoxParams, Dieline, DimMark, Material, Panel, Segment } from '../types'
import { P, fmt, obroundPath, obroundPts, rect, roundedRectPath, roundedRectPts } from './shared'

// กล่องหูหิ้วขวด (bottle carrier): ตะกร้าเปิดบน ฐานแยกสองซีก
// แผ่นหูหิ้วกลางสองแผ่นพับ 180° ประกบกัน เจาะรูมือกลม
// ผนังยาวสองข้างมีหน้าต่างโชว์สินค้า ปิดหัว-ท้ายด้วยลิ้นพับจากผนัง
// W×D = footprint ด้านใน, H = ความสูงของ/ขวด (หูหิ้วสูงกว่าขวด ~55 มม.)
export function generateBottleCarrier(box: BoxParams, mat: Material): Dieline {
  const { W, D, H } = box
  const t = mat.thickness

  const Wp = W + 2 * t
  const Dp = D + 2 * t
  const Hw = Math.min(Math.max(0.42 * H, 40), H)
  const Hh = H + 55
  const flapD = Dp / 2
  const layer = t + 0.05

  const x0 = flapD
  const x1 = x0 + Wp
  const y0 = 0
  const y1 = y0 + Hw
  const y2 = y1 + Dp / 2
  const y3 = y2 + Hh
  const y4 = y3 + Hh
  const y5 = y4 + Dp / 2
  const y6 = y5 + Hw

  const width = Wp + 2 * flapD
  const height = y6

  // รูมือกลมบนแผ่นหูหิ้วทั้งสอง — ระยะเท่ากันจากสัน y3 เพื่อให้ตรงกันหลังพับ 180°
  const holeD = Math.min(34, Hh * 0.3)
  const holeOff = holeD / 2 + 13
  const holeCx = (x0 + x1) / 2

  // หน้าต่างโชว์สินค้าบนผนังยาวทั้งสอง (สองช่องต่อผนัง แบบ 4-pack)
  const winW = 0.3 * Wp
  const winH = 0.55 * Hw
  const winR = Math.min(8, winH / 3, winW / 3)
  const windows = (yTop: number, yBot: number) => {
    const cy = (yTop + yBot) / 2
    return [x0 + 0.28 * Wp, x0 + 0.72 * Wp].map((cx) =>
      roundedRectPts(cx - winW / 2, cy - winH / 2, cx + winW / 2, cy + winH / 2, winR),
    )
  }
  const windowPaths = (yTop: number, yBot: number) => {
    const cy = (yTop + yBot) / 2
    return [x0 + 0.28 * Wp, x0 + 0.72 * Wp].map((cx) =>
      roundedRectPath(cx - winW / 2, cy - winH / 2, cx + winW / 2, cy + winH / 2, winR),
    )
  }

  const panels: Panel[] = [
    { id: 'base-a', parentId: null, outline: rect(x0, y4, x1, y5), stage: 0 },
    {
      id: 'side-a', parentId: 'base-a', outline: rect(x0, y5, x1, y6),
      holes: windows(y5, y6),
      hingeA: P(x0, y5), hingeB: P(x1, y5), foldAngle: -90, stage: 0,
    },
    {
      id: 'flap-a-left', parentId: 'side-a', outline: rect(0, y5, x0, y6),
      hingeA: P(x0, y5), hingeB: P(x0, y6), foldAngle: -90, stage: 1,
    },
    {
      id: 'flap-a-right', parentId: 'side-a', outline: rect(x1, y5, x1 + flapD, y6),
      hingeA: P(x1, y5), hingeB: P(x1, y6), foldAngle: 90, stage: 1,
    },
    {
      id: 'handle-a', parentId: 'base-a', outline: rect(x0, y3, x1, y4),
      holes: [obroundPts(holeCx, y3 + holeOff, holeD, holeD)],
      hingeA: P(x0, y4), hingeB: P(x1, y4), foldAngle: 90, stage: 0,
    },
    {
      id: 'handle-b', parentId: 'handle-a', outline: rect(x0, y2, x1, y3),
      holes: [obroundPts(holeCx, y3 - holeOff, holeD, holeD)],
      hingeA: P(x0, y3), hingeB: P(x1, y3), foldAngle: 180, stage: 1, zOffset: layer,
    },
    {
      id: 'base-b', parentId: 'handle-b', outline: rect(x0, y1, x1, y2),
      hingeA: P(x0, y2), hingeB: P(x1, y2), foldAngle: 90, stage: 2,
    },
    {
      id: 'side-b', parentId: 'base-b', outline: rect(x0, y0, x1, y1),
      holes: windows(y0, y1),
      hingeA: P(x0, y1), hingeB: P(x1, y1), foldAngle: 90, stage: 3,
    },
    {
      id: 'flap-b-left', parentId: 'side-b', outline: rect(0, y0, x0, y1),
      hingeA: P(x0, y0), hingeB: P(x0, y1), foldAngle: -90, stage: 3,
    },
    {
      id: 'flap-b-right', parentId: 'side-b', outline: rect(x1, y0, x1 + flapD, y1),
      hingeA: P(x1, y0), hingeB: P(x1, y1), foldAngle: 90, stage: 3,
    },
  ]

  const cut = (d: string): Segment => ({ kind: 'cut', d })
  const crease = (d: string): Segment => ({ kind: 'crease', d })

  const segments: Segment[] = [
    cut(`M 0 ${y0} L ${width} ${y0}`),
    cut(`M 0 ${y6} L ${width} ${y6}`),
    cut(`M 0 ${y0} L 0 ${y1}`),
    cut(`M ${width} ${y0} L ${width} ${y1}`),
    cut(`M 0 ${y1} L ${x0} ${y1}`),
    cut(`M ${x1} ${y1} L ${width} ${y1}`),
    cut(`M ${x0} ${y1} L ${x0} ${y5}`),
    cut(`M ${x1} ${y1} L ${x1} ${y5}`),
    cut(`M 0 ${y5} L ${x0} ${y5}`),
    cut(`M ${x1} ${y5} L ${width} ${y5}`),
    cut(`M 0 ${y5} L 0 ${y6}`),
    cut(`M ${width} ${y5} L ${width} ${y6}`),
    cut(obroundPath(holeCx, y3 + holeOff, holeD, holeD)),
    cut(obroundPath(holeCx, y3 - holeOff, holeD, holeD)),
    ...windowPaths(y0, y1).map(cut),
    ...windowPaths(y5, y6).map(cut),
    crease(`M ${x0} ${y1} L ${x1} ${y1}`),
    crease(`M ${x0} ${y2} L ${x1} ${y2}`),
    crease(`M ${x0} ${y3} L ${x1} ${y3}`),
    crease(`M ${x0} ${y4} L ${x1} ${y4}`),
    crease(`M ${x0} ${y5} L ${x1} ${y5}`),
    crease(`M ${x0} ${y0} L ${x0} ${y1}`),
    crease(`M ${x1} ${y0} L ${x1} ${y1}`),
    crease(`M ${x0} ${y5} L ${x0} ${y6}`),
    crease(`M ${x1} ${y5} L ${x1} ${y6}`),
  ]

  const dims: DimMark[] = [
    { a: P(x0, y6 + 12), b: P(x1, y6 + 12), label: `W ${fmt(Wp)}` },
    { a: P(width + 10, y0), b: P(width + 10, y1), label: `ผนัง ${fmt(Hw)}` },
    { a: P(width + 10, y2), b: P(width + 10, y3), label: `หูหิ้ว ${fmt(Hh)}` },
    { a: P(0, -10), b: P(width, -10), label: fmt(width) },
  ]

  return { width, height, segments, panels, dims }
}
