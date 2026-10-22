import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { drawSilhouette, type Deco } from '../core/artwork'
import { finishDef } from '../core/finish'

// แผนที่ผิวของงานพิมพ์พิเศษสำหรับ 3D — วางพิกัดเดียวกับ texture ลาย (แผ่นคลี่/ฉลาก/ฟิล์มถุง ที่ s px/มม.)
//  orm: G = ความด้าน (roughness), B = ความเป็นโลหะ (metalness) ตามที่ three อ่าน roughnessMap/metalnessMap (พื้นแอ่งปั๊มจมด้านน้อยกว่ากระดาษ) —
//       พื้นทั้งแผ่น = ค่าของวัสดุ, ฟอยล์ = โลหะมันวาว, Spot UV = มันวาวไม่เป็นโลหะ; material ต้องตั้ง roughness/metalness = 1
//       (three คูณค่าคงที่กับค่าในแผนที่)
//  bump: แผนที่ความสูง (เทากลาง = เรียบ, ปั๊มนูน = ขาว, ปั๊มจม = ดำ — ลาดเฉพาะด้านในรูป) แล้วแปลงเป็น normal map บน CPU
//       (`heightToNormal`) — bumpMap ของ three คำนวณความชันจากพิกเซลจอ เส้นนูนบาง ๆ (ซิป) มองเฉียงแตกเป็นขั้นบันได
// ไม่มีชิ้นงานพิเศษ = คืน null ทั้งคู่ (material ใช้ค่าคงที่เดิม ไม่เสีย texture เพิ่ม)
const PX_PER_MM = 8 // แผนที่ผิวไม่ต้องคมเท่าลาย (แต่สันนูนบาง ๆ อย่างซิปต้องพอให้ไม่เป็นขั้นบันได)
const MAX_PX = 4096

export interface FinishMaps {
  orm: THREE.CanvasTexture | null
  bump: THREE.CanvasTexture | null // normal map (tangent space) จากแผนที่ความสูง
}

// ความสูงเต็มช่วง (ค่า 0/255 ห่างจากเทากลาง 127 ระดับ) = กี่มม. — กำหนดความชันของผิวนูน
const RELIEF_MM = 0.5

// แผนที่ความสูง (เทา) → normal map: ความชันจากผลต่างกลาง แปลงหน่วยเป็นมม. ตามความละเอียด s px/มม.
// แกน v ของ texture: flipY = แถวบนของภาพคือ v สูงสุด → ความชันตาม v กลับเครื่องหมายกับแถวภาพ
export function heightToNormal(src: Uint8ClampedArray, w: number, h: number, s: number, flipY: boolean): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4)
  const k = (RELIEF_MM / 127) * (s / 2) // (ระดับเทา → มม.) ÷ ระยะผลต่างกลาง 2 px (มม.)
  const H = (x: number, y: number) => src[(Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = (H(x + 1, y) - H(x - 1, y)) * k
      const gRow = (H(x, y + 1) - H(x, y - 1)) * k
      const gy = flipY ? -gRow : gRow
      const inv = 1 / Math.hypot(gx, gy, 1)
      const i = (y * w + x) * 4
      out[i] = Math.round((-gx * inv * 0.5 + 0.5) * 255)
      out[i + 1] = Math.round((-gy * inv * 0.5 + 0.5) * 255)
      out[i + 2] = Math.round((inv * 0.5 + 0.5) * 255)
      out[i + 3] = 255
    }
  }
  return out
}

// ปั๊มนูน/จม: ผิวยก/แอ่งอยู่ในเส้นรอบรูปเท่านั้น (ไหล่/ผนังลาดจากขอบเข้าไปด้านใน กระดาษรอบตัวอักษรเรียบ — เงา/ไฮไลต์
// ชิดขอบ ไม่ล้นออกนอกตัว) — ระดับ 0..1 จาก alpha คม a และ alpha ที่เบลอแล้ว b: ขอบรูป (b≈0.5) = 0 ไล่ถึงเต็มเมื่อ b=1
// (เส้นบางกว่าระยะเบลอได้ตื้นลง); คืนค่าเป็นระดับเทาที่บวก (นูน) / ลบ (จม) จากเทากลาง
export function reliefDepth(a: number, b: number): number {
  return (a / 255) * Math.max(0, Math.min(1, (b / 255 - 0.5) * 2)) * 127
}

