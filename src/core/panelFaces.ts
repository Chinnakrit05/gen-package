import * as THREE from 'three'

// แบ่ง group ของ geometry แผ่นหนา (ExtrudeGeometry ตามแกน +z) เพื่อ "พิมพ์ลายเฉพาะฝาด้านนอก":
// แผ่นถูกวางที่ z=0 แล้ว extrude ไป +z (= ด้านในกล่อง ตามคอนเวนชันใน fold.ts)
//   ฝาที่ z≈0        → material 0 (มีลายพิมพ์จาก texture แผ่นคลี่)
//   ฝาด้านใน z≈depth + ผนังรอบ → material 1 (สีวัสดุล้วน ไม่มีลาย)
// ExtrudeGeometry เป็น non-indexed (3 เวอร์เทกซ์ต่อสามเหลี่ยมเรียงกัน) จึงจัด group เป็นช่วง ๆ
// รวมสามเหลี่ยมที่ material เดียวกันติดกันให้อยู่ group เดียวเพื่อลดจำนวน group
export function assignOuterFaceGroups(geo: THREE.BufferGeometry, depth: number): void {
  const pos = geo.attributes.position
  geo.clearGroups()
  const half = depth / 2
  const triCount = Math.floor(pos.count / 3)
  let cur = -1
  let start = 0
  for (let t = 0; t < triCount; t++) {
    const outer =
      pos.getZ(t * 3) < half && pos.getZ(t * 3 + 1) < half && pos.getZ(t * 3 + 2) < half
    const m = outer ? 0 : 1
    if (m !== cur) {
      if (cur !== -1) geo.addGroup(start * 3, (t - start) * 3, cur)
      cur = m
      start = t
    }
  }
  if (triCount > 0) geo.addGroup(start * 3, (triCount - start) * 3, cur)
}

// เส้นขอบ (EdgesGeometry) ของแผงลูกตามแนวบานพับ: หลังพับ ปลายแผงลูก (ฝา/ลิ้น/ปีก) ไปแนบผิวนอกของแผงแม่พอดี
// เส้นขอบชั้นใน (z = ความหนา) จึงถูกวาด "บนหน้า" ผนังแม่ เป็นเส้นซ้อนต่ำกว่าขอบบนเท่าความหนา (เห็นเป็นเส้นคู่บนหน้ากล่อง)
// ขอบจริงของกล่องตรงนั้นวาดโดยแผงแม่อยู่แล้ว → ตัดเส้นที่ทั้งสองปลายอยู่บนแนวบานพับทิ้ง (พิกัด geometry = (x, −y) ของแผ่นคลี่)
export function dropHingeEdges(
  positions: ArrayLike<number>,
  hingeA: { x: number; y: number },
  hingeB: { x: number; y: number },
  tol = 1e-3,
): Float32Array {
  const ax = hingeA.x
  const ay = -hingeA.y
  const dx = hingeB.x - ax
  const dy = -hingeB.y - ay
  const len = Math.hypot(dx, dy)
  const onHinge = (i: number) => len > 0 && Math.abs((positions[i] - ax) * dy - (positions[i + 1] - ay) * dx) / len < tol
  const out: number[] = []
  for (let i = 0; i + 5 < positions.length; i += 6) {
    if (onHinge(i) && onHinge(i + 3)) continue
    for (let k = 0; k < 6; k++) out.push(positions[i + k])
  }
  return new Float32Array(out)
}
