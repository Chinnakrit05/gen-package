import type { BoxParams, Dieline, DimMark, Panel, Segment, Vec2 } from '../types'
import { P, fmt, roundedRectPts, roundedRectPath } from './shared'
import { loopPath, type StickerBasicShape } from '../stickerContour'

// รูปทรงพื้นฐานของสติกเกอร์ (ไม่รวม 'contour' = ตามรูป ซึ่งคำนวณจากลาย) — ทุกแบบพอดีกรอบ W×H
export const STICKER_BASIC_SHAPES: { id: StickerBasicShape; nameTh: string; nameEn: string }[] = [
  { id: 'rect', nameTh: 'สี่เหลี่ยมมุมมน', nameEn: 'Rounded' },
  { id: 'square', nameTh: 'สี่เหลี่ยม', nameEn: 'Rectangle' },
  { id: 'ellipse', nameTh: 'วงกลม/วงรี', nameEn: 'Circle/oval' },
  { id: 'hexagon', nameTh: 'หกเหลี่ยม', nameEn: 'Hexagon' },
  { id: 'star', nameTh: 'ดาว', nameEn: 'Star' },
  { id: 'heart', nameTh: 'หัวใจ', nameEn: 'Heart' },
]

// รัศมีมุมขั้นต่ำของเส้นตัด (กติกาไดคัท ≥0.5 มม. — เผื่อเป็น 1)
const MIN_CORNER = 1

// จุดบนส่วนโค้งวงกลม (cx,cy,r) จากมุม a0 ถึง a1 (ทิศตามเครื่องหมายของ a1−a0) ไม่รวมจุดแรก
function arcTo(cx: number, cy: number, r: number, a0: number, a1: number, seg: number): Vec2[] {
  const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) / (Math.PI / 2)) * seg))
  return Array.from({ length: n }, (_, k) => {
    const a = a0 + ((a1 - a0) * (k + 1)) / n
    return P(cx + r * Math.cos(a), cy + r * Math.sin(a))
  })
}

// มนมุมด้วยส่วนโค้งวงกลมจริง (fillet) รัศมี r ที่จุดยอด V ระหว่างทิศ u (ไปจุดก่อนหน้า) และ w (ไปจุดถัดไป)
// คืนจุดจากจุดสัมผัสบนขอบก่อนหน้า → จุดสัมผัสบนขอบถัดไป; ระยะสัมผัสไม่เกิน maxD (ขอบสั้น → ลดรัศมี)
function fillet(V: Vec2, u: Vec2, w: Vec2, r: number, maxD: number, seg = 8): Vec2[] {
  const cos = Math.max(-1, Math.min(1, u.x * w.x + u.y * w.y))
  const half = Math.acos(cos) / 2
  if (half > Math.PI / 2 - 1e-3) return [V] // แทบเป็นเส้นตรง
  let d = r / Math.tan(half)
  if (d > maxD) {
    d = maxD
    r = d * Math.tan(half)
  }
  const bx = u.x + w.x
  const by = u.y + w.y
  const bl = Math.hypot(bx, by)
  const cd = r / Math.sin(half)
  const C = P(V.x + (bx / bl) * cd, V.y + (by / bl) * cd)
  const p0 = P(V.x + u.x * d, V.y + u.y * d)
  const p1 = P(V.x + w.x * d, V.y + w.y * d)
  const a0 = Math.atan2(p0.y - C.y, p0.x - C.x)
  let a1 = Math.atan2(p1.y - C.y, p1.x - C.x)
  // เดินทางสั้น (ส่วนโค้งของมุมมนน้อยกว่าครึ่งวงเสมอ)
  while (a1 - a0 > Math.PI) a1 -= 2 * Math.PI
  while (a1 - a0 < -Math.PI) a1 += 2 * Math.PI
  return [p0, ...arcTo(C.x, C.y, r, a0, a1, seg)]
}

const unit = (a: Vec2, b: Vec2): Vec2 => {
  const l = Math.hypot(b.x - a.x, b.y - a.y)
  return P((b.x - a.x) / l, (b.y - a.y) / l)
}

// มนทุกมุมของรูปหลายเหลี่ยมด้วยรัศมี r (ไม่เกิน 45% ของขอบ) — ใช้ได้ทั้งมุมนูนและมุมเว้า
function roundPolygon(pts: Vec2[], r: number): Vec2[] {
  const N = pts.length
  return pts.flatMap((V, i) => {
    const a = pts[(i - 1 + N) % N]
    const b = pts[(i + 1) % N]
    const maxD = 0.45 * Math.min(Math.hypot(a.x - V.x, a.y - V.y), Math.hypot(b.x - V.x, b.y - V.y))
    return fillet(V, unit(V, a), unit(V, b), r, maxD)
  })
}

