import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { drawSilhouette, type Deco } from '../core/artwork'
import { finishDef } from '../core/finish'

// แผนที่ผิวของงานพิมพ์พิเศษสำหรับ 3D — วางพิกัดเดียวกับ texture ลาย (แผ่นคลี่/ฉลาก/ฟิล์มถุง ที่ s px/มม.)
//  orm: G = ความด้าน (roughness), B = ความเป็นโลหะ (metalness) ตามที่ three อ่าน roughnessMap/metalnessMap —
//       พื้นทั้งแผ่น = ค่าของวัสดุ, ฟอยล์ = โลหะมันวาว, Spot UV = มันวาวไม่เป็นโลหะ; material ต้องตั้ง roughness/metalness = 1
//       (three คูณค่าคงที่กับค่าในแผนที่)
//  bump: เทากลาง = เรียบ, ปั๊มนูน = ขาว, ปั๊มจม = ดำ — เบลอขอบให้ไล่ระดับ (bump อ่านความชัน ขอบแข็งได้แค่เส้นบาง)
// ไม่มีชิ้นงานพิเศษ = คืน null ทั้งคู่ (material ใช้ค่าคงที่เดิม ไม่เสีย texture เพิ่ม)
const PX_PER_MM = 6 // แผนที่ผิวไม่ต้องคมเท่าลาย
const MAX_PX = 4096

export interface FinishMaps {
  orm: THREE.CanvasTexture | null
  bump: THREE.CanvasTexture | null
}

export function useFinishMaps(opts: {
  sheetW: number
  sheetH: number
  decos: Deco[]
  baseRough: number
  baseMetal: number
  configure?: (t: THREE.CanvasTexture) => void // ต้องตรงกับ texture ลาย (flipY/repeat)
  deps?: unknown[] // ค่าที่ configure ใช้ (เช่นช่วงฉลากที่มองเห็น) — เปลี่ยนแล้วสร้างแผนที่ใหม่
}): FinishMaps {
  const { sheetW, sheetH, decos, baseRough, baseMetal, configure, deps = [] } = opts
  const [maps, setMaps] = useState<FinishMaps>({ orm: null, bump: null })
  const imgCache = useRef(new Map<string, HTMLImageElement>())
  const [imgTick, setImgTick] = useState(0)
  const fin = decos.filter((d) => !d.hidden && d.finish)
  // คีย์เฉพาะสิ่งที่มีผลต่อแผนที่ (ชิ้นงานพิเศษ + ขนาดแผ่น) — แก้ชิ้นอื่นไม่ต้องวาดใหม่
  const key = JSON.stringify([sheetW, sheetH, baseRough, baseMetal, deps, fin.map((d) => (d.type === 'image' ? { ...d, src: d.src.length + d.src.slice(-32) } : d))])

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
    if (!fin.length) {
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

      const orm = document.createElement('canvas')
      orm.width = w
      orm.height = h
      const oc = orm.getContext('2d')
      const relief = fin.filter((d) => finishDef(d.finish)?.relief)
      let bump: HTMLCanvasElement | null = null
      if (oc) {
        oc.fillStyle = `rgb(0,${to255(baseRough)},${to255(baseMetal)})`
        oc.fillRect(0, 0, w, h)
        for (const d of fin) {
          const def = finishDef(d.finish)
          if (!def || def.relief) continue
          drawSilhouette(oc, d, s, imgOf, `rgb(0,${to255(def.rough)},${to255(def.metal)})`)
        }
      }
      if (relief.length) {
        bump = document.createElement('canvas')
        bump.width = w
        bump.height = h
        const bc = bump.getContext('2d')
        const tmp = document.createElement('canvas')
        tmp.width = w
        tmp.height = h
        const tc = tmp.getContext('2d')
        if (bc && tc) {
          bc.fillStyle = 'rgb(128,128,128)'
          bc.fillRect(0, 0, w, h)
          for (const sign of [1, -1] as const) {
            const items = relief.filter((d) => finishDef(d.finish)?.relief === sign)
            if (!items.length) continue
            tc.clearRect(0, 0, w, h)
            for (const d of items) drawSilhouette(tc, d, s, imgOf, '#000000')
            // เบลอผ่านเงาของ canvas (ใช้ได้ทุกเบราว์เซอร์): วาดต้นแบบนอกภาพ แล้วให้เงาตกกลับมาที่เดิม
            const far = w + h + 1000
            bc.save()
            bc.shadowColor = sign > 0 ? '#ffffff' : '#000000'
            bc.shadowBlur = Math.max(2, s * 0.8)
            bc.shadowOffsetX = far
            bc.drawImage(tmp, -far, 0)
            bc.restore()
          }
        }
      }
      if (dead) return
      const mk = (c: HTMLCanvasElement | null) => {
        if (!c) return null
        const t = new THREE.CanvasTexture(c)
        t.colorSpace = THREE.NoColorSpace // ข้อมูลผิว ไม่ใช่สี — ห้ามแปลง sRGB
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
    bumpMap: maps.bump,
    bumpScale: maps.bump ? 3 : 1,
  }
}
