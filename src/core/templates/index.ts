import type { BoxParams, Dieline, Material } from '../types'
import { generateTuckEndBox } from './tuckEnd'
import { generateMailerBox } from './mailer'
import { generateSleeve } from './sleeve'
import { generateBottleCarrier } from './bottleCarrier'

export interface BoxTemplate {
  id: string
  nameTh: string
  detail: string
  defaults: BoxParams
  tilt: number
  supportsHandle: boolean
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
    foldDepth: (b, m) => b.H + m.thickness,
    generate: generateMailerBox,
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
]

export function getTemplate(id: string): BoxTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]
}
