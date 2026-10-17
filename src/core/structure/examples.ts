// โครงสร้างตัวอย่างในภาษาแผง — ใช้ 3 ทาง: เทสต์เทียบกับ template ที่เขียนมือ (compile.test.ts),
// few-shot ใน system prompt ของ AI (server/boxStructure.ts) และค่าเริ่มต้นในหน้าทดลอง
import type { BoxStructure } from './grammar'

// กล่องฝาเสียบ — ต้องให้ผลตรงกับ generateTuckEndBox (id แผงตั้งให้ตรงกัน)
export const TUCK_END_STRUCTURE: BoxStructure = {
  name: 'กล่องฝาเสียบ',
  orientation: 'front',
  panels: [
    { id: 'front', kind: 'body', attach: null, w: 'W', h: 'H', size: null },
    { id: 'side-left', kind: 'body', attach: { to: 'front', edge: 'left', fold: 90 }, w: null, h: null, size: 'D' },
    { id: 'glue', kind: 'glue', attach: { to: 'side-left', edge: 'left', fold: 90 }, w: null, h: null, size: null },
    { id: 'side-right', kind: 'body', attach: { to: 'front', edge: 'right', fold: 90 }, w: null, h: null, size: 'D' },
    { id: 'back', kind: 'body', attach: { to: 'side-right', edge: 'right', fold: 90 }, w: null, h: null, size: 'W' },
    { id: 'tuck-top', kind: 'lid', attach: { to: 'back', edge: 'top', fold: 90 }, w: null, h: null, size: 'D' },
    { id: 'tuck-bot', kind: 'lid', attach: { to: 'back', edge: 'bottom', fold: 90 }, w: null, h: null, size: 'D' },
  ],
  flaps: [
    { id: 'dust-tl', type: 'dust', on: 'side-left', edge: 'top', depth: null, side: null },
    { id: 'dust-tr', type: 'dust', on: 'side-right', edge: 'top', depth: null, side: null },
    { id: 'dust-bl', type: 'dust', on: 'side-left', edge: 'bottom', depth: null, side: null },
    { id: 'dust-br', type: 'dust', on: 'side-right', edge: 'bottom', depth: null, side: null },
    { id: 'tongue-top', type: 'tuck', on: 'tuck-top', edge: 'top', depth: null, side: null },
    { id: 'tongue-bot', type: 'tuck', on: 'tuck-bot', edge: 'bottom', depth: null, side: null },
  ],
  holes: [],
  explanation: 'ท่อสี่แผง + ปีกทากาว ฝาเสียบบน-ล่างต่อจากผนังหลัง ลิ้นกันฝุ่นที่ผนังข้าง',
}

// ปลอกสวม — เทียบกับ generateSleeve (H = ความยาวปลอก ไม่เผื่อความหนา จึงระบุเป็นตัวเลขจาก box.H ตอนเทสต์)
export const sleeveStructure = (length: number): BoxStructure => ({
  name: 'ปลอกสวม',
  orientation: 'front',
  panels: [
    { id: 'front', kind: 'body', attach: null, w: 'W', h: length, size: null },
    { id: 'side-left', kind: 'body', attach: { to: 'front', edge: 'left', fold: 90 }, w: null, h: null, size: 'D' },
    { id: 'glue', kind: 'glue', attach: { to: 'side-left', edge: 'left', fold: 90 }, w: null, h: null, size: null },
    { id: 'side-right', kind: 'body', attach: { to: 'front', edge: 'right', fold: 90 }, w: null, h: null, size: 'D' },
    { id: 'back', kind: 'body', attach: { to: 'side-right', edge: 'right', fold: 90 }, w: null, h: null, size: 'W' },
  ],
  flaps: [],
  holes: [],
  explanation: 'ท่อสี่แผงเปิดหัวท้าย สวมรอบกล่องหรือสินค้า',
})

