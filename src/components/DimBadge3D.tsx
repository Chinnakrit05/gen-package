import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { fmtDim } from '../core/units'

export interface Dim3D {
  label: string
  mm: number
}

// สีเส้นบอกขนาด — เข้มพออ่านบนพื้นขาวของฉาก 3D (ฉากตั้งพื้นขาวเสมอ)
const LINE_COLOR = '#5a696c'

type Vec3 = [number, number, number]
// เส้นวัดหนึ่งเส้น: ขอบจริง p0→p1 + ทิศ/ระยะยื่นออก off (เวกเตอร์เต็มรวมความยาวแล้ว) + ข้อความ
interface Measure {
  p0: Vec3
  p1: Vec3
  off: Vec3
  label: string
}

// ป้ายขนาด กว้าง/ลึก/สูง บนมุมมอง 3D ตามหน่วยที่เลือก (มม./นิ้ว) — ยึดกับ bounding box จริง
// variant 'lines'  = กล่อง/ถุง: จับขนาดเข้าแกนตามช่วง แล้ววาดเส้นตามขอบจริงทั้ง 3 แกน
// variant 'vessel' = ขวด/โหล: ตัวกว้างที่ฐาน + สูงด้านซ้าย + ปากแคบที่ยอด (ยาวเท่า ⌀ จริง)
// variant 'tube'   = หลอดครีม: กลับหัวจากขวด — ตัวกว้างที่ยอด (ตะเข็บซีล) + ปาก/ฝาแคบที่ฐาน
// variant 'badge'  = ป้ายรวมลอย (สำรองไว้)
export function DimBadge3D({
  targetRef,
  dims,
  imperial,
  variant = 'lines',
}: {
  targetRef: React.RefObject<THREE.Object3D | null>
  dims: Dim3D[]
  imperial: boolean
  variant?: 'lines' | 'vessel' | 'tube' | 'badge'
}) {
  if (variant === 'badge') return <DimCard targetRef={targetRef} dims={dims} imperial={imperial} />
  const build = variant === 'vessel' ? buildVessel : variant === 'tube' ? buildTube : buildAuto
  return <DimLines targetRef={targetRef} dims={dims} imperial={imperial} build={build} />
}

// จับคู่ขนาด (W/D/H) เข้ากับแกนของทรงตามช่วงที่ใกล้ที่สุด แล้ววาดตามขอบจริง (กล่อง/ถุง)
// x = ขอบหน้า-ล่าง (ยื่นลง), y = ขอบหน้า-ซ้าย (ยื่นซ้าย), z = ขอบซ้าย-ล่าง (ยื่นซ้าย)
function buildAuto(b: THREE.Box3, dims: Dim3D[], imperial: boolean): Measure[] {
  const { min, max } = b
  const span = [max.x - min.x, max.y - min.y, max.z - min.z]
  const off = Math.max(10, Math.max(span[0], span[1], span[2]) * 0.13)
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
  const edges: { p0: Vec3; dir: Vec3; len: number; offv: Vec3 }[] = [
    { p0: [min.x, min.y, max.z], dir: [1, 0, 0], len: span[0], offv: [0, -1, 0] },
    { p0: [min.x, min.y, max.z], dir: [0, 1, 0], len: span[1], offv: [-1, 0, 0] },
    { p0: [min.x, min.y, min.z], dir: [0, 0, 1], len: span[2], offv: [-1, 0, 0] },
  ]
  const out: Measure[] = []
  for (let a = 0; a < 3; a++) {
    const di = axisDim[a]
    if (di < 0) continue
    const e = edges[a]
    out.push({
      p0: e.p0,
      p1: [e.p0[0] + e.dir[0] * e.len, e.p0[1] + e.dir[1] * e.len, e.p0[2] + e.dir[2] * e.len],
      off: [e.offv[0] * off, e.offv[1] * off, e.offv[2] * off],
      label: `${dims[di].label} ${fmtDim(dims[di].mm, imperial)}`,
    })
  }
  return out
}

