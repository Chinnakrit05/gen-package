import type { Deco, FillImage } from './artwork'

// ขนาดมาตรฐานเมื่อสลับประเภทงาน (งานยังไม่เริ่ม) — ไม่ให้ขนาดของงานประเภทเดิมติดข้ามมา
// (เช่น ปรับขวดสูงมากแล้วสลับเป็นถุง → ถุงสูงตาม) กล่อง/นามบัตร/สติกเกอร์ใช้ค่าเริ่มต้นของ template อยู่แล้ว
export type SizedKind = 'vessel' | 'pouch' | 'tube'
export const STANDARD_SIZE: Record<SizedKind, { W: number; D: number; H: number }> = {
  vessel: { W: 65, D: 28, H: 200 }, // ขวด PET ~500 มล. คอมาตรฐาน 28 มม.
  pouch: { W: 130, D: 70, H: 200 }, // ถุงตั้ง doypack ~250 ก.
  tube: { W: 40, D: 20, H: 150 }, // หลอดครีม ~50 มล. (ทรงชะลูด ไม่ใช่กระปุก)
}

// "ยังไม่เริ่มงาน" = ยังไม่มีลาย/องค์ประกอบและรูปพื้น — มีแล้วคงขนาดเดิมไว้ ลายจะได้ไม่หลุดตำแหน่ง
export const isFreshWork = (decos: Deco[], fillImage: FillImage | null | undefined) => decos.length === 0 && !fillImage
