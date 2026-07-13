import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { Dieline, Material } from '../core/types'
import { computeMatrices } from '../core/fold'

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
}

function PanelMesh({ geometry, edges, matrix, mat }: PanelMeshProps) {
  const ref = useRef<THREE.Mesh>(null!)
  useLayoutEffect(() => {
    ref.current.matrixAutoUpdate = false
    ref.current.matrix.copy(matrix)
    ref.current.matrixWorldNeedsUpdate = true
  }, [matrix])
  return (
    <mesh ref={ref} geometry={geometry}>
      <meshStandardMaterial
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
}

function FoldedModel({ dieline, mat, fold, depth, tilt }: ModelProps) {
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
