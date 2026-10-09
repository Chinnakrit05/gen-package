import type { Vec2 } from './types'
import { tubeSection, type TubeShape } from './vessel'
import { FLAT_SEAL, pouchWidthFactor, pouchDepthFactor, pouchSectionArea, type PouchStyle } from './pouch'

// ความจุโดยประมาณ (มล.) ของบรรจุภัณฑ์ — ประเมินจากปริมาตรใช้งานด้านใน
// (หัก headspace/ผนัง/คอ คร่าว ๆ) เพื่อบอกผู้ใช้ว่าใส่สินค้าได้ราวเท่าไร
// หน่วย: มิติเป็น มม. → ปริมาตร มม.³ ; 1 มล. = 1000 มม.³

// กล่องพับ: ปริมาตรด้านใน = W×D×H (หักเล็กน้อยเผื่อผนัง/ความหนา)
export function boxVolumeMl(W: number, D: number, H: number): number {
  return ((W * D * H) / 1000) * 0.95
}

// ถุงฟิล์ม: อินทิเกรตพื้นที่หน้าตัดตามความสูง (วงรี / เลนส์ doypack / สี่เหลี่ยมมุมมน brick/box)
// ใช้โปรไฟล์กว้าง/ลึกชุดเดียวกับที่เรนเดอร์ 3D จึงสอดคล้องกับทรงจริง
export function pouchVolumeMl(W: number, H: number, depth3D: number, style: PouchStyle): number {
  if (style === 'flat') {
    // ซองแบน: ทรง 3D แสดงตอนพองบาง ๆ แต่ความจุจริงคือตอนบรรจุเต็ม — ใช้สูตรปริมาตรซองแบน (Baginsky):
    // V ≈ w³·(l/(π·w) − 0.142·(1 − 10^(−l/w))) บนขนาดในแนวซีล แล้วเผื่อ headspace
    const w = Math.max(1, W - 2 * FLAT_SEAL)
    const l = Math.max(1, H)
    const v3 = w ** 3 * (l / (Math.PI * w) - 0.142 * (1 - 10 ** (-l / w)))
    return (Math.max(0, v3) / 1000) * 0.8
  }
  const k = pouchSectionArea(style)
  const N = 48
  let v3 = 0
  for (let i = 0; i < N; i++) {
    const v = (i + 0.5) / N
    const a = (W / 2) * pouchWidthFactor(v, style) // ครึ่งกว้าง
    const b = depth3D * pouchDepthFactor(v, style) // ครึ่งลึก
    const area = k * a * b
    v3 += area * (H / N)
  }
  return (v3 / 1000) * 0.9 // เผื่อ headspace
}

// ภาชนะหมุนขึ้นรูป (ขวด/โหล/กระป๋อง): ปริมาตรทรงหมุนจากโปรไฟล์ (ผลรวม frustum) หักผนัง/คอ/headspace
export function vesselVolumeMl(profile: Vec2[]): number {
  let v3 = 0
  for (let i = 1; i < profile.length; i++) {
    const r0 = profile[i - 1].x
    const r1 = profile[i].x
    const dy = Math.abs(profile[i].y - profile[i - 1].y)
    v3 += (Math.PI / 3) * (r0 * r0 + r0 * r1 + r1 * r1) * dy
  }
  return (v3 / 1000) * 0.8
}

// หลอดครีม: อินทิเกรตพื้นที่หน้าตัดวงรีของท่อบีบแบน (tubeSection ชุดเดียวกับ 3D) จากไหล่ถึงซีล
export function tubeVolumeMl(t: TubeShape): number {
  const N = 64
  let v3 = 0
  const y0 = t.capTop
  const y1 = t.sealY0
  for (let i = 0; i < N; i++) {
    const y = y0 + ((i + 0.5) / N) * (y1 - y0)
    const { a, b } = tubeSection(t, y)
    v3 += Math.PI * a * b * ((y1 - y0) / N)
  }
  return (v3 / 1000) * 0.9 // เผื่อ headspace
}

// ข้อความแสดงผล: เมตริก = มล./ลิตร; imperial = fl oz / แกลลอน (US)
export function formatCapacity(ml: number, imperial = false): string {
  if (!Number.isFinite(ml) || ml <= 0) return '—'
  if (imperial) {
    const oz = ml / 29.5735 // US fluid ounce
    if (oz >= 128) return `≈ ${(oz / 128).toFixed(oz >= 1280 ? 0 : 1)} gal`
    return `≈ ${oz >= 10 ? Math.round(oz) : Math.round(oz * 10) / 10} fl oz`
  }
  if (ml >= 1000) return `≈ ${(ml / 1000).toFixed(ml >= 10000 ? 0 : 1)} ลิตร`
  if (ml >= 100) return `≈ ${Math.round(ml / 5) * 5} มล.`
  return `≈ ${Math.round(ml)} มล.`
}
