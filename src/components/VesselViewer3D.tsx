import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { Material } from '../core/types'
import type { Vessel } from '../core/vessel'
import { drawDeco2D, fillImageRect, type Deco, type FillImage } from '../core/artwork'

// พรีวิวภาชนะขึ้นรูป: โปรไฟล์หมุนรอบแกน (LatheGeometry) + ฉลากพันรอบตัว
// ฉลากเป็นทรงกระบอกบาง ๆ ลอยเหนือผิว เท็กซ์เจอร์วาดจาก dieline ฉลาก (สีขาว = กระดาษฉลาก)
// จึงเห็นลาย (โลโก้/ข้อความ) พันรอบขวดตรงตำแหน่งเดียวกับบน blueprint

// วาดแผ่นฉลากลง canvas — พื้นขาวเสมอ (ฉลากคือกระดาษพิมพ์ ไม่ใช่สีวัสดุภาชนะ)
function useLabelTexture(
  vessel: Vessel,
  decos: Deco[],
  fillColor: string | null | undefined,
  fillImage: FillImage | null | undefined,
) {
  const [tex, setTex] = useState<THREE.CanvasTexture | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const imgCache = useRef(new Map<string, HTMLImageElement>())
  const [imgReady, setImgReady] = useState(0)

  const srcs = decos.filter((d): d is Extract<Deco, { type: 'image' }> => d.type === 'image').map((d) => d.src)
  if (fillImage) srcs.push(fillImage.src)
  const srcKey = srcs.join('|')
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcKey])

  const decoKey = JSON.stringify(decos)
  const { width, height } = vessel.label

  useEffect(() => {
    const s = Math.min(3, 2048 / Math.max(width, height))
    const w = Math.max(1, Math.round(width * s))
    const h = Math.max(1, Math.round(height * s))
    let canvas = canvasRef.current
    if (!canvas || canvas.width !== w || canvas.height !== h) {
      canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvasRef.current = canvas
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = fillColor || '#ffffff'
    ctx.fillRect(0, 0, w, h)
    // รูปพื้น (ถ้ามี) คลุมทั้งฉลาก (สี่เหลี่ยมเดียว ไม่ต้อง clip แผง) แล้วลายทับ
    const fimg = fillImage ? imgCache.current.get(fillImage.src) : undefined
    if (fillImage && fimg) {
      const r = fillImageRect({ x0: 0, y0: 0, x1: width, y1: height }, fillImage)
      ctx.save()
      if (fillImage.opacity !== undefined && fillImage.opacity < 1) ctx.globalAlpha = fillImage.opacity
      if (fillImage.rot) {
        const cx = (width / 2) * s
        const cy = (height / 2) * s
        ctx.translate(cx, cy)
        ctx.rotate((fillImage.rot * Math.PI) / 180)
        ctx.translate(-cx, -cy)
      }
      ctx.drawImage(fimg, r.x * s, r.y * s, r.w * s, r.h * s)
      ctx.restore()
    }
    // ผิวทรงกระบอกมองจากด้านนอก UV อ่านตรง — ไม่ต้องมิเรอร์แบบกล่อง
    for (const e of decos) drawDeco2D(ctx, e, s, (src) => imgCache.current.get(src))
    setTex((prev) => {
      if (prev && prev.image === canvas) {
        prev.needsUpdate = true
        return prev
      }
      const t = new THREE.CanvasTexture(canvas)
      t.colorSpace = THREE.SRGBColorSpace
      // โชว์เฉพาะช่วงเส้นรอบวงจริง — หางทับซ้อน (กาว) มุดใต้รอยต่อ มองไม่เห็นบนขวด
      t.repeat.x = (2 * Math.PI * vessel.labelR) / width
      t.wrapS = THREE.ClampToEdgeWrapping
      return t
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decoKey, imgReady, fillColor, fillImage, width, height, vessel.labelR])

  useEffect(() => () => tex?.dispose(), [tex])
  return tex
}

function VesselModel({
  vessel,
  mat,
  decos,
  fillColor,
  fillImage,
}: {
  vessel: Vessel
  mat: Material
  decos: Deco[]
  fillColor: string | null | undefined
  fillImage: FillImage | null | undefined
}) {
  const tex = useLabelTexture(vessel, decos, fillColor, fillImage)

  const body = useMemo(
    () => new THREE.LatheGeometry(vessel.profile.map((p) => new THREE.Vector2(p.x, p.y)), 64),
    [vessel],
  )
  const labelH = vessel.labelY1 - vessel.labelY0
  const labelGeo = useMemo(
    // ลอยเหนือผิว 0.3 มม. กัน z-fighting กับตัวภาชนะ
    () => new THREE.CylinderGeometry(vessel.labelR + 0.3, vessel.labelR + 0.3, labelH, 64, 1, true),
    [vessel, labelH],
  )
  useEffect(
    () => () => {
      body.dispose()
      labelGeo.dispose()
    },
    [body, labelGeo],
  )

  const metal = mat.id === 'aluminum'
  return (
    // จัดกึ่งกลางแนวตั้งให้หมุนรอบกลางลำตัว
    <group position={[0, -vessel.H / 2, 0]}>
      <mesh geometry={body}>
        <meshStandardMaterial
          color={mat.color}
          roughness={mat.roughness ?? (metal ? 0.3 : 0.12)}
          metalness={metal ? 0.85 : 0}
          transparent={mat.opacity !== undefined}
          opacity={mat.opacity ?? 1}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* หมุนรอยต่อฉลากไปด้านหลัง ไม่ให้บังหน้าลาย */}
      <mesh geometry={labelGeo} position={[0, (vessel.labelY0 + vessel.labelY1) / 2, 0]} rotation={[0, Math.PI, 0]}>
        <meshStandardMaterial map={tex} color={tex ? '#ffffff' : '#f5f2ea'} roughness={0.8} metalness={0} />
      </mesh>
    </group>
  )
}

export function VesselViewer3D({
  vessel,
  mat,
  decos,
  fillColor,
  fillImage,
}: {
  vessel: Vessel
  mat: Material
  decos: Deco[]
  fillColor?: string | null
  fillImage?: FillImage | null
}) {
  const dist = Math.max(vessel.H, vessel.labelR * 4) * 2.2
  return (
    <Canvas
      camera={{ position: [dist * 0.45, dist * 0.3, dist], fov: 36, near: 1, far: 8000 }}
      role="img"
      aria-label="มุมมอง 3 มิติของภาชนะพร้อมฉลาก"
    >
      <color attach="background" args={['#eeebe3']} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[250, 420, 300]} intensity={1.7} />
      <directionalLight position={[-220, 120, -260]} intensity={0.6} />
      <VesselModel vessel={vessel} mat={mat} decos={decos} fillColor={fillColor} fillImage={fillImage} />
      <OrbitControls makeDefault enableDamping />
    </Canvas>
  )
}
