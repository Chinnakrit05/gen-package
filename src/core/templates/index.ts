import type { BoxParams, Dieline, Material } from '../types'
import { generateTuckEndBox } from './tuckEnd'
import { generateMailerBox } from './mailer'
import { generateFefco0427 } from './fefco0427'
import { generateSleeve } from './sleeve'
import { generateBottleCarrier } from './bottleCarrier'
import { generateTrayBox } from './tray'
import { generateGableBox } from './gable'
import { generateRSCBox } from './rsc'
import { generateCard } from './card'
import { generateSticker } from './sticker'
import { generateLidBox } from './lidBox'
import { generateSlideBox } from './slideBox'
import { generateWedgeBox } from './wedge'

export interface BoxTemplate {
  id: string
  nameTh: string
  detail: string
  defaults: BoxParams
  tilt: number
  supportsHandle: boolean
  supportsVents?: boolean // รองรับรูระบายอากาศ (กล่องทรงปิด/ถาดที่มีผนังตั้ง)
  foldDepth: (box: BoxParams, mat: Material) => number
  generate: (box: BoxParams, mat: Material) => Dieline
}

export const TEMPLATES: BoxTemplate[] = [
  {
    id: 'tuck-end',
    nameTh: 'กล่องฝาเสียบ (tuck end)',
    detail: 'กล่องสินค้าทั่วไป เครื่องสำอาง/ยา/ของชิ้นเดียว เสียบฝาหัว-ท้าย',
    defaults: { W: 80, D: 50, H: 120 },
    tilt: 0,
    supportsHandle: true,
    supportsVents: true,
    foldDepth: (b, m) => b.D + 2 * m.thickness,
    generate: generateTuckEndBox,
  },
  {
    id: 'mailer',
    nameTh: 'กล่องไปรษณีย์ (mailer)',
    detail: 'กล่องฝาเปิดด้านบนแบบ e-commerce แข็งแรง เหมาะส่งของ/ของฝากหลายชิ้น',
    defaults: { W: 200, D: 140, H: 60 },
    tilt: -Math.PI / 2,
    supportsHandle: true,
    supportsVents: true,
    foldDepth: (b, m) => b.H + m.thickness,
    generate: generateMailerBox,
  },
  {
    id: 'fefco-0427',
    nameTh: 'กล่องไปรษณีย์ฝาล็อก (FEFCO 0427)',
    detail: 'mailer มาตรฐานอุตสาหกรรม ผนังข้างม้วนสองชั้น ลิ้นล็อกเสียบฐาน แข็งแรง ไม่ใช้กาว',
    defaults: { W: 200, D: 140, H: 60 },
    tilt: -Math.PI / 2,
    supportsHandle: false,
    supportsVents: true,
    foldDepth: (b, m) => b.H + m.thickness,
    generate: generateFefco0427,
  },
  {
    id: 'rsc',
    nameTh: 'กล่องลูกฟูก RSC (FEFCO 0201)',
    detail: 'กล่องชิปปิ้งมาตรฐาน ผนัง 4 ด้านเป็นท่อ ลิ้นบน-ล่างพับมาชนกลาง ปิดสองชั้น แข็งแรง ใช้กับสินค้าทั่วไป',
    defaults: { W: 250, D: 200, H: 150 },
    tilt: 0,
    supportsHandle: false,
    supportsVents: true,
    foldDepth: (b, m) => b.D + 2 * m.thickness,
    generate: generateRSCBox,
  },
  {
    id: 'bottle-carrier',
    nameTh: 'กล่องหูหิ้วขวด (bottle carrier)',
    detail: 'ตะกร้าเปิดบน หูหิ้วกลางเจาะรูมือ + หน้าต่างโชว์สินค้า สำหรับขวด 2-6 ขวด',
    defaults: { W: 150, D: 150, H: 230 },
    tilt: -Math.PI / 2,
    supportsHandle: false,
    foldDepth: (b) => b.H + 55,
    generate: generateBottleCarrier,
  },
  {
    id: 'sleeve',
    nameTh: 'ปลอกสวม (sleeve)',
    detail: 'ปลอกรัดรอบกล่อง/ถาด เปิดสองด้าน ใช้เป็นแบนด์พิมพ์ลาย',
    defaults: { W: 80, D: 50, H: 60 },
    tilt: 0,
    supportsHandle: false,
    foldDepth: (b, m) => b.D + 2 * m.thickness,
    generate: generateSleeve,
  },
  {
    id: 'lid-box',
    nameTh: 'กล่องฝาครอบ (telescoping lid)',
    detail: 'ฐานถาดลึก + ฝาครอบถาดตื้นสวมทับ 2 ชิ้น — กล่องของขวัญ/รองเท้า/เครื่องสำอางพรีเมียม',
    defaults: { W: 160, D: 110, H: 70 },
    tilt: -Math.PI / 2,
    supportsHandle: false,
    foldDepth: (b, m) => b.H + m.thickness,
    generate: generateLidBox,
  },
  {
    id: 'slide-box',
    nameTh: 'กล่องฝาสไลด์ (matchbox)',
    detail: 'ลิ้นชัก (ถาด) เลื่อนเข้า-ออกในปลอกสวมภายนอก 2 ชิ้น — กล่องเครื่องประดับ/ของขวัญชิ้นเล็ก/ไม้ขีด',
    defaults: { W: 90, D: 120, H: 35 },
    tilt: -Math.PI / 2,
    supportsHandle: false,
    foldDepth: (b, m) => b.H + m.thickness,
    generate: generateSlideBox,
  },
  {
    id: 'wedge',
    nameTh: 'กล่องแซนวิช (wedge)',
    detail: 'ปริซึมสามเหลี่ยม ฐาน+ผนังหลัง+ฝาเฉียง+ผนังข้างสามเหลี่ยม — ใส่แซนวิช/ขนมชิ้นสามเหลี่ยม',
    defaults: { W: 120, D: 110, H: 80 },
    tilt: -Math.PI / 2,
    supportsHandle: false,
    foldDepth: (b, m) => b.H + m.thickness,
    generate: generateWedgeBox,
  },
  {
    id: 'tray',
    nameTh: 'กล่องถาด (open tray)',
    detail: 'ถาดเปิดบน ผนัง 4 ด้านพับขึ้น มุมมีลิ้นล็อกด้านใน — ถาดอาหาร/ดิสเพลย์ หรือลิ้นชักคู่กับ sleeve',
    defaults: { W: 160, D: 110, H: 40 },
    tilt: -Math.PI / 2,
    supportsHandle: false,
    supportsVents: true,
    foldDepth: (b, m) => b.H + m.thickness,
    generate: generateTrayBox,
  },
  {
    id: 'gable',
    nameTh: 'กล่องหูหิ้วทรงจั่ว (gable)',
    detail: 'กล่องหลังคาทรงจั่ว หูหิ้วในตัวที่สัน — ของขวัญ/เบเกอรี่/อาหาร ดูพรีเมียม',
    defaults: { W: 120, D: 100, H: 150 },
    tilt: -Math.PI / 2,
    supportsHandle: false,
    supportsVents: true,
    foldDepth: (b) => b.H + b.D * 0.6,
    generate: generateGableBox,
  },
  {
    id: 'card',
    nameTh: 'นามบัตร (business card)',
    detail: 'การ์ดแบนพิมพ์ ขนาดมาตรฐาน 90×54 มม. — ออกแบบได้ทั้งด้านหน้าและด้านหลัง ไม่มีรอยพับ',
    defaults: { W: 90, D: 54, H: 54 },
    tilt: 0,
    supportsHandle: false,
    foldDepth: () => 0,
    generate: generateCard,
  },
  {
    id: 'sticker',
    nameTh: 'สติกเกอร์ไดคัท (die-cut sticker)',
    detail: 'สติกเกอร์พิมพ์แบนชิ้นเดียว ไดคัทตามรูป มุมมน — ฉลากสินค้า/โลโก้ ไม่มีรอยพับ',
    defaults: { W: 60, D: 60, H: 60 },
    tilt: 0,
    supportsHandle: false,
    foldDepth: () => 0,
    generate: generateSticker,
  },
]

export function getTemplate(id: string): BoxTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]
}
