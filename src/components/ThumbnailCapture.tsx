// ถ่ายภาพย่อ 3D ของงาน (แกลเลอรีงาน) — วางไว้ใน <Canvas> ของ viewer ที่ App mount ซ่อนนอกจอเฉพาะตอนถ่าย
// (พับเสร็จ/ไม่มีเส้นบอกขนาด/มุมกล้องเริ่มต้น ไม่ใช่มุมที่ผู้ใช้หมุนค้างไว้)
// รอฟอนต์+รูปของลายพร้อมแล้วให้ texture วาดเต็มก่อน แล้ว render หนึ่งเฟรมบนพื้นโปร่งใส → ตัดขอบตามโมเดล → วางบนพื้นขาว
import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { ensureThaiFont, type Deco, type FillImage } from '../core/artwork'
import { THUMB_H, THUMB_W, alphaBounds, thumbPlacement } from '../core/thumbnail'
import { THUMBNAIL_MAX_BYTES, type ThumbnailMime } from '../../shared/contracts/projects'

const SETTLE_MS = 700 // ให้ useArtTexture วาดความละเอียดเต็ม + อัปโหลด texture หลังรูป/ฟอนต์พร้อม

const decodeImage = (src: string) =>
  new Promise<void>((resolve) => {
    const img = new Image()
    img.onload = img.onerror = () => resolve()
    img.src = src
  })
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

export interface ThumbnailShot {
  blob: Blob
  mimeType: ThumbnailMime
}

// WebP (เล็กสุด) → JPEG ถ้า browser เข้ารหัส WebP ไม่ได้ (Safari ได้ PNG กลับมา); ลดคุณภาพจนไม่เกินเพดานของ server
export async function encodeThumbnail(canvas: HTMLCanvasElement): Promise<ThumbnailShot | null> {
  const toBlob = (type: string, q: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, q))
  for (const type of ['image/webp', 'image/jpeg'] as const) {
    for (const q of [0.82, 0.7, 0.55, 0.4]) {
      const blob = await toBlob(type, q)
      if (!blob || blob.type !== type) break
      if (blob.size <= THUMBNAIL_MAX_BYTES) return { blob, mimeType: type }
    }
  }
  return null
}

export function ThumbnailCapture({
  decos,
  fillImage,
  onCapture,
}: {
  decos: Deco[]
  fillImage?: FillImage | null
  onCapture: (shot: ThumbnailShot | null) => void
}) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)

  useEffect(() => {
    let dead = false
    void (async () => {
      try {
        await ensureThaiFont(decos)
        const srcs = decos.flatMap((d) => (d.type === 'image' ? [d.src] : []))
        if (fillImage) srcs.push(fillImage.src)
        await Promise.all(srcs.map(decodeImage))
        await new Promise((r) => setTimeout(r, SETTLE_MS))
        await nextFrame()
        await nextFrame()
        if (dead) return
        // เฟรมพื้นโปร่งใส อ่านทันทีหลัง render ใน task เดียวกัน (ไม่ต้องเปิด preserveDrawingBuffer)
        const bg = scene.background
        const clearAlpha = gl.getClearAlpha()
        scene.background = null
        gl.setClearAlpha(0)
        gl.render(scene, camera)
        const src = gl.domElement
        const grab = document.createElement('canvas')
        grab.width = src.width
        grab.height = src.height
        const gctx = grab.getContext('2d', { willReadFrequently: true })
        gctx?.drawImage(src, 0, 0)
        scene.background = bg
        gl.setClearAlpha(clearAlpha)
        if (!gctx) return onCapture(null)
        const bounds = alphaBounds(gctx.getImageData(0, 0, grab.width, grab.height).data, grab.width, grab.height)
        if (!bounds) return onCapture(null)
        const out = document.createElement('canvas')
        out.width = THUMB_W
        out.height = THUMB_H
        const octx = out.getContext('2d')
        if (!octx) return onCapture(null)
        octx.fillStyle = '#ffffff'
        octx.fillRect(0, 0, THUMB_W, THUMB_H)
        octx.imageSmoothingQuality = 'high'
        const p = thumbPlacement(bounds, THUMB_W, THUMB_H)
        octx.drawImage(grab, p.sx, p.sy, p.sw, p.sh, p.dx, p.dy, p.dw, p.dh)
        const shot = await encodeThumbnail(out)
        if (!dead) onCapture(shot)
      } catch {
        if (!dead) onCapture(null)
      }
    })()
    return () => {
      dead = true
    }
    // ถ่ายครั้งเดียวต่อการ mount — App mount ใหม่ทุกงานถ่าย
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