export function useFinishMaps(opts: {
  sheetW: number
  sheetH: number
  decos: Deco[]
  baseRough: number
  baseMetal: number
  configure?: (t: THREE.CanvasTexture) => void // ต้องตรงกับ texture ลาย (flipY/repeat)
  deps?: unknown[] // ค่าที่ configure ใช้ (เช่นช่วงฉลากที่มองเห็น) — เปลี่ยนแล้วสร้างแผนที่ใหม่
  // รอยนูนของตัวบรรจุภัณฑ์เอง (เช่นแนวซิปล็อกของถุง) วาดลงแผนที่ bump พิกัดแผ่นคลี่ — ผิวยังเป็นฟิล์มเดิม สี/ลายจึงกลืนกับถุง
  // key = ค่าที่มีผลต่อภาพ (เปลี่ยนแล้ววาดใหม่)
  relief?: { key: string; draw: (ctx: CanvasRenderingContext2D, s: number, w: number) => void } | null
}): FinishMaps {
  const { sheetW, sheetH, decos, baseRough, baseMetal, configure, deps = [], relief: extra = null } = opts
  const [maps, setMaps] = useState<FinishMaps>({ orm: null, bump: null })
  const imgCache = useRef(new Map<string, HTMLImageElement>())
  const [imgTick, setImgTick] = useState(0)
  const fin = decos.filter((d) => !d.hidden && d.finish)
  // คีย์เฉพาะสิ่งที่มีผลต่อแผนที่ (ชิ้นงานพิเศษ + ขนาดแผ่น) — แก้ชิ้นอื่นไม่ต้องวาดใหม่
  const key = JSON.stringify([sheetW, sheetH, baseRough, baseMetal, deps, extra?.key ?? null, fin.map((d) => (d.type === 'image' ? { ...d, src: d.src.length + d.src.slice(-32) } : d))])

  useEffect(() => {
    let dead = false
    for (const d of fin) {
      if (d.type !== 'image' || imgCache.current.has(d.src)) continue
      const el = new Image()
      el.onload = () => {
        if (dead) return
        imgCache.current.set(d.src, el)
        setImgTick((n) => n + 1)
      }
      el.src = d.src
    }
    return () => {
      dead = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    if (!fin.length && !extra) {
      setMaps((m) => (m.orm || m.bump ? { orm: null, bump: null } : m))
      return
    }
    let dead = false
    // วาดหลังหยุดแก้สั้น ๆ — ตอนลากชิ้นไม่ต้องวาดแผนที่ทุกเฟรม
    const timer = window.setTimeout(() => {
      const s = Math.min(PX_PER_MM, MAX_PX / Math.max(sheetW, sheetH))
      const w = Math.max(1, Math.round(sheetW * s))
      const h = Math.max(1, Math.round(sheetH * s))
      const imgOf = (src: string) => imgCache.current.get(src)
      const to255 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255)

      // แผนที่ความด้าน/โลหะ: เมื่อมีฟอยล์/Spot UV หรือปั๊มจม (พื้นแอ่งถูกอัดจนเนียนกว่ากระดาษ — ด้านน้อยลง); ปั๊มนูนไม่ต้องใช้
      const FLOOR_ROUGH = 0.65 // ความด้านของพื้นแอ่งปั๊มจม เทียบกับกระดาษ
      const needOrm = fin.some((d) => (finishDef(d.finish)?.relief ?? 0) <= 0)
      const orm = needOrm ? document.createElement('canvas') : null
      if (orm) {
        orm.width = w
        orm.height = h
      }
      const oc = orm?.getContext('2d') ?? null
      const relief = fin.filter((d) => finishDef(d.finish)?.relief)
      let bump: HTMLCanvasElement | null = null
      if (oc) {
        oc.fillStyle = `rgb(0,${to255(baseRough)},${to255(baseMetal)})`
        oc.fillRect(0, 0, w, h)
        for (const d of fin) {
          const def = finishDef(d.finish)
          if (!def || def.relief > 0) continue
          const fill = def.relief < 0 ? `rgb(0,${to255(baseRough * FLOOR_ROUGH)},${to255(baseMetal)})` : `rgb(0,${to255(def.rough)},${to255(def.metal)})`
          drawSilhouette(oc, d, s, imgOf, fill)
        }
      }
      if (relief.length || extra) {
        bump = document.createElement('canvas')
        bump.width = w
        bump.height = h
        const bc = bump.getContext('2d', { willReadFrequently: true })
        const tmp = document.createElement('canvas')
        tmp.width = w
        tmp.height = h
        const tc = tmp.getContext('2d', { willReadFrequently: true })
        if (bc && tc) {
          bc.fillStyle = 'rgb(128,128,128)'
          bc.fillRect(0, 0, w, h)
          if (extra) {
            bc.save()
            extra.draw(bc, s, w)
            bc.restore()
          }
          for (const sign of [1, -1] as const) {
            const items = relief.filter((d) => finishDef(d.finish)?.relief === sign)
            if (!items.length) continue
            tc.clearRect(0, 0, w, h)
            for (const d of items) drawSilhouette(tc, d, s, imgOf, '#000000')
            // เบลอผ่านเงาของ canvas (ใช้ได้ทุกเบราว์เซอร์): วาดต้นแบบนอกภาพ แล้วให้เงาตกกลับมาที่เดิม
            const far = w + h + 1000
            // ไหล่ปั๊มนูน ~0.2 มม., ผนังปั๊มจม ~0.15 มม. → เงา/ไฮไลต์เป็นเส้นบางที่ขอบ
            // และเส้นบางของตัวอักษรสูง/ลึกเต็มเท่าเส้นหนา (แม่พิมพ์หน้าเรียบกดระดับเดียวกันทั้งชิ้น)
            const blurInto = (c: CanvasRenderingContext2D, color: string) => {
              c.save()
              c.shadowColor = color
              c.shadowBlur = sign > 0 ? Math.max(1.5, s * 0.4) : Math.max(1.2, s * 0.3)
              c.shadowOffsetX = far
              c.drawImage(tmp, -far, 0)
              c.restore()
            }
            // ไหล่/ผนังลาดเข้าด้านในรูป (`reliefDepth`) — นูน = บวก, จม = ลบจากเทากลาง
            const blur = document.createElement('canvas')
            blur.width = w
            blur.height = h
            const lc = blur.getContext('2d', { willReadFrequently: true })
            if (!lc) continue
            blurInto(lc, '#000000')
            const A = tc.getImageData(0, 0, w, h).data
            const B = lc.getImageData(0, 0, w, h).data
            const img = bc.getImageData(0, 0, w, h)
            const H = img.data
            for (let i = 3; i < H.length; i += 4) {
              if (!A[i]) continue
              const dv = sign * reliefDepth(A[i], B[i])
              H[i - 3] += dv
              H[i - 2] += dv
              H[i - 1] += dv
            }
            bc.putImageData(img, 0, 0)
          }
        }
      }
      if (dead) return
      // ความสูง → normal map (ทิศแกน v ตาม flipY ของ texture ลาย)
      if (bump) {
        const bc = bump.getContext('2d')
        if (bc) {
          const probe = new THREE.CanvasTexture(document.createElement('canvas'))
          configure?.(probe)
          const img = bc.getImageData(0, 0, w, h)
          img.data.set(heightToNormal(img.data, w, h, s, probe.flipY))
          bc.putImageData(img, 0, 0)
        }
      }
      const mk = (c: HTMLCanvasElement | null) => {
        if (!c) return null
        const t = new THREE.CanvasTexture(c)
        t.colorSpace = THREE.NoColorSpace // ข้อมูลผิว ไม่ใช่สี — ห้ามแปลง sRGB
        t.anisotropy = 8 // มองผิวเฉียง (ไหล่/ข้างถุง) เส้นนูนไม่แตกเป็นหยัก
        configure?.(t)
        return t
      }
      setMaps({ orm: oc ? mk(orm) : null, bump: mk(bump) })
    }, 120)
    return () => {
      dead = true
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, imgTick])

  // คืนหน่วยความจำ GPU ของแผนที่ชุดเก่า
  useEffect(
    () => () => {
      maps.orm?.dispose()
      maps.bump?.dispose()
    },
    [maps],
  )
  return maps
}

// props ของ meshStandardMaterial สำหรับผิวที่มีงานพิเศษ — ไม่มีแผนที่ = ค่าคงที่ของวัสดุตามเดิม
export function finishMaterialProps(maps: FinishMaps, baseRough: number, baseMetal: number) {
  return {
    roughnessMap: maps.orm,
    metalnessMap: maps.orm,
    roughness: maps.orm ? 1 : baseRough,
    metalness: maps.orm ? 1 : baseMetal,
    normalMap: maps.bump,
  }
}