// ภาชนะ/หลอด (ทรงหมุน): ⌀ตัว = เส้นนอนที่ฐาน (เต็มความกว้าง), สูง = เส้นตั้งด้านซ้าย,
// ⌀ปาก = เส้นนอนสั้น ๆ ที่ยอด ยาวเท่าค่า ⌀ปากจริง (ไม่ใช่เต็มลำตัว) จัดกึ่งกลาง
// dims เรียง [⌀ตัว(W), ⌀ปาก(D), สูง(H)] ตามที่ App ส่งมา
function buildVessel(b: THREE.Box3, dims: Dim3D[], imperial: boolean): Measure[] {
  const { min, max } = b
  const span = [max.x - min.x, max.y - min.y, max.z - min.z]
  const off = Math.max(10, Math.max(span[0], span[1], span[2]) * 0.13)
  const cx = (min.x + max.x) / 2
  const mouth = dims[1] ? dims[1].mm : span[0]
  const out: Measure[] = []
  // ⌀ตัว — ขอบฐานด้านหน้า เต็มความกว้าง ยื่นลง
  out.push({
    p0: [min.x, min.y, max.z],
    p1: [max.x, min.y, max.z],
    off: [0, -off, 0],
    label: `${dims[0].label} ${fmtDim(dims[0].mm, imperial)}`,
  })
  // สูง — ขอบซ้ายด้านหน้า เต็มความสูง ยื่นซ้าย
  if (dims[2]) {
    out.push({
      p0: [min.x, min.y, max.z],
      p1: [min.x, max.y, max.z],
      off: [-off, 0, 0],
      label: `${dims[2].label} ${fmtDim(dims[2].mm, imperial)}`,
    })
  }
  // ⌀ปาก — เส้นนอนสั้นที่ยอด ยาวเท่า ⌀ปากจริง จัดกึ่งกลาง ยื่นขึ้น
  if (dims[1]) {
    out.push({
      p0: [cx - mouth / 2, max.y, max.z],
      p1: [cx + mouth / 2, max.y, max.z],
      off: [0, off, 0],
      label: `${dims[1].label} ${fmtDim(dims[1].mm, imperial)}`,
    })
  }
  return out
}

// หลอดครีม: กลับหัวจากขวด — ตัวหลอด (กว้างสุด) คือตะเข็บซีลที่ยอด, ปาก/ฝาอยู่ที่ฐาน
// ⌀ตัว = เส้นนอนเต็มกว้างที่ "ยอด", ⌀ปาก = เส้นนอนสั้นที่ "ฐาน" ยาวเท่า ⌀ปากจริง, สูง = ด้านซ้าย
function buildTube(b: THREE.Box3, dims: Dim3D[], imperial: boolean): Measure[] {
  const { min, max } = b
  const span = [max.x - min.x, max.y - min.y, max.z - min.z]
  const off = Math.max(10, Math.max(span[0], span[1], span[2]) * 0.13)
  const cx = (min.x + max.x) / 2
  const mouth = dims[1] ? dims[1].mm : span[0]
  const out: Measure[] = []
  // ⌀ตัว — ขอบบนด้านหน้า เต็มความกว้าง ยื่นขึ้น
  out.push({
    p0: [min.x, max.y, max.z],
    p1: [max.x, max.y, max.z],
    off: [0, off, 0],
    label: `${dims[0].label} ${fmtDim(dims[0].mm, imperial)}`,
  })
  // สูง — ขอบซ้ายด้านหน้า เต็มความสูง ยื่นซ้าย
  if (dims[2]) {
    out.push({
      p0: [min.x, min.y, max.z],
      p1: [min.x, max.y, max.z],
      off: [-off, 0, 0],
      label: `${dims[2].label} ${fmtDim(dims[2].mm, imperial)}`,
    })
  }
  // ⌀ปาก — เส้นนอนสั้นที่ฐาน (ฝา/คอ) ยาวเท่า ⌀ปากจริง จัดกึ่งกลาง ยื่นลง
  if (dims[1]) {
    out.push({
      p0: [cx - mouth / 2, min.y, max.z],
      p1: [cx + mouth / 2, min.y, max.z],
      off: [0, -off, 0],
      label: `${dims[1].label} ${fmtDim(dims[1].mm, imperial)}`,
    })
  }
  return out
}

