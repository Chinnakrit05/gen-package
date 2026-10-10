import type { BoxParams, Dieline, DimMark, Material, Panel, Segment, Vec2 } from '../types'
import { P, arcPts, fmt, obroundPath, obroundPts, rect } from './shared'
import { placePath, placePoint } from '../stickerSheet'

// FEFCO 0427 ตัวเต็ม (roll end tray with lock front) — แบบ dieline มาตรฐานงานจริง
// ผนังข้างสองชั้นแบบพับทบ: ผนัง → สัน (รอยพับคู่ กว้าง = ความหนาผนัง+หู+ชั้นทบ) → ชั้นทบลงด้านใน
// ปลายชั้นทบมีลิ้นล็อกเสียบช่องบนฐาน หูมุมของผนังหน้า-หลังถูกชั้นทบหนีบไว้ — ไม่ใช้กาว
// ฝา: แคบกว่ากล่องเท่าความหนาผนังสองชั้น (ลงพอดีระหว่างสันผนังข้าง) มีปีกข้างพับลงด้านในชั้นทบ
// และลิ้นหน้ามุมโค้งใหญ่เสียบด้านในผนังหน้า (ผนังหน้าเตี้ยกว่า t ให้ฝาวางบนขอบ) — W,D,H คือขนาดด้านใน
//
// generate ผังแนวตั้งแล้วหมุน 90° ให้ตรงผัง dieline มาตรฐาน (ฝาเปิดไปทางขวา) — template ตั้ง spin
// ให้ viewer หมุนกลับ จึงยังเห็นผนังหน้าหันหากล้องเหมือนเดิม
//
// ผังก่อนหมุน (x ขวา y ลง):
//   คอลัมน์: [ลิ้น|ชั้นทบ|สัน|ผนังข้าง|  ฐาน  |ผนังข้าง|สัน|ชั้นทบ|ลิ้น]
//   แถว:     ลิ้นฝา / ฝา(+ปีกข้าง) / ผนังหลัง(+หู) / ฐาน / ผนังหน้า(+หู)
export function fefco0427Layout(box: BoxParams, mat: Material): Dieline {
  return rollEndLayout(box, mat, { lid: true })
}

