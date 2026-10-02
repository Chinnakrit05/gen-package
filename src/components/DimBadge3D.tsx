import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { fmtDim } from '../core/units'

export interface Dim3D {
  label: string
  mm: number
}

// ป้ายขนาด กว้าง/ลึก/สูง ที่ลอยติดเหนือโมเดล 3D — ตามหน่วยที่ผู้ใช้เลือก (มม./นิ้ว)
// ยึดตำแหน่งกับ bounding box จริงของโมเดล (วัดทุกเฟรม) จึงเกาะอยู่กับชิ้นงานขณะหมุน/พับ
// ข้อความเป็น HTML (drei <Html>) หันเข้าหากล้องเสมอ อ่านง่ายทุกมุม และใช้ฟอนต์/สไตล์เดียวกับ UI
export function DimBadge3D({
  targetRef,
  dims,
  imperial,
}: {
  targetRef: React.RefObject<THREE.Object3D | null>
  dims: Dim3D[]
  imperial: boolean
}) {
  const groupRef = useRef<THREE.Group>(null)
  const box = useRef(new THREE.Box3())

  useFrame(() => {
    const target = targetRef.current
    const group = groupRef.current
    if (!target || !group) return
    box.current.setFromObject(target)
    const b = box.current
    if (b.isEmpty() || !Number.isFinite(b.max.y)) return
    const cx = (b.min.x + b.max.x) / 2
    const cz = (b.min.z + b.max.z) / 2
    // วางเหนือยอดโมเดลเล็กน้อย (ตามสัดส่วนความสูงจริง) ให้ลอยพ้นชิ้นงาน
    const pad = Math.max(8, (b.max.y - b.min.y) * 0.08)
    group.position.set(cx, b.max.y + pad, cz)
  })

  return (
    <group ref={groupRef}>
      <Html center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }} className="dim3d-badge">
        {dims.map((d) => (
          <div key={d.label} className="dim3d-row">
            <span className="dim3d-k">{d.label}</span>
            <span className="dim3d-v">{fmtDim(d.mm, imperial)}</span>
          </div>
        ))}
      </Html>
    </group>
  )
}
