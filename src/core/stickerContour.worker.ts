// Web Worker: คำนวณไดคัทตามรูปนอก main thread (distance transform + เบลอ + เดินเส้น หนักหลายร้อย ms
// สำหรับสติกเกอร์ใหญ่) — UI ไม่ค้างระหว่างปรับขอบ/แก้ลาย; ตรรกะทั้งหมดอยู่ใน stickerContour.ts (pure)
import { contourFromAlpha, type AlphaMask } from './stickerContour'

export interface ContourRequest {
  id: number
  mask: AlphaMask
  offset: number
}
export interface ContourResponse {
  id: number
  loops: { x: number; y: number }[][]
}

self.onmessage = (ev: MessageEvent<ContourRequest>) => {
  const { id, mask, offset } = ev.data
  const loops = contourFromAlpha(mask, offset)
  ;(self as unknown as Worker).postMessage({ id, loops } satisfies ContourResponse)
}
