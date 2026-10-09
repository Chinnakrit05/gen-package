import type { BoxParams, Dieline, Material } from '../types'
import { generateTuckEndBox } from './tuckEnd'
import { generateMailerBox } from './mailer'
import { generateFefco0427, FEFCO0427_SPIN as SPIN_0427 } from './fefco0427'
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
import { generateRolloverMailer } from './rolloverMailer'
// import { generateWedgeBox } from './wedge' // กล่องแซนวิช — ซ่อนไว้ก่อน (re-add เมื่อเปิดใช้)

export interface BoxTemplate {
  id: string
  nameTh: string
  detail: string
  defaults: BoxParams
  tilt: number
  // หมุนแผ่นในระนาบใน 3D (rad, ก่อนเอียง) — ใช้เมื่อ generate หมุนผัง dieline ให้ตรงแบบมาตรฐาน
  spin?: number
  supportsHandle: boolean
  supportsVents?: boolean // รองรับรูระบายอากาศ (กล่องทรงปิด/ถาดที่มีผนังตั้ง)
  foldDepth: (box: BoxParams, mat: Material) => number
  generate: (box: BoxParams, mat: Material) => Dieline
}

export const TEMPLATES: BoxTemplate[] = [
  {
    id: 'tuck-end',
    nameTh: 'กล่องฝาเสียบ (tuck end)',
    detail: 'เครื่องสำอาง · ยา/อาหารเสริม · ขนม · สินค้าชิ้นเดียวทั่วไป',
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
    detail: 'ส่งของออนไลน์ · กล่อง subscription · ชุดของฝากหลายชิ้น',
    defaults: { W: 200, D: 140, H: 60 },
    tilt: -Math.PI / 2,
    supportsHandle: true,
    supportsVents: true,
    foldDepth: (b, m) => b.H + m.thickness,
    generate: generateMailerBox,
  },
  {
    id: 'rollover-mailer',
    nameTh: 'กล่องไปรษณีย์ขอบม้วน (rollover mailer)',
    detail: 'กล่องแบรนด์พรีเมียม · ส่งเสื้อผ้า/เครื่องสำอาง · ของขวัญ',
    defaults: { W: 220, D: 150, H: 70 },
    tilt: -Math.PI / 2,
    supportsHandle: false,
    foldDepth: (b, m) => b.H + m.thickness,
    generate: generateRolloverMailer,
  },
  {
    id: 'fefco-0427',
    nameTh: 'กล่องไปรษณีย์ฝาล็อก (FEFCO 0427)',
    detail: 'ส่งหนังสือ/ของหนัก · อีคอมเมิร์ซ · สินค้ากันกระแทก',
    defaults: { W: 200, D: 140, H: 60 },
    tilt: -Math.PI / 2,
    spin: SPIN_0427,
    supportsHandle: false,
    supportsVents: true,
    foldDepth: (b, m) => b.H + m.thickness,
    generate: generateFefco0427,
  },
  {
    id: 'fefco-0215',
    nameTh: 'กล่องฝาบนก้นล็อก (FEFCO 0215)',
    detail: 'สินค้ารีเทลวางชั้น · เครื่องสำอาง · ขนม/อาหารแห้ง',
    defaults: { W: 90, D: 60, H: 150 },
    tilt: 0,
    supportsHandle: false,
    foldDepth: (b, m) => b.D + 2 * m.thickness,
    generate: generateFefco0215,
  },
  {
    id: 'fefco-0202',
    nameTh: 'กล่องลูกฟูกลิ้นเกย OSC (FEFCO 0202)',
    detail: 'ของหนัก/ทรงสูงแคบ · ขวด · อะไหล่/ชิ้นส่วน',
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
    detail: 'ลังขนส่งทั่วไป · สต็อก/กระจายสินค้า · สินค้าจำนวนมาก',
    defaults: { W: 250, D: 200, H: 150 },
    tilt: 0,
    supportsHandle: false,
    supportsVents: true,
    foldDepth: (b, m) => b.D + 2 * m.thickness,
    generate: generateRSCBox,
  },
  {
    id: 'fefco-0217',
    nameTh: 'กล่องหูหิ้วทรงจั่ว (FEFCO 0217)',
    detail: 'เค้ก/เบเกอรี่ · ของฝากถือกลับ · ชุดของขวัญ',
    defaults: { W: 300, D: 150, H: 180 },
    tilt: 0,
    supportsHandle: false,
    foldDepth: (b, m) => b.D + 2 * m.thickness,
    generate: generateFefco0217,
  },
  {
    id: 'bottle-carrier',
    nameTh: 'กล่องหูหิ้วขวด (bottle carrier)',
    detail: 'ขวดน้ำ/น้ำผลไม้ · เบียร์คราฟท์ · ซอส/เครื่องปรุง (2-6 ขวด)',
    defaults: { W: 150, D: 150, H: 230 },
    tilt: -Math.PI / 2,
    supportsHandle: false,
    foldDepth: (b) => b.H + 55,
    generate: generateBottleCarrier,
  },
  {
    id: 'sleeve',
    nameTh: 'ปลอกสวม (sleeve)',
    detail: 'แบนด์รอบกล่องอาหาร · สบู่/เทียนหอม · เซ็ตของขวัญ',
    defaults: { W: 80, D: 50, H: 60 },
    tilt: 0,
    supportsHandle: false,
    foldDepth: (b, m) => b.D + 2 * m.thickness,
    generate: generateSleeve,
  },
  {
    id: 'lid-box',
    nameTh: 'กล่องฝาครอบ (FEFCO 0300 telescope)',
    detail: 'ของขวัญพรีเมียม · รองเท้า · เซ็ตเครื่องสำอาง',
    defaults: { W: 160, D: 110, H: 70 },
    tilt: -Math.PI / 2,
    supportsHandle: false,
    foldDepth: (b, m) => b.H + m.thickness,
    generate: generateLidBox,
  },
  {
    id: 'slide-box',
    nameTh: 'กล่องฝาสไลด์ (matchbox)',
    detail: 'เครื่องประดับ · ของขวัญชิ้นเล็ก · ช็อกโกแลต/ขนม',
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
    detail: 'ของโชว์หน้าร้าน · ฟิกเกอร์/ของสะสม · ของขวัญโชว์สินค้า',
    defaults: { W: 140, D: 90, H: 140 },
    tilt: -Math.PI / 2,
    supportsHandle: false,
    foldDepth: (b, m) => b.H + m.thickness,
    generate: generateDisplayBox,
  },
  {
    id: 'tray',
    nameTh: 'กล่องถาด (open tray)',
    detail: 'ถาดอาหาร/เบเกอรี่ · ดิสเพลย์หน้าร้าน · ลิ้นชักคู่ปลอกสวม',
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
    detail: 'เบเกอรี่/ขนม · อาหารถือกลับ · ชุดของขวัญ',
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
    detail: 'นามบัตร · การ์ดสะสม · คูปอง/การ์ดเชิญ',
    defaults: { W: 90, D: 54, H: 54 },
    tilt: 0,
    supportsHandle: false,
    foldDepth: () => 0,
    generate: generateCard,
  },
  {
    id: 'sticker',
    nameTh: 'สติกเกอร์ไดคัท (die-cut sticker)',
    detail: 'ฉลากสินค้า · โลโก้แบรนด์ · สติกเกอร์ตกแต่ง',
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
