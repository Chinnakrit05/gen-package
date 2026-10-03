import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { safeCanvasEvents } from './safeCanvasEvents'
import type { Material } from '../core/types'
import type { Vessel } from '../core/vessel'
import { drawDeco2D, fillImageRect, type Deco, type FillImage } from '../core/artwork'
import { DimBadge3D, type Dim3D } from './DimBadge3D'

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
  dims,
  imperial,
}: {
  vessel: Vessel
  mat: Material
  decos: Deco[]
  fillColor: string | null | undefined
  fillImage: FillImage | null | undefined
  dims?: Dim3D[]
  imperial?: boolean
}) {
  const tex = useLabelTexture(vessel, decos, fillColor, fillImage)

  // three คอมไพล์ shader ตาม define ตอนสร้าง — พอ map เปลี่ยนจาก null → texture
  // ต้องสั่ง needsUpdate ให้ recompile ไม่งั้นลาย/สีบนฉลากจะไม่ขึ้น (เหมือน PanelMesh ของกล่อง)
  const labelMatRef = useRef<THREE.MeshStandardMaterial>(null!)
  const hasTex = !!tex
  useLayoutEffect(() => {
    if (labelMatRef.current) labelMatRef.current.needsUpdate = true
  }, [hasTex])

  const metal = mat.id === 'aluminum'
  const isTube = mat.form === 'tube'
  const tube = vessel.tube

  // ฝา+ไหล่ (ทรงหมุน) — หลอดครีม profile เก็บแค่ส่วนนี้ (เปิดปลายบนให้ลำตัว loft รับต่อ)
  const body = useMemo(
    () => new THREE.LatheGeometry(vessel.profile.map((p) => new THREE.Vector2(p.x, p.y)), 64),
    [vessel],
  )

  // หลอดครีม: ลำตัว loft หน้าตัดค่อย ๆ บีบ — width (x) คงเกือบเต็ม, depth (z) ยุบจาก R → ครึ่งความหนาซีล
  // ได้ front กว้างแบน + side เป็นลิ่ม (สามเหลี่ยม) + ยอดเป็นตะเข็บซีลแบน เหมือนหลอดครีมจริง
  const tubeBodyGeo = useMemo(() => {
    if (!tube) return null
    const { R, rcap, capTop, sealThick } = tube
    const top = vessel.H
    // width (แกน x): บานจากคอ rcap (ก้น) → กว้างสุด R ที่ยอด (ตะเข็บซีล) = ทรง trapezoid กว้างบน
    const aOf = (v: number) => rcap + (R - rcap) * Math.pow(v, 0.6)
    // depth (แกน z): เรียวเป็นลิ่มคมจากคอ rcap → เกือบเป็นจุดที่ยอด (side view = สามเหลี่ยมคม)
    const bOf = (v: number) => (rcap - sealThick / 2) * Math.pow(1 - v, 1.4) + sealThick / 2
    const NV = 28
    const NU = 64
    const stride = NU + 1
    const pos: number[] = []
    const idx: number[] = []
    for (let iv = 0; iv <= NV; iv++) {
      const v = iv / NV
      const y = capTop + v * (top - capTop)
      const a = aOf(v)
      const b = bOf(v)
      for (let i = 0; i <= NU; i++) {
        const th = (i / NU) * Math.PI * 2
        pos.push(a * Math.cos(th), y, b * Math.sin(th))
      }
    }
    for (let iv = 0; iv < NV; iv++) {
      for (let i = 0; i < NU; i++) {
        const a0 = iv * stride + i
        const b0 = (iv + 1) * stride + i
        idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1)
      }
    }
    // ปิดตะเข็บซีลบนสุด (เส้นแบน) ด้วยพัดจากจุดกึ่งกลาง
    const center = pos.length / 3
    pos.push(0, top, 0)
    const topStart = NV * stride
    for (let i = 0; i < NU; i++) idx.push(topStart + i, center, topStart + i + 1)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    return g
  }, [tube, vessel.H])

  // หลอดครีม: ฝาเกลียว (ชิ้นแยก สีต่างจากตัวหลอด) — ทรงกระบอกที่ก้น มีร่องเกลียวตั้งรอบฝา
  // (รัศมีกระเพื่อมตาม θ) ร่องจางหายไปช่วงบนที่ชนกับไหล่/ลำตัว ให้รอยต่อเนียน
  const tubeCapGeo = useMemo(() => {
    if (!tube) return null
    const { rcap, capTop } = tube
    const capR = rcap
    const nRibs = 34 // จำนวนร่องเกลียวรอบฝา
    const ribAmp = Math.min(0.6, capR * 0.09)
    const NU = 136
    const NV = 10
    const stride = NU + 1
    const pos: number[] = []
    const idx: number[] = []
    // ร่องเกลียว: รัศมีกระเพื่อมตามมุม; คงร่องเกือบทั้งฝา แล้วจางช่วงบนสุด (v>0.78) ให้ชนลำตัวเนียน
    const rAt = (th: number, v: number) => {
      const fade = v < 0.78 ? 1 : (1 - v) / 0.22
      return capR + ribAmp * fade * 0.5 * (1 + Math.cos(th * nRibs))
    }
    for (let iv = 0; iv <= NV; iv++) {
      const v = iv / NV
      const y = v * capTop
      for (let i = 0; i <= NU; i++) {
        const th = (i / NU) * Math.PI * 2
        const r = rAt(th, v)
        pos.push(r * Math.cos(th), y, r * Math.sin(th))
      }
    }
    for (let iv = 0; iv < NV; iv++) {
      for (let i = 0; i < NU; i++) {
        const a0 = iv * stride + i
        const b0 = (iv + 1) * stride + i
        idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1)
      }
    }
    // ปิดก้นฝา (พัดจากจุดกึ่งกลางที่ y=0)
    const cBot = pos.length / 3
    pos.push(0, 0, 0)
    for (let i = 0; i < NU; i++) idx.push(i, cBot, i + 1)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    return g
  }, [tube])

  // ฉลาก: หลอดครีมใช้เปลือก loft หุ้มตามผิวลำตัวในช่วง band; ภาชนะอื่นใช้ทรงกระบอก
  const labelH = vessel.labelY1 - vessel.labelY0
  const labelGeo = useMemo(() => {
    if (tube) {
      const { R, rcap, capTop, sealThick } = tube
      const top = vessel.H
      const aOf = (v: number) => rcap + (R - rcap) * Math.pow(v, 0.6) + 0.3
      const bOf = (v: number) => (rcap - sealThick / 2) * Math.pow(1 - v, 1.4) + sealThick / 2 + 0.3
      const NV = 20
      const NU = 64
      const stride = NU + 1
      const pos: number[] = []
      const uv: number[] = []
      const idx: number[] = []
      for (let iv = 0; iv <= NV; iv++) {
        const f = iv / NV
        const y = vessel.labelY0 + f * (vessel.labelY1 - vessel.labelY0)
        const v = (y - capTop) / (top - capTop)
        const a = aOf(v)
        const b = bOf(v)
        for (let i = 0; i <= NU; i++) {
          const th = (i / NU) * Math.PI * 2
          pos.push(a * Math.cos(th), y, b * Math.sin(th))
          uv.push(i / NU, f)
        }
      }
      for (let iv = 0; iv < NV; iv++) {
        for (let i = 0; i < NU; i++) {
          const a0 = iv * stride + i
          const b0 = (iv + 1) * stride + i
          idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1)
        }
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
      g.setIndex(idx)
      g.computeVertexNormals()
      return g
    }
    // ลอยเหนือผิว 0.3 มม. กัน z-fighting กับตัวภาชนะ
    return new THREE.CylinderGeometry(vessel.labelR + 0.3, vessel.labelR + 0.3, labelH, 64, 1, true)
  }, [tube, vessel, labelH])

  useEffect(
    () => () => {
      body.dispose()
      labelGeo.dispose()
      tubeBodyGeo?.dispose()
      tubeCapGeo?.dispose()
    },
    [body, labelGeo, tubeBodyGeo, tubeCapGeo],
  )

  // สีฝาหลอด — แยกจากตัวหลอดให้เห็นว่าเป็นคนละชิ้น (พลาสติกเงากว่า)
  const CAP_COLOR = '#b9b5ac'

  const modelRef = useRef<THREE.Group>(null)

  return (
    <>
    {/* จัดกึ่งกลางแนวตั้งให้หมุนรอบกลางลำตัว */}
    <group ref={modelRef} position={[0, -vessel.H / 2, 0]}>
      {/* ตัวภาชนะทรงหมุน — หลอดครีมไม่ใช้ (ฝา+ลำตัวเป็นชิ้นแยก) */}
      {!isTube && (
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
      )}
      {isTube && tubeBodyGeo && (
        <mesh geometry={tubeBodyGeo}>
          <meshStandardMaterial color={mat.color} roughness={mat.roughness ?? 0.28} metalness={0} side={THREE.DoubleSide} />
        </mesh>
      )}
      {isTube && tubeCapGeo && (
        <mesh geometry={tubeCapGeo}>
          <meshStandardMaterial color={CAP_COLOR} roughness={0.32} metalness={0.05} side={THREE.DoubleSide} />
        </mesh>
      )}
      {/* ฉลาก: หลอด = เปลือก loft ตามผิว (วาง y จริง); ภาชนะอื่น = ทรงกระบอกจัดกึ่งกลาง band หมุนรอยต่อไปหลัง */}
      {tube ? (
        <mesh geometry={labelGeo}>
          <meshStandardMaterial ref={labelMatRef} map={tex} color={tex ? '#ffffff' : '#f5f2ea'} roughness={0.8} metalness={0} side={THREE.DoubleSide} />
        </mesh>
      ) : (
        <mesh geometry={labelGeo} position={[0, (vessel.labelY0 + vessel.labelY1) / 2, 0]} rotation={[0, Math.PI, 0]}>
          <meshStandardMaterial ref={labelMatRef} map={tex} color={tex ? '#ffffff' : '#f5f2ea'} roughness={0.8} metalness={0} />
        </mesh>
      )}
    </group>
    {dims && dims.length > 0 && <DimBadge3D targetRef={modelRef} dims={dims} imperial={!!imperial} variant={tube ? 'tube' : 'vessel'} />}
    </>
  )
}

export function VesselViewer3D({
  vessel,
  mat,
  decos,
  fillColor,
  fillImage,
  dims,
  imperial,
}: {
  vessel: Vessel
  mat: Material
  decos: Deco[]
  fillColor?: string | null
  fillImage?: FillImage | null
  dims?: Dim3D[]
  imperial?: boolean
}) {
  const dist = Math.max(vessel.H, vessel.labelR * 4) * 2.2
  return (
    <Canvas
      events={safeCanvasEvents}
      camera={{ position: [dist * 0.45, dist * 0.3, dist], fov: 36, near: 1, far: 8000 }}
      role="img"
      aria-label="มุมมอง 3 มิติของภาชนะพร้อมฉลาก"
    >
      <color attach="background" args={['#ffffff']} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[250, 420, 300]} intensity={1.7} />
      <directionalLight position={[-220, 120, -260]} intensity={0.6} />
      <VesselModel vessel={vessel} mat={mat} decos={decos} fillColor={fillColor} fillImage={fillImage} dims={dims} imperial={imperial} />
      <OrbitControls makeDefault enableDamping />
    </Canvas>
  )
}
