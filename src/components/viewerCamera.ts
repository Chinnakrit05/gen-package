// กล้องของ viewer ภาชนะ/ถุง: R3F ใช้ prop `camera` ของ <Canvas> ครั้งเดียวตอนสร้าง — ถ้าสลับขวด↔หลอด, รูปแบบถุง หรือขนาดต่างมาก
// โดยหน้า 3D ไม่ถูกถอด กล้องจะค้างระยะ/มุมของของเดิม (ชิ้นใหม่ดูเล็ก เอียง ข้อความหน้าฉลากไปตกขอบโค้ง) → คำนวณใหม่ตามกติกาเดียวกับ
// FitCamera ของกล่อง: เปลี่ยนรูปทรง หรือระยะต่างเกิน 18% = จัดกล้องใหม่; ขยับ slider ทีละน้อยไม่รีเซ็ต (มุมที่ผู้ใช้หมุนไว้คงอยู่)
export const REFIT_RATIO = 0.18

export interface ViewerCameraFit {
  shape: string // รูปทรงหลัก เช่น 'tube' / 'bottle' / รูปแบบถุง — เปลี่ยน = จัดกล้องใหม่เสมอ
  dist: number // ระยะกล้องจากจุดเล็ง (มม.)
  dir: readonly [number, number, number] // ทิศจากจุดเล็งไปกล้อง (ไม่ต้อง normalize)
}

export function vesselCameraFit(v: { H: number; labelR: number; tube?: unknown }): ViewerCameraFit {
  return { shape: v.tube ? 'tube' : 'bottle', dist: Math.max(v.H, v.labelR * 4) * 2.2, dir: [0.45, 0.3, 1] }
}

// ถุงตั้ง/ก้น K เปิดมาหน้าตรง (แบบภาพ mockup) ให้สองข้างสมดุล — มุมเฉียงขวาเห็นความหนาด้านขวาข้างเดียว;
// ถุงแบบอื่นคงมุมเฉียง (เห็นจีบข้าง/ความลึก)
export function pouchCameraFit(p: { H: number; W: number }, style: string): ViewerCameraFit {
  const front = style === 'stand' || style === 'kseal'
  return { shape: `pouch:${style}`, dist: Math.max(p.H, p.W) * 2.6, dir: front ? [0, 0.12, 1] : [0.35, 0.25, 1] }
}

// ตำแหน่งกล้องตามทิศเดิมของ viewer (ไม่ normalize ทิศ เพื่อให้ตรงกับตำแหน่งที่ Canvas ตั้งตอนสร้างทุกประการ)
export const cameraPosition = (f: ViewerCameraFit): [number, number, number] => [f.dir[0] * f.dist, f.dir[1] * f.dist, f.dir[2] * f.dist]

export function needsRefit(prev: ViewerCameraFit | null, next: ViewerCameraFit): boolean {
  if (!prev) return false // ครั้งแรก Canvas ตั้งตำแหน่งให้แล้ว
  if (prev.shape !== next.shape) return true
  return Math.abs(next.dist - prev.dist) / prev.dist >= REFIT_RATIO
}
