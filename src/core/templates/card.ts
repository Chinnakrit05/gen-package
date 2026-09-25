import type { BoxParams, Dieline, DimMark, Panel, Segment } from '../types'
import { P, fmt, rect } from './shared'

// ระยะห่างระหว่างหน้า-หลังบนแผ่นออกแบบ (มม.) — เว้นให้แยกหน้าชัด + เผื่อเจียนตัด
const GAP = 10

// นามบัตร (business card): การ์ดแบนพิมพ์ ไม่มีรอยพับ — วางสองหน้าเรียงกัน
// ซ้าย = ด้านหน้า (card), ขวา = ด้านหลัง (card-back) เพื่อออกแบบ/ตกแต่งได้ทั้งสองด้าน
// W = กว้าง, H = สูง (การ์ดแบน จึงไม่ใช้ค่า D); ขนาดมาตรฐานไทย 90×54 มม.
export function generateCard(box: BoxParams): Dieline {
  const { W: w, H: h } = box
  const bx = w + GAP // จุดเริ่มของหน้าหลังตามแกน x

  const panels: Panel[] = [
    { id: 'card', parentId: null, outline: rect(0, 0, w, h), stage: 0 },
    { id: 'card-back', parentId: null, outline: rect(bx, 0, bx + w, h), stage: 0 },
  ]

  const cut = (d: string): Segment => ({ kind: 'cut', d })
  const rectCut = (x0: number) => cut(`M ${x0} 0 L ${x0 + w} 0 L ${x0 + w} ${h} L ${x0} ${h} Z`)
  const segments: Segment[] = [rectCut(0), rectCut(bx)]

  const width = bx + w
  const dims: DimMark[] = [
    { a: P(0, h + 12), b: P(w, h + 12), label: `W ${fmt(w)}` },
    { a: P(-10, 0), b: P(-10, h), label: `H ${fmt(h)}` },
  ]

  // ป้ายกำกับหน้า/หลัง — โชว์บน blueprint เท่านั้น (ไม่เข้าไฟล์ตัด)
  const captions = [
    { x: w / 2, y: -4, text: 'หน้า (front)' },
    { x: bx + w / 2, y: -4, text: 'หลัง (back)' },
  ]

  return { width, height: h, segments, panels, dims, captions }
}
