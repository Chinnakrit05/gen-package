import {
  HANG_HOLE_R,
  TEAR_GAP,
  TEAR_SEAL_GAP,
  TINTIE_INSET,
  VALVE_V,
  ZIP_HALF,
  hangHoleY,
  spoutMarker,
  valveR,
  type Pouch,
} from './pouch'

// ตรวจตำแหน่งซิปล็อก/รอยบากฉีกตามหลักการผลิตถุง (pure) — ระยะทั้งหมดเป็น มม. จากขอบบนถุง
// ลำดับที่ถูก: ซีลบน → รอยบาก (พ้นซีล) → ซิป (เว้นระยะให้ฉีก) → ลำตัว; ซิปไม่ทับวาล์ว/ที่รัดปาก/จุก/ก้นจีบ
export type PouchIssueCode =
  | 'tear-in-seal'
  | 'tear-near-seal'
  | 'tear-below-zip'
  | 'tear-near-zip'
  | 'zip-near-seal'
  | 'zip-low'
  | 'zip-bottom'
  | 'zip-hang'
  | 'zip-valve'
  | 'zip-tintie'
  | 'zip-spout'

export interface PouchIssue {
  code: PouchIssueCode
  level: 'error' | 'warn'
  th: string
  en: string
}

const f = (v: number) => String(Math.round(v * 10) / 10)
const overlap = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1