// ยืดจุดให้พอดีกรอบ [0,w]×[0,h]
function fitBox(pts: Vec2[], w: number, h: number): Vec2[] {
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const x0 = Math.min(...xs)
  const y0 = Math.min(...ys)
  const sx = w / (Math.max(...xs) - x0)
  const sy = h / (Math.max(...ys) - y0)
  return pts.map((p) => P((p.x - x0) * sx, (p.y - y0) * sy))
}

// เส้นรอบรูปของรูปทรงพื้นฐาน (พิกัดแผ่น y ลง, ปิดวง) พอดีกรอบ W×H
export function stickerOutline(shape: StickerBasicShape, w: number, h: number): Vec2[] {
  const s = Math.min(w, h)
  if (shape === 'rect' || shape === 'square') {
    // มุมมน ~12% ของด้านสั้น (≥2 มม.) / มุมฉาก = รัศมีขั้นต่ำของไดคัท
    const r = shape === 'rect' ? Math.min(Math.max(s * 0.12, 2), s / 2) : MIN_CORNER
    return roundedRectPts(0, 0, w, h, r)
  }
  if (shape === 'ellipse') {
    const n = 96
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * 2 * Math.PI
      return P(w / 2 + (w / 2) * Math.cos(a), h / 2 + (h / 2) * Math.sin(a))
    })
  }
  if (shape === 'hexagon') {
    // หกเหลี่ยมแนวนอน (ยอดซ้าย-ขวา) ยืดตามกรอบ
    const hex = [P(0, h / 2), P(w / 4, 0), P((3 * w) / 4, 0), P(w, h / 2), P((3 * w) / 4, h), P(w / 4, h)]
    // มนมุมแล้วยืดกลับให้เต็มกรอบ (มุมมนกินขอบกรอบเล็กน้อย — ยืดกลับแล้วรัศมีโตขึ้นนิดเดียว)
    return fitBox(roundPolygon(hex, Math.max(MIN_CORNER, s * 0.06)), w, h)
  }
  if (shape === 'star') {
    // ดาว 5 แฉก ยอดบน รัศมีใน 0.45 — มนทั้งปลายแฉกและมุมเว้า
    const pts: Vec2[] = []
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5
      const r = i % 2 === 0 ? 1 : 0.45
      pts.push(P(r * Math.cos(a), r * Math.sin(a)))
    }
    return fitBox(roundPolygon(fitBox(pts, w, h), Math.max(MIN_CORNER, s * 0.03)), w, h)
  }
  return heartOutline(w, h)
}

// หัวใจ: สองวงกลม (พูซ้าย-ขวา) + เส้นสัมผัสลงหาปลายล่าง — มนปลายล่าง (มุมนูน) และร่องบน (มุมเว้า)
// ด้วยส่วนโค้งวงกลมจริง แล้วยืดพอดีกรอบ (รัศมีมนเผื่อการยืดไม่เท่ากันสองแกนให้ยัง ≥ 1 มม.)
function heartOutline(w: number, h: number): Vec2[] {
  // พิกัดคณิต y ขึ้น: พู ρ=1 ศูนย์กลาง (±a, 0), ปลายล่าง (0, −tip)
  const rho = 1
  const a = 0.7
  const tip = 2.2
  const W0 = 2 * (a + rho)
  const H0 = rho + tip
  const sx = w / W0
  const sy = h / H0
  // ยืดสองแกนไม่เท่ากัน → รัศมีโค้งเล็กสุดเหลือ r·min²/max — ตั้งให้ได้ ≥ 1.2 มม. (และไม่ต่ำกว่าสัดส่วนรูปทรง)
  const need = (1.2 * Math.max(sx, sy)) / Math.min(sx, sy) ** 2
  const rt = Math.max(0.14, need) // ปลายล่าง
  const rn = Math.max(0.16, need) // ร่องบน
  const T = P(0, -tip)
  const Cr = P(a, 0)
  const Cl = P(-a, 0)
  // จุดสัมผัสเส้นจากปลายล่างถึงพูขวา (ด้านนอก)
  const tangent = (C: Vec2, side: 1 | -1) => {
    const vx = T.x - C.x
    const vy = T.y - C.y
    const L = Math.hypot(vx, vy)
    const al = Math.acos(rho / L) * side
    const ang = Math.atan2(vy, vx) + al
    return P(C.x + rho * Math.cos(ang), C.y + rho * Math.sin(ang))
  }
  const Pr = tangent(Cr, 1)
  const Pl = tangent(Cl, -1)
  // ร่องบน: วงกลมมน (รัศมี rn) แตะนอกพูทั้งสอง ศูนย์กลางบนแกนกลาง
  const yc = Math.sqrt((rho + rn) ** 2 - a * a)
  const Cf = P(0, yc)
  const angOn = (C: Vec2, q: Vec2) => Math.atan2(q.y - C.y, q.x - C.x)
  const Fr = P(Cr.x + (rho * (Cf.x - Cr.x)) / (rho + rn), Cr.y + (rho * (Cf.y - Cr.y)) / (rho + rn))
  const Fl = P(Cl.x + (rho * (Cf.x - Cl.x)) / (rho + rn), Cl.y + (rho * (Cf.y - Cl.y)) / (rho + rn))
  const pts: Vec2[] = []
  // ปลายล่างมน (เดินทวนเข็มในพิกัดคณิต: ฝั่งซ้าย → ฝั่งขวา)
  pts.push(...fillet(T, unit(T, Pl), unit(T, Pr), rt, 0.45 * Math.hypot(Pr.x - T.x, Pr.y - T.y), 10))
  // เส้นตรงขึ้นถึงพูขวา แล้วโค้งพูขวาทวนเข็มขึ้นไปจนจุดแตะวงมนร่องบน
  pts.push(Pr)
  let a0 = angOn(Cr, Pr)
  let a1 = angOn(Cr, Fr)
  while (a1 < a0) a1 += 2 * Math.PI
  pts.push(...arcTo(Cr.x, Cr.y, rho, a0, a1, 16))
  // วงมนร่องบน: ตามเข็ม (มุมเว้า) จากฝั่งขวาไปฝั่งซ้าย ผ่านด้านล่างของวง
  a0 = angOn(Cf, Fr)
  a1 = angOn(Cf, Fl)
  while (a1 > a0) a1 -= 2 * Math.PI
  pts.push(...arcTo(Cf.x, Cf.y, rn, a0, a1, 10))
  // พูซ้ายทวนเข็มลงไปถึงจุดสัมผัสเส้นลงปลายล่าง
  a0 = angOn(Cl, Fl)
  a1 = angOn(Cl, Pl)
  while (a1 < a0) a1 += 2 * Math.PI
  pts.push(...arcTo(Cl.x, Cl.y, rho, a0, a1, 16))
  // พิกัดแผ่น y ลง แล้วยืดพอดีกรอบ
  return fitBox(pts.map((p) => P(p.x, -p.y)), w, h)
}

