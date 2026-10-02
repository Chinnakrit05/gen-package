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
import { generateDisplayBox } from './displayBox'
import { generateFefco0215 } from './fefco0215'
import { generateFefco0202 } from './fefco0202'
import { generateFefco0217 } from './fefco0217'
// import { generateWedgeBox } from './wedge' // กล่องแซนวิช — ซ่อนไว้ก่อน (re-add เมื่อเปิดใช้)

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
    nameTh: 'กล่องไปรษณีย์ฝาพับ (≈FEFCO 0426)',
    detail: 'กล่องฝาเปิดด้านบนแบบ e-commerce ถาด+ฝาพับในตัว (ตระกูล FEFCO 0426) แข็งแรง เหมาะส่งของ/ของฝากหลายชิ้น',
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
    id: 'fefco-0215',
    nameTh: 'กล่องฝาบนก้นล็อก (FEFCO 0215)',
    detail: 'ฝาบนเสียบ + ก้นล็อกอัตโนมัติ (snap-lock) ประกอบเร็วไม่ต้องทากาวก้น — กล่องรีเทลยอดนิยม',
    defaults: { W: 90, D: 60, H: 150 },
    tilt: 0,
    supportsHandle: false,
    foldDepth: (b, m) => b.D + 2 * m.thickness,
    generate: generateFefco0215,
  },
  {
    id: 'fefco-0202',
    nameTh: 'กล่องลูกฟูกลิ้นเกย OSC (FEFCO 0202)',
    detail: 'ชิปปิ้งแบบ RSC แต่ลิ้นหน้า-หลังยาวเต็มเกยทับกันเต็มแผ่น — ก้น/ฝาสองชั้น แข็งแรงกว่า เหมาะของหนัก/ของแคบ',
    defaults: { W: 120, D: 90, H: 180 },
    tilt: 0,
    supportsHandle: false,
    supportsVents: true,
    foldDepth: (b, m) => b.D + 2 * m.thickness,
    generate: generateFefco0202,
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
    id: 'fefco-0217',
    nameTh: 'กล่องหูหิ้วบนก้นล็อก (FEFCO 0217)',
    detail: 'กล่องรีเทลมีหูหิ้วด้านบน (ลิ้นหน้า-หลังชนเป็นหูเจาะรูจับ) + ก้นล็อกอัตโนมัติ — เค้ก/เบเกอรี่/ของฝากถือสะดวก',
    defaults: { W: 160, D: 100, H: 120 },
    tilt: 0,
    supportsHandle: false,
    foldDepth: (b, m) => b.D + 2 * m.thickness,
    generate: generateFefco0217,
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
    nameTh: 'กล่องฝาครอบ (FEFCO 0300 telescope)',
    detail: 'ฐานถาดลึก + ฝาครอบถาดตื้นสวมทับ 2 ชิ้น (FEFCO 0300 FTSSC) — กล่องของขวัญ/รองเท้า/เครื่องสำอางพรีเมียม',
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
  // กล่องแซนวิช (wedge) — ซ่อนจาก UI ไว้ก่อน (generator/เทสต์ยังอยู่ใน wedge.ts) เปิดใช้ได้โดย uncomment
  // {
  //   id: 'wedge',
  //   nameTh: 'กล่องแซนวิช (wedge)',
  //   detail: 'ปริซึมสามเหลี่ยม ฐาน+ผนังหลัง+ฝาเฉียง+ผนังข้างสามเหลี่ยม — ใส่แซนวิช/ขนมชิ้นสามเหลี่ยม',
  //   defaults: { W: 120, D: 110, H: 80 },
  //   tilt: -Math.PI / 2,
  //   supportsHandle: false,
  //   foldDepth: (b, m) => b.H + m.thickness,
  //   generate: generateWedgeBox,
  // },
  {
    id: 'display-box',
    nameTh: 'กล่องฝาข้าง/หน้าต่าง (display)',
    detail: 'กล่องปิด 5 ด้าน + ฝาหน้าเปิดได้ เจาะหน้าต่างโชว์สินค้า — กล่องโชว์/ของขวัญ/ของสะสม',
    defaults: { W: 140, D: 90, H: 140 },
    tilt: -Math.PI / 2,
    supportsHandle: false,
    foldDepth: (b, m) => b.H + m.thickness,
    generate: generateDisplayBox,
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
