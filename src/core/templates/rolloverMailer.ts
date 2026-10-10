import type { BoxParams, Dieline, Material } from '../types'
import { rollEndLayout } from './fefco0427'

// Rollover mailer — กล่องไปรษณีย์ฝาพับ ผนังข้างทบสองชั้น (roll end) แบบ dieline มาตรฐาน:
// ผนังหน้า-หลังมีหูมุมพับเข้า → ผนังข้างตั้ง → ทบข้ามสันลงด้านในทับหู ลิ้นปลายล็อกช่องบนฐาน
// ฝาต่อจากผนังหลัง มีปีกข้างยาวเกือบเต็มฝา (มุมฝั่งลิ้นหน้ามน) พับลงด้านในชั้นทบ + ลิ้นหน้ามุมโค้งเสียบด้านในผนังหน้า
// โครงเดียวกับ FEFCO 0427 (`rollEndLayout`) ต่างที่ปีกข้างฝาและผังวางฝาไว้บน (ไม่หมุน) — W,D,H = ขนาดด้านใน
export function generateRolloverMailer(box: BoxParams, mat: Material): Dieline {
  return rollEndLayout(box, mat, { lid: true, flap: 'long', front: 'wide' })
}
