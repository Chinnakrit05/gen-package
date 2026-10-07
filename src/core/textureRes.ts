// ความละเอียดของ texture ลาย (แผ่นคลี่/ฉลาก/ฟิล์มถุง) ที่วาดลง canvas แล้วแปะบนโมเดล 3D
// เดิม 3 px/มม. (~76 dpi, ด้านยาว ≤2048) — ด้านกล่อง 80 มม. ได้แค่ ~240 px ซูมแล้วขอบ/รูปแตก
// ตอนนี้ 10 px/มม. (~254 dpi) โดยด้านยาวไม่เกิน 4096 px และไม่เกินที่ GPU รับได้ (maxTextureSize)
export const TEX_PX_PER_MM = 10
export const TEX_MAX_SIDE = 4096

// px ต่อ มม. สำหรับแผ่นขนาด wMm × hMm
export function textureScale(wMm: number, hMm: number, maxTextureSize = TEX_MAX_SIDE): number {
  const side = Math.min(TEX_MAX_SIDE, maxTextureSize)
  return Math.min(TEX_PX_PER_MM, side / Math.max(wMm, hMm, 1))
}
