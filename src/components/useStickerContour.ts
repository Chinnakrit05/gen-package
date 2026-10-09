import { useEffect, useRef, useState } from 'react'
import { NO_BORDER_INSET, type AlphaMask, type StickerCut } from '../core/stickerContour'
import type { ContourRequest, ContourResponse } from '../core/stickerContour.worker'
import type { Vec2 } from '../core/types'

// สถานะไดคัทตามรูป — ให้ UI บอกเหตุผลถูกเมื่อยังใช้สี่เหลี่ยมอยู่
//  off: ไม่ใช่โหมดตามรูป · no-art: ยังไม่มีลาย · pending: กำลังคำนวณครั้งแรก
//  empty: มีลายแต่ไม่เหลือชิ้นที่ตัดได้ (เช่น ไม่มีขอบขาวกับลายเส้นบาง) · ok: มีเส้นตัด
export type ContourStatus = 'off' | 'no-art' | 'pending' | 'empty' | 'ok'

// เส้นตัดไดคัทตามรูปของสติกเกอร์ — คำนวณใน Web Worker แล้วคืน loop (มม.) หรือ null (= ใช้สี่เหลี่ยม)
// ระหว่างคำนวณรอบใหม่ คงผลเดิมไว้ — เส้นตัดไม่กระพริบกลับเป็นสี่เหลี่ยมทุกครั้งที่ปรับค่า
export function useStickerContour(
  active: boolean,
  cut: StickerCut,
  art: AlphaMask | null,
  W: number,
  H: number,
): { loops: Vec2[][] | null; status: ContourStatus } {
  const [result, setResult] = useState<{ loops: Vec2[][] | null; status: ContourStatus }>({
    loops: null,
    status: 'off',
  })
  const worker = useRef<Worker | null>(null)
  const seq = useRef(0)

  useEffect(
    () => () => {
      worker.current?.terminate()
      worker.current = null
    },
    [],
  )

  const on = active && cut.shape === 'contour'
  useEffect(() => {
    if (!on || !art) {
      seq.current++ // ทิ้งผลที่ค้างอยู่
      setResult({ loops: null, status: on ? 'no-art' : 'off' })
      return
    }
    // ตัดเฉพาะในแผ่น W×H (ลายที่ล้นแผ่นไม่นับ — เส้นตัดชนขอบแผ่นจะมีคำเตือนจากการตรวจไฟล์)
    const s = art.pxPerMm
    const ox = Math.round(-art.origin.x * s)
    const oy = Math.round(-art.origin.y * s)
    const w = Math.min(art.w - ox, Math.round(W * s))
    const h = Math.min(art.h - oy, Math.round(H * s))
    if (w < 2 || h < 2) {
      setResult({ loops: null, status: 'empty' })
      return
    }
    const data = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) data.set(art.data.subarray((y + oy) * art.w + ox, (y + oy) * art.w + ox + w), y * w)
    const offset = cut.border === 'white' ? cut.offset : -NO_BORDER_INSET

    worker.current ??= new Worker(new URL('../core/stickerContour.worker.ts', import.meta.url), { type: 'module' })
    const wk = worker.current
    const id = ++seq.current
    setResult((r) => (r.loops ? r : { loops: null, status: 'pending' }))
    const onMsg = (ev: MessageEvent<ContourResponse>) => {
      if (ev.data.id !== seq.current) return // ผลของคำขอเก่า
      setResult(
        ev.data.loops.length ? { loops: ev.data.loops, status: 'ok' } : { loops: null, status: 'empty' },
      )
    }
    wk.addEventListener('message', onMsg)
    const req: ContourRequest = { id, mask: { data, w, h, pxPerMm: s, origin: { x: 0, y: 0 } }, offset }
    wk.postMessage(req, [data.buffer])
    return () => wk.removeEventListener('message', onMsg)
  }, [on, art, cut.border, cut.offset, W, H])

  return result
}
