import type { BoxParams, Dieline, Material } from '../types'
import { generateWindowTuckBox } from './tuckEnd'

// กล่องหน้าต่าง (display / window box) ตามผังโรงพิมพ์: ปีกกาว | หลัง | ข้างซ้าย | หน้า | ข้างขวา
// ฝาเสียบบน+ล่างอยู่ที่แผงหน้าซึ่งเจาะหน้าต่างมุมมน, ลิ้นกันฝุ่นที่ผนังข้าง — สร้างด้วยตัวสร้างกล่องฝาเสียบชุดเดียวกับ tuck-end
// (เปลี่ยนจากกล่องฝาข้างแบบเดิม 17 พ.ย. 2026 — งานเก่าลายตกผิดแผง); W,D,H = ขนาดด้านใน
export function generateDisplayBox(box: BoxParams, mat: Material): Dieline {
  return generateWindowTuckBox(box, mat)
}
