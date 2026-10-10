import type { BoxParams, Dieline, Material } from '../types'
import { rollEndLayout } from './fefco0427'

// กล่องถาด (open tray) — ถาดเปิดบนผนังทบ (roll end tray) แบบ dieline มาตรฐาน:
// ผนังหน้า-หลังมีหูมุมพับเข้าแนบผนังข้าง → ผนังข้างตั้ง → ทบสันลงด้านในทับหู ลิ้นปลายล็อกช่องบนฐาน
// โครงเดียวกับ FEFCO 0427 ส่วนล่าง (ไม่มีฝา) — ใช้เป็นถาดอาหาร/ดิสเพลย์ หรือ "ลิ้นชัก" คู่ sleeve; W,D,H = ขนาดด้านใน
//
// ผังแผ่นคลี่ (x ขวา y ลง):
//   คอลัมน์: [ลิ้น|ชั้นทบ|สัน|ผนังข้าง|  ฐาน  |ผนังข้าง|สัน|ชั้นทบ|ลิ้น]
//   แถว:     ผนังหลัง(+หู) / ฐาน / ผนังหน้า(+หู)
export function generateTrayBox(box: BoxParams, mat: Material): Dieline {
  return rollEndLayout(box, mat, { lid: false })
}
