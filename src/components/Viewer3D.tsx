import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { safeCanvasEvents } from './safeCanvasEvents'
import type { Dieline, Material } from '../core/types'
import {
  drawFill,
  drawFillImage,
  drawImageFit,
  drawShape2D,
  drawText2D,
  drawNutrition2D,
  drawPath2D,
  elW,
  elH,
  sheetUV,
  type Deco,
  type FillImage,
} from '../core/artwork'
import { computeMatrices, rollBeads } from '../core/fold'
import { assignOuterFaceGroups } from '../core/panelFaces'

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
  if (e.opacity !== undefined && e.opacity < 1) ctx.globalAlpha = e.opacity
  ctx.translate((e.x + w / 2) * s, (e.y + h / 2) * s)
  ctx.rotate((e.rot * Math.PI) / 180)
  // วาดปกติ (ไม่มิเรอร์ฐาน) — โมเดลถูกพลิก scale x=-1 ให้กล้องมองฝั่งพิมพ์/ด้านนอก
  // ตำแหน่งซ้าย-ขวาจึงตรงกับ blueprint พอดี; เหลือแค่การพลิกของผู้ใช้ (flipX/flipY)
  if (e.flipX || e.flipY) ctx.scale(e.flipX ? -1 : 1, e.flipY ? -1 : 1)
  if (e.type === 'image') {
    const img = imgOf(e.src)
    if (img) drawImageFit(ctx, img, e, s)
  } else if (e.type === 'shape') {
    drawShape2D(ctx, e, s)
  } else if (e.type === 'path') {
    drawPath2D(ctx, e, s)
  } else if (e.type === 'nutrition') {
    drawNutrition2D(ctx, e, s)
  } else {
    drawText2D(ctx, e, s)
  }
  ctx.restore()
}

// วาดสีวัสดุ + องค์ประกอบทั้งหมดลงผ้าใบขนาดเท่าแผ่นคลี่ แล้วใช้เป็น texture ผืนเดียวของทุกแผง
// เพราะ UV ของทุกแผงอ้างพิกัดแผ่นคลี่ร่วมกัน (ดู uv ใน FoldedModel) องค์ประกอบจึงพาด
// ข้ามรอยพับได้ถูกต้องเหมือนพิมพ์ลงแผ่นจริงแล้วค่อยพับ
function useSheetTexture(
  dieline: Dieline,
  mat: Material,
  decos: Deco[],
  fillColor: string | null | undefined,
  fillImage: FillImage | null | undefined,
) {
  const [tex, setTex] = useState<THREE.CanvasTexture | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const imgCache = useRef(new Map<string, HTMLImageElement>())
  const [imgReady, setImgReady] = useState(0) // เพิ่มค่าเมื่อมีรูปโหลดเสร็จ เพื่อสั่งวาดใหม่

  // ถอดรหัสรูปแต่ละ src ครั้งเดียว เก็บใน cache — ไม่ decode ซ้ำตอนลาก/หมุน (รวมรูปพื้นด้วย)
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
    // srcKey ครอบคลุมการเปลี่ยนชุด src แล้ว
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcKey])

  // มี hash ของ decos เพื่อวาดใหม่เฉพาะเมื่อค่าที่มีผลต่อภาพเปลี่ยน (ไม่รวม id)
  const decoKey = JSON.stringify(decos)

  useEffect(() => {
    // ไม่มีทั้งลาย สีพื้น และรูปพื้น → ใช้สีวัสดุตรง ๆ ไม่ต้องมี texture
    if (decos.length === 0 && !fillColor && !fillImage) {
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
    // พื้นสีวัสดุก่อน (ช่องว่าง/ขอบ) แล้วทับด้วยสีพื้นแพ็กเกจเฉพาะพื้นที่แผงจริง
    ctx.fillStyle = mat.color
    ctx.fillRect(0, 0, w, h)
    // รูปพื้นมาก่อน (ถ้ามี) ไม่งั้นใช้สีพื้นทึบ — แล้วค่อยลายทับ
    const fimg = fillImage ? imgCache.current.get(fillImage.src) : undefined
    try {
      if (fillImage && fimg) drawFillImage(ctx, dieline, fimg, fillImage, s)
      else if (fillColor) drawFill(ctx, dieline, fillColor, s)
    } catch (err) {
      console.warn('วาดพื้นแพ็กเกจลง texture ไม่สำเร็จ', err)
    }
    // วาดทีละชิ้นแบบกันพลาด — ชิ้นที่วาดไม่ได้ (เช่นค่ารัศมี/ขนาดผิดปกติทำให้ canvas โยน error)
    // ต้องไม่ทำให้ทั้ง texture หลุด (ไม่งั้น map เป็น null → กล่อง/การ์ดโชว์สีวัสดุล้วนไม่มีลาย)
    for (const e of decos) {
      if (e.hidden) continue
      try {
        drawDeco(ctx, e, s, (src) => imgCache.current.get(src))
      } catch (err) {
        console.warn('วาดองค์ประกอบลง texture ไม่สำเร็จ (ข้ามชิ้นนี้)', e.type, err)
      }
    }

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
  }, [decoKey, imgReady, fillColor, fillImage, mat.color, dieline.width, dieline.height])

  // คืนหน่วยความจำเมื่อ viewer ถูกถอด
  useEffect(() => () => tex?.dispose(), [tex])

  return tex
}

