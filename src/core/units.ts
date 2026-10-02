// หน่วยวัด: เรขาคณิตภายในเก็บเป็น มม. เสมอ — ฟังก์ชันนี้แปลงเพื่อ "แสดงผล" เท่านั้น
// ใช้ร่วมกันระหว่างแผง DimField, blueprint และป้ายขนาดบนมุมมอง 3D ให้ค่าตรงกันทุกจุด
export const MM_PER_IN = 25.4

// ค่าตัวเลขตามหน่วยที่เลือก (ปัดพอดีอ่าน): มม. 1 ตำแหน่ง, นิ้ว 2 ตำแหน่ง
export function dimValue(mm: number, imperial: boolean): number {
  if (imperial) return Math.round((mm / MM_PER_IN) * 100) / 100
  return Math.round(mm * 10) / 10
}

// ข้อความค่าขนาด เช่น "80 มม." หรือ "3.15 นิ้ว"
export function fmtDim(mm: number, imperial: boolean): string {
  return `${dimValue(mm, imperial)} ${imperial ? 'นิ้ว' : 'มม.'}`
}