// โครงถาดผนังทบ (roll end) ชุดเดียวกับ 0427 — lid=false = ถาดเปิดบน (กล่องถาด): ไม่มีฝา/ปีก/ลิ้นหน้า
// ผนังหน้า-หลังสูงเท่ากัน ขอบบนผนังหลังตัดตรงเต็มกว้าง
export function rollEndLayout(box: BoxParams, mat: Material, opts: { lid?: boolean } = {}): Dieline {
  const lid = opts.lid !== false
  const { W, D, H } = box
  const t = mat.thickness

  const Wp = W + 2 * t
  const Dp = D + 2 * t
  const Hp = H + t
  const layer = t + 0.05

  // สัน = ระยะผนังนอก → ชั้นทบ: ผนัง t + หูมุม t + ชั้นทบ t (+ช่องว่างเล็กน้อย) → รอยพับคู่บน dieline
  const sp = 3 * t + 0.2
  // ชั้นทบยาวถึงผิวบนของฐาน (สั้นกว่าผนัง t) หดปลายบน-ล่างหลบหูมุม
  const rollW = Math.max(6, Hp - t)
  const rollIns = Math.max(1.5, 2 * t)
  // ลิ้นล็อกปลายชั้นทบ + ช่องเสียบบนฐานตรงแนวชั้นทบ (ห่างขอบฐาน sp − t/2)
  const tabL = Math.max(4, Math.min(7, 0.3 * rollW))
  const tabW = Math.max(12, Math.min(26, 0.2 * Dp))
  const slotL = tabW + 1.5
  const slotW = Math.max(1.5, t + 0.6)
  const slotOff = sp - t / 2
  // หูมุมผนังหน้า-หลัง: สี่เหลี่ยม (ตามแบบงานจริง) พับแนบด้านในผนังข้าง ถูกชั้นทบทับ
  const earW = Math.max(8, Math.min(1.3 * Hp, 0.4 * Dp))
  const earIns = Math.max(1.5, t + 0.5)
  const topIns = Math.max(1.5, 2 * t)
  // ผนังหน้าเตี้ยกว่า t: ฝาวางบนขอบ แล้วลิ้นหน้าเสียบด้านใน
  const Hf = lid ? Hp - t : Hp
  // ฝา: แคบกว่ากล่องข้างละ sp (ลงระหว่างสันผนังข้าง) + ปีกข้างลึกเกือบเท่าผนัง
  const lx0Off = sp
  const flapH = Math.max(8, Hp - 2 * t)
  const flapIn = 1
  // ลิ้นหน้าฝา: ลึกเกือบเท่าผนังหน้า มุมนอกโค้งใหญ่
  const tuckIn = Math.max(1, t + 0.5)
  const lipH = Math.max(10, Math.min(Hf - t, 0.8 * Dp))

  // แกน x
  const xr0 = tabL // ขอบอิสระชั้นทบซ้าย (ลิ้นยื่นไปถึง x=0)
  const xr1 = xr0 + rollW // ชั้นทบ|สัน
  const xs1 = xr1 + sp // สัน|ผนังข้าง
  const cx0 = xs1 + Hp // ผนังข้าง|ฐาน
  const cx1 = cx0 + Wp
  const xs2 = cx1 + Hp
  const xr2 = xs2 + sp
  const xr3 = xr2 + rollW
  const width = xr3 + tabL
  const lx0 = cx0 + lx0Off
  const lx1 = cx1 - lx0Off
  // แกน y
  const y1 = lid ? lipH : 0
  const y2 = lid ? y1 + Dp : 0
  const y3 = y2 + Hp
  const y4 = y3 + Dp
  const y5 = y4 + Hf
  const height = y5

  const r = Math.min(lipH * 0.85, (lx1 - lx0 - 2 * tuckIn) / 2)
  const yc1 = y3 + Dp * 0.28
  const yc2 = y3 + Dp * 0.72

  // ชั้นทบ: สี่เหลี่ยมหดปลาย + ลิ้นล็อกสองอันบนขอบอิสระ (x0 = รอยพับกับสัน, x1 = ขอบอิสระ)
  const rollOutline = (x0: number, x1: number, tabX: number): Vec2[] => {
    const pts = [P(x0, y3 + rollIns), P(x1, y3 + rollIns)]
    for (const yc of [yc1, yc2]) {
      pts.push(P(x1, yc - tabW / 2), P(tabX, yc - tabW / 2 + 1.5), P(tabX, yc + tabW / 2 - 1.5), P(x1, yc + tabW / 2))
    }
    pts.push(P(x1, y4 - rollIns), P(x0, y4 - rollIns))
    return pts
  }
  const rollFreeCut = (x1: number, tabX: number) => {
    let d = `M ${x1} ${y3 + rollIns}`
    for (const yc of [yc1, yc2]) {
      d +=
        ` L ${x1} ${yc - tabW / 2} L ${tabX} ${yc - tabW / 2 + 1.5}` +
        ` L ${tabX} ${yc + tabW / 2 - 1.5} L ${x1} ${yc + tabW / 2}`
    }
    return d + ` L ${x1} ${y4 - rollIns}`
  }

  // หูมุมสี่เหลี่ยม: hx = เส้นพับ, dir = ทิศยื่น, ya = ขอบฝั่งติดฐาน, yb = ขอบไกล
  const earPts = (hx: number, dir: 1 | -1, ya: number, yb: number) => {
    const sy = Math.sign(yb - ya) || 1
    return [P(hx, ya + sy * earIns), P(hx + dir * earW, ya + sy * earIns), P(hx + dir * earW, yb - sy * topIns), P(hx, yb - sy * topIns)]
  }
  const earCut = (hx: number, dir: 1 | -1, ya: number, yb: number) => {
    const e = earPts(hx, dir, ya, yb)
    return `M ${e[0].x} ${e[0].y} L ${e[1].x} ${e[1].y} L ${e[2].x} ${e[2].y} L ${e[3].x} ${e[3].y}`
  }

  // ปีกข้างฝา: คางหมูปลายลาด มุมนอกมน — hx = รอยพับ, dir = ทิศยื่น
  const cham = Math.min(flapH * 0.35, Dp * 0.2)
  const fr = Math.min(4, cham * 0.6)
  const flapPts = (hx: number, dir: 1 | -1): Vec2[] => {
    const xo = hx + dir * flapH
    const ya = y1 + flapIn
    const yb = y2 - flapIn
    // มุมนอกมน: ปัดด้วยจุดบนโค้งกำลังสอง (ตรงกับ Q ใน path)
    const q = (p0: Vec2, c: Vec2, p1: Vec2) =>
      [0.25, 0.5, 0.75].map((s) => P((1 - s) ** 2 * p0.x + 2 * (1 - s) * s * c.x + s * s * p1.x, (1 - s) ** 2 * p0.y + 2 * (1 - s) * s * c.y + s * s * p1.y))
    const c1 = P(xo, ya + cham)
    const c2 = P(xo, yb - cham)
    const a1 = P(hx + dir * (flapH - fr), ya + cham * (1 - fr / flapH))
    const b1 = P(xo, ya + cham + fr)
    const a2 = P(xo, yb - cham - fr)
    const b2 = P(hx + dir * (flapH - fr), yb - cham * (1 - fr / flapH))
    return [P(hx, ya), a1, ...q(a1, c1, b1), b1, a2, ...q(a2, c2, b2), b2, P(hx, yb)]
  }
  const flapCut = (hx: number, dir: 1 | -1) => {
    const xo = hx + dir * flapH
    const ya = y1 + flapIn
    const yb = y2 - flapIn
    return (
      `M ${hx} ${y1} L ${hx} ${ya} L ${hx + dir * (flapH - fr)} ${ya + cham * (1 - fr / flapH)} ` +
      `Q ${xo} ${ya + cham} ${xo} ${ya + cham + fr} L ${xo} ${yb - cham - fr} ` +
      `Q ${xo} ${yb - cham} ${hx + dir * (flapH - fr)} ${yb - cham * (1 - fr / flapH)} L ${hx} ${yb} L ${hx} ${y2}`
    )
  }

  // ลิ้นหน้าฝา: มุมนอกโค้งใหญ่ (ไม่มีบ่าล็อก)
  const la = lx0 + tuckIn
  const lb = lx1 - tuckIn
  const lipOutline = [
    P(la, y1),
    ...arcPts(la + r, r, r, Math.PI, Math.PI * 1.5),
    ...arcPts(lb - r, r, r, Math.PI * 1.5, Math.PI * 2),
    P(lb, y1),
  ]

  const slotCs: [number, number][] = [
    [cx0 + slotOff, yc1],
    [cx0 + slotOff, yc2],
    [cx1 - slotOff, yc1],
    [cx1 - slotOff, yc2],
  ]
  const slots = slotCs.map(([x, y]) => obroundPts(x, y, slotL, slotW, true))

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
      id: 'side-left', parentId: 'base', outline: rect(xs1, y3, cx0, y4),
      hingeA: P(cx0, y3), hingeB: P(cx0, y4), foldAngle: -90, stage: 2,
    },
    {
      id: 'side-right', parentId: 'base', outline: rect(cx1, y3, xs2, y4),
      hingeA: P(cx1, y3), hingeB: P(cx1, y4), foldAngle: 90, stage: 2,
    },
    // หูมุม (stage 1) พับก่อนผนังข้างตั้ง (2) — ไม่งั้นหูกวาดอยู่นอกผนังข้างแล้วทะลุเข้าตอนท้าย
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
    // สัน + ชั้นทบ (stage 3): พับ 90° สองครั้งที่รอยพับคู่ → ชั้นทบลงขนานผนังห่าง sp ทับหูมุม ลิ้นลงช่องบนฐาน
    {
      id: 'spine-left', parentId: 'side-left', outline: rect(xr1, y3 + rollIns, xs1, y4 - rollIns),
      hingeA: P(xs1, y3 + rollIns), hingeB: P(xs1, y4 - rollIns), foldAngle: -90, stage: 3,
    },
    {
      id: 'roll-left', parentId: 'spine-left', outline: rollOutline(xr1, xr0, 0),
      hingeA: P(xr1, y3 + rollIns), hingeB: P(xr1, y4 - rollIns), foldAngle: -90, stage: 3,
    },
    {
      id: 'spine-right', parentId: 'side-right', outline: rect(xs2, y3 + rollIns, xr2, y4 - rollIns),
      hingeA: P(xs2, y3 + rollIns), hingeB: P(xs2, y4 - rollIns), foldAngle: 90, stage: 3,
    },
    {
      id: 'roll-right', parentId: 'spine-right', outline: rollOutline(xr2, xr3, width),
      hingeA: P(xr2, y3 + rollIns), hingeB: P(xr2, y4 - rollIns), foldAngle: 90, stage: 3,
    },
    // ฝา (stage 5) — ปีกข้าง (4) พับลงก่อน แล้วฝาปิดพาปีกลงด้านในชั้นทบ; ลิ้นหน้า tuck ผูกจังหวะกับฝา
    {
      id: 'lid', parentId: 'back', outline: rect(lx0, y1, lx1, y2),
      hingeA: P(lx0, y2), hingeB: P(lx1, y2), foldAngle: 90, stage: 5,
    },
    {
      id: 'lid-flap-left', parentId: 'lid', outline: flapPts(lx0, -1),
      hingeA: P(lx0, y1 + flapIn), hingeB: P(lx0, y2 - flapIn), foldAngle: -90, stage: 4,
    },
    {
      id: 'lid-flap-right', parentId: 'lid', outline: flapPts(lx1, 1),
      hingeA: P(lx1, y1 + flapIn), hingeB: P(lx1, y2 - flapIn), foldAngle: 90, stage: 4,
    },
    {
      id: 'lip', parentId: 'lid', outline: lipOutline,
      hingeA: P(la, y1), hingeB: P(lb, y1), foldAngle: 90, stage: 5, zOffset: layer, tuck: true,
    },
  ].filter((p) => lid || !(p.id === 'lid' || p.id === 'lip' || p.id.startsWith('lid-flap')))

  const cut = (d: string): Segment => ({ kind: 'cut', d })
  const crease = (d: string): Segment => ({ kind: 'crease', d })

  const segments: Segment[] = [
    ...(lid
      ? [
          // ลิ้นหน้าฝา (มุมโค้งใหญ่)
          cut(`M ${la} ${y1} L ${la} ${r} Q ${la} 0 ${la + r} 0 L ${lb - r} 0 Q ${lb} 0 ${lb} ${r} L ${lb} ${y1}`),
          cut(`M ${lx0} ${y1} L ${la} ${y1}`),
          cut(`M ${lb} ${y1} L ${lx1} ${y1}`),
          // ปีกข้างฝา
          cut(flapCut(lx0, -1)),
          cut(flapCut(lx1, 1)),
          // ขอบบนผนังหลังนอกช่วงฝา (ฝาแคบกว่ากล่อง)
          cut(`M ${cx0} ${y2} L ${lx0} ${y2}`),
          cut(`M ${lx1} ${y2} L ${cx1} ${y2}`),
        ]
      : [cut(`M ${cx0} ${y2} L ${cx1} ${y2}`)]), // ถาดเปิดบน: ขอบบนผนังหลังตรงเต็มกว้าง
    // หูมุมผนังหลัง + รอยตัดช่วงหด
    cut(`M ${cx0} ${y2} L ${cx0} ${y2 + topIns}`),
    cut(earCut(cx0, -1, y3, y2)),
    cut(`M ${cx0} ${y3 - earIns} L ${cx0} ${y3}`),
    cut(`M ${cx1} ${y2} L ${cx1} ${y2 + topIns}`),
    cut(earCut(cx1, 1, y3, y2)),
    cut(`M ${cx1} ${y3 - earIns} L ${cx1} ${y3}`),
    // แถวผนังข้าง: ขอบบน-ล่างผนัง → สัน+ชั้นทบ (หดปลาย rollIns)
    cut(`M ${cx0} ${y3} L ${xs1} ${y3} L ${xs1} ${y3 + rollIns} L ${xr0} ${y3 + rollIns}`),
    cut(`M ${cx0} ${y4} L ${xs1} ${y4} L ${xs1} ${y4 - rollIns} L ${xr0} ${y4 - rollIns}`),
    cut(rollFreeCut(xr0, 0)),
    cut(`M ${cx1} ${y3} L ${xs2} ${y3} L ${xs2} ${y3 + rollIns} L ${xr3} ${y3 + rollIns}`),
    cut(`M ${cx1} ${y4} L ${xs2} ${y4} L ${xs2} ${y4 - rollIns} L ${xr3} ${y4 - rollIns}`),
    cut(rollFreeCut(xr3, width)),
    // หูมุมผนังหน้า
    cut(`M ${cx0} ${y4} L ${cx0} ${y4 + earIns}`),
    cut(earCut(cx0, -1, y4, y5)),
    cut(`M ${cx0} ${y5 - topIns} L ${cx0} ${y5}`),
    cut(`M ${cx1} ${y4} L ${cx1} ${y4 + earIns}`),
    cut(earCut(cx1, 1, y4, y5)),
    cut(`M ${cx1} ${y5 - topIns} L ${cx1} ${y5}`),
    cut(`M ${cx0} ${y5} L ${cx1} ${y5}`),
    // ช่องเสียบลิ้นบนฐาน
    ...slotCs.map(([x, y]) => cut(obroundPath(x, y, slotL, slotW, true))),
    // รอยพับ
    ...(lid
      ? [
          crease(`M ${la} ${y1} L ${lb} ${y1}`), // ลิ้นหน้า|ฝา
          crease(`M ${lx0} ${y1 + flapIn} L ${lx0} ${y2 - flapIn}`), // ปีกข้างฝา
          crease(`M ${lx1} ${y1 + flapIn} L ${lx1} ${y2 - flapIn}`),
          crease(`M ${lx0} ${y2} L ${lx1} ${y2}`), // ฝา|ผนังหลัง
        ]
      : []),
    crease(`M ${cx0} ${y3} L ${cx1} ${y3}`), // ผนังหลัง|ฐาน
    crease(`M ${cx0} ${y4} L ${cx1} ${y4}`), // ฐาน|ผนังหน้า
    crease(`M ${cx0} ${y3} L ${cx0} ${y4}`), // ฐาน|ผนังซ้าย
    crease(`M ${cx1} ${y3} L ${cx1} ${y4}`), // ฐาน|ผนังขวา
    // รอยพับคู่ของผนังทบ (ผนัง|สัน, สัน|ชั้นทบ)
    crease(`M ${xs1} ${y3 + rollIns} L ${xs1} ${y4 - rollIns}`),
    crease(`M ${xr1} ${y3 + rollIns} L ${xr1} ${y4 - rollIns}`),
    crease(`M ${xs2} ${y3 + rollIns} L ${xs2} ${y4 - rollIns}`),
    crease(`M ${xr2} ${y3 + rollIns} L ${xr2} ${y4 - rollIns}`),
    // หูมุม
    crease(`M ${cx0} ${y2 + topIns} L ${cx0} ${y3 - earIns}`),
    crease(`M ${cx1} ${y2 + topIns} L ${cx1} ${y3 - earIns}`),
    crease(`M ${cx0} ${y4 + earIns} L ${cx0} ${y5 - topIns}`),
    crease(`M ${cx1} ${y4 + earIns} L ${cx1} ${y5 - topIns}`),
  ]

  const dims: DimMark[] = [
    { a: P(cx0, y5 + 12), b: P(cx1, y5 + 12), label: `W ${fmt(Wp)}` },
    { a: P(xr3 + 8, y3), b: P(xr3 + 8, y4), label: `D ${fmt(Dp)}` },
    { a: P(cx0 - 8, y2), b: P(cx0 - 8, y3), label: `H ${fmt(Hp)}` },
    { a: P(0, -10), b: P(width, -10), label: fmt(width) },
    { a: P(width + 10, 0), b: P(width + 10, height), label: fmt(height) },
  ]

  return { width, height, segments, panels, dims }
}