// นามบัตรถูก gen เป็นแผ่นคลี่สองหน้า (card + card-back เรียงข้างกันสำหรับ blueprint)
// แต่ใน 3D ต้องเป็นการ์ด "ใบเดียว" หมุนดูหน้า-หลังได้ จึงเรนเดอร์แยกเส้นทาง (CardModel)
function isCardDieline(dieline: Dieline): boolean {
  return (
    dieline.panels.length === 2 &&
    dieline.panels[0].id === 'card' &&
    dieline.panels[1].id === 'card-back'
  )
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
    // นามบัตร: 3D เป็นการ์ดใบเดียวจัดกึ่งกลางที่ origin จึงเล็งจากครึ่งหนึ่งของขนาดหน้าเดียว
    // (ไม่ใช่ทั้งแผ่นสองหน้า ไม่งั้นกล้องถอยไกลเกินไปเพราะแผ่นกว้างเป็นสองเท่า)
    const card = isCardDieline(dieline)
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2
    const exX = card ? (Math.max(...xs) - Math.min(...xs)) / 2 : Math.max(cx, dieline.width - cx)
    const exY = card ? (Math.max(...ys) - Math.min(...ys)) / 2 : Math.max(cy, dieline.height - cy)

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

// สันโค้งของรอยพับม้วน 180° — ทรงกระบอกบางตามแนวเส้นพับ อุดร่องสองชั้นให้ดูเป็นสันจริง
// แทนขอบมีดคม (ตำแหน่ง/รัศมีมาจาก rollBeads ซึ่งคุมด้วยเทสต์เชิงตัวเลข)
const UP = new THREE.Vector3(0, 1, 0)
function Bead({ a, b, r, mat }: { a: THREE.Vector3; b: THREE.Vector3; r: number; mat: Material }) {
  const dir = b.clone().sub(a)
  const len = dir.length()
  const mid = a.clone().add(b).multiplyScalar(0.5)
  const quat = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize())
  return (
    <mesh position={mid} quaternion={quat}>
      <cylinderGeometry args={[r, r, len, 14, 1]} />
      <meshStandardMaterial color={mat.color} roughness={mat.roughness ?? 0.8} metalness={0} />
    </mesh>
  )
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
      {/* material 0 = ฝาด้านนอก มีลายพิมพ์ (จาก texture แผ่นคลี่) */}
      <meshStandardMaterial
        ref={matRef}
        attach="material-0"
        map={tex}
        // texture มีสีวัสดุอยู่ในตัวแล้ว ถ้าคูณสีซ้ำภาพจะมืดลง
        color={tex ? '#ffffff' : mat.color}
        roughness={mat.roughness ?? 0.8}
        metalness={0}
        transparent={mat.opacity !== undefined}
        opacity={mat.opacity ?? 1}
        side={THREE.DoubleSide}
      />
      {/* material 1 = ฝาด้านใน + ผนัง สีวัสดุล้วน ไม่พิมพ์ลาย */}
      <meshStandardMaterial
        attach="material-1"
        color={mat.color}
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
  fillColor?: string | null
  fillImage?: FillImage | null
}

