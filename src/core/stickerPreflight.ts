import type { Vec2 } from './types'
import { STICKER_RULES, loopArea, type AlphaMask } from './stickerContour'

// ตรวจไฟล์สติกเกอร์ตามข้อจำกัดการผลิตไดคัท (pure — ทดสอบได้):
//  1) ลายชิดเส้นตัด: ต้องห่างเส้นตัด ≥1 มม. หรือถ้าตั้งใจให้สีชนขอบ ต้องเผื่อสีเลยเส้นตัด ≥1 มม.
//  2) ระยะระหว่างเส้นตัดกับเส้นตัด ≥2 มม.
//  3) ช่องเจาะ (เส้นตัดด้านใน) ≥2 มม.
//  4) เส้นตัดไม่หักศอก (รัศมีโค้ง ≥0.5 มม.)
//  5) ชิ้นเล็กเกินไป (ลอกยาก) / เส้นตัดชนขอบแผ่น
export type PreflightCode = 'art-edge' | 'gap' | 'hole' | 'corner' | 'tiny' | 'edge'
export interface PreflightIssue {
  code: PreflightCode
  level: 'error' | 'warn'
  th: string
  en: string
  at?: Vec2 // ตำแหน่งตัวอย่าง (มม. บนแผ่น) สำหรับชี้บน blueprint
}

const fmt1 = (v: number) => String(Math.round(v * 10) / 10)

// จุดบน loop ทุกระยะ step (มม.) พร้อม normal ชี้เข้าในเนื้อ
function samples(loop: Vec2[], step: number): { p: Vec2; n: Vec2 }[] {
  const inward = loopArea(loop) > 0 ? 1 : -1 // พิกัด y ลง: area > 0 = ตามเข็ม → ด้านในอยู่ขวามือ
  const out: { p: Vec2; n: Vec2 }[] = []
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]
    const b = loop[(i + 1) % loop.length]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len < 1e-9) continue
    const tx = (b.x - a.x) / len
    const ty = (b.y - a.y) / len
    const n = { x: -ty * inward, y: tx * inward }
    for (let d = 0; d < len; d += step) out.push({ p: { x: a.x + tx * d, y: a.y + ty * d }, n })
  }
  return out
}

function alphaAt(m: AlphaMask, x: number, y: number): number {
  const px = Math.floor((x - m.origin.x) * m.pxPerMm)
  const py = Math.floor((y - m.origin.y) * m.pxPerMm)
  if (px < 0 || py < 0 || px >= m.w || py >= m.h) return 0
  return m.data[py * m.w + px]
}

function inside(pt: Vec2, loop: Vec2[]): boolean {
  let c = false
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i]
    const b = loop[j]
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c
  }
  return c
}

function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}

// ระยะใกล้สุดระหว่างสอง loop (จุดของฝั่งหนึ่งถึงขอบอีกฝั่ง ทั้งสองทาง) + ตำแหน่ง
function loopGap(A: Vec2[], B: Vec2[]): { d: number; at: Vec2 } {
  let best = { d: Infinity, at: A[0] }
  const pass = (P: Vec2[], Q: Vec2[]) => {
    for (const p of P) {
      for (let i = 0; i < Q.length; i++) {
        const d = segDist(p, Q[i], Q[(i + 1) % Q.length])
        if (d < best.d) best = { d, at: p }
      }
    }
  }
  pass(A, B)
  pass(B, A)
  return best
}

// รัศมีโค้งที่จุดหนึ่ง จากวงกลมผ่าน 3 จุดที่ห่างกันตามแนวเส้น ±span มม.
function minRadius(loop: Vec2[], skip: (p: Vec2) => boolean = () => false, span = 0.4): { r: number; at: Vec2 } {
  const pts = samples(loop, 0.1).map((s) => s.p)
  const n = pts.length
  const k = Math.max(1, Math.round(span / 0.1))
  let best = { r: Infinity, at: loop[0] }
  if (n < 2 * k + 1) return best
  for (let i = 0; i < n; i++) {
    const a = pts[(i - k + n) % n]
    const b = pts[i]
    const c = pts[(i + k) % n]
    if (skip(b)) continue
    const ab = Math.hypot(b.x - a.x, b.y - a.y)
    const bc = Math.hypot(c.x - b.x, c.y - b.y)
    const ca = Math.hypot(a.x - c.x, a.y - c.y)
    const cross = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))
    if (cross < 1e-9) continue
    const r = (ab * bc * ca) / (2 * cross)
    if (r < best.r) best = { r, at: b }
  }
  return best
}

export interface PreflightInput {
  loops: Vec2[][] // เส้นตัดทั้งหมด (มม. บนแผ่น)
  art?: AlphaMask | null // alpha ของลาย (ไม่รวมสีพื้น/รูปพื้น) — มีขอบเผื่อรอบแผ่นเพื่อดูสีที่เลยเส้นตัด
  sheet: { w: number; h: number }
  contour?: boolean // ไดคัทตามรูป — เตือนเมื่อเส้นตัดชนขอบแผ่น (สี่เหลี่ยมเต็มแผ่นชนขอบโดยตั้งใจ)
}

