import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { Dieline, Material } from '../core/types'
import { elW, elH, sheetUV, type Deco } from '../core/artwork'
import { computeMatrices } from '../core/fold'

// วาดองค์ประกอบ (รูป/ข้อความ) ลง ctx ในพิกัดแผ่นคลี่ (สเกล s) พร้อมหมุนรอบจุดกึ่งกลาง
// ใช้พิกัดชุดเดียวกับ blueprint (y ชี้ลง, มุมหมุนตามเข็ม) เพื่อให้จอสองฝั่งตรงกัน
function drawDeco(
  ctx: CanvasRenderingContext2D,
  e: Deco,
  s: number,
  imgOf: (src: string) => HTMLImageElement | undefined,
) {
  const w = elW(e)
  const h = elH(e)
  ctx.save()
  ctx.translate((e.x + w / 2) * s, (e.y + h / 2) * s)
  ctx.rotate((e.rot * Math.PI) / 180)
  // ผิวที่กล้องเห็น (ด้านนอกกล่อง) เป็น "หลัง" ของ UV — ถ้าวาดปกติจะอ่านกลับซ้าย-ขวา
  // มิเรอร์เนื้อของแต่ละชิ้นรอบจุดกึ่งกลางตัวเอง (scale -1) ให้ผิวนอกอ่านถูก โดย "ตำแหน่ง"
  // ของชิ้นไม่ขยับ (จุดกึ่งกลางคงเดิม) — ต่างจากมิเรอร์ทั้งผืนที่ทำให้ตำแหน่งเลื่อนตามไปด้วย
  ctx.scale(-1, 1)
  if (e.type === 'image') {
    const img = imgOf(e.src)
    if (img) ctx.drawImage(img, (-w / 2) * s, (-h / 2) * s, w * s, h * s)
  } else {
    ctx.fillStyle = e.color
    ctx.font = `${e.size * s}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(e.text, 0, 0)
  }
  ctx.restore()
}

// วาดสีวัสดุ + องค์ประกอบทั้งหมดลงผ้าใบขนาดเท่าแผ่นคลี่ แล้วใช้เป็น texture ผืนเดียวของทุกแผง
// เพราะ UV ของทุกแผงอ้างพิกัดแผ่นคลี่ร่วมกัน (ดู uv ใน FoldedModel) องค์ประกอบจึงพาด
// ข้ามรอยพับได้ถูกต้องเหมือนพิมพ์ลงแผ่นจริงแล้วค่อยพับ
function useSheetTexture(dieline: Dieline, mat: Material, decos: Deco[]) {
  const [tex, setTex] = useState<THREE.CanvasTexture | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const imgCache = useRef(new Map<string, HTMLImageElement>())
  const [imgReady, setImgReady] = useState(0) // เพิ่มค่าเมื่อมีรูปโหลดเสร็จ เพื่อสั่งวาดใหม่

  // ถอดรหัสรูปแต่ละ src ครั้งเดียว เก็บใน cache — ไม่ decode ซ้ำตอนลาก/หมุน
  const srcs = decos.filter((d): d is Extract<Deco, { type: 'image' }> => d.type === 'image').map((d) => d.src)
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
    // srcKey ครอบคลุมการเปลี่ยนชุด src แล้ว
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcKey])

  // มี hash ของ decos เพื่อวาดใหม่เฉพาะเมื่อค่าที่มีผลต่อภาพเปลี่ยน (ไม่รวม id)
  const decoKey = JSON.stringify(decos)

  useEffect(() => {
    if (decos.length === 0) {
      setTex(null)
      return
    }
    const s = Math.min(3, 2048 / Math.max(dieline.width, dieline.height))
    const w = Math.max(1, Math.round(dieline.width * s))
    const h = Math.max(1, Math.round(dieline.height * s))

    let canvas = canvasRef.current
    if (!canvas || canvas.width !== w || canvas.height !== h) {
      canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvasRef.current = canvas
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = mat.color
    ctx.fillRect(0, 0, w, h)
    for (const e of decos) drawDeco(ctx, e, s, (src) => imgCache.current.get(src))

    // ห้าม dispose ของเก่าตรงนี้ — StrictMode เรียกตัวอัปเดตซ้ำได้
    // ปล่อยให้ cleanup ของ effect ด้านล่างเป็นคนคืนหน่วยความจำแทน
    setTex((prev) => {
      if (prev && prev.image === canvas) {
        prev.needsUpdate = true
        return prev
      }
      const t = new THREE.CanvasTexture(canvas)
      t.colorSpace = THREE.SRGBColorSpace
      return t
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decoKey, imgReady, mat.color, dieline.width, dieline.height])

  // คืนหน่วยความจำเมื่อ viewer ถูกถอด
  useEffect(() => () => tex?.dispose(), [tex])

  return tex
}

// เลื่อนกล้องให้เห็นแผ่นคลี่เต็มใบเมื่อขนาดแผ่นเปลี่ยนอย่างมีนัย
// (ไม่ refit ทุกติ๊กของ slider เพื่อไม่แย่งมุมกล้องที่ผู้ใช้หมุนไว้)
function FitCamera({ dieline }: { dieline: Dieline }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as { target?: THREE.Vector3; update?: () => void } | null
  const size = useThree((s) => s.size)
  const lastDiag = useRef(0)

  useLayoutEffect(() => {
    const diag = Math.hypot(dieline.width, dieline.height)
    if (lastDiag.current && Math.abs(diag - lastDiag.current) / lastDiag.current < 0.18) return
    lastDiag.current = diag

    // ฉากถูกจัดกึ่งกลางที่แผงหน้า (root ของ fold tree) ไม่ใช่กึ่งกลางแผ่น
    // จึงต้องวัดจากส่วนของแผ่นที่ยื่นไกลจากจุดเล็งมากที่สุด
    const front = dieline.panels[0]
    const xs = front.outline.map((p) => p.x)
    const ys = front.outline.map((p) => p.y)
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2
    const exX = Math.max(cx, dieline.width - cx)
    const exY = Math.max(cy, dieline.height - cy)

    const persp = camera as THREE.PerspectiveCamera
    const tanV = Math.tan((persp.fov * Math.PI) / 360)
    const aspect = size.width / Math.max(1, size.height)
    const distV = (exY * 1.25) / tanV
    const distH = (exX * 1.25) / (tanV * aspect)
    const dist = Math.max(distV, distH, 320)
    camera.position.set(0.5, 0.42, 1).normalize().multiplyScalar(dist)
    camera.lookAt(0, 0, 0)
    controls?.target?.set(0, 0, 0)
    controls?.update?.()
  }, [dieline, camera, controls, size])

  return null
}

interface PanelMeshProps {
  geometry: THREE.BufferGeometry
  edges: THREE.BufferGeometry
  matrix: THREE.Matrix4
  mat: Material
  tex: THREE.CanvasTexture | null
}

function PanelMesh({ geometry, edges, matrix, mat, tex }: PanelMeshProps) {
  const ref = useRef<THREE.Mesh>(null!)
  const matRef = useRef<THREE.MeshStandardMaterial>(null!)
  useLayoutEffect(() => {
    ref.current.matrixAutoUpdate = false
    ref.current.matrix.copy(matrix)
    ref.current.matrixWorldNeedsUpdate = true
  }, [matrix])

  // three คอมไพล์ shader ตาม define ตอนสร้าง — การสลับ map ระหว่าง null กับ texture
  // เปลี่ยน define ต้องสั่ง needsUpdate ให้ recompile เอง ไม่งั้น texture ที่เพิ่งใส่จะไม่ขึ้น
  // เช็คเฉพาะ "มี/ไม่มี" (boolean) ไม่ใช่ตัว texture — ตอนลากรูปเดิมถูกใช้ซ้ำ ไม่ควร recompile
  const hasTex = !!tex
  useLayoutEffect(() => {
    if (matRef.current) matRef.current.needsUpdate = true
  }, [hasTex])

  return (
    <mesh ref={ref} geometry={geometry}>
      <meshStandardMaterial
        ref={matRef}
        map={tex}
        // texture มีสีวัสดุอยู่ในตัวแล้ว ถ้าคูณสีซ้ำภาพจะมืดลง
        color={tex ? '#ffffff' : mat.color}
        roughness={mat.roughness ?? 0.8}
        metalness={0}
        transparent={mat.opacity !== undefined}
        opacity={mat.opacity ?? 1}
        side={THREE.DoubleSide}
      />
      <lineSegments geometry={edges}>
        <lineBasicMaterial color="#4a4032" transparent opacity={0.3} />
      </lineSegments>
    </mesh>
  )
}

interface ModelProps {
  dieline: Dieline
  mat: Material
  fold: number
  depth: number
  tilt: number
  decos?: Deco[]
}

function FoldedModel({ dieline, mat, fold, depth, tilt, decos }: ModelProps) {
  const tex = useSheetTexture(dieline, mat, decos ?? [])

  const geoms = useMemo(
    () =>
      dieline.panels.map((p) => {
        const shape = new THREE.Shape(p.outline.map((pt) => new THREE.Vector2(pt.x, -pt.y)))
        for (const ring of p.holes ?? []) {
          shape.holes.push(new THREE.Path(ring.map((pt) => new THREE.Vector2(pt.x, -pt.y))))
        }
        const geo = new THREE.ExtrudeGeometry(shape, {
          depth: Math.max(mat.thickness, 0.25),
          bevelEnabled: false,
        })

        // UV ของ ExtrudeGeometry เป็นพิกัดดิบ ไม่ normalize จึงเขียนทับเอง
        // ให้ทุกแผงอ้างระบบพิกัดแผ่นคลี่ร่วมกัน (สูตรอยู่ใน sheetUV ซึ่งมีเทสต์คุมไว้)
        const pos = geo.attributes.position
        const uv = new Float32Array(pos.count * 2)
        for (let i = 0; i < pos.count; i++) {
          const [u, v] = sheetUV(pos.getX(i), pos.getY(i), dieline.width, dieline.height)
          uv[i * 2] = u
          uv[i * 2 + 1] = v
        }
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))

        return { geo, edges: new THREE.EdgesGeometry(geo, 25) }
      }),
    [dieline, mat.thickness],
  )

  useLayoutEffect(
    () => () =>
      geoms.forEach(({ geo, edges }) => {
        geo.dispose()
        edges.dispose()
      }),
    [geoms],
  )

  const matrices = useMemo(() => computeMatrices(dieline.panels, fold), [dieline, fold])

  // จัดกึ่งกลางฉากที่แผงหน้า (root ของ fold tree)
  const front = dieline.panels[0]
  const xs = front.outline.map((p) => p.x)
  const ys = front.outline.map((p) => p.y)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2

  // เอียงโมเดลตามจังหวะพับ (เช่น mailer พับเสร็จแล้วฐานควรอยู่ล่าง)
  return (
    <group rotation={[tilt * fold, 0, 0]}>
      <group position={[-cx, cy, -depth / 2]}>
        {dieline.panels.map((p, i) => (
          <PanelMesh
            key={p.id}
            geometry={geoms[i].geo}
            edges={geoms[i].edges}
            matrix={matrices.get(p.id)!}
            mat={mat}
            tex={tex}
          />
        ))}
      </group>
    </group>
  )
}

export function Viewer3D(props: ModelProps) {
  return (
    <Canvas
      camera={{ position: [280, 220, 340], fov: 36, near: 1, far: 8000 }}
      role="img"
      aria-label="มุมมอง 3 มิติของกล่องที่กำลังพับ"
    >
      <color attach="background" args={['#eeebe3']} />
      <ambientLight intensity={0.9} />
      <directionalLight position={[250, 420, 300]} intensity={1.7} />
      <directionalLight position={[-220, 120, -260]} intensity={0.55} />
      <FoldedModel {...props} />
      <OrbitControls makeDefault enableDamping />
      <FitCamera dieline={props.dieline} />
    </Canvas>
  )
}