// หมุนทั้ง dieline 90° (proper rotation ไม่สะท้อน → เครื่องหมายมุมพับใช้ได้เดิม): (x, y) → (H − y, x)
// ผนังหน้าไปอยู่ซ้าย ฝาเปิดไปทางขวา ตามผัง dieline มาตรฐาน
export function rotateDieline90(d: Dieline): Dieline {
  const pl = { rot: true, tx: d.height, ty: 0 }
  const pt = (p: Vec2) => placePoint(pl, p)
  return {
    width: d.height,
    height: d.width,
    segments: d.segments.map((s) => ({ ...s, d: placePath(s.d, pl) })),
    panels: d.panels.map((p) => ({
      ...p,
      outline: p.outline.map(pt),
      ...(p.holes ? { holes: p.holes.map((h) => h.map(pt)) } : {}),
      ...(p.hingeA ? { hingeA: pt(p.hingeA) } : {}),
      ...(p.hingeB ? { hingeB: pt(p.hingeB) } : {}),
    })),
    dims: d.dims.map((m) => ({ ...m, a: pt(m.a), b: pt(m.b) })),
  }
}

export function generateFefco0427(box: BoxParams, mat: Material): Dieline {
  return rotateDieline90(fefco0427Layout(box, mat))
}

// viewer หมุนแผ่นกลับเท่ามุมที่หมุนผัง (กลับทิศเพราะกลุ่มโมเดลสะท้อนแกน x ก่อนหมุน) — เทสต์คุมใน fefco0427.test
export const FEFCO0427_SPIN = -Math.PI / 2