// กล่องไปรษณีย์ฝาพับ (แบบ mailer): ฐานกลาง ผนัง 4 ด้าน ฝาต่อจากผนังหลัง ลิ้นหน้าเสียบ ปีกข้างฝาห่อนอกผนังข้าง
export const MAILER_STRUCTURE: BoxStructure = {
  name: 'กล่องไปรษณีย์ฝาพับ',
  orientation: 'base',
  panels: [
    { id: 'base', kind: 'body', attach: null, w: 'W', h: 'D', size: null },
    { id: 'side-left', kind: 'body', attach: { to: 'base', edge: 'left', fold: 90 }, w: null, h: null, size: 'H' },
    { id: 'side-right', kind: 'body', attach: { to: 'base', edge: 'right', fold: 90 }, w: null, h: null, size: 'H' },
    { id: 'front', kind: 'body', attach: { to: 'base', edge: 'bottom', fold: 90 }, w: null, h: null, size: 'H' },
    { id: 'back', kind: 'body', attach: { to: 'base', edge: 'top', fold: 90 }, w: null, h: null, size: 'H' },
    { id: 'lid', kind: 'lid', attach: { to: 'back', edge: 'top', fold: 90 }, w: null, h: null, size: 'D' },
  ],
  flaps: [
    { id: 'dust-lb', type: 'dust', on: 'side-left', edge: 'top', depth: null, side: null },
    { id: 'dust-lf', type: 'dust', on: 'side-left', edge: 'bottom', depth: null, side: null },
    { id: 'dust-rb', type: 'dust', on: 'side-right', edge: 'top', depth: null, side: null },
    { id: 'dust-rf', type: 'dust', on: 'side-right', edge: 'bottom', depth: null, side: null },
    { id: 'lip', type: 'tuck', on: 'lid', edge: 'top', depth: null, side: null },
    { id: 'lip-left', type: 'tab', on: 'lid', edge: 'left', depth: 'H', side: 'out' },
    { id: 'lip-right', type: 'tab', on: 'lid', edge: 'right', depth: 'H', side: 'out' },
  ],
  holes: [],
  explanation: 'ฐานกลาง ผนังพับขึ้นสี่ด้าน ฝาต่อจากผนังหลัง ลิ้นหน้าเสียบลงด้านใน ปีกข้างฝาห่อลงนอกผนังข้าง',
}

// ถาดเปิด: ฐาน + ผนัง 4 ด้าน + ลิ้นมุมจากผนังข้างพับเข้าในผนังหน้า-หลัง (ไม่มีฝา — ด้านบนเปิดโดยตั้งใจ)
export const TRAY_STRUCTURE: BoxStructure = {
  name: 'ถาดเปิด',
  orientation: 'base',
  panels: [
    { id: 'base', kind: 'body', attach: null, w: 'W', h: 'D', size: null },
    { id: 'side-left', kind: 'body', attach: { to: 'base', edge: 'left', fold: 90 }, w: null, h: null, size: 'H' },
    { id: 'side-right', kind: 'body', attach: { to: 'base', edge: 'right', fold: 90 }, w: null, h: null, size: 'H' },
    { id: 'front', kind: 'body', attach: { to: 'base', edge: 'bottom', fold: 90 }, w: null, h: null, size: 'H' },
    { id: 'back', kind: 'body', attach: { to: 'base', edge: 'top', fold: 90 }, w: null, h: null, size: 'H' },
  ],
  flaps: [
    { id: 'corner-lb', type: 'tab', on: 'side-left', edge: 'top', depth: null, side: null },
    { id: 'corner-lf', type: 'tab', on: 'side-left', edge: 'bottom', depth: null, side: null },
    { id: 'corner-rb', type: 'tab', on: 'side-right', edge: 'top', depth: null, side: null },
    { id: 'corner-rf', type: 'tab', on: 'side-right', edge: 'bottom', depth: null, side: null },
  ],
  holes: [],
  explanation: 'ถาดสี่เหลี่ยมผนังตั้ง ลิ้นมุมจากผนังข้างพับเข้าด้านในผนังหน้า-หลังแล้วทากาว',
}

// กล่องฝาเสียบกลับด้าน (reverse tuck): ฝาบนต่อผนังหน้า ฝาล่างต่อผนังหลัง — ไม่มีใน template registry
// AI ประกอบเองในเช็คสด 17 ต.ค. 2026 ผ่านทุกตัวตรวจรอบแรก; เก็บไว้เป็น regression ว่าภาษาแผงสร้างแบบนอกแคตตาล็อกได้
export const REVERSE_TUCK_STRUCTURE: BoxStructure = {
  name: 'กล่องท่อฝาเสียบกลับด้าน',
  orientation: 'front',
  panels: [
    { id: 'front', kind: 'body', attach: null, w: 'W', h: 'H', size: null },
    { id: 'side-left', kind: 'body', attach: { to: 'front', edge: 'left', fold: 90 }, w: null, h: null, size: 'D' },
    { id: 'glue', kind: 'glue', attach: { to: 'side-left', edge: 'left', fold: 90 }, w: null, h: null, size: null },
    { id: 'side-right', kind: 'body', attach: { to: 'front', edge: 'right', fold: 90 }, w: null, h: null, size: 'D' },
    { id: 'back', kind: 'body', attach: { to: 'side-right', edge: 'right', fold: 90 }, w: null, h: null, size: 'W' },
    { id: 'tuck-top', kind: 'lid', attach: { to: 'front', edge: 'top', fold: 90 }, w: null, h: null, size: 'D' },
    { id: 'tuck-bot', kind: 'lid', attach: { to: 'back', edge: 'bottom', fold: 90 }, w: null, h: null, size: 'D' },
  ],
  flaps: [
    { id: 'dust-tl', type: 'dust', on: 'side-left', edge: 'top', depth: null, side: null },
    { id: 'dust-tr', type: 'dust', on: 'side-right', edge: 'top', depth: null, side: null },
    { id: 'dust-bl', type: 'dust', on: 'side-left', edge: 'bottom', depth: null, side: null },
    { id: 'dust-br', type: 'dust', on: 'side-right', edge: 'bottom', depth: null, side: null },
    { id: 'tongue-top', type: 'tuck', on: 'tuck-top', edge: 'top', depth: null, side: null },
    { id: 'tongue-bot', type: 'tuck', on: 'tuck-bot', edge: 'bottom', depth: null, side: null },
  ],
  holes: [],
  explanation: 'ท่อสี่ผนัง+ปีกทากาว ฝาบนเสียบต่อจากผนังหน้า ฝาล่างเสียบต่อจากผนังหลัง (กลับด้านกัน) ลิ้นกันฝุ่นอยู่ที่ขอบบน-ล่างของผนังข้างทั้งสอง',
}