export function preflightSticker({ loops, art, sheet, contour = false }: PreflightInput): PreflightIssue[] {
  const R = STICKER_RULES
  const issues: PreflightIssue[] = []
  // แยกเส้นนอก / ช่องเจาะ (loop ที่อยู่ในอีก loop)
  const isHole = loops.map((l, i) => loops.some((o, j) => j !== i && inside(l[0], o)))

  // 1) ลายชิดเส้นตัดโดยไม่มีเผื่อสี
  if (art) {
    let badLen = 0
    let at: Vec2 | undefined
    const step = 0.5
    for (const l of loops) {
      for (const { p, n } of samples(l, step)) {
        const nearIn = [0.3, 0.6, 0.9].some((d) => alphaAt(art, p.x + n.x * d, p.y + n.y * d) >= 128)
        if (!nearIn) continue
        const bleedOk = alphaAt(art, p.x - n.x * (R.minBleed - 0.05), p.y - n.y * (R.minBleed - 0.05)) >= 128
        if (!bleedOk) {
          badLen += step
          at ??= p
        }
      }
    }
    if (badLen >= 1) {
      issues.push({
        code: 'art-edge',
        level: 'error',
        th:
          `ลายชิดเส้นตัดเกินไปยาวรวม ~${fmt1(badLen)} มม. — แบบมีขอบขาวต้องเว้นจากเส้นตัด ≥${R.minBorder} มม., ` +
          `ถ้าตั้งใจให้สีชนขอบ ต้องขยายสีเลยเส้นตัดออกไป ≥${R.minBleed} มม.`,
        en:
          `Artwork too close to the cut line for ~${fmt1(badLen)} mm — keep ≥${R.minBorder} mm away, ` +
          `or extend colour ≥${R.minBleed} mm past the cut for edge-to-edge print`,
        at,
      })
    }
  }

  // 2) ระยะระหว่างเส้นตัด (เฉพาะเส้นนอกคนละชิ้น)
  for (let i = 0; i < loops.length; i++) {
    for (let j = i + 1; j < loops.length; j++) {
      if (isHole[i] || isHole[j]) continue
      const g = loopGap(loops[i], loops[j])
      if (g.d < R.minGap) {
        issues.push({
          code: 'gap',
          level: 'error',
          th: `เส้นตัดสองชิ้นห่างกันแค่ ${fmt1(g.d)} มม. — ต้องห่างกันอย่างน้อย ${R.minGap} มม.`,
          en: `Two cut lines are only ${fmt1(g.d)} mm apart — keep at least ${R.minGap} mm`,
          at: g.at,
        })
      }
    }
  }

  for (let i = 0; i < loops.length; i++) {
    const l = loops[i]
    const xs = l.map((p) => p.x)
    const ys = l.map((p) => p.y)
    const minSide = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
    const c = { x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2 }
    // 3) ช่องเจาะเล็กเกิน
    if (isHole[i] && minSide < R.minHole) {
      issues.push({
        code: 'hole',
        level: 'error',
        th: `ช่องเจาะกว้างแค่ ${fmt1(minSide)} มม. — ต้องไม่ต่ำกว่า ${R.minHole} มม.`,
        en: `Cut-out is only ${fmt1(minSide)} mm — must be at least ${R.minHole} mm`,
        at: c,
      })
    }
    // 5) ชิ้นเล็กมาก ลอกออกจากแผ่นยาก
    if (!isHole[i] && minSide < 8) {
      issues.push({
        code: 'tiny',
        level: 'warn',
        th: `มีชิ้นสติกเกอร์เล็กมาก (${fmt1(minSide)} มม.) — ลอกยาก แนะนำอย่างน้อย 8 มม.`,
        en: `A sticker piece is very small (${fmt1(minSide)} mm) — hard to peel, 8 mm+ recommended`,
        at: c,
      })
    }
    // 4) มุมหักศอก (ไดคัทตามรูปที่ถูกตัดตรงขอบแผ่นเกิดมุมตรงนั้นเอง — คำเตือน 'ชนขอบแผ่น' ครอบคลุมแล้ว)
    const onSheetEdge = (p: Vec2) =>
      contour && (p.x <= 0.6 || p.y <= 0.6 || p.x >= sheet.w - 0.6 || p.y >= sheet.h - 0.6)
    const mr = minRadius(l, onSheetEdge)
    if (mr.r < R.minRadius) {
      issues.push({
        code: 'corner',
        level: 'warn',
        th: `เส้นตัดมีมุมแหลม/หักศอก (รัศมี ~${fmt1(mr.r)} มม.) — ควรโค้งมนอย่างน้อย ${R.minRadius} มม. เพื่อให้ตัดสวย`,
        en: `Cut line has a sharp corner (~${fmt1(mr.r)} mm radius) — round it to ≥${R.minRadius} mm for a clean cut`,
        at: mr.at,
      })
    }
  }

  // เส้นตัดชนขอบแผ่น (ไดคัทตามรูปถูกตัดตรงที่ขอบแผ่น)
  const eps = 0.2
  const touching = contour && loops.some((l) =>
    l.some((p) => p.x <= eps || p.y <= eps || p.x >= sheet.w - eps || p.y >= sheet.h - eps),
  )
  if (touching) {
    issues.push({
      code: 'edge',
      level: 'warn',
      th: 'เส้นตัดชนขอบแผ่น — ขยายขนาดสติกเกอร์ หรือย้ายลายเข้ามาให้มีที่ว่างรอบตัว',
      en: 'Cut line hits the sheet edge — enlarge the sticker or move the artwork inward',
    })
  }

  // ซ้ำโค้ดเดียวกันหลายจุด → รวมเป็นรายการเดียว (เก็บตัวแรกพร้อมจำนวน)
  const seen = new Map<PreflightCode, PreflightIssue & { n: number }>()
  for (const it of issues) {
    const s = seen.get(it.code)
    if (s) s.n++
    else seen.set(it.code, { ...it, n: 1 })
  }
  return [...seen.values()].map(({ n, ...it }) =>
    n > 1 ? { ...it, th: `${it.th} (${n} จุด)`, en: `${it.en} (${n} places)` } : it,
  )
}
