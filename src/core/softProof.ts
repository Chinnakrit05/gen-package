import { CMYK_PROOF_LUT_B64, CMYK_PROOF_N } from './cmykProofLut'
import type { Deco, GradientDef } from './artwork'

// Soft-proof CMYK: จำลองบนจอว่าสีจะออกมาอย่างไรเมื่อพิมพ์ด้วยหมึก CMYK
// ใช้ 3D LUT ที่อบจาก ICC จริง (scripts/build-cmyk-lut.py: sRGB → CMYK → sRGB + แก้ gray balance)
// แล้ว interpolate แบบ trilinear — สีนอก gamut (ฟ้า/เขียว/ส้มสด) หม่นลงชัด, ขาว/ดำ/เทาคงเดิม
// ใช้เพื่อ "แสดงผล" เท่านั้น ไม่แตะค่าสีที่เก็บในงาน/ไฟล์ส่งออก (ไฟล์ผลิตแปลง CMYK เองใน pdf.ts)
//
// หมายเหตุ: สูตรแปลง RGB→CMYK ตรง ๆ แบบใน pdf.ts แปลงกลับได้ค่าเดิมเป๊ะ จึงใช้จำลองไม่ได้ —
// ต้องผ่าน profile ที่รู้ gamut ของหมึกจริงแบบนี้

const N = CMYK_PROOF_N
const SCALE = (N - 1) / 255

let lut: Uint8Array | null = null
function table(): Uint8Array {
  if (!lut) {
    const bin = atob(CMYK_PROOF_LUT_B64)
    const t = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) t[i] = bin.charCodeAt(i)
    lut = t
  }
  return lut
}

// แปลงสีหนึ่งจุด (0–255) — เขียน 3 ช่องลง out[o..o+2] (ใช้ซ้ำได้ทั้งสีเดี่ยวและพิกเซลรูป)
function proofInto(r: number, g: number, b: number, out: Uint8Array | Uint8ClampedArray | number[], o: number) {
  const t = table()
  const fr = r * SCALE
  const fg = g * SCALE
  const fb = b * SCALE
  const r0 = Math.min(N - 2, fr | 0)
  const g0 = Math.min(N - 2, fg | 0)
  const b0 = Math.min(N - 2, fb | 0)
  const dr = fr - r0
  const dg = fg - g0
  const db = fb - b0
  const NN = N * N
  const i000 = ((r0 * N + g0) * N + b0) * 3
  const i001 = i000 + 3
  const i010 = i000 + N * 3
  const i011 = i010 + 3
  const i100 = i000 + NN * 3
  const i101 = i100 + 3
  const i110 = i100 + N * 3
  const i111 = i110 + 3
  for (let c = 0; c < 3; c++) {
    const c00 = t[i000 + c] + (t[i001 + c] - t[i000 + c]) * db
    const c01 = t[i010 + c] + (t[i011 + c] - t[i010 + c]) * db
    const c10 = t[i100 + c] + (t[i101 + c] - t[i100 + c]) * db
    const c11 = t[i110 + c] + (t[i111 + c] - t[i110 + c]) * db
    const c0 = c00 + (c01 - c00) * dg
    const c1 = c10 + (c11 - c10) * dg
    out[o + c] = Math.round(c0 + (c1 - c0) * dr)
  }
}

export function proofRGB(r: number, g: number, b: number): [number, number, number] {
  const out = [0, 0, 0]
  proofInto(r, g, b, out, 0)
  return out as [number, number, number]
}

// พิกเซลรูป (RGBA ต่อเนื่องแบบ ImageData.data) — แปลงในที่ ไม่แตะ alpha
export function proofPixels(data: Uint8ClampedArray) {
  for (let i = 0; i < data.length; i += 4) proofInto(data[i], data[i + 1], data[i + 2], data, i)
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

// สี hex (#rgb / #rrggbb / #rrggbbaa) → hex ที่จำลองแล้ว; ค่าอื่น ('none', ชื่อสี ฯลฯ) คืนเดิม
export function proofHex(color: string): string {
  const m = HEX.exec(color.trim())
  if (!m) return color
  let h = m[1]
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const [r, g, b] = proofRGB(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16))
  const to2 = (v: number) => v.toString(16).padStart(2, '0')
  return `#${to2(r)}${to2(g)}${to2(b)}${h.length === 8 ? h.slice(6) : ''}`
}

function proofGrad(g: GradientDef): GradientDef {
  return { ...g, from: proofHex(g.from), to: proofHex(g.to) }
}

// สำเนาลายที่เปลี่ยนเฉพาะ "สีที่พิมพ์" — id/ตำแหน่ง/ขนาดเดิมทุกอย่าง (callback ของ blueprint อ้าง id
// จึงแก้ไขบนสำเนานี้ได้โดยค่าสีจำลองไม่หลุดกลับไปเก็บในงาน); รูปภาพแปลงแยกแบบ async (proofImageSrc)
export function proofDeco(d: Deco): Deco {
  switch (d.type) {
    case 'text':
      return {
        ...d,
        color: proofHex(d.color),
        ...(d.strokeColor !== undefined ? { strokeColor: proofHex(d.strokeColor) } : {}),
      }
    case 'shape':
    case 'path':
      return {
        ...d,
        fill: proofHex(d.fill),
        stroke: proofHex(d.stroke),
        ...(d.grad ? { grad: proofGrad(d.grad) } : {}),
      }
    case 'nutrition':
      return d.ink !== undefined ? { ...d, ink: proofHex(d.ink) } : d
    case 'image':
      return d
  }
}

// ---- รูปภาพ (ใช้ DOM: เรียกได้เฉพาะในเบราว์เซอร์) ----
// วาดรูปลง canvas → แปลงทุกพิกเซลผ่าน LUT → คืน blob URL; แคชตาม src (รูปเดิมแปลงครั้งเดียว)
const imageCache = new Map<string, Promise<string>>()
const IMAGE_CACHE_MAX = 40
const MIN_RASTER = 1024 // รูป SVG/รูปเล็ก: วาดอย่างน้อยด้านยาวเท่านี้ ไม่ให้พรีวิวแตก

export function proofImageSrc(src: string): Promise<string> {
  const hit = imageCache.get(src)
  if (hit) return hit
  const job = new Promise<string>((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const w0 = img.naturalWidth || img.width
        const h0 = img.naturalHeight || img.height
        if (!w0 || !h0) return resolve(src)
        const up = Math.max(1, MIN_RASTER / Math.max(w0, h0))
        const w = Math.round(w0 * up)
        const h = Math.round(h0 * up)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) return resolve(src)
        ctx.drawImage(img, 0, 0, w, h)
        const px = ctx.getImageData(0, 0, w, h)
        proofPixels(px.data)
        ctx.putImageData(px, 0, 0)
        canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : src), 'image/png')
      } catch {
        resolve(src) // เช่น canvas ติด CORS — แสดงรูปเดิมแทน
      }
    }
    img.onerror = () => resolve(src)
    img.src = src
  })
  imageCache.set(src, job)
  if (imageCache.size > IMAGE_CACHE_MAX) {
    const [oldSrc, oldJob] = imageCache.entries().next().value as [string, Promise<string>]
    imageCache.delete(oldSrc)
    void oldJob.then((url) => url.startsWith('blob:') && URL.revokeObjectURL(url))
  }
  return job
}
