import { memo, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer } from '@react-three/drei'

// โหมดแสงของมุมมอง 3D (ใช้ร่วมทุก viewer: กล่อง/ภาชนะ/ถุง)
// 'soft'       = ปิดแสงสด: ACES Filmic (ค่า default ของ R3F) นุ่มนวลแต่สีจืด/ไฮไลต์หม่น
// 'studio'     = แสงสดแบบสตูดิโอ: Neutral tone mapping + แสงฟุ้งรอบด้าน เงาน้อย — เช็กลาย/สีได้ทุกด้าน
// 'threePoint' = แสงสดแบบ 3 จุด: key (หน้าเฉียงซ้ายบน) + fill (อ่อน ขวา) + rim (ตรงหลัง ส่องขอบบน)
//                ได้มิติ/ขอบแยกจากพื้นขาวชัด แบบภาพโฆษณาสินค้า แต่ด้านเงาจะมืดกว่า
export type LightMode = 'soft' | 'studio' | 'threePoint'

// ไฟทิศทาง (key/fill/rim) ยึดกับ "มุมมองคนดู" ไม่ใช่กับโลกของฉาก: หมุนโมเดลไปด้านไหน ด้านที่หันหากล้อง
// ได้แสงแบบเดียวกับด้านหน้าตอนเริ่ม (เหมือนไฟสตูดิโอที่ตั้งติดกล้อง) — ตำแหน่งไฟด้านล่างเขียนไว้สำหรับ
// มุมกล้องเริ่มต้น (ทิศเดียวกับ FitCamera ของกล่อง) แล้วแต่ละเฟรมหมุนทั้งชุดตามที่กล้องโคจรไปจากมุมนั้น
const REF_VIEW_INV = new THREE.Quaternion()
  .setFromRotationMatrix(
    new THREE.Matrix4().lookAt(new THREE.Vector3(0.5, 0.42, 1), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)),
  )
  .invert()

