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
