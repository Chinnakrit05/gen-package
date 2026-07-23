import type { BoxParams, Dieline, DimMark, Material, Panel, Segment } from '../types'
import { P, arcPts, fmt, obroundPath, obroundPts, rect } from './shared'

// FEFCO 0427 ตัวเต็ม (roll end tray with lock front)
// ต่างจาก mailer อย่างย่อตรงหัวใจของแบบนี้: ผนังข้างเป็นสองชั้นแบบม้วนกลับ (roll end)
// ปลายแผ่นม้วนมีลิ้นล็อกเสียบลงช่องที่เจาะบนฐาน หูมุมของผนังหน้า-หลังถูกแผ่นม้วนทับไว้
// จึงแข็งแรงและประกอบได้โดยไม่ใช้กาวเลย — W,D,H คือขนาดด้านใน
//
// ผังแผ่นคลี่ (x ขวา y ลง):
//   คอลัมน์: [ลิ้น|ม้วนซ้าย|ผนังซ้าย|  ฐาน  |ผนังขวา|ม้วนขวา|ลิ้น]
//   แถว:     ลิ้นฝา / ฝา / ผนังหลัง(+หู) / ฐาน / ผนังหน้า(+หู)
export function generateFefco0427(box: BoxParams, mat: Material): Dieline {
  const { W, D, H } = box
  const t = mat.thickness

  const Wp = W + 2 * t
  const Dp = D + 2 * t
  const Hp = H + t
  const layer = t + 0.05

  // แผ่นม้วนสั้นกว่าผนัง t กันปลายชนฐาน และหดปลายบน-ล่างหลบหูมุม
  const rollW = Math.max(6, Hp - t)
  const rollIns = Math.max(1.5, 2 * t)
  // ลิ้นล็อกยื่นจากขอบแผ่นม้วน + ช่องเสียบบนฐาน (ยาวกว่าลิ้นเล็กน้อยให้เสียบง่าย)
  const tabL = Math.max(5, Math.min(8, 0.35 * rollW))
  const tabW = Math.max(12, Math.min(26, 0.22 * Dp))
  const slotL = tabW + 1.5
  const slotW = Math.max(1.5, t + 0.6)
  const slotOff = Math.max(2, 2.5 * t) // ระยะช่องจากขอบฐาน = ความหนาผนัง+ม้วน
  // หูมุมของผนังหน้า-หลัง พับเข้าแนบผนังข้าง แล้วถูกแผ่นม้วนทับ
  const earW = Math.max(8, Math.min(0.9 * Hp, 0.4 * Dp))
  const earIns = Math.max(1.5, t + 0.5)
  const topIns = Math.max(1.5, 2 * t)
  const earSlant = Math.min(6, earW * 0.5)
  // ลิ้นหน้าของฝา พร้อมบ่าล็อกเล็ก ๆ สองข้าง (front lock)
  const tuckIn = Math.max(1, t + 0.5)
  const lipH = Math.max(10, Math.min(0.7 * Hp, 0.8 * Dp))
  const lockW = Math.min(4, tuckIn + 3)
  const lockH = Math.min(10, lipH * 0.5)
  const r = Math.min(7, lipH * 0.45, (Wp - 2 * tuckIn) / 2)

  // แกน x
  const xr0 = tabL
  const xr1 = xr0 + rollW
  const cx0 = xr1 + Hp
  const cx1 = cx0 + Wp
  const xr2 = cx1 + Hp
  const xr3 = xr2 + rollW
  const width = xr3 + tabL
  // แกน y
  const y1 = lipH
  const y2 = y1 + Dp
  const y3 = y2 + Hp
  const y4 = y3 + Dp
  const y5 = y4 + Hp
  const height = y5

  // ตำแหน่งลิ้น/ช่อง ตามแนว D สองจุดต่อข้าง
  const yc1 = y3 + Dp * 0.28
  const yc2 = y3 + Dp * 0.72

  // แผ่นม้วน: สี่เหลี่ยมหดปลาย + ลิ้นล็อกสองอันบนขอบอิสระ
  const rollOutline = (x0: number, x1: number, tabX: number): { pts: ReturnType<typeof P>[] } => {
    // x0 = ขอบพับ (hinge), x1 = ขอบอิสระ, tabX = ปลายลิ้น
    const pts = [P(x0, y3 + rollIns), P(x1, y3 + rollIns)]
    for (const yc of [yc1, yc2]) {
      pts.push(P(x1, yc - tabW / 2))
      pts.push(P(tabX, yc - tabW / 2 + 1.5))
      pts.push(P(tabX, yc + tabW / 2 - 1.5))
      pts.push(P(x1, yc + tabW / 2))
    }
    pts.push(P(x1, y4 - rollIns), P(x0, y4 - rollIns))
    return { pts }
  }

  const earPts = (hx: number, dir: 1 | -1, ya: number, yb: number) => [
    // hx = เส้นพับ, dir = ทิศยื่น (-1 ซ้าย +1 ขวา), ya..yb = แถวผนัง (ya คือฝั่งสันพับกับฐาน)
    P(hx, ya + earIns),
    P(hx + dir * earW, ya + earIns + earSlant),
    P(hx + dir * earW, yb - topIns - earSlant),
    P(hx, yb - topIns),
  ]

  // ลิ้นฝา: โค้งมนแบบ mailer + บ่าล็อกสองข้างที่โคน
  const lipOutline = [
    P(cx0 + tuckIn, y1),
    P(cx0 + tuckIn - lockW, y1 - lockH * 0.35),
    P(cx0 + tuckIn, y1 - lockH),
    ...arcPts(cx0 + tuckIn + r, r, r, Math.PI, Math.PI * 1.5),
    ...arcPts(cx1 - tuckIn - r, r, r, Math.PI * 1.5, Math.PI * 2),
    P(cx1 - tuckIn, y1 - lockH),
    P(cx1 - tuckIn + lockW, y1 - lockH * 0.35),
    P(cx1 - tuckIn, y1),
  ]

  const slots = [
    obroundPts(cx0 + slotOff, yc1, slotL, slotW, true),
    obroundPts(cx0 + slotOff, yc2, slotL, slotW, true),
    obroundPts(cx1 - slotOff, yc1, slotL, slotW, true),
    obroundPts(cx1 - slotOff, yc2, slotL, slotW, true),
  ]

  const panels: Panel[] = [
    { id: 'base', parentId: null, outline: rect(cx0, y3, cx1, y4), holes: slots, stage: 0 },
    {
      id: 'front', parentId: 'base', outline: rect(cx0, y4, cx1, y5),
      hingeA: P(cx0, y4), hingeB: P(cx1, y4), foldAngle: -90, stage: 0,
    },
    {
      id: 'back', parentId: 'base', outline: rect(cx0, y2, cx1, y3),
      hingeA: P(cx0, y3), hingeB: P(cx1, y3), foldAngle: 90, stage: 0,
    },
    {
      id: 'side-left', parentId: 'base', outline: rect(xr1, y3, cx0, y4),
      hingeA: P(cx0, y3), hingeB: P(cx0, y4), foldAngle: -90, stage: 0,
    },
    {
      id: 'side-right', parentId: 'base', outline: rect(cx1, y3, xr2, y4),
      hingeA: P(cx1, y3), hingeB: P(cx1, y4), foldAngle: 90, stage: 0,
    },
    // หูมุม (stage 1) — พับเข้าแนบผนังข้างก่อนแผ่นม้วนทับ
    {
      id: 'ear-fl', parentId: 'front', outline: earPts(cx0, -1, y4, y5),
      hingeA: P(cx0, y4), hingeB: P(cx0, y5), foldAngle: -90, stage: 1, zOffset: layer,
    },
    {
      id: 'ear-fr', parentId: 'front', outline: earPts(cx1, 1, y4, y5),
      hingeA: P(cx1, y4), hingeB: P(cx1, y5), foldAngle: 90, stage: 1, zOffset: layer,
    },
    {
      id: 'ear-bl', parentId: 'back', outline: earPts(cx0, -1, y3, y2),
      hingeA: P(cx0, y2), hingeB: P(cx0, y3), foldAngle: -90, stage: 1, zOffset: layer,
    },
    {
      id: 'ear-br', parentId: 'back', outline: earPts(cx1, 1, y3, y2),
      hingeA: P(cx1, y2), hingeB: P(cx1, y3), foldAngle: 90, stage: 1, zOffset: layer,
    },
    // แผ่นม้วน (stage 1 พร้อมหูมุม) — พับ 180° กลับเข้าด้านใน ทับหูมุม ลิ้นชี้ลงหาช่องบนฐาน
    // zOffset ติดลบ: หลังหมุน 180° แกน z ท้องถิ่นกลับทิศ (ชี้ออกนอกกล่อง)
    // จึงต้องดันทางลบเพื่อให้แผ่นม้วนลอยเข้าด้านใน ไม่ใช่ทะลุออกนอกผนัง
    {
      id: 'roll-left', parentId: 'side-left', outline: rollOutline(xr1, xr0, 0).pts,
      hingeA: P(xr1, y3 + rollIns), hingeB: P(xr1, y4 - rollIns),
      foldAngle: -180, stage: 1, zOffset: -2 * layer,
    },
    {
      id: 'roll-right', parentId: 'side-right', outline: rollOutline(xr2, xr3, width).pts,
      hingeA: P(xr2, y3 + rollIns), hingeB: P(xr2, y4 - rollIns),
      foldAngle: 180, stage: 1, zOffset: -2 * layer,
    },
    // ฝาปิด (stage 2) แล้วลิ้นหน้าค่อยเสียบ (stage 3) — แยกจังหวะกันลิ้นกวาดทะลุผนังหน้า
    {
      id: 'lid', parentId: 'back', outline: rect(cx0, y1, cx1, y2),
      hingeA: P(cx0, y2), hingeB: P(cx1, y2), foldAngle: 90, stage: 2,
    },
    {
      id: 'lip', parentId: 'lid', outline: lipOutline,
      hingeA: P(cx0 + tuckIn, y1), hingeB: P(cx1 - tuckIn, y1), foldAngle: 90, stage: 3, zOffset: layer,
    },
  ]

  const cut = (d: string): Segment => ({ kind: 'cut', d })
  const crease = (d: string): Segment => ({ kind: 'crease', d })

  const earCut = (hx: number, dir: 1 | -1, ya: number, yb: number) =>
    `M ${hx} ${ya + earIns} L ${hx + dir * earW} ${ya + earIns + earSlant} ` +
    `L ${hx + dir * earW} ${yb - topIns - earSlant} L ${hx} ${yb - topIns}`

  // ขอบอิสระของแผ่นม้วน (แนวตั้ง) พร้อมลิ้นสองอัน
  const rollFreeCut = (x1: number, tabX: number) => {
    let d = `M ${x1} ${y3 + rollIns}`
    for (const yc of [yc1, yc2]) {
      d +=
        ` L ${x1} ${yc - tabW / 2} L ${tabX} ${yc - tabW / 2 + 1.5}` +
        ` L ${tabX} ${yc + tabW / 2 - 1.5} L ${x1} ${yc + tabW / 2}`
    }
    d += ` L ${x1} ${y4 - rollIns}`
    return d
  }

  const segments: Segment[] = [
    // ลิ้นฝา (โค้งมน + บ่าล็อก)
    cut(
      `M ${cx0 + tuckIn} ${y1} L ${cx0 + tuckIn - lockW} ${y1 - lockH * 0.35} L ${cx0 + tuckIn} ${y1 - lockH} ` +
        `L ${cx0 + tuckIn} ${r} Q ${cx0 + tuckIn} 0 ${cx0 + tuckIn + r} 0 ` +
        `L ${cx1 - tuckIn - r} 0 Q ${cx1 - tuckIn} 0 ${cx1 - tuckIn} ${r} ` +
        `L ${cx1 - tuckIn} ${y1 - lockH} L ${cx1 - tuckIn + lockW} ${y1 - lockH * 0.35} L ${cx1 - tuckIn} ${y1}`,
    ),
    cut(`M ${cx0} ${y1} L ${cx0 + tuckIn} ${y1}`),
    cut(`M ${cx1 - tuckIn} ${y1} L ${cx1} ${y1}`),
    // ขอบข้างฝา (ไม่มีปีก — ขอบข้างจบด้วยผนังม้วน)
    cut(`M ${cx0} ${y1} L ${cx0} ${y2}`),
    cut(`M ${cx1} ${y1} L ${cx1} ${y2}`),
    // หูมุมผนังหลัง + รอยตัดช่วงหด
    cut(`M ${cx0} ${y2} L ${cx0} ${y2 + topIns}`),
    cut(earCut(cx0, -1, y3, y2)),
    cut(`M ${cx0} ${y3 - earIns} L ${cx0} ${y3}`),
    cut(`M ${cx1} ${y2} L ${cx1} ${y2 + topIns}`),
    cut(earCut(cx1, 1, y3, y2)),
    cut(`M ${cx1} ${y3 - earIns} L ${cx1} ${y3}`),
    // แถวผนังข้าง: ขอบบน-ล่างของผนัง + แผ่นม้วน (มีสเต็ปช่วงหด rollIns)
    cut(`M ${cx0} ${y3} L ${xr1} ${y3} L ${xr1} ${y3 + rollIns} L ${xr0} ${y3 + rollIns}`),
    cut(`M ${cx0} ${y4} L ${xr1} ${y4} L ${xr1} ${y4 - rollIns} L ${xr0} ${y4 - rollIns}`),
    cut(rollFreeCut(xr0, 0)),
    cut(`M ${cx1} ${y3} L ${xr2} ${y3} L ${xr2} ${y3 + rollIns} L ${xr3} ${y3 + rollIns}`),
    cut(`M ${cx1} ${y4} L ${xr2} ${y4} L ${xr2} ${y4 - rollIns} L ${xr3} ${y4 - rollIns}`),
    cut(rollFreeCut(xr3, width)),
    // หูมุมผนังหน้า
    cut(`M ${cx0} ${y4} L ${cx0} ${y4 + earIns}`),
    cut(earCut(cx0, -1, y4, y5)),
    cut(`M ${cx0} ${y5 - topIns} L ${cx0} ${y5}`),
    cut(`M ${cx1} ${y4} L ${cx1} ${y4 + earIns}`),
    cut(earCut(cx1, 1, y4, y5)),
    cut(`M ${cx1} ${y5 - topIns} L ${cx1} ${y5}`),
    // ขอบล่างสุด
    cut(`M ${cx0} ${y5} L ${cx1} ${y5}`),
    // ช่องเสียบลิ้นบนฐาน
    cut(obroundPath(cx0 + slotOff, yc1, slotL, slotW, true)),
    cut(obroundPath(cx0 + slotOff, yc2, slotL, slotW, true)),
    cut(obroundPath(cx1 - slotOff, yc1, slotL, slotW, true)),
    cut(obroundPath(cx1 - slotOff, yc2, slotL, slotW, true)),
    // รอยพับ
    crease(`M ${cx0 + tuckIn} ${y1} L ${cx1 - tuckIn} ${y1}`), // ลิ้นฝา|ฝา
    crease(`M ${cx0} ${y2} L ${cx1} ${y2}`), // ฝา|ผนังหลัง
    crease(`M ${cx0} ${y3} L ${cx1} ${y3}`), // ผนังหลัง|ฐาน
    crease(`M ${cx0} ${y4} L ${cx1} ${y4}`), // ฐาน|ผนังหน้า
    crease(`M ${cx0} ${y3} L ${cx0} ${y4}`), // ฐาน|ผนังซ้าย
    crease(`M ${cx1} ${y3} L ${cx1} ${y4}`), // ฐาน|ผนังขวา
    crease(`M ${xr1} ${y3 + rollIns} L ${xr1} ${y4 - rollIns}`), // ผนังซ้าย|ม้วน
    crease(`M ${xr2} ${y3 + rollIns} L ${xr2} ${y4 - rollIns}`), // ผนังขวา|ม้วน
    crease(`M ${cx0} ${y2 + topIns} L ${cx0} ${y3 - earIns}`), // หูหลังซ้าย
    crease(`M ${cx1} ${y2 + topIns} L ${cx1} ${y3 - earIns}`), // หูหลังขวา
    crease(`M ${cx0} ${y4 + earIns} L ${cx0} ${y5 - topIns}`), // หูหน้าซ้าย
    crease(`M ${cx1} ${y4 + earIns} L ${cx1} ${y5 - topIns}`), // หูหน้าขวา
  ]

  const dims: DimMark[] = [
    { a: P(cx0, y5 + 12), b: P(cx1, y5 + 12), label: `W ${fmt(Wp)}` },
    { a: P(xr3 + 8, y3), b: P(xr3 + 8, y4), label: `D ${fmt(Dp)}` },
    { a: P(cx0 - 8, y4), b: P(cx0 - 8, y5), label: `H ${fmt(Hp)}` },
    { a: P(0, -10), b: P(width, -10), label: fmt(width) },
    { a: P(width + 10, 0), b: P(width + 10, height), label: fmt(height) },
  ]

  return { width, height, segments, panels, dims }
}
