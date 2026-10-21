// งานตกแต่งที่ผู้ใช้ทำไว้บนรูปแบบปัจจุบัน (ลาย/รูปพื้น/สีพื้น) — ใช้ตัดสินว่าการสลับประเภทงาน/รูปแบบบรรจุภัณฑ์/รูปแบบถุง
// ต้องเตือน "งานเดิมจะถูกลบ" ก่อนไหม (pure ไม่ผูก React) ต่างจาก `isFreshWork` ตรงที่นับสีพื้นด้วย เพราะเลือกสีก็คือตกแต่งแล้ว
import type { Deco, FillImage } from './artwork'

export interface DesignWorkSummary {
  text: number
  image: number
  shape: number // รูปทรง/เส้น/path
  nutrition: number
  fillImage: boolean
  fillColor: boolean
  total: number // ชิ้นงานทุกชนิด + รูปพื้น + สีพื้น
}

export function summarizeDesignWork(decos: Deco[], fillImage: FillImage | null | undefined, fillColor: string | null | undefined): DesignWorkSummary {
  const s: DesignWorkSummary = { text: 0, image: 0, shape: 0, nutrition: 0, fillImage: !!fillImage, fillColor: !!fillColor, total: 0 }
  for (const d of decos) {
    if (d.type === 'text') s.text++
    else if (d.type === 'image') s.image++
    else if (d.type === 'nutrition') s.nutrition++
    else s.shape++
  }
  s.total = decos.length + (s.fillImage ? 1 : 0) + (s.fillColor ? 1 : 0)
  return s
}

export const hasDesignWork = (decos: Deco[], fillImage: FillImage | null | undefined, fillColor: string | null | undefined): boolean =>
  summarizeDesignWork(decos, fillImage, fillColor).total > 0

type T = (th: string, en: string) => string

// รายการสิ่งที่จะหายไปแบบอ่านง่าย เช่น "ข้อความ 3 · รูปภาพ 2 · รูปทรง/เส้น 1 · สีพื้น"
export function describeDesignWork(s: DesignWorkSummary, t: T): string {
  const parts: string[] = []
  if (s.text) parts.push(`${t('ข้อความ', 'Text')} ${s.text}`)
  if (s.image) parts.push(`${t('รูปภาพ', 'Images')} ${s.image}`)
  if (s.shape) parts.push(`${t('รูปทรง/เส้น', 'Shapes/lines')} ${s.shape}`)
  if (s.nutrition) parts.push(`${t('ตารางโภชนาการ', 'Nutrition tables')} ${s.nutrition}`)
  if (s.fillImage) parts.push(t('รูปพื้น', 'Background image'))
  if (s.fillColor) parts.push(t('สีพื้น', 'Background colour'))
  return parts.join(' · ')
}
