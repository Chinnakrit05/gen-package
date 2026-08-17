import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { Material } from '../core/types'
import {
  type Pouch,
  pouchDepthFactor,
  pouchWidthFactor,
  pouchSection,
  valveR,
  VALVE_V,
  TINTIE_INSET,
} from '../core/pouch'
import { drawDeco2D, fillImageRect, type Deco, type FillImage } from '../core/artwork'

// พรีวิวถุงฟิล์มตั้งได้ (doypack): พื้นผิว loft หน้าตัดวงรีเปลี่ยนตามความสูง
// ก้นแบนตั้งได้ พุงกลางป่อง ปากบนซีลแบน — ลาย (หน้า/หลัง) map ลงผิวถุงตรงกับ dieline
// texture วาดจาก dieline ฟิล์มทั้งแผ่น แล้วใช้ UV ของ frontRect/backRect เลือกเฉพาะพื้นที่พิมพ์

function usePouchTexture(
  pouch: Pouch,
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
  const { width, height } = pouch.label

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
    for (const e of decos) drawDeco2D(ctx, e, s, (src) => imgCache.current.get(src))
    setTex((prev) => {
      if (prev && prev.image === canvas) {
        prev.needsUpdate = true
        return prev
      }
      const t = new THREE.CanvasTexture(canvas)
      t.colorSpace = THREE.SRGBColorSpace
      t.flipY = false // UV คำนวณเป็นพิกัดแผ่นคลี่ตรง ๆ (y ลง) จึงไม่ต้องพลิก
      return t
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decoKey, imgReady, fillColor, fillImage, width, height])

  useEffect(() => () => tex?.dispose(), [tex])
  return tex
}

// สร้าง BufferGeometry ถุง: วงแหวนวงรีตามความสูง + ฝาก้น/ปาก + UV แม็พหน้า/หลังตาม dieline
function usePouchGeometry(pouch: Pouch) {
  return useMemo(() => {
    const { W, H, depth3D, style, frontRect, backRect, label } = pouch
    const NU = 64 // รอบวง
    const NV = 48 // ตามความสูง
    const dw = label.width
    const dh = label.height
    const pos: number[] = []
    const uv: number[] = []
    const idx: number[] = []

    const ringVert = (v: number, theta: number) => {
      const a = (W / 2) * pouchWidthFactor(v, style)
      const b = depth3D * pouchDepthFactor(v, style)
      const sec = pouchSection(theta, style)
      const x = a * sec.cx
      const z = b * sec.cz
      const y = v * H
      // UV: front (θ∈[0,π]) แม็พ frontRect ขวา→ซ้าย (ให้อ่านไม่กลับด้านเมื่อมองจาก +Z),
      // back (θ∈[π,2π]) แม็พ backRect ต่อเนื่องที่รอยพับข้าง (x=W) และรอยกาว (x=0/2W)
      let dlx: number
      if (theta <= Math.PI) dlx = frontRect.x + W * (1 - theta / Math.PI)
      else dlx = backRect.x + W * (1 - (theta - Math.PI) / Math.PI)
      const dly = frontRect.y + (1 - v) * H
      pos.push(x, y, z)
      uv.push(dlx / dw, dly / dh)
    }

    // กริดผิวข้าง (NV+1 แถว × NU+1 คอลัมน์ ให้มี seam ซ้ำจุดสำหรับ UV)
    for (let iv = 0; iv <= NV; iv++) {
      const v = iv / NV
      for (let iu = 0; iu <= NU; iu++) ringVert(v, (iu / NU) * Math.PI * 2)
    }
    const cols = NU + 1
    for (let iv = 0; iv < NV; iv++) {
      for (let iu = 0; iu < NU; iu++) {
        const a = iv * cols + iu
        const b = a + 1
        const c = a + cols
        const d = c + 1
        idx.push(a, c, b, b, c, d)
      }
    }

    // ฝาก้น (v=0) พัดไปจุดกลาง และฝาปาก (v=1) พัดไปจุดกลาง — ปิดผิวให้ทึบ/ตั้งได้
    const cap = (v: number, flip: boolean) => {
      const center = pos.length / 3
      pos.push(0, v * H, 0)
      uv.push((frontRect.x + W / 2) / dw, (frontRect.y + (1 - v) * H) / dh)
      const base = v === 0 ? 0 : NV * cols
      for (let iu = 0; iu < NU; iu++) {
        const p0 = base + iu
        const p1 = base + iu + 1
        if (flip) idx.push(center, p1, p0)
        else idx.push(center, p0, p1)
      }
    }
    cap(0, false) // ก้น (มองจากล่าง)
    cap(1, true) // ปาก

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    return geo
  }, [pouch])
}

