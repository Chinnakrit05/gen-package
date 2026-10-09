import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useArtTexture } from './useArtTexture'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { safeCanvasEvents } from './safeCanvasEvents'
import type { Material } from '../core/types'
import { tubeSection, type Vessel } from '../core/vessel'
import { drawDeco2D, fillImageRect, type Deco, type FillImage } from '../core/artwork'
import { DimBadge3D, type Dim3D } from './DimBadge3D'
import { SceneLighting, type LightMode } from './SceneLighting'

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
  const { width, height } = vessel.label
  return useArtTexture({
    sheetW: width,
    sheetH: height,
    decos,
    fillImage,
    enabled: true,
    deps: [fillColor, fillImage, vessel.labelR],
    // โชว์เฉพาะช่วงเส้นรอบวงจริง — หางทับซ้อน (กาว) มุดใต้รอยต่อ มองไม่เห็นบนขวด
    configure: (t) => {
      t.repeat.x = (2 * Math.PI * vessel.labelR) / width
      t.wrapS = THREE.ClampToEdgeWrapping
    },
    // ผิวทรงกระบอกมองจากด้านนอก UV อ่านตรง — ไม่ต้องมิเรอร์แบบกล่อง; ฉลากพื้นขาว (กระดาษพิมพ์)
    draw: (ctx, s, imgOf) => {
      ctx.fillStyle = fillColor || '#ffffff'
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
      // รูปพื้น (ถ้ามี) คลุมทั้งแผ่น (สี่เหลี่ยมเดียว ไม่ต้อง clip แผง) แล้วลายทับ
      const fimg = fillImage ? imgOf(fillImage.src) : undefined
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
      for (const e of decos) drawDeco2D(ctx, e, s, imgOf)
    },
  })
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

  // หลอดครีม: ไหล่ + ลำตัว (ท่อบีบแบน เส้นรอบวงคงที่) ด้วย tubeSection ชุดเดียวกับความจุ
  // คอลัมน์แบ่งตามความยาวผิวจริง เริ่มกลางหลัง (แนวรอยต่อท่อ laminate) → ซ้าย → กลางหน้า → ขวา → กลางหลัง
  // ลายจึงอ่านจากซ้ายไปขวาบนหน้าหลอด และไม่ยืดตรงขอบที่ถูกบีบแบน
  const tubeRing = (a: number, b: number, NU: number): [number, number][] => {
    const M = 256
    const th: number[] = []
    const cum = [0]
    for (let i = 0; i <= M; i++) {
      th.push((3 * Math.PI) / 2 - (2 * Math.PI * i) / M)
      if (i) {
        const t0 = th[i - 1]
        const t1 = th[i]
        cum.push(cum[i - 1] + Math.hypot(a * (Math.cos(t1) - Math.cos(t0)), b * (Math.sin(t1) - Math.sin(t0))))
      }
    }
    const L = cum[M]
    const out: [number, number][] = []
    let j = 0
    for (let k = 0; k <= NU; k++) {
      const target = (L * k) / NU
      while (j < M - 1 && cum[j + 1] < target) j++
      const t = cum[j + 1] > cum[j] ? Math.min(1, (target - cum[j]) / (cum[j + 1] - cum[j])) : 0
      const ang = th[j] + (th[j + 1] - th[j]) * t
      out.push([a * Math.cos(ang), b * Math.sin(ang)])
    }
    return out
  }
  const loftTube = (ys: number[], grow: number, withUv: boolean) => {
    const NU = 96
    const stride = NU + 1
    const pos: number[] = []
    const uv: number[] = []
    const idx: number[] = []
    ys.forEach((y) => {
      const { a, b } = tubeSection(tube!, y)
      for (const [k, [x, z]] of tubeRing(a + grow, b + grow, NU).entries()) {
        pos.push(x, y, z)
        if (withUv) uv.push(k / NU, (y - ys[0]) / (ys[ys.length - 1] - ys[0] || 1))
      }
    })
    for (let iv = 0; iv < ys.length - 1; iv++) {
      for (let i = 0; i < NU; i++) {
        const a0 = iv * stride + i
        const b0 = (iv + 1) * stride + i
        idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    if (withUv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(idx)
    g.computeVertexNormals()
    return g
  }
  const range = (y0: number, y1: number, n: number) => Array.from({ length: n + 1 }, (_, i) => y0 + ((y1 - y0) * i) / n)

  const tubeBodyGeo = useMemo(() => {
    if (!tube) return null
    return loftTube([...range(tube.capTop, tube.bodyY0, 8), ...range(tube.bodyY0, tube.sealY0, 48).slice(1)], 0, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tube])

  // ตะเข็บซีลบน: แถบแบนกว้าง πR มีลอนกดแนวตั้ง (crimp) ทั้งสองหน้า + ขอบบน
  const tubeSealGeo = useMemo(() => {
    if (!tube) return null
    const a = (Math.PI * tube.R) / 2
    const half = tube.sealThick / 2
    const y0 = tube.sealY0
    const y1 = vessel.H
    const pitch = 1.2
    const NX = Math.max(60, Math.round((2 * a) / (pitch / 4)))
    const pos: number[] = []
    const idx: number[] = []
    for (const side of [1, -1]) {
      const start = pos.length / 3
      for (const y of [y0, y1]) {
        for (let k = 0; k <= NX; k++) {
          const x = -a + (2 * a * k) / NX
          const ridge = 0.18 * (0.5 + 0.5 * Math.cos((2 * Math.PI * x) / pitch))
          pos.push(x, y, side * (half + ridge))
        }
      }
      for (let k = 0; k < NX; k++) {
        const q = start + k
        if (side > 0) idx.push(q, q + 1, q + NX + 1, q + 1, q + NX + 2, q + NX + 1)
        else idx.push(q, q + NX + 1, q + 1, q + 1, q + NX + 1, q + NX + 2)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    return g
  }, [tube, vessel.H])

  // ฝา flip-top: ทรงกระบอกกว้างเกือบเท่าท่อ ขอบล่างมน (ตั้งบนฝา) + ร่องแบ่งฝาพับ/ฐาน
  const tubeCapGeo = useMemo(() => {
    if (!tube) return null
    const { rcap: r, capTop: h } = tube
    const bev = Math.min(1.2, r * 0.08)
    const g0 = h * 0.34 // ร่องรอยแยกฝาพับ (นับจากก้น)
    const pts = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(r - bev, 0),
      new THREE.Vector2(r - bev * 0.3, bev * 0.3),
      new THREE.Vector2(r, bev),
      new THREE.Vector2(r, g0 - 0.5),
      new THREE.Vector2(r - 0.35, g0),
      new THREE.Vector2(r, g0 + 0.5),
      new THREE.Vector2(r, h - 0.6),
      new THREE.Vector2(r * 0.985, h),
      new THREE.Vector2(0, h),
    ]
    return new THREE.LatheGeometry(pts, 72)
  }, [tube])

  // ฉลาก: หลอดครีมใช้เปลือก loft หุ้มตามผิวลำตัวในช่วงพิมพ์; ภาชนะอื่นใช้ทรงกระบอก
  const labelH = vessel.labelY1 - vessel.labelY0
  const labelGeo = useMemo(() => {
    if (tube) return loftTube(range(vessel.labelY0, vessel.labelY1, 40), 0.25, true)
    // ลอยเหนือผิว 0.3 มม. กัน z-fighting กับตัวภาชนะ
    return new THREE.CylinderGeometry(vessel.labelR + 0.3, vessel.labelR + 0.3, labelH, 64, 1, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tube, vessel, labelH])

  useEffect(
    () => () => {
      body.dispose()
      labelGeo.dispose()
      tubeBodyGeo?.dispose()
      tubeCapGeo?.dispose()
      tubeSealGeo?.dispose()
    },
    [body, labelGeo, tubeBodyGeo, tubeCapGeo, tubeSealGeo],
  )

  // สีฝาหลอด flip-top — พลาสติกขาวเงา แยกจากตัวหลอด
  const CAP_COLOR = '#f1f1ef'

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
            metalness={mat.metalness ?? (metal ? 0.85 : 0)}
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
      {isTube && tube && (
        // ร่องจับเปิดฝาพับ (thumb notch) ด้านหน้าที่แนวร่องฝา
        <mesh position={[0, tube.capTop * 0.34, tube.rcap - 0.15]}>
          <boxGeometry args={[tube.rcap * 0.5, tube.capTop * 0.16, 0.6]} />
          <meshStandardMaterial color="#dcdcd8" roughness={0.4} metalness={0} />
        </mesh>
      )}
      {isTube && tubeSealGeo && (
        <mesh geometry={tubeSealGeo}>
          <meshStandardMaterial color={mat.color} roughness={0.35} metalness={0} side={THREE.DoubleSide} />
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
  lightMode,
}: {
  vessel: Vessel
  mat: Material
  decos: Deco[]
  fillColor?: string | null
  fillImage?: FillImage | null
  dims?: Dim3D[]
  imperial?: boolean
  lightMode?: LightMode
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
      <SceneLighting mode={lightMode ?? 'soft'} />
      <VesselModel vessel={vessel} mat={mat} decos={decos} fillColor={fillColor} fillImage={fillImage} dims={dims} imperial={imperial} />
      <OrbitControls makeDefault enableDamping />
    </Canvas>
  )
}
