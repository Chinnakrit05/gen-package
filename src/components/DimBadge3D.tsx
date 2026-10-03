import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { fmtDim } from '../core/units'

export interface Dim3D {
  label: string
  mm: number
}

// สีเส้น/ตัวอักษรบอกขนาด — เข้มพออ่านบนพื้นขาวของฉาก 3D (ฉากตั้งพื้นขาวเสมอ)
const LINE_COLOR = '#5a696c'

// ป้ายขนาด กว้าง/ลึก/สูง บนมุมมอง 3D ตามหน่วยที่เลือก (มม./นิ้ว)
// variant 'lines' = เส้นบอกขนาดพาดตามขอบจริงของโมเดล (เส้นต่อ + หัวลูกศร + ตัวเลข) แบบ CAD
// variant 'badge' = ป้ายรวมลอยเหนือโมเดล (ใช้กับภาชนะที่ขนาด D = ⌀ปาก ไม่ใช่ความกว้างแกน)
// ทั้งคู่ยึดกับ bounding box จริง (วัดทุกเฟรม) จึงเกาะอยู่กับชิ้นงานขณะพับ/หมุน
export function DimBadge3D({
  targetRef,
  dims,
  imperial,
  variant = 'lines',
}: {
  targetRef: React.RefObject<THREE.Object3D | null>
  dims: Dim3D[]
  imperial: boolean
  variant?: 'lines' | 'badge'
}) {
  if (variant === 'badge') return <DimCard targetRef={targetRef} dims={dims} imperial={imperial} />
  return <DimLines targetRef={targetRef} dims={dims} imperial={imperial} />
}

