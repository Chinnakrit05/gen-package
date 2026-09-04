import type { BoxParams, Dieline, DimMark, Panel, Segment } from '../types'
import { P, fmt, rect } from './shared'

// นามบัตร (business card): การ์ดแบนพิมพ์ ไม่มีรอยพับ — แผงเดียวเรียบ
// W = กว้าง, H = สูง (การ์ดแบน จึงไม่ใช้ค่า D); ขนาดมาตรฐานไทย 90×54 มม.
export function generateCard(box: BoxParams): Dieline {
  const { W: w, H: h } = box

  const panels: Panel[] = [{ id: 'card', parentId: null, outline: rect(0, 0, w, h), stage: 0 }]

  const cut = (d: string): Segment => ({ kind: 'cut', d })
  const segments: Segment[] = [cut(`M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`)]

  const dims: DimMark[] = [
    { a: P(0, h + 12), b: P(w, h + 12), label: `W ${fmt(w)}` },
    { a: P(w + 10, 0), b: P(w + 10, h), label: `H ${fmt(h)}` },
  ]

  return { width: w, height: h, segments, panels, dims }
}
