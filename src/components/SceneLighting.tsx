import { useEffect } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'

// ชุดไฟ + tone mapping ที่สลับได้ ใช้ร่วมทุก viewer (กล่อง/ภาชนะ/ถุง)
// โหมดปกติ: ACES Filmic (ค่า default ของ R3F) — นุ่มนวลแต่สีจะจืด/ไฮไลต์หม่นลง
// โหมด "แสงสด": NoToneMapping + เพิ่มความสว่าง/แสงฟุ้ง ให้สีอิ่มและสว่างขึ้น (เหมาะพรีวิวสินค้า)
export function SceneLighting({ vivid }: { vivid: boolean }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)

  // เปลี่ยน tone mapping ต้อง recompile material ที่มีอยู่ (ตัวที่สร้างใหม่ใช้ค่าปัจจุบันเองตอน compile)
  useEffect(() => {
    gl.toneMapping = vivid ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping
    gl.toneMappingExposure = vivid ? 1.05 : 1
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      const m = mesh.material
      if (!m) return
      for (const mm of Array.isArray(m) ? m : [m]) mm.needsUpdate = true
    })
  }, [vivid, gl, scene])

  return (
    <>
      <ambientLight intensity={vivid ? 1.25 : 0.9} />
      {/* แสงฟุ้งจากฟ้า/พื้น เติมเงาให้สว่างนุ่ม ไม่ทึบ */}
      <hemisphereLight args={['#ffffff', '#efeae0', vivid ? 0.7 : 0.25]} />
      <directionalLight position={[250, 420, 300]} intensity={vivid ? 2.3 : 1.7} />
      <directionalLight position={[-220, 120, -260]} intensity={vivid ? 0.95 : 0.55} />
    </>
  )
}