// Environment = สตูดิโอจำลองจาก Lightformer (cubemap ในหน่วยความจำ ไม่โหลดไฟล์ HDR นอก
// ตามแนว self-host ของโปรเจกต์) — ให้ผิวโลหะ (ฟอยล์/อะลูมิเนียม) มีอะไรสะท้อนจึงดูเงา
export function SceneLighting({ mode }: { mode: LightMode }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const rig = useRef<THREE.Group>(null)
  const vivid = mode !== 'soft'
  const threePoint = mode === 'threePoint'

  // tone mapping ต่อโหมด: ปิดแสงสด = ACES (ค่า default ของ R3F); แสงสด = Neutral (Khronos PBR Neutral —
  // คงสีพื้นตรงและอิ่ม ไม่เพี้ยนเฉดแบบ ACES) + exposure ดันให้สว่าง; NoToneMapping ใช้ไม่ได้เพราะไม่รับ exposure
  // เลยมืดกว่าเดิม. tone mapping ถูก "อบ" ลง shader ตอน compile — ตั้งครั้งเดียวใน effect ไม่พอ (ตรวจแล้วเจอ
  // material ที่ compile ค้างเป็น ACES ทั้งที่ renderer ตั้ง Neutral) จึงบังคับทุกเฟรม: ตั้ง renderer ให้ตรง
  // และสั่ง recompile เฉพาะ material ที่ค่าที่ compile ไว้ไม่ตรง (exposure เป็น uniform ไม่ต้อง recompile)
  const toneMapping = vivid ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping
  const exposure = threePoint ? 1.3 : vivid ? 1.5 : 1
  useFrame(() => {
    // ชุดไฟหมุนตามกล้อง: q = (การหมุนของกล้องตอนนี้) × (มุมเริ่มต้น)⁻¹ — ที่มุมเริ่มต้น q = ไม่หมุน
    // (แสงตรงกับค่าที่จูนไว้ทุกอย่าง) และ environment (แสงสะท้อนบนโลหะ) หมุนตามเพื่อให้ไฮไลต์ไม่ค้างที่เดิม
    if (rig.current) {
      rig.current.quaternion.copy(camera.quaternion).multiply(REF_VIEW_INV)
      scene.environmentRotation.setFromQuaternion(rig.current.quaternion)
    }
    if (gl.toneMapping !== toneMapping) gl.toneMapping = toneMapping
    if (gl.toneMappingExposure !== exposure) gl.toneMappingExposure = exposure
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material
      if (!m) return
      for (const mm of Array.isArray(m) ? m : [m]) {
        const compiled = (gl.properties.get(mm) as { toneMapping?: number }).toneMapping
        const want = mm.toneMapped ? toneMapping : THREE.NoToneMapping
        if (compiled !== undefined && compiled !== want) mm.needsUpdate = true
      }
    })
  })

  // ความแรงของ environment ต่อโหมด — ตั้งที่ scene เองแทน prop ของ <Environment> (ดู StudioEnv)
  const envIntensity = threePoint ? 0.35 : vivid ? 1 : 0.6
  useEffect(() => {
    scene.environmentIntensity = envIntensity
  }, [scene, envIntensity])

  return (
    <>
      {threePoint ? (
        <>
          {/* แสงรอบข้างต่ำ ให้ด้านเงายังเห็นลายแต่มีมิติ */}
          <ambientLight intensity={0.25} />
          <hemisphereLight args={['#ffffff', '#e9e4da', 0.15]} />
          <group ref={rig}>
            {/* key: หน้าเฉียงซ้ายบน (ฝั่งตรงข้ามกล้องที่มองจากขวา) — ฝาบน+หน้าสว่างสุด อุ่นเล็กน้อย */}
            <directionalLight position={[-300, 420, 380]} intensity={3} color="#fff8ee" />
            {/* fill: ขวาต่ำ อ่อน — ผนังข้างที่กล้องเห็นตกอยู่ในเงานุ่ม ได้มิติ (ยังเห็นลาย) เย็นเล็กน้อย */}
            <directionalLight position={[420, 60, 160]} intensity={0.55} color="#eef3ff" />
            {/* rim: ตรงหลังสูง — แตะแค่ขอบบน/ด้านหลัง ไม่ลบเงาของผนังข้างที่กล้องเห็น */}
            <directionalLight position={[0, 300, -500]} intensity={2} />
          </group>
        </>
      ) : (
        <>
          <ambientLight intensity={vivid ? 0.9 : 0.65} />
          {/* แสงฟุ้งจากฟ้า/พื้น เติมเงาให้สว่างนุ่ม ไม่ทึบ */}
          <hemisphereLight args={['#ffffff', '#efeae0', vivid ? 0.55 : 0.22]} />
          <group ref={rig}>
            <directionalLight position={[250, 420, 300]} intensity={vivid ? 2 : 1.5} />
            <directionalLight position={[-220, 120, -260]} intensity={vivid ? 0.85 : 0.5} />
          </group>
        </>
      )}
      <StudioEnv />
    </>
  )
}

// สตูดิโอสะท้อนสำหรับผิวโลหะ — สร้าง cubemap ครั้งเดียวต่อ Canvas
// drei <Environment> ถ่าย cubemap ใหม่ (6 หน้า + สร้าง PMREM) ใน layout effect ทุกครั้งที่ parent re-render
// เพราะ children เป็น JSX ใหม่ทุกรอบ — เช่นทุกติ๊กตอนลากสไลเดอร์ขนาด ทั้งที่ไฟสตูดิโอไม่เคยเปลี่ยน
// จึงเป็น memo ไม่มี prop (ไม่ re-render ตาม parent) และไม่ผูกค่าตามโหมด — ความแรงต่อโหมดปรับผ่าน
// scene.environmentIntensity ใน SceneLighting แทน; เปลี่ยนชนิดงานได้ Canvas ใหม่ = สร้างใหม่เอง
const StudioEnv = memo(function StudioEnv() {
  return (
    <Environment resolution={256} frames={1}>
      {/* ซอฟต์บ็อกซ์บนหัว = ไฮไลต์เส้นยาวบนผิวโลหะ */}
      <Lightformer form="rect" intensity={3.2} position={[0, 6, 1]} scale={[10, 5, 1]} color="#ffffff" />
      {/* แผงข้างซ้าย-ขวา = ขอบสว่างสองด้าน */}
      <Lightformer form="rect" intensity={1.6} position={[-6, 1, 3]} scale={[4, 8, 1]} color="#f4f7fb" />
      <Lightformer form="rect" intensity={1.6} position={[6, 1, 3]} scale={[4, 8, 1]} color="#f4f7fb" />
      {/* วงแหวนด้านหลัง = ประกายโค้งบนทรงกระบอก */}
      <Lightformer form="ring" intensity={1.2} position={[0, 3, -6]} scale={5} color="#eef2f6" />
    </Environment>
  )
})
