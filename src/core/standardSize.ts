import type { Deco, FillImage } from './artwork'
import type { PouchStyle } from './pouch'

// ขนาดมาตรฐานของบรรจุภัณฑ์แต่ละแบบ — ตั้งให้เมื่อสลับประเภทงาน/วัสดุภาชนะ/รูปแบบถุงตอนยังไม่เริ่มงาน
// (ไม่ให้ขนาดของงานเดิมติดข้ามมา เช่น ขวดสูงมากแล้วสลับเป็นถุง → ถุงสูงตาม)
// อ้างอิงขนาดที่ขายจริงในตลาด (ไม่มีมาตรฐานทางการ ขนาดต่างกันเล็กน้อยตามผู้ผลิต) — ความจุในวงเล็บคำนวณด้วย
// สูตรความจุของแอป (capacity.ts หัก headspace แล้ว) จึงต่ำกว่าความจุเต็มปากที่ผู้ผลิตระบุเล็กน้อย
// ความหมาย W/D/H ตามชนิดงาน: ขวด/กระป๋อง W = ⌀ตัว, D = ⌀ปาก, H = สูงรวม; หลอด W = ⌀ท่อ, H = ยาวรวม;
// ถุง W = กว้าง, D = ลึกก้น/จีบข้าง, H = สูงลำตัว (ไม่รวมซีลบน — ซองข้างจีบไม่รวมซีลบน/ล่าง 20+20)
export interface StdSize {
  W: number
  D: number
  H: number
}

// ขวด/โหล/กระป๋องตามวัสดุ
export const VESSEL_STANDARD: Record<string, StdSize & { noteTh: string }> = {
  'pet-bottle': { W: 65, D: 28, H: 205, noteTh: 'ขวด PET 500 มล. คอ 28 มม. (PCO 1881)' }, // ≈430 มล. ใช้งาน
  glass: { W: 76, D: 30, H: 300, noteTh: 'ขวดแก้ว 750 มล. (ไวน์/สุรา บอร์โดซ์ ⌀76×300)' }, // ≈910 มล.
  aluminum: { W: 66, D: 53, H: 115, noteTh: 'กระป๋อง 330 มล. ⌀66×115 ฝา 202 (⌀53)' }, // ≈305 มล.
  'tube-laminate': { W: 30, D: 20, H: 130, noteTh: 'หลอดครีม 50 มล. ⌀30×130' }, // ≈58 มล.
}

// ถุงฟิล์มตามรูปแบบ
export const POUCH_STANDARD: Record<PouchStyle, StdSize & { noteTh: string }> = {
  stand: { W: 140, D: 80, H: 215, noteTh: 'ถุงตั้ง doypack 250 ก. (140×220+80)' }, // ≈700 มล.
  flat: { W: 100, D: 20, H: 150, noteTh: 'ซองแบน 3 ด้าน 100×150' }, // ≈250 มล.
  gusset: { W: 80, D: 60, H: 210, noteTh: 'ถุงกาแฟข้างจีบ 250 ก. (80×250+60 รวมซีล)' }, // ≈770 มล.
  box: { W: 125, D: 65, H: 195, noteTh: 'ถุงก้นแบน 250 ก. (125×195+65)' },
  pillow: { W: 150, D: 20, H: 220, noteTh: 'ซองขนมหลังกลาง 150×220' }, // ≈620 มล.
  spout: { W: 100, D: 50, H: 160, noteTh: 'ถุงมีจุก 250 มล. (100×160+50)' }, // ≈230 มล.
}

// ขนาดมาตรฐานของงานไม่ใช่กล่อง (กล่อง/นามบัตร/สติกเกอร์ใช้ defaults ของ template) — null = ไม่มีค่ากำหนด
export function standardSizeFor(materialId: string, pouchStyle: PouchStyle, kind: 'vessel' | 'pouch'): StdSize | null {
  const s = kind === 'pouch' ? POUCH_STANDARD[pouchStyle] : VESSEL_STANDARD[materialId]
  return s ? { W: s.W, D: s.D, H: s.H } : null
}

// "ยังไม่เริ่มงาน" = ยังไม่มีลาย/องค์ประกอบและรูปพื้น — มีแล้วคงขนาดเดิมไว้ ลายจะได้ไม่หลุดตำแหน่ง
export const isFreshWork = (decos: Deco[], fillImage: FillImage | null | undefined) => decos.length === 0 && !fillImage
