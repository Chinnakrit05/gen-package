import type { BoxParams, Dieline, DimMark, Material, Panel, Segment } from '../types'
import { P, fmt } from './shared'
import { buildTrayPiece, trayPieceSize } from './trayPiece'

// กล่องฝาครอบ (FEFCO 0300 telescope) — 2 ชิ้น: ถาดฐาน + ถาดฝา ลึกเท่ากัน ฝาใหญ่กว่าเล็กน้อยให้สวมทับฐาน
// แต่ละชิ้น = ฐาน + ผนัง 4 ด้าน + ลิ้นมุมสี่เหลี่ยมเต็มที่ผนังซ้าย-ขวา (มีร่องหลบข้างผนังหน้า-หลัง) ตามแบบ dieline มาตรฐาน
// 3D: พับถาดทั้งสองชิ้น → พลิกฝา 180° ข้ามมาวางบนขอบฐาน (stage 4) → สวมลงจนมิดฐาน (stage 5, `slide`)
// — ฐานฝาเป็นแผงลูกของฐานกล่อง หมุนรอบแกนสมมติกึ่งกลางระหว่างสองชิ้น (assemble) + ยกขึ้นตาม zOffset;
//   ต้องพลิกเสร็จก่อนค่อยสวมลง ถ้าหมุนลงตรง ๆ ผนังฝาจะกวาดทะลุผนังฐาน (stage 3 เว้นว่างให้ได้ชุดจังหวะ 6)
// W,D,H = ขนาดด้านในของฐาน
export const LID_CLEAR = 0.8 // ระยะเผื่อให้ฝาสวมฐานได้ (มม.)
export const LID_SEAT = 0.1 // ระยะผิวในฝาเหนือขอบฐานตอนสวมมิด (กัน z-fighting)

export function generateLidBox(box: BoxParams, mat: Material): Dieline {
  const { W, D, H } = box
  const t = mat.thickness

  // ฝาสวมภายนอกฐาน: ด้านในฝา = ด้านนอกฐาน + เผื่อ; ลึกเท่าฐาน (telescope เต็ม)
  const lidW = W + 2 * t + LID_CLEAR
  const lidD = D + 2 * t + LID_CLEAR
  const lidH = H

  const GAP = 14
  const base = trayPieceSize(W, D, H, t)
  const lid = trayPieceSize(lidW, lidD, lidH, t)
  // จัดกึ่งกลางแนวตั้งของสองชิ้นให้ตรงกัน — ฝาพลิกข้ามมาแล้วตรงฐานพอดี
  const byOff = (lid.h - base.h) / 2
  const bx = base.w + GAP

  const basePiece = buildTrayPiece('b-', 0, byOff, W, D, H, t, 1, { squareCorners: true })
  const lidPiece = buildTrayPiece('l-', bx, 0, lidW, lidD, lidH, t, 1, { squareCorners: true })

  // พลิกฝา: แกนแนวตั้งกึ่งกลางระหว่างศูนย์กลางสองชิ้น → หมุน 180° แล้วศูนย์กลางฝาตกตรงศูนย์กลางฐาน
  // ยกขึ้นจนขอบฝาวางบนขอบฐาน: ผิวบนฝา = สูงผนังฐาน + สูงผนังฝา (zOffset ท้องถิ่นชี้ลงหลังพลิก → ติดลบ)
  // แล้วสวมลง (+z ท้องถิ่น = ลงในโลก) จนผิวในฝาห่างขอบฐาน LID_SEAT → ขอบฝาลงเกือบถึงพื้น ครอบฐานมิด
  const xcB = base.w / 2
  const xcL = bx + lid.w / 2
  const xh = (xcB + xcL) / 2
  const Hpb = H + t
  const Hpl = lidH + t
  const lidPanels: Panel[] = lidPiece.panels.map((p) =>
    p.id === 'l-base'
      ? {
          ...p,
          parentId: 'b-base',
          hingeA: P(xh, 0),
          hingeB: P(xh, lid.h),
          foldAngle: 180,
          stage: 4,
          zOffset: -(Hpb + Hpl),
          slide: { dz: Hpl - t - LID_SEAT, stage: 5 },
          assemble: true,
        }
      : p,
  )

  const panels: Panel[] = [...basePiece.panels, ...lidPanels]
  const segments: Segment[] = [...basePiece.segments, ...lidPiece.segments]

  const width = lidPiece.bbox.x1
  const height = Math.max(basePiece.bbox.y1, lidPiece.bbox.y1)

  const dims: DimMark[] = [
    { a: P(basePiece.bbox.x0, height + 12), b: P(basePiece.bbox.x1, height + 12), label: `ฐาน ${fmt(W)}×${fmt(D)}×${fmt(H)}` },
    { a: P(lidPiece.bbox.x0, height + 12), b: P(lidPiece.bbox.x1, height + 12), label: `ฝา ${fmt(lidW)}×${fmt(lidD)}×${fmt(lidH)}` },
  ]

  return { width, height, segments, panels, dims }
}