// ---- เส้นบอกขนาด (CAD) ----
function DimLines({
  targetRef,
  dims,
  imperial,
}: {
  targetRef: React.RefObject<THREE.Object3D | null>
  dims: Dim3D[]
  imperial: boolean
}) {
  const geoRef = useRef<THREE.BufferGeometry>(null)
  // 3 แกน × สูงสุด 7 เส้น (ต่อ 2 + เส้นวัด 1 + หัวลูกศร 4) × 2 จุด × 3 พิกัด
  const posAttr = useMemo(() => new THREE.BufferAttribute(new Float32Array(3 * 7 * 2 * 3), 3), [])
  const g0 = useRef<THREE.Group>(null)
  const g1 = useRef<THREE.Group>(null)
  const g2 = useRef<THREE.Group>(null)
  const e0 = useRef<HTMLDivElement>(null)
  const e1 = useRef<HTMLDivElement>(null)
  const e2 = useRef<HTMLDivElement>(null)
  const labelGroups = [g0, g1, g2]
  const labelEls = [e0, e1, e2]
  const box = useRef(new THREE.Box3())

  useFrame(() => {
    const target = targetRef.current
    const geo = geoRef.current
    if (!target || !geo) return
    box.current.makeEmpty()
    box.current.setFromObject(target)
    const b = box.current
    if (b.isEmpty() || !Number.isFinite(b.min.x)) return
    const { min, max } = b
    const sx = max.x - min.x
    const sy = max.y - min.y
    const sz = max.z - min.z
    const span = [sx, sy, sz]
    const biggest = Math.max(sx, sy, sz)
    const off = Math.max(10, biggest * 0.13) // ระยะยื่นของเส้นวัดออกจากขอบ
    const arr = Math.max(4, biggest * 0.03) // ความยาวหัวลูกศร

    // จับคู่ขนาดที่ตั้งไว้ (W/D/H) เข้ากับแกนของกล่องตามความใกล้เคียงของช่วง
    // (ตัวใหญ่จับก่อน) — ทำให้ป้ายถูกแกนแม้ template เอียงสลับแกน y↔z
    const used = [false, false, false]
    const axisDim = [-1, -1, -1]
    const order = dims.map((_, i) => i).sort((a, c) => dims[c].mm - dims[a].mm)
    for (const di of order) {
      let bestAxis = -1
      let bestErr = Infinity
      for (let a = 0; a < 3; a++) {
        if (used[a]) continue
        const err = Math.abs(span[a] - dims[di].mm)
        if (err < bestErr) {
          bestErr = err
          bestAxis = a
        }
      }
      if (bestAxis >= 0) {
        used[bestAxis] = true
        axisDim[bestAxis] = di
      }
    }

    // ขอบที่ใช้วางเส้นวัดของแต่ละแกน + ทิศยื่นออก (offv) ให้เส้นอยู่นอกรูปทรง
    // x = ขอบหน้า-ล่าง (ยื่นลง), y = ขอบหน้า-ซ้าย (ยื่นซ้าย), z = ขอบซ้าย-ล่าง (ยื่นซ้าย)
    const edges = [
      { p0: [min.x, min.y, max.z], dir: [1, 0, 0], len: sx, offv: [0, -1, 0] },
      { p0: [min.x, min.y, max.z], dir: [0, 1, 0], len: sy, offv: [-1, 0, 0] },
      { p0: [min.x, min.y, min.z], dir: [0, 0, 1], len: sz, offv: [-1, 0, 0] },
    ]

    const data = posAttr.array as Float32Array
    let s = 0
    const seg = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
      const o = s * 6
      data[o] = ax; data[o + 1] = ay; data[o + 2] = az
      data[o + 3] = bx; data[o + 4] = by; data[o + 5] = bz
      s++
    }

    for (let a = 0; a < 3; a++) {
      const di = axisDim[a]
      const lg = labelGroups[a].current
      const le = labelEls[a].current
      if (di < 0) {
        if (lg) lg.visible = false
        continue
      }
      const e = edges[a]
      const dx = e.dir[0], dy = e.dir[1], dz = e.dir[2]
      const ox = e.offv[0] * off, oy = e.offv[1] * off, oz = e.offv[2] * off
      // จุดปลายขอบจริง
      const P0x = e.p0[0], P0y = e.p0[1], P0z = e.p0[2]
      const P1x = P0x + dx * e.len, P1y = P0y + dy * e.len, P1z = P0z + dz * e.len
      // จุดบนเส้นวัด (ขยับออกตาม offv)
      const E0x = P0x + ox, E0y = P0y + oy, E0z = P0z + oz
      const E1x = P1x + ox, E1y = P1y + oy, E1z = P1z + oz
      // เส้นต่อจากขอบไปเส้นวัด
      seg(P0x, P0y, P0z, E0x, E0y, E0z)
      seg(P1x, P1y, P1z, E1x, E1y, E1z)
      // เส้นวัดหลัก
      seg(E0x, E0y, E0z, E1x, E1y, E1z)
      // หัวลูกศรสองปลาย (ใช้ทิศ offv เป็นแกนตั้งฉากระนาบ)
      const px = e.offv[0], py = e.offv[1], pz = e.offv[2]
      seg(E0x, E0y, E0z, E0x + dx * arr + px * arr * 0.6, E0y + dy * arr + py * arr * 0.6, E0z + dz * arr + pz * arr * 0.6)
      seg(E0x, E0y, E0z, E0x + dx * arr - px * arr * 0.6, E0y + dy * arr - py * arr * 0.6, E0z + dz * arr - pz * arr * 0.6)
      seg(E1x, E1y, E1z, E1x - dx * arr + px * arr * 0.6, E1y - dy * arr + py * arr * 0.6, E1z - dz * arr + pz * arr * 0.6)
      seg(E1x, E1y, E1z, E1x - dx * arr - px * arr * 0.6, E1y - dy * arr - py * arr * 0.6, E1z - dz * arr - pz * arr * 0.6)
      // ป้ายตัวเลขกึ่งกลางเส้นวัด ขยับออกอีกนิด
      if (lg) {
        lg.visible = true
        lg.position.set(
          (E0x + E1x) / 2 + e.offv[0] * off * 0.22,
          (E0y + E1y) / 2 + e.offv[1] * off * 0.22,
          (E0z + E1z) / 2 + e.offv[2] * off * 0.22,
        )
      }
      if (le) le.textContent = `${dims[di].label} ${fmtDim(dims[di].mm, imperial)}`
    }

    geo.setDrawRange(0, s * 2)
    posAttr.needsUpdate = true
  })

  return (
    <group>
      <lineSegments renderOrder={999} frustumCulled={false}>
        <bufferGeometry ref={geoRef}>
          <primitive object={posAttr} attach="attributes-position" />
        </bufferGeometry>
        <lineBasicMaterial color={LINE_COLOR} depthTest={false} transparent toneMapped={false} />
      </lineSegments>
      {labelGroups.map((gr, i) => (
        <group key={i} ref={gr}>
          <Html center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
            <div ref={labelEls[i]} className="dim3d-label" />
          </Html>
        </group>
      ))}
    </group>
  )
}

// ---- ป้ายรวมลอยเหนือโมเดล (ภาชนะ) ----
function DimCard({
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
    box.current.makeEmpty()
    box.current.setFromObject(target)
    const b = box.current
    if (b.isEmpty() || !Number.isFinite(b.max.y)) return
    const cx = (b.min.x + b.max.x) / 2
    const cz = (b.min.z + b.max.z) / 2
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
