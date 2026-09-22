import type { Panel } from './types'
import { elW, elH, type Deco } from './artwork'

// "ดูด" ชิ้น artwork ให้เข้าแนวขณะลากบน blueprint — pure ล้วนเพื่อเทสต์เชิงตัวเลขได้
// แนวที่ดูดติด (snap line) เก็บเป็นค่าพิกัดเส้นตั้ง (x) / เส้นนอน (y) บนแผ่นคลี่ หน่วย มม.

export interface SnapTargets {
  xs: number[] // เส้นตั้งที่ดูดได้ (ค่า x)
  ys: number[] // เส้นนอนที่ดูดได้ (ค่า y)
}

// ปัดทศนิยม + ตัดค่าซ้ำ เพื่อไม่ให้มีเส้นเป้าหมายทับกันเป็นสิบเส้น
const dedupe = (vals: number[]): number[] => {
  const seen = new Set<number>()
  const out: number[] = []
  for (const v of vals) {
    const k = Math.round(v * 10) / 10
    if (!seen.has(k)) {
      seen.add(k)
      out.push(k)
    }
  }
  return out
}

// เส้นเป้าหมายมาจาก: กึ่งกลางแผ่น, ขอบ/กึ่งกลางของแต่ละแผง, และขอบ/กึ่งกลางของชิ้นอื่น
// (ไม่รวมชิ้นที่กำลังลาก) — คำนวณครั้งเดียวตอนเริ่มลากก็พอ เพราะแผงกับชิ้นอื่นอยู่นิ่งระหว่างลาก
export function snapTargets(
  panels: Panel[],
  decos: Deco[],
  draggedId: string,
  sheetW: number,
  sheetH: number,
): SnapTargets {
  const xs: number[] = [sheetW / 2]
  const ys: number[] = [sheetH / 2]
  for (const p of panels) {
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const q of p.outline) {
      if (q.x < minX) minX = q.x
      if (q.x > maxX) maxX = q.x
      if (q.y < minY) minY = q.y
      if (q.y > maxY) maxY = q.y
    }
    if (minX <= maxX) {
      xs.push(minX, maxX, (minX + maxX) / 2)
      ys.push(minY, maxY, (minY + maxY) / 2)
    }
  }
  for (const d of decos) {
    if (d.id === draggedId) continue
    const w = elW(d)
    const h = elH(d)
    xs.push(d.x, d.x + w / 2, d.x + w)
    ys.push(d.y, d.y + h / 2, d.y + h)
  }
  return { xs: dedupe(xs), ys: dedupe(ys) }
}

// หาเส้นเป้าหมายที่ใกล้ที่สุดกับจุดอ้างอิงชุดหนึ่ง (ซ้าย/กึ่งกลาง/ขวา หรือ บน/กึ่งกลาง/ล่าง)
// คืน delta ที่ต้องขยับ + ค่าเส้นที่ดูดติด ถ้าไม่มีอันไหนอยู่ในระยะ thresh → null
function nearest(refs: number[], targets: number[], thresh: number): { delta: number; line: number } | null {
  let best: { delta: number; line: number } | null = null
  let bestDist = thresh
  for (const t of targets) {
    for (const r of refs) {
      const dist = Math.abs(t - r)
      if (dist <= bestDist) {
        bestDist = dist
        best = { delta: t - r, line: t }
      }
    }
  }
  return best
}

// รับมุมซ้ายบน (x,y) + ขนาด (w,h) ที่ลากมา → คืนตำแหน่งหลังดูด + เส้นไกด์ที่ติด (null = ไม่ติด)
// ดูดแกน x และ y แยกกัน โดยเทียบขอบซ้าย/กึ่งกลาง/ขอบขวา (และ บน/กึ่งกลาง/ล่าง) กับเส้นเป้าหมาย
export function applySnap(
  x: number,
  y: number,
  w: number,
  h: number,
  t: SnapTargets,
  thresh: number,
): { x: number; y: number; vx: number | null; vy: number | null } {
  const sx = nearest([x, x + w / 2, x + w], t.xs, thresh)
  const sy = nearest([y, y + h / 2, y + h], t.ys, thresh)
  return {
    x: sx ? x + sx.delta : x,
    y: sy ? y + sy.delta : y,
    vx: sx ? sx.line : null,
    vy: sy ? sy.line : null,
  }
}