export function pouchZipIssues(p: Pouch): PouchIssue[] {
  if (!p.zipper || p.zipY === undefined || p.tearY === undefined) return []
  const st = p.frontRect.y
  const { zipY, tearY, H } = p
  const out: PouchIssue[] = []
  const add = (code: PouchIssueCode, level: PouchIssue['level'], th: string, en: string) =>
    out.push({ code, level, th, en })

  // รอยบาก vs ซีลบน
  if (tearY <= st) {
    add(
      'tear-in-seal',
      'error',
      `รอยฉีกอยู่ในแนวซีลบน (${f(tearY)} ≤ ${f(st)} มม.) — ฉีกแล้วถุงไม่เปิด ต้องเลื่อนลงให้พ้นซีล`,
      `Tear notch sits inside the top seal (${f(tearY)} ≤ ${f(st)} mm) — tearing won't open the bag; move it below the seal`,
    )
  } else if (tearY < st + TEAR_SEAL_GAP) {
    add(
      'tear-near-seal',
      'warn',
      `รอยฉีกชิดซีลบนเกินไป (ควรต่ำกว่าซีลอย่างน้อย ${TEAR_SEAL_GAP} มม.) — ฉีกแล้วอาจไม่เปิดเต็มปาก`,
      `Tear notch is very close to the top seal (keep ≥${TEAR_SEAL_GAP} mm below it) — the bag may not open cleanly`,
    )
  }
  // ซิปชิดซีลจนไม่มีที่ให้รอยบาก (ต้องมี: ซีล + ระยะพ้นซีล + ระยะเหนือปีกซิป)
  const zipMin = st + TEAR_SEAL_GAP + TEAR_GAP
  if (zipY - ZIP_HALF <= st + TEAR_SEAL_GAP) {
    add(
      'zip-near-seal',
      'error',
      `ซิปชิดซีลบนเกินไป — ไม่มีที่ให้รอยฉีกระหว่างซีลกับซิป; เลื่อนซิปลง (แนะนำ ≥${f(zipMin)} มม. จากขอบบน)`,
      `Zipper is too close to the top seal — no room for a tear notch between them; move it down (≥${f(zipMin)} mm from the top recommended)`,
    )
  } else if (tearY >= zipY - ZIP_HALF) {
    add(
      'tear-below-zip',
      'error',
      'รอยฉีกต่ำกว่าหรือทับแนวซิป — ฉีกแล้วซิปหลุดไปกับเศษฟิล์ม ปิดซ้ำไม่ได้; รอยฉีกต้องอยู่เหนือซิป',
      'Tear notch is level with or below the zipper — tearing removes the zipper so the bag cannot reclose; keep it above the zipper',
    )
  } else if (zipY - tearY < TEAR_GAP) {
    add(
      'tear-near-zip',
      'warn',
      `รอยฉีกห่างซิปแค่ ${f(zipY - tearY)} มม. (แนะนำ ≥${TEAR_GAP}) — แนวฉีกอาจเบี่ยงโดนปีกซิป`,
      `Tear notch is only ${f(zipY - tearY)} mm above the zipper (≥${TEAR_GAP} recommended) — the tear may run into the zipper flange`,
    )
  }
  // ซิปต่ำเกิน / ลงไปถึงก้นจีบ
  // ถุงมีก้น gusset: ก้นพับขึ้นมาซีลติดข้างถุงราวครึ่งความลึกก้น → ช่วงนั้นซีลซิปไม่ได้
  const bottomZone = p.style === 'stand' || p.style === 'spout' || p.style === 'box' ? p.gusset / 2 : 0
  if (zipY + ZIP_HALF > st + H - bottomZone) {
    add(
      'zip-bottom',
      'error',
      'ซิปลงไปถึงช่วงก้น/ก้นจีบ — เครื่องซีลซิปตรงนั้นไม่ได้ ต้องเลื่อนขึ้น',
      'Zipper reaches the bottom/gusset area — it cannot be sealed there; move it up',
    )
  } else if (zipY > st + H * 0.5) {
    add(
      'zip-low',
      'warn',
      'ซิปต่ำกว่าครึ่งถุง — เปิดใช้ไม่สะดวกและเสียพื้นที่บรรจุเหนือซิป',
      'Zipper is below half the bag height — awkward to use and wastes fill space above it',
    )
  }
  const zip0 = zipY - ZIP_HALF
  const zip1 = zipY + ZIP_HALF
  if (p.hangHole) {
    const hy = hangHoleY(st)
    if (overlap(zip0, zip1, hy - HANG_HOLE_R - 1, hy + HANG_HOLE_R + 1) || tearY - 2.5 < hy + HANG_HOLE_R + 1) {
      add(
        'zip-hang',
        'error',
        'ซิป/รอยฉีกทับรูแขวน — รูแขวนต้องอยู่ในหัวถุงเหนือรอยฉีก',
        'Zipper/tear notch overlaps the hang hole — the hole must sit in the header above the tear',
      )
    }
  }
  if (p.valve) {
    const vy = st + (1 - VALVE_V) * H
    const vr = valveR(p.W)
    if (overlap(zip0, zip1, vy - vr, vy + vr)) {
      add(
        'zip-valve',
        'error',
        'ซิปทับวาล์วกาแฟ — เลื่อนซิปขึ้นหรือลงให้พ้นวาล์ว',
        'Zipper overlaps the degassing valve — move it clear of the valve',
      )
    } else if (overlap(zip0, zip1, vy - vr - 2, vy + vr + 2)) {
      add(
        'zip-valve',
        'warn',
        'ซิปชิดวาล์วกาแฟ (ห่างไม่ถึง 2 มม.) — หัวซีลซิปอาจกดโดนวาล์ว ควรเลื่อนซิปขึ้น',
        'Zipper is within 2 mm of the degassing valve — the zipper sealing jaw may hit it; move the zipper up',
      )
    }
  }
  if (p.tinTie) {
    const ty = st + TINTIE_INSET
    if (overlap(zip0, zip1, ty, ty + 6)) {
      add(
        'zip-tintie',
        'warn',
        'ซิปทับแนวที่รัดปาก (tin-tie) — ปกติใช้อย่างใดอย่างหนึ่ง หรือเลื่อนซิปลง',
        'Zipper overlaps the tin-tie — usually only one is used, or move the zipper down',
      )
    }
  }
  if (p.spout) {
    const s = spoutMarker(p.W, st)
    if (overlap(zip0, zip1, s.cy - s.r - 2, s.cy + s.r + 2)) {
      add(
        'zip-spout',
        'error',
        'ซิปทับตำแหน่งเชื่อมจุก — เลื่อนซิปลงให้พ้นจุก',
        'Zipper overlaps the spout fitment — move it below the spout',
      )
    }
  }
  return out
}
