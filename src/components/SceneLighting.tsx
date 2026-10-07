import { useEffect } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { Environment, Lightformer } from '@react-three/drei'

// ชุดไฟ + tone mapping + environment ที่สลับได้ ใช้ร่วมทุก viewer (กล่อง/ภาชนะ/ถุง)
// โหมดปกติ: ACES Filmic (ค่า default ของ R3F) — นุ่มนวลแต่สีจะจืด/ไฮไลต์หม่นลง
// โหมด "แสงสด": NoToneMapping + เพิ่มความสว่าง/แสงฟุ้ง ให้สีอิ่มและสว่างขึ้น (เหมาะพรีวิวสินค้า)
//
// Environment = สตูดิโอจำลองจาก Lightformer (สร้าง cubemap ในหน่วยความจำ ไม่โหลดไฟล์ HDR นอก
// ตามแนว self-host ของโปรเจกต์) — ให้ผิวโลหะ (metalness สูง เช่น ฟอยล์/อะลูมิเนียม) มีอะไรสะท้อน
// จึงดูเงาวับ ไม่ทึบดำ; ผิวกระดาษ (roughness สูง) ได้แค่ fill นุ่ม ๆ ไม่เปลี่ยนมาก
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
      <ambientLight intensity={vivid ? 0.9 : 0.65} />
      {/* แสงฟุ้งจากฟ้า/พื้น เติมเงาให้สว่างนุ่ม ไม่ทึบ */}
      <hemisphereLight args={['#ffffff', '#efeae0', vivid ? 0.55 : 0.22]} />
      <directionalLight position={[250, 420, 300]} intensity={vivid ? 2 : 1.5} />
      <directionalLight position={[-220, 120, -260]} intensity={vivid ? 0.85 : 0.5} />
      {/* สตูดิโอสะท้อนสำหรับผิวโลหะ — เรนเดอร์ครั้งเดียว (ไฟไม่ขยับ) */}
      <Environment resolution={256} frames={1} environmentIntensity={vivid ? 1 : 0.8}>
        {/* ซอฟต์บ็อกซ์บนหัว = ไฮไลต์เส้นยาวบนผิวโลหะ */}
        <Lightformer form="rect" intensity={vivid ? 3.2 : 2.4} position={[0, 6, 1]} scale={[10, 5, 1]} color="#ffffff" />
        {/* แผงข้างซ้าย-ขวา = ขอบสว่างสองด้าน */}
        <Lightformer form="rect" intensity={1.6} position={[-6, 1, 3]} scale={[4, 8, 1]} color="#f4f7fb" />
        <Lightformer form="rect" intensity={1.6} position={[6, 1, 3]} scale={[4, 8, 1]} color="#f4f7fb" />
        {/* วงแหวนด้านหลัง = ประกายโค้งบนทรงกระบอก */}
        <Lightformer form="ring" intensity={1.2} position={[0, 3, -6]} scale={5} color="#eef2f6" />
      </Environment>
    </>
  )
}