function PouchModel({
  pouch,
  mat,
  decos,
  fillColor,
  fillImage,
}: {
  pouch: Pouch
  mat: Material
  decos: Deco[]
  fillColor: string | null | undefined
  fillImage: FillImage | null | undefined
}) {
  const tex = usePouchTexture(pouch, decos, fillColor, fillImage)
  const geo = usePouchGeometry(pouch)
  useEffect(() => () => geo.dispose(), [geo])

  // three คอมไพล์ shader ตาม define ตอนสร้าง — map เปลี่ยน null → texture ต้อง needsUpdate ให้ recompile
  const matRef = useRef<THREE.MeshStandardMaterial>(null!)
  const hasTex = !!tex
  useLayoutEffect(() => {
    if (matRef.current) matRef.current.needsUpdate = true
  }, [hasTex])

  // แถบซิปล็อก: วงรีบาง ๆ พาดรอบใกล้ปาก ที่ระดับความสูงเดียวกับแนวซิปบน dieline
  let zip: { y: number; ax: number; bz: number } | null = null
  if (pouch.zipper && pouch.zipY !== undefined) {
    const vzip = Math.min(0.98, Math.max(0.02, 1 - (pouch.zipY - pouch.frontRect.y) / pouch.H))
    zip = {
      y: vzip * pouch.H,
      ax: (pouch.W / 2) * pouchWidthFactor(vzip, pouch.style) * 1.03,
      bz: pouch.depth3D * pouchDepthFactor(vzip, pouch.style) * 1.03,
    }
  }

  // จุก + ฝาเกลียว ที่ปากบน (spout pouch)
  const spoutR = Math.min(pouch.W, 90) * 0.09
  const neckH = pouch.H * 0.08
  const capH = neckH * 0.6

  // วาล์วกาแฟ: จานกลมนูนบนหน้าถุงส่วนบน (z = ผิวหน้าที่ระดับ VALVE_V)
  const valveZ = pouch.depth3D * pouchDepthFactor(VALVE_V, pouch.style)
  const vR = valveR(pouch.W)
  // ที่รัดปาก: แถบบางพาดขวางหน้าใกล้ปาก
  const ttV = Math.min(0.97, Math.max(0.03, 1 - (TINTIE_INSET + 3) / pouch.H))
  const ttZ = pouch.depth3D * pouchDepthFactor(ttV, pouch.style)
  const ttW = pouch.W * pouchWidthFactor(ttV, pouch.style) * 0.9

  return (
    <group position={[0, -pouch.H / 2, 0]}>
      <mesh geometry={geo}>
        <meshStandardMaterial
          ref={matRef}
          map={tex}
          color={tex ? '#ffffff' : mat.color}
          roughness={mat.roughness ?? 0.6}
          metalness={0}
          transparent={mat.opacity !== undefined}
          opacity={mat.opacity ?? 1}
          side={THREE.DoubleSide}
        />
      </mesh>
      {zip && (
        <mesh position={[0, zip.y, 0]} scale={[zip.ax, 1, zip.bz]}>
          <cylinderGeometry args={[1, 1, 5, 48, 1, true]} />
          <meshStandardMaterial color="#6f685c" roughness={0.5} metalness={0} side={THREE.DoubleSide} />
        </mesh>
      )}
      {pouch.spout && (
        <group position={[0, pouch.H, 0]}>
          {/* คอจุก */}
          <mesh position={[0, neckH / 2, 0]}>
            <cylinderGeometry args={[spoutR, spoutR, neckH, 24]} />
            <meshStandardMaterial color="#d6cfbf" roughness={0.45} metalness={0} />
          </mesh>
          {/* ฝาเกลียว */}
          <mesh position={[0, neckH + capH / 2, 0]}>
            <cylinderGeometry args={[spoutR * 1.4, spoutR * 1.4, capH, 24]} />
            <meshStandardMaterial color="#b7ae99" roughness={0.5} metalness={0} />
          </mesh>
        </group>
      )}
      {pouch.valve && (
        // วาล์วกาแฟ: จานกลมนูนออกจากผิวหน้า (แกนตามแนว z)
        <mesh position={[0, VALVE_V * pouch.H, valveZ + 1]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[vR, vR, 3, 24]} />
          <meshStandardMaterial color="#2f2c28" roughness={0.5} metalness={0.1} />
        </mesh>
      )}
      {pouch.tinTie && (
        // ที่รัดปาก: แถบบางพาดขวางหน้าถุงใกล้ปาก
        <mesh position={[0, ttV * pouch.H, ttZ + 1]}>
          <boxGeometry args={[ttW, 6, 2]} />
          <meshStandardMaterial color="#a89a7a" roughness={0.6} metalness={0.2} />
        </mesh>
      )}
    </group>
  )
}

export function PouchViewer3D({
  pouch,
  mat,
  decos,
  fillColor,
  fillImage,
}: {
  pouch: Pouch
  mat: Material
  decos: Deco[]
  fillColor?: string | null
  fillImage?: FillImage | null
}) {
  const dist = Math.max(pouch.H, pouch.W) * 2.6
  return (
    <Canvas
      camera={{ position: [dist * 0.35, dist * 0.25, dist], fov: 36, near: 1, far: 8000 }}
      role="img"
      aria-label="มุมมอง 3 มิติของถุงพร้อมลาย"
    >
      <color attach="background" args={['#eeebe3']} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[250, 420, 300]} intensity={1.6} />
      <directionalLight position={[-220, 120, -260]} intensity={0.6} />
      <PouchModel pouch={pouch} mat={mat} decos={decos} fillColor={fillColor} fillImage={fillImage} />
      <OrbitControls makeDefault enableDamping />
    </Canvas>
  )
}
