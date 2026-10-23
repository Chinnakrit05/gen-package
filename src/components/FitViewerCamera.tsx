// จัดกล้องใหม่เมื่อของที่แสดงเปลี่ยนชัด ๆ (ดู viewerCamera.ts) — ใช้ใน <Canvas> ของ VesselViewer3D/PouchViewer3D
import { useLayoutEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import type * as THREE from 'three'
import { cameraPosition, needsRefit, type ViewerCameraFit } from './viewerCamera'

export function FitViewerCamera({ fit }: { fit: ViewerCameraFit }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as { target?: THREE.Vector3; update?: () => void } | null
  const last = useRef<ViewerCameraFit | null>(null)
  const { shape, dist, dir } = fit
  useLayoutEffect(() => {
    const next: ViewerCameraFit = { shape, dist, dir }
    const prev = last.current
    if (prev && !needsRefit(prev, next)) return
    last.current = next
    if (!prev) return
    camera.position.set(...cameraPosition(next))
    camera.lookAt(0, 0, 0)
    controls?.target?.set(0, 0, 0)
    controls?.update?.()
    // dir เป็นค่าคงที่ต่อ viewer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, dist, camera, controls])
  return null
}
