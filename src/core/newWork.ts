import { getMaterial, packKind } from './materials'
import { freshProject, type Project } from './project'
import type { PouchStyle } from './pouch'
import { standardSizeFor } from './standardSize'
import { getTemplate } from './templates'

// งานใหม่จากการเปลี่ยนประเภทงาน/รูปแบบ ตอนงานเดิมมีการตกแต่งแล้ว (pure): งานเดิมถูกบันทึกไว้ตามเดิม
// แล้วเปิดชิ้นงานใหม่ที่ "ไม่มีอะไรจากงานเก่าเลย" — ค่าเริ่มต้นของ freshProject + เฉพาะสิ่งที่ผู้ใช้เลือก
// (template/วัสดุ/รูปแบบถุง) ขนาดตามมาตรฐานของแบบนั้น (กล่อง = defaults ของ template, ภาชนะ/ถุง = standardSize)
export interface NewWorkTarget {
  template: string
  materialId: string
  pouchStyle?: PouchStyle
}

export function freshProjectFor(n: number, target: NewWorkTarget): Project {
  const p = freshProject(n)
  const mat = getMaterial(target.materialId)
  const kind = packKind(mat)
  const tp = getTemplate(target.template)
  const style = target.pouchStyle ?? 'stand'
  const size = kind === 'box' ? tp.defaults : (standardSizeFor(mat.id, style, kind) ?? tp.defaults)
  p.live = { template: tp.id, materialId: mat.id, W: size.W, D: size.D, H: size.H, handle: false }
  if (kind === 'pouch' && style !== 'stand') p.pouchStyle = style
  return p
}
