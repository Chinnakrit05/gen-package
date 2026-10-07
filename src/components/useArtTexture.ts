import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import type { Deco, FillImage } from '../core/artwork'
import { textureScale } from '../core/textureRes'

// texture ลาย (แผ่นคลี่/ฉลาก/ฟิล์มถุง) ที่วาดลง canvas แล้วแปะบนโมเดล 3D — ใช้ร่วมทุก viewer
//
// วาดแบบปรับความละเอียดตามจังหวะแก้ไข: texture ความละเอียดเต็ม (textureScale ~10 px/มม., กล่องทั่วไป
// ~2750×2650) อัปโหลดเข้า GPU + สร้าง mipmap ครั้งละ ~95–110ms (วัดจริง; ขนาด 3 px/มม. ~11ms) — ถ้าทำ
// ทุกครั้งที่ลากชิ้นงาน ทุกเฟรมหลังขยับจะสะดุด ทั้ง blueprint และ 3D กระตุก
// จึง: แก้ครั้งเดียว (เช่นเปลี่ยนสี) → วาดเต็มทันที; แก้ถี่ ๆ ต่อเนื่อง (ลาก/หมุน/ย่อ) → วาดร่างที่ 3 px/มม.
// ให้ 3D ยังขยับตามสด แล้ววาดเต็มครั้งเดียวเมื่อหยุดแก้ SETTLE_MS
const DRAFT_PX_PER_MM = 3
const RAPID_MS = 200 // แก้ห่างกันน้อยกว่านี้ = กำลังลากอยู่
const SETTLE_MS = 250 // หยุดแก้นานเท่านี้ → วาดความละเอียดเต็ม

export type ImgOf = (src: string) => HTMLImageElement | undefined

export function useArtTexture(opts: {
  sheetW: number // มม.
  sheetH: number
  decos: Deco[]
  fillImage: FillImage | null | undefined
  enabled: boolean // false = ไม่ใช้ texture (เช่นไม่มีลาย/สีพื้นเลย)
  draw: (ctx: CanvasRenderingContext2D, s: number, imgOf: ImgOf) => void // วาดทั้งแผ่นที่ s px/มม.
  deps: unknown[] // ค่าอื่นที่มีผลต่อภาพ (สีพื้น/สีวัสดุ ฯลฯ)
  configure?: (t: THREE.CanvasTexture) => void // ตั้งค่าเฉพาะ viewer (flipY, repeat ฯลฯ)
}): THREE.CanvasTexture | null {
  const { sheetW, sheetH, decos, fillImage, enabled, draw, deps, configure } = opts
  const gl = useThree((st) => st.gl)
  const [tex, setTex] = useState<THREE.CanvasTexture | null>(null)
  const canvases = useRef<{ draft?: HTMLCanvasElement; full?: HTMLCanvasElement }>({})
  const imgCache = useRef(new Map<string, HTMLImageElement>())
  const [imgReady, setImgReady] = useState(0) // เพิ่มค่าเมื่อมีรูปโหลดเสร็จ เพื่อสั่งวาดใหม่
  const lastRun = useRef(0)
  const settleTimer = useRef<number | undefined>(undefined)

  // ถอดรหัสรูปแต่ละ src ครั้งเดียว เก็บใน cache — ไม่ decode ซ้ำตอนลาก/หมุน (รวมรูปพื้นด้วย)
  // key ใช้ความยาว+ท้าย data URL แทนการต่อสตริงรูปทั้งก้อน (รูปละหลายร้อย KB) ทุกครั้งที่ render
  const srcs = decos.filter((d): d is Extract<Deco, { type: 'image' }> => d.type === 'image').map((d) => d.src)
  if (fillImage) srcs.push(fillImage.src)
  const srcKey = srcs.map((s) => `${s.length}:${s.slice(-48)}`).join('|')
  useEffect(() => {
    let dead = false
    for (const src of srcs) {
      if (imgCache.current.has(src)) continue
      const el = new Image()
      el.onload = () => {
        if (dead) return
        imgCache.current.set(src, el)
        setImgReady((n) => n + 1)
      }
      el.src = src
    }
    return () => {
      dead = true
    }
    // srcKey ครอบคลุมการเปลี่ยนชุด src แล้ว
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcKey])

  useEffect(() => {
    window.clearTimeout(settleTimer.current)
    if (!enabled) {
      setTex(null)
      return
    }
    const full = textureScale(sheetW, sheetH, gl.capabilities.maxTextureSize)
    const draft = Math.min(full, DRAFT_PX_PER_MM)
    const now = performance.now()
    const rapid = now - lastRun.current < RAPID_MS
    lastRun.current = now

    const render = (s: number, which: 'draft' | 'full') => {
      const w = Math.max(1, Math.round(sheetW * s))
      const h = Math.max(1, Math.round(sheetH * s))
      let canvas = canvases.current[which]
      if (!canvas || canvas.width !== w || canvas.height !== h) {
        canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        canvases.current[which] = canvas
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, w, h)
      ctx.save()
      draw(ctx, s, (src) => imgCache.current.get(src))
      ctx.restore()
      const target = canvas
      // ห้าม dispose ของเก่าตรงนี้ — StrictMode เรียกตัวอัปเดตซ้ำได้; effect ด้านล่างคืนหน่วยความจำแทน
      setTex((prev) => {
        if (prev && prev.image === target) {
          configure?.(prev)
          prev.needsUpdate = true
          return prev
        }
        const t = new THREE.CanvasTexture(target)
        t.colorSpace = THREE.SRGBColorSpace
        // มองด้านที่เอียงไม่ให้เบลอ (ค่าเริ่มต้น 1 = เบลอมากเมื่อผิวเฉียงกล้อง)
        t.anisotropy = gl.capabilities.getMaxAnisotropy()
        configure?.(t)
        return t
      })
    }

    if (rapid && draft < full) {
      render(draft, 'draft')
      settleTimer.current = window.setTimeout(() => render(full, 'full'), SETTLE_MS)
    } else {
      render(full, 'full')
    }
    // draw/configure เป็นฟังก์ชันใหม่ทุก render — ค่าที่มีผลต่อภาพอยู่ใน deps แล้ว
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decos, imgReady, enabled, sheetW, sheetH, ...deps])

  useEffect(() => () => window.clearTimeout(settleTimer.current), [])
  // คืนหน่วยความจำเมื่อเปลี่ยน texture หรือ viewer ถูกถอด
  useEffect(() => () => tex?.dispose(), [tex])

  return tex
}