// กล่องหูหิ้วฝาประกบ (เช่น กล่องขวด/ของขวัญถือกลับ): ท่อ 4 ผนัง ฝาบนแยกสองซีกจากผนังหน้า-หลัง แต่ละซีกต่อแผงหูหิ้ว
// ที่พับตั้งขึ้น (fold -90) มาประกบกันกลางกล่อง เจาะรูมือทั้งสองแผงให้ตรงกัน ก้นเป็นฝาเสียบ — แสดงการใช้ fold -90 + holes
export const HANDLE_BOX_STRUCTURE: BoxStructure = {
  name: 'กล่องหูหิ้วฝาประกบ',
  orientation: 'front',
  panels: [
    { id: 'front', kind: 'body', attach: null, w: 'W', h: 'H', size: null },
    { id: 'side-left', kind: 'body', attach: { to: 'front', edge: 'left', fold: 90 }, w: null, h: null, size: 'D' },
    { id: 'glue', kind: 'glue', attach: { to: 'side-left', edge: 'left', fold: 90 }, w: null, h: null, size: null },
    { id: 'side-right', kind: 'body', attach: { to: 'front', edge: 'right', fold: 90 }, w: null, h: null, size: 'D' },
    { id: 'back', kind: 'body', attach: { to: 'side-right', edge: 'right', fold: 90 }, w: null, h: null, size: 'W' },
    { id: 'lid-f', kind: 'lid', attach: { to: 'front', edge: 'top', fold: 90 }, w: null, h: null, size: 'D/2' },
    { id: 'lid-b', kind: 'lid', attach: { to: 'back', edge: 'top', fold: 90 }, w: null, h: null, size: 'D/2' },
    { id: 'handle-f', kind: 'body', attach: { to: 'lid-f', edge: 'top', fold: -90 }, w: null, h: null, size: 45 },
    { id: 'handle-b', kind: 'body', attach: { to: 'lid-b', edge: 'top', fold: -90 }, w: null, h: null, size: 45 },
    { id: 'tuck-bot', kind: 'lid', attach: { to: 'back', edge: 'bottom', fold: 90 }, w: null, h: null, size: 'D' },
  ],
  flaps: [
    { id: 'dust-tl', type: 'dust', on: 'side-left', edge: 'top', depth: null, side: null },
    { id: 'dust-tr', type: 'dust', on: 'side-right', edge: 'top', depth: null, side: null },
    { id: 'dust-bl', type: 'dust', on: 'side-left', edge: 'bottom', depth: null, side: null },
    { id: 'dust-br', type: 'dust', on: 'side-right', edge: 'bottom', depth: null, side: null },
    { id: 'tongue-bot', type: 'tuck', on: 'tuck-bot', edge: 'bottom', depth: null, side: null },
  ],
  holes: [
    { id: 'hole-f', type: 'hand-hole', on: 'handle-f', anchor: 'center', length: null, height: null },
    { id: 'hole-b', type: 'hand-hole', on: 'handle-b', anchor: 'center', length: null, height: null },
  ],
  explanation: 'ท่อสี่ผนัง ฝาบนสองซีกจากผนังหน้า-หลังปิดชนกัน แต่ละซีกต่อแผงหูหิ้วตั้งขึ้นประกบกันกลางกล่อง เจาะรูมือตรงกัน ก้นเป็นฝาเสียบพร้อมลิ้นกันฝุ่น',
}

export const EXAMPLE_STRUCTURES: readonly BoxStructure[] = [
  TUCK_END_STRUCTURE,
  MAILER_STRUCTURE,
  TRAY_STRUCTURE,
  REVERSE_TUCK_STRUCTURE,
  HANDLE_BOX_STRUCTURE,
]
