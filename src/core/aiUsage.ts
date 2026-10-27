// จัดรูปโทเคน/ค่าใช้จ่ายของงาน AI (pure) — ช่วงพัฒนาเท่านั้น: server ส่ง AiUsageReport มาเฉพาะเมื่อเปิดตัวเลือกรุ่น
// ราคาต่อรุ่นและสูตรคิดอยู่ shared/contracts/aiModels.ts (server คิดจาก usage จริงของ API) ฝั่งนี้แค่จัดรูปตัวเลข
import { AI_MODEL_PRICES, APPROX_THB_PER_USD, type AiUsageReport } from '../../shared/contracts/aiModels'

export const formatTokens = (n: number): string => Math.round(n).toLocaleString('en-US')

// Haiku ถูกจนเป็นเศษเซนต์ — ต่ำกว่า 1 เซนต์แสดง 4 ตำแหน่ง ไม่งั้น 3 ตำแหน่ง
export function formatUsd(usd: number): string {
  if (usd === 0) return '$0'
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(3)}`
}

// ประมาณเป็นบาท (ตัวเลขอย่างเดียว — ผู้เรียกเติมหน่วยตามภาษา)
export function approxThb(usd: number): string {
  const thb = usd * APPROX_THB_PER_USD
  return thb < 1 ? thb.toFixed(2) : thb.toFixed(1)
}

// ป้ายราคาในตัวเลือกรุ่น เช่น "$4 / $20" (input / output ต่อ 1M โทเคน)
export function modelPriceLabel(model: string): string {
  const price = AI_MODEL_PRICES[model]
  return price ? `$${price.input} / $${price.output}` : ''
}

// แถวรายละเอียดโทเคน — output รวมโทเคนที่โมเดลคิดก่อนตอบ (ค่าใช้จ่ายส่วนใหญ่อยู่ตรงนี้)
export function usageRows(report: AiUsageReport): { th: string; en: string; value: string }[] {
  return [
    { th: 'input', en: 'input', value: formatTokens(report.inputTokens) },
    { th: 'cache อ่าน', en: 'cache read', value: formatTokens(report.cacheReadTokens) },
    { th: 'cache เขียน', en: 'cache write', value: formatTokens(report.cacheCreationTokens) },
    { th: 'output (รวมที่คิด)', en: 'output (incl. thinking)', value: formatTokens(report.outputTokens) },
    { th: 'คำขอถึง API', en: 'API requests', value: String(report.requests) },
  ]
}
