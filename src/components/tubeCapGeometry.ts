import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// ฝาเหลี่ยมหลอดครีม (flip-top ทรงสเตเดียม): ตั้งบนฝา (y = 0 คือก้นฝา) สูง h, ครึ่งกว้าง ca × ครึ่งลึก cb (+z = ด้านหน้า)
// ฝาพับ (ช่วงล่าง LID_FRAC·h) แยกจากตัวฝาด้วยรอยต่อ (ขอบมนของฝาพับเป็นร่อง) + ร่องงัดนิ้วรูปซุ้มกลางหน้าตัวฝา
// ร่องสร้างจริง: หน้าแบนด้านหน้าของตัวฝาเป็นแผ่นมีรอยเว้ารูปซุ้ม → ผนังร่อง + พื้นร่องลึก d (เปิดลงหาฝาพับ เห็นขอบฝาพับในร่อง)
export const TUBE_LID_FRAC = 0.3

interface Stadium {
  hx: number
  hz: number
  rr: number
}

// เส้นรอบสี่เหลี่ยมมุมมนบนระนาบ (x, z) — เริ่มปลายขวาของหน้าแบนด้านหน้า เดินรอบไปจบปลายซ้าย (ไม่รวมหน้าแบนหน้า)
function perimeterOpen(s: Stadium, seg = 12): [number, number][] {
  const fx = s.hx - s.rr
  const out: [number, number][] = []
  const arc = (cx: number, cz: number, a0: number, a1: number) => {
    for (let k = 0; k <= seg; k++) {
      const a = a0 + ((a1 - a0) * k) / seg
      out.push([cx + s.rr * Math.cos(a), cz + s.rr * Math.sin(a)])
    }
  }
  arc(fx, s.hz - s.rr, Math.PI / 2, 0)
  arc(fx, -s.hz + s.rr, 0, -Math.PI / 2)
  arc(-fx, -s.hz + s.rr, -Math.PI / 2, -Math.PI)
  arc(-fx, s.hz - s.rr, Math.PI, Math.PI / 2)
  return out
}

function roundedShape(s: Stadium): THREE.Shape {
  const sh = new THREE.Shape()
  const pts = perimeterOpen(s)
  sh.moveTo(pts[0][0], pts[0][1])
  for (const [x, z] of pts.slice(1)) sh.lineTo(x, z)
  sh.closePath()
  return sh
}

