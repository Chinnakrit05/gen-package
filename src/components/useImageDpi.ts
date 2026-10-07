import { useEffect, useMemo, useReducer, useRef } from 'react'
import { decoLabel, fillImageRect, panelsBBox, type Deco, type FillImage } from '../core/artwork'
import type { Dieline } from '../core/types'
import { imageDrawMm, isVectorSrc, LOW_DPI, needsDpiCheck, pixelsNeeded, printDpi } from '../core/imageDpi'

export interface LowResImage {
  id: string // id ของลาย หรือ 'fill' = รูปพื้น
  label: string
  dpi: number
  wantPx: number // ด้านกว้างของรูป (px) ที่ควรมีเพื่อให้ได้ 300 dpi ที่ขนาดนี้
}

// ขนาดพิกเซลจริงของรูปที่นำเข้า (decode ครั้งเดียวต่อ src แล้วแคช) → dpi ตามขนาดที่วางบนแผ่น
// dpiById: ทุกรูปที่ตรวจได้ (ใช้โชว์ค่าในแผงปรับแต่ง); low: เฉพาะที่ต่ำกว่า LOW_DPI (ป้ายเตือน/ก่อนส่งออก)
export function useImageDpi(decos: Deco[], fillImage: FillImage | null, dieline: Dieline | null) {
  const sizes = useRef(new Map<string, { w: number; h: number }>())
  const [ready, bump] = useReducer((n: number) => n + 1, 0)

  const srcs: string[] = []
  for (const d of decos) if (d.type === 'image' && needsDpiCheck(d)) srcs.push(d.src)
  if (fillImage && !isVectorSrc(fillImage.src)) srcs.push(fillImage.src)
  const srcKey = srcs.join('|')

  useEffect(() => {
    let dead = false
    for (const src of srcs) {
      if (sizes.current.has(src)) continue
      const img = new Image()
      img.onload = () => {
        sizes.current.set(src, { w: img.naturalWidth, h: img.naturalHeight })
        if (!dead) bump()
      }
      img.src = src
    }
    return () => {
      dead = true
    }
    // srcKey ครอบคลุมชุด src แล้ว
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcKey])

  return useMemo(() => {
    const dpiById = new Map<string, number>()
    const low: LowResImage[] = []
    for (const d of decos) {
      if (d.type !== 'image' || !needsDpiCheck(d)) continue
      const px = sizes.current.get(d.src)
      if (!px) continue
      const mm = imageDrawMm(d)
      const dpi = Math.round(printDpi(px.w, px.h, mm.w, mm.h))
      dpiById.set(d.id, dpi)
      if (dpi < LOW_DPI) low.push({ id: d.id, label: decoLabel(d), dpi, wantPx: pixelsNeeded(mm.w) })
    }
    let fillDpi: number | null = null
    if (fillImage && dieline && !isVectorSrc(fillImage.src)) {
      const px = sizes.current.get(fillImage.src)
      if (px) {
        const r = fillImageRect(panelsBBox(dieline), fillImage)
        fillDpi = Math.round(printDpi(px.w, px.h, r.w, r.h))
        if (fillDpi < LOW_DPI) low.push({ id: 'fill', label: 'รูปพื้นแพ็กเกจ', dpi: fillDpi, wantPx: pixelsNeeded(r.w) })
      }
    }
    return { dpiById, low, fillDpi }
    // ready = มีรูปเพิ่งรู้ขนาด → คำนวณใหม่
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decos, fillImage, dieline, ready])
}