function FoldedModel({ dieline, mat, fold, depth, tilt, decos, fillColor, fillImage }: ModelProps) {
  const tex = useSheetTexture(dieline, mat, decos ?? [], fillColor, fillImage)

  const geoms = useMemo(
    () =>
      dieline.panels.map((p) => {
        const shape = new THREE.Shape(p.outline.map((pt) => new THREE.Vector2(pt.x, -pt.y)))
        for (const ring of p.holes ?? []) {
          shape.holes.push(new THREE.Path(ring.map((pt) => new THREE.Vector2(pt.x, -pt.y))))
        }
        const d = Math.max(mat.thickness, 0.25)
        const geo = new THREE.ExtrudeGeometry(shape, {
          depth: d,
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

        // แยก group เพื่อพิมพ์ลายเฉพาะฝา "ด้านนอก" (สีวัสดุล้วนด้านใน) — ตรรกะเทสต์ใน panelFaces.test.ts
        assignOuterFaceGroups(geo, d)

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
  // สันโค้งของรอยพับม้วน 180° (FEFCO 0427) — คำนวณจาก matrices จึงขยับตามการพับ
  const beads = useMemo(() => rollBeads(dieline.panels, matrices), [dieline, matrices])

  // จัดกึ่งกลางฉากที่แผงหน้า (root ของ fold tree)
  const front = dieline.panels[0]
  const xs = front.outline.map((p) => p.x)
  const ys = front.outline.map((p) => p.y)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2

  // เอียงโมเดลตามจังหวะพับ (เช่น mailer พับเสร็จแล้วฐานควรอยู่ล่าง)
  // scale x=-1: พลิกให้กล้องมอง "ฝั่งพิมพ์/ด้านนอก" ตำแหน่งลาย ซ้าย-ขวา จึงตรงกับ blueprint
  return (
    <group scale={[-1, 1, 1]} rotation={[tilt * fold, 0, 0]}>
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
        {beads.map((bd) => (
          <Bead key={bd.id} a={bd.a} b={bd.b} r={bd.r} mat={mat} />
        ))}
      </group>
    </group>
  )
}

// นามบัตรใน 3D = การ์ดใบเดียว (แผ่นบาง) พิมพ์ลายหน้าที่ +Z และลายหลังที่ -Z
// ลายมาจาก texture แผ่นคลี่ผืนเดียวกับ blueprint (หน้าอยู่ช่วง x ซ้าย, หลังอยู่ช่วง x ขวา)
// จึงคำนวณ UV ของแต่ละหน้าให้ชี้ไปช่วง x ของหน้านั้น ๆ — หลังกลับ (หมุนรอบแกน Y) ให้อ่านถูกด้าน
function CardModel({ dieline, mat, decos, fillColor, fillImage }: ModelProps) {
  const tex = useSheetTexture(dieline, mat, decos ?? [], fillColor, fillImage)
  const front = dieline.panels[0]
  const back = dieline.panels[1]
  const fxs = front.outline.map((p) => p.x)
  const ys = front.outline.map((p) => p.y)
  const bxs = back.outline.map((p) => p.x)
  const w = Math.max(...fxs) - Math.min(...fxs)
  const h = Math.max(...ys) - Math.min(...ys)
  const fx0 = Math.min(...fxs)
  const bx0 = Math.min(...bxs)
  const t = Math.max(mat.thickness, 0.3)
  const W = dieline.width
  const H = dieline.height

  // สร้างระนาบสองหน้าพร้อม UV ที่ชี้ไปช่วง x ของหน้านั้นบน texture แผ่นคลี่
  const { frontGeo, backGeo } = useMemo(() => {
    const mk = (x0: number) => {
      const g = new THREE.PlaneGeometry(w, h)
      const pos = g.attributes.position
      const uv = new Float32Array(pos.count * 2)
      for (let i = 0; i < pos.count; i++) {
        const sheetX = x0 + (pos.getX(i) + w / 2) // local x (-w/2..w/2) → x ของหน้าบนแผ่น
        const sheetY = h / 2 - pos.getY(i) // local y → y ของแผ่น (y ชี้ลง)
        uv[i * 2] = sheetX / W
        uv[i * 2 + 1] = 1 - sheetY / H
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
      return g
    }
    return { frontGeo: mk(fx0), backGeo: mk(bx0) }
  }, [w, h, fx0, bx0, W, H])

  useLayoutEffect(
    () => () => {
      frontGeo.dispose()
      backGeo.dispose()
    },
    [frontGeo, backGeo],
  )

  const eps = 0.05
  const rough = mat.roughness ?? 0.8

  // three คอมไพล์ shader ตาม define ตอนสร้าง — ถ้า material ถูกสร้างตอน tex ยังเป็น null
  // (การ์ดขึ้นจอก่อน texture วาดเสร็จ) แล้ว tex มาทีหลัง map จะไม่ขึ้นจนกว่าจะ needsUpdate
  // (เหมือน PanelMesh) — ไม่งั้นการ์ดค้างเป็นสีวัสดุล้วนไม่มีลาย
  const frontMat = useRef<THREE.MeshStandardMaterial>(null!)
  const backMat = useRef<THREE.MeshStandardMaterial>(null!)
  const hasTex = !!tex
  useLayoutEffect(() => {
    if (frontMat.current) frontMat.current.needsUpdate = true
    if (backMat.current) backMat.current.needsUpdate = true
  }, [hasTex])

  return (
    <group>
      {/* ตัวการ์ด: ความหนา + ขอบกระดาษ สีวัสดุล้วน */}
      <mesh>
        <boxGeometry args={[w, h, t]} />
        <meshStandardMaterial color={mat.color} roughness={rough} metalness={0} />
      </mesh>
      {/* ด้านหน้า (+Z) */}
      <mesh geometry={frontGeo} position={[0, 0, t / 2 + eps]}>
        <meshStandardMaterial ref={frontMat} map={tex} color={tex ? '#ffffff' : mat.color} roughness={rough} metalness={0} />
      </mesh>
      {/* ด้านหลัง (-Z) — หมุน 180° รอบแกน Y ให้ลายอ่านถูกด้านเมื่อพลิกการ์ด */}
      <mesh geometry={backGeo} position={[0, 0, -t / 2 - eps]} rotation={[0, Math.PI, 0]}>
        <meshStandardMaterial ref={backMat} map={tex} color={tex ? '#ffffff' : mat.color} roughness={rough} metalness={0} />
      </mesh>
    </group>
  )
}

export function Viewer3D(props: ModelProps) {
  const card = isCardDieline(props.dieline)
  return (
    <Canvas
      events={safeCanvasEvents}
      camera={{ position: [280, 220, 340], fov: 36, near: 1, far: 8000 }}
      role="img"
      aria-label={card ? 'มุมมอง 3 มิติของนามบัตร (หมุนดูหน้า-หลังได้)' : 'มุมมอง 3 มิติของกล่องที่กำลังพับ'}
    >
      <color attach="background" args={['#ffffff']} />
      <ambientLight intensity={0.9} />
      <directionalLight position={[250, 420, 300]} intensity={1.7} />
      <directionalLight position={[-220, 120, -260]} intensity={0.55} />
      {card ? <CardModel {...props} /> : <FoldedModel {...props} />}
      <OrbitControls makeDefault enableDamping />
      <FitCamera dieline={props.dieline} />
    </Canvas>
  )
}
