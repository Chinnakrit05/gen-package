import { useEffect, useMemo, useReducer, useRef } from 'react'
import type { Deco, FillImage } from '../core/artwork'
import { proofDeco, proofHex, proofImageSrc } from '../core/softProof'

// สำเนา "ลาย/สีพื้น/รูปพื้น" ที่จำลองสีงานพิมพ์ CMYK สำหรับส่งเข้า blueprint เท่านั้น
// enabled=false → คืนค่าเดิมทุกตัว (ไม่มีค่าใช้จ่าย); รูปภาพแปลงแบบ async ทีละรูปแล้วแคช
// ระหว่างรอใช้รูปเดิมไปก่อน — ค่าที่เก็บในงาน/ไฟล์ส่งออกไม่ถูกแตะเลย
export function useSoftProof(
  enabled: boolean,
  decos: Deco[],
  fillColor: string | null,
  fillImage: FillImage | null,
) {
  const urls = useRef(new Map<string, string>()) // src เดิม → blob URL ที่จำลองแล้ว
  const [ready, bump] = useReducer((n: number) => n + 1, 0)

  const srcs: string[] = []
  if (enabled) {
    for (const d of decos) if (d.type === 'image' && !d.hidden) srcs.push(d.src)
    if (fillImage) srcs.push(fillImage.src)
  }
  const srcKey = srcs.join('|')

  useEffect(() => {
    let dead = false
    for (const src of srcs) {
      if (urls.current.has(src)) continue
      void proofImageSrc(src).then((url) => {
        urls.current.set(src, url)
        if (!dead) bump()
      })
    }
    return () => {
      dead = true
    }
    // srcKey ครอบคลุมชุด src แล้ว
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcKey])

  return useMemo(() => {
    if (!enabled) return { decos, fillColor, fillImage }
    const img = (src: string) => urls.current.get(src) ?? src
    return {
      decos: decos.map((d) => (d.type === 'image' ? { ...d, src: img(d.src) } : proofDeco(d))),
      fillColor: fillColor ? proofHex(fillColor) : fillColor,
      fillImage: fillImage ? { ...fillImage, src: img(fillImage.src) } : fillImage,
    }
    // ready = มีรูปแปลงเสร็จเพิ่ม → คำนวณใหม่ให้ได้ URL ล่าสุด
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, decos, fillColor, fillImage, ready])
}