// ผนังรอบแบบ loft: แถว (y, inset) ต่อกันเป็นแถบ; closed = รวมหน้าแบนด้านหน้า
function loftRows(base: Stadium, rows: { y: number; e: number }[], closed: boolean): THREE.BufferGeometry {
  const pos: number[] = []
  const idx: number[] = []
  let n = 0
  rows.forEach(({ y, e }) => {
    const ring = perimeterOpen({ hx: base.hx - e, hz: base.hz - e, rr: Math.max(0.01, base.rr - e) })
    if (closed) ring.push(ring[0])
    n = ring.length
    for (const [x, z] of ring) pos.push(x, y, z)
  })
  for (let r = 0; r < rows.length - 1; r++) {
    for (let i = 0; i < n - 1; i++) {
      const a = r * n + i
      const b = (r + 1) * n + i
      idx.push(a, a + 1, b, a + 1, b + 1, b)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  return g
}

export function ovalFlipCapGeometry(ca: number, cb: number, h: number): THREE.BufferGeometry {
  const base: Stadium = { hx: ca, hz: cb, rr: cb * 0.92 }
  const fx = base.hx - base.rr // ครึ่งกว้างหน้าแบนด้านหน้า
  const bev = Math.min(1.4, cb * 0.18)
  const gL = h * TUBE_LID_FRAC // รอยต่อฝาพับ
  const ytb = h - bev // ขอบบนตัวฝาเริ่มมน
  const parts: THREE.BufferGeometry[] = []

  // ฝาพับ: แท่งสเตเดียมขอบมนทั้งล่าง/บน (ขอบมนบนชนตัวฝา = ร่องรอยต่อ)
  const lid = new THREE.ExtrudeGeometry(roundedShape({ hx: ca - bev, hz: cb - bev, rr: base.rr - bev }), {
    depth: Math.max(0.2, gL - 2 * bev),
    bevelEnabled: true,
    bevelThickness: bev,
    bevelSize: bev,
    bevelSegments: 4,
    curveSegments: 12,
  })
  lid.rotateX(-Math.PI / 2)
  lid.translate(0, bev, 0)
  parts.push(lid)

  // ตัวฝา: ผนังตรง (เว้นหน้าแบนด้านหน้า) + ขอบบนมน (รอบเต็ม) + หน้าบน
  parts.push(loftRows(base, [{ y: gL, e: 0 }, { y: ytb, e: 0 }], false))
  const bevRows = Array.from({ length: 5 }, (_, k) => {
    const a = (k / 4) * (Math.PI / 2)
    return { y: ytb + bev * Math.sin(a), e: bev * (1 - Math.cos(a)) }
  })
  parts.push(loftRows(base, bevRows, true))
  const top = new THREE.ShapeGeometry(roundedShape({ hx: ca - bev, hz: cb - bev, rr: base.rr - bev }), 12)
  top.rotateX(-Math.PI / 2)
  top.translate(0, h, 0)
  parts.push(top)

  // ร่องงัดรูปซุ้มกลางหน้า: กว้าง ~36% ของฝา (ไม่เกินหน้าแบน), สูง ~72% ของตัวฝา, ลึก d
  const aw = Math.min(fx * 2 * 0.8, ca * 2 * 0.36)
  const ar = aw / 2
  const ah = Math.max(ar * 1.2, (ytb - gL) * 0.72)
  const d = Math.min(1.2, cb * 0.15)
  const archPts: [number, number][] = [[-ar, gL], [-ar, gL + ah - ar]]
  for (let k = 1; k <= 16; k++) {
    const a = Math.PI - (Math.PI * k) / 16
    archPts.push([ar * Math.cos(a), gL + ah - ar + ar * Math.sin(a)])
  }
  archPts.push([ar, gL])
  // หน้าแบนด้านหน้า (แผ่นที่ z = cb) มีรอยเว้ารูปซุ้มจากขอบล่าง
  const plate = new THREE.Shape()
  plate.moveTo(-fx, gL)
  for (const [x, y] of archPts) plate.lineTo(x, y)
  plate.lineTo(fx, gL)
  plate.lineTo(fx, ytb)
  plate.lineTo(-fx, ytb)
  plate.closePath()
  const plateGeo = new THREE.ShapeGeometry(plate)
  plateGeo.translate(0, 0, cb)
  parts.push(plateGeo)
  // พื้นร่อง
  const floor = new THREE.Shape()
  floor.moveTo(archPts[0][0], archPts[0][1])
  for (const [x, y] of archPts.slice(1)) floor.lineTo(x, y)
  floor.closePath()
  const floorGeo = new THREE.ShapeGeometry(floor)
  floorGeo.translate(0, 0, cb - d)
  parts.push(floorGeo)
  // ผนังร่อง (ข้างซ้าย → โค้งบน → ข้างขวา) จากผิวหน้าลงไปถึงพื้นร่อง
  const wall: number[] = []
  const widx: number[] = []
  archPts.forEach(([x, y]) => wall.push(x, y, cb, x, y, cb - d))
  for (let i = 0; i < archPts.length - 1; i++) {
    const a = i * 2
    widx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
  }
  const wallGeo = new THREE.BufferGeometry()
  wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wall, 3))
  wallGeo.setIndex(widx)
  parts.push(wallGeo)

  // รวมเป็นชิ้นเดียว: คำนวณ normal บนชิ้นที่ยังมี index (ผิวโค้งเรียบ ไม่เป็นเหลี่ยม) ก่อนแตก index แล้วตัด uv ให้แอตทริบิวต์ตรงกัน
  const clean = parts.map((g) => {
    if (!g.getAttribute('normal')) g.computeVertexNormals()
    const ng = g.index ? g.toNonIndexed() : g
    ng.deleteAttribute('uv')
    return ng
  })
  const merged = mergeGeometries(clean, false)!
  parts.forEach((g) => g.dispose())
  return merged
}