// สติกเกอร์ไดคัท (die-cut sticker): แผ่นพิมพ์แบนชิ้นเดียว ไม่มีรอยพับ — เส้นตัดตามรูปทรงพื้นฐานที่เลือก
// (ค่าเริ่มต้นสี่เหลี่ยมมุมมน) ใช้เป็นฉลากสินค้า/โลโก้; W = กว้าง, H = สูง (แบน จึงไม่ใช้ค่า D)
export function generateSticker(box: BoxParams, shape: StickerBasicShape = 'rect'): Dieline {
  const { W: w, H: h } = box
  const outline = stickerOutline(shape, w, h)
  const panels: Panel[] = [{ id: 'sticker', parentId: null, outline, stage: 0 }]
  const r = Math.min(Math.max(Math.min(w, h) * 0.12, 2), Math.min(w, h) / 2)
  // สี่เหลี่ยมมุมมนคงเส้นโค้ง A แบบเดิม (ไฟล์ตัดเรียบกว่า polyline)
  const segments: Segment[] = [{ kind: 'cut', d: shape === 'rect' ? roundedRectPath(0, 0, w, h, r) : loopPath(outline) }]

  const dims: DimMark[] = [
    { a: P(0, h + 12), b: P(w, h + 12), label: `W ${fmt(w)}` },
    { a: P(-10, 0), b: P(-10, h), label: `H ${fmt(h)}` },
  ]

  return { width: w, height: h, segments, panels, dims }
}

// สติกเกอร์ไดคัทตามรูป: เส้นตัดจาก contourFromAlpha (loop ละชิ้น) บนแผ่นขนาด W×H เดิม
// ลายวางอยู่ที่ตำแหน่งเดิมบนแผ่น (พิกัดไม่ขยับ) — แผงหนึ่งต่อหนึ่งชิ้น ให้ 3D/ส่งออกใช้รูปทรงจริง
export function generateStickerContour(loops: Vec2[][], W: number, H: number): Dieline {
  const panels: Panel[] = loops.map((l, i) => ({
    id: i === 0 ? 'sticker' : `sticker-${i + 1}`,
    parentId: null,
    outline: l,
    stage: 0,
  }))
  const segments: Segment[] = loops.map((l) => ({ kind: 'cut', d: loopPath(l) }))
  const xs = loops.flat().map((p) => p.x)
  const ys = loops.flat().map((p) => p.y)
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  const dims: DimMark[] = [
    { a: P(x0, y1 + 8), b: P(x1, y1 + 8), label: `W ${fmt(x1 - x0)}` },
    { a: P(x0 - 8, y0), b: P(x0 - 8, y1), label: `H ${fmt(y1 - y0)}` },
  ]
  return { width: W, height: H, segments, panels, dims }
}