// ---- วาดเส้นบอกขนาด (CAD) จากรายการ Measure ----
function DimLines({
  targetRef,
  dims,
  imperial,
  build,
}: {
  targetRef: React.RefObject<THREE.Object3D | null>
  dims: Dim3D[]
  imperial: boolean
  build: (b: THREE.Box3, dims: Dim3D[], imperial: boolean) => Measure[]
}) {
  const geoRef = useRef<THREE.BufferGeometry>(null)
  // 3 เส้น × 7 ช่วง (ต่อ 2 + เส้นวัด 1 + หัวลูกศร 4) × 2 จุด × 3 พิกัด
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
    const biggest = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z)
    const arr = Math.max(4, biggest * 0.03) // ความยาวหัวลูกศร
    const measures = build(b, dims, imperial)

    const data = posAttr.array as Float32Array
    let s = 0
    const seg = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
      const o = s * 6
      data[o] = ax; data[o + 1] = ay; data[o + 2] = az
      data[o + 3] = bx; data[o + 4] = by; data[o + 5] = bz
      s++
    }

    for (let i = 0; i < 3; i++) {
      const lg = labelGroups[i].current
      const le = labelEls[i].current
      const m = measures[i]
      if (!m) {
        if (lg) lg.visible = false
        continue
      }
      const [ax, ay, az] = m.p0
      const [bx, by, bz] = m.p1
      const [ox, oy, oz] = m.off
      // ทิศของขอบ (หน่วย)
      let dx = bx - ax, dy = by - ay, dz = bz - az
      const dl = Math.hypot(dx, dy, dz) || 1
      dx /= dl; dy /= dl; dz /= dl
      // ทิศยื่นออก (หน่วย) ใช้เป็นแกนของหัวลูกศร/ตำแหน่งป้าย
      let px = ox, py = oy, pz = oz
      const ol = Math.hypot(px, py, pz) || 1
      px /= ol; py /= ol; pz /= ol
      // จุดบนเส้นวัด
      const E0x = ax + ox, E0y = ay + oy, E0z = az + oz
      const E1x = bx + ox, E1y = by + oy, E1z = bz + oz
      // เส้นต่อจากขอบไปเส้นวัด + เส้นวัดหลัก
      seg(ax, ay, az, E0x, E0y, E0z)
      seg(bx, by, bz, E1x, E1y, E1z)
      seg(E0x, E0y, E0z, E1x, E1y, E1z)
      // หัวลูกศรสองปลาย
      seg(E0x, E0y, E0z, E0x + dx * arr + px * arr * 0.6, E0y + dy * arr + py * arr * 0.6, E0z + dz * arr + pz * arr * 0.6)
      seg(E0x, E0y, E0z, E0x + dx * arr - px * arr * 0.6, E0y + dy * arr - py * arr * 0.6, E0z + dz * arr - pz * arr * 0.6)
      seg(E1x, E1y, E1z, E1x - dx * arr + px * arr * 0.6, E1y - dy * arr + py * arr * 0.6, E1z - dz * arr + pz * arr * 0.6)
      seg(E1x, E1y, E1z, E1x - dx * arr - px * arr * 0.6, E1y - dy * arr - py * arr * 0.6, E1z - dz * arr - pz * arr * 0.6)
      // ป้ายตัวเลขกึ่งกลางเส้นวัด ขยับออกตามทิศยื่นอีกนิด
      if (lg) {
        lg.visible = true
        lg.position.set(
          (E0x + E1x) / 2 + px * arr * 1.6,
          (E0y + E1y) / 2 + py * arr * 1.6,
          (E0z + E1z) / 2 + pz * arr * 1.6,
        )
      }
      if (le) le.textContent = m.label
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

// ---- ป้ายรวมลอยเหนือโมเดล (สำรอง) ----
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
