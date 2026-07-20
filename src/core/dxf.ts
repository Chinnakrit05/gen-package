import type { Dieline, Vec2 } from './types'

// Export dieline เป็น DXF สำหรับส่งโรงทำมีดไดคัท
//
// ตัดสินใจเชิงรูปแบบไฟล์:
// - DXF R12 (AC1009) + entity LINE ล้วน — รูปแบบที่เก่าและเรียบง่ายที่สุด
//   เปิดได้กับ CAD/CAM/เครื่องเลเซอร์ทุกตัว ไม่ต้องมี handle/ownership เหมือน R13+
//   (LWPOLYLINE ใช้ใน R12 ไม่ได้ ต้อง R14 ขึ้นไป จึงเลี่ยงไปใช้ LINE ซึ่ง CAM ไล่ chain ต่อเองได้)
// - เส้นโค้ง (A/Q) แตกเป็นเส้นตรงย่อยตาม TOL แทนการแปลงเป็น entity ARC
//   เพราะแม่นเกินพอ (ดูค่า TOL) และตัดความเสี่ยงบั๊กจากการแปลงพารามิเตอร์ arc
// - ไม่ใส่เส้นบอกขนาดลงไฟล์ มีแต่ CUT/CREASE เท่านั้น — ไฟล์นี้คือไฟล์ผลิต
//   ถ้าโรงงานเผลอตัดตามเส้นบอกขนาดคือพัง

// ระยะคลาดเคลื่อนสูงสุดตอนแตกเส้นโค้งเป็นเส้นตรง (มม.)
// 0.02 มม. ละเอียดกว่าความแม่นของการทำมีดไดคัทจริง (~±0.1 มม.) ราว 5 เท่า
const TOL = 0.02

// path ที่ template สร้างใช้แค่ M/L/A/Q/Z แบบ absolute เท่านั้น (ตรวจแล้วทั้ง 4 template)
// จึง parse เฉพาะชุดนี้พอ ไม่ต้องรองรับ SVG path เต็มสเปก
function tokenize(d: string): (string | number)[] {
  const out: (string | number)[] = []
  const re = /([MLAQZ])|(-?\d*\.?\d+(?:e[-+]?\d+)?)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(d)) !== null) out.push(m[1] ? m[1].toUpperCase() : Number(m[2]))
  return out
}

// ระยะเบี่ยงสูงสุดของเส้นโค้งกำลังสองจากคอร์ด = |2*p1 - p0 - p2| / 4
// ความคลาดเคลื่อนเมื่อแบ่ง n ท่อน ~ dev/n² จึงได้ n = sqrt(dev/TOL)
function flattenQuad(p0: Vec2, p1: Vec2, p2: Vec2): Vec2[] {
  const dev = Math.hypot(2 * p1.x - p0.x - p2.x, 2 * p1.y - p0.y - p2.y) / 4
  const n = Math.max(2, Math.min(64, Math.ceil(Math.sqrt(dev / TOL))))
  const pts: Vec2[] = []
  for (let k = 1; k <= n; k++) {
    const t = k / n
    const u = 1 - t
    pts.push({
      x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    })
  }
  return pts
}

// แปลง SVG arc (endpoint parameterization) เป็นจุดบนเส้นโค้ง
// ใช้อัลกอริทึมตามภาคผนวก F.6.5 ของสเปก SVG
function flattenArc(
  p0: Vec2,
  rxIn: number,
  ryIn: number,
  rotDeg: number,
  large: number,
  sweep: number,
  p1: Vec2,
): Vec2[] {
  let rx = Math.abs(rxIn)
  let ry = Math.abs(ryIn)
  if (rx < 1e-9 || ry < 1e-9) return [p1]

  const phi = (rotDeg * Math.PI) / 180
  const cosP = Math.cos(phi)
  const sinP = Math.sin(phi)
  const dx2 = (p0.x - p1.x) / 2
  const dy2 = (p0.y - p1.y) / 2
  const x1p = cosP * dx2 + sinP * dy2
  const y1p = -sinP * dx2 + cosP * dy2

  // ถ้ารัศมีเล็กเกินกว่าจะลากถึงปลายทาง ต้องขยายตามสเปก
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
  if (lam > 1) {
    const s = Math.sqrt(lam)
    rx *= s
    ry *= s
  }

  const sign = large !== sweep ? 1 : -1
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
  const co = sign * Math.sqrt(Math.max(0, num / den))
  const cxp = (co * rx * y1p) / ry
  const cyp = (-co * ry * x1p) / rx
  const cx = cosP * cxp - sinP * cyp + (p0.x + p1.x) / 2
  const cy = sinP * cxp + cosP * cyp + (p0.y + p1.y) / 2

  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const d = Math.hypot(ux, uy) * Math.hypot(vx, vy)
    const c = Math.min(1, Math.max(-1, d < 1e-12 ? 1 : (ux * vx + uy * vy) / d))
    return (ux * vy - uy * vx < 0 ? -1 : 1) * Math.acos(c)
  }
  const ux = (x1p - cxp) / rx
  const uy = (y1p - cyp) / ry
  const vx = (-x1p - cxp) / rx
  const vy = (-y1p - cyp) / ry
  const th0 = ang(1, 0, ux, uy)
  let dth = ang(ux, uy, vx, vy)
  if (!sweep && dth > 0) dth -= 2 * Math.PI
  else if (sweep && dth < 0) dth += 2 * Math.PI

  // มุมต่อท่อนที่ทำให้ sagitta ไม่เกิน TOL: sagitta = r(1 - cos(α/2))
  const r = Math.max(rx, ry)
  const step = 2 * Math.acos(Math.min(1, Math.max(-1, 1 - TOL / r)))
  const n = Math.max(2, Math.min(256, Math.ceil(Math.abs(dth) / Math.max(step, 1e-6))))
  const pts: Vec2[] = []
  for (let k = 1; k <= n; k++) {
    const th = th0 + (dth * k) / n
    const ct = Math.cos(th)
    const st = Math.sin(th)
    pts.push({
      x: cosP * rx * ct - sinP * ry * st + cx,
      y: sinP * rx * ct + cosP * ry * st + cy,
    })
  }
  return pts
}

// แตก path เป็นชุด polyline (แต่ละเส้นคือ subpath ที่ต่อเนื่องกัน)
function pathToPolylines(d: string): Vec2[][] {
  const t = tokenize(d)
  const polys: Vec2[][] = []
  let cur: Vec2[] = []
  let pos: Vec2 = { x: 0, y: 0 }
  let start: Vec2 = { x: 0, y: 0 }
  let i = 0
  const num = () => t[i++] as number
  const flush = () => {
    if (cur.length > 1) polys.push(cur)
    cur = []
  }

  while (i < t.length) {
    const cmd = t[i++]
    if (typeof cmd !== 'string') continue
    switch (cmd) {
      case 'M': {
        flush()
        pos = { x: num(), y: num() }
        start = pos
        cur = [pos]
        break
      }
      case 'L': {
        pos = { x: num(), y: num() }
        cur.push(pos)
        break
      }
      case 'Q': {
        const c = { x: num(), y: num() }
        const e = { x: num(), y: num() }
        for (const p of flattenQuad(pos, c, e)) cur.push(p)
        pos = e
        break
      }
      case 'A': {
        const rx = num()
        const ry = num()
        const rot = num()
        const large = num()
        const sweep = num()
        const e = { x: num(), y: num() }
        for (const p of flattenArc(pos, rx, ry, rot, large, sweep, e)) cur.push(p)
        pos = e
        break
      }
      case 'Z': {
        if (cur.length > 0) cur.push(start)
        pos = start
        flush()
        break
      }
    }
  }
  flush()
  return polys
}

const f = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v).toFixed(4)

interface DxfLine {
  layer: string
  a: Vec2
  b: Vec2
}

export function dielineDXFString(d: Dieline): string {
  // พิกัดแผ่นคลี่ y ชี้ลง แต่ CAD ใช้ y ชี้ขึ้น — พลิกด้วย (height - y)
  // เพื่อให้ภาพใน CAD วางตัวเหมือนที่เห็นบนจอ และอยู่ในควอดรันต์บวก
  const fy = (y: number) => d.height - y

  const lines: DxfLine[] = []
  for (const s of d.segments) {
    const layer = s.kind === 'cut' ? 'CUT' : 'CREASE'
    for (const poly of pathToPolylines(s.d)) {
      for (let i = 1; i < poly.length; i++) {
        const a = { x: poly[i - 1].x, y: fy(poly[i - 1].y) }
        const b = { x: poly[i].x, y: fy(poly[i].y) }
        // ตัดเส้นยาวศูนย์ทิ้ง (เกิดได้ตอนปิด path ที่จุดสุดท้ายซ้ำจุดเริ่ม)
        if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-9) continue
        lines.push({ layer, a, b })
      }
    }
  }

  const xs = lines.flatMap((l) => [l.a.x, l.b.x])
  const ys = lines.flatMap((l) => [l.a.y, l.b.y])
  const minX = xs.length ? Math.min(...xs) : 0
  const minY = ys.length ? Math.min(...ys) : 0
  const maxX = xs.length ? Math.max(...xs) : 0
  const maxY = ys.length ? Math.max(...ys) : 0

  const out: (string | number)[] = []
  const g = (code: number, val: string | number) => {
    out.push(code, val)
  }

  // --- HEADER: หน่วยเป็นมิลลิเมตร ($INSUNITS = 4) สเกล 1:1 ---
  g(0, 'SECTION')
  g(2, 'HEADER')
  g(9, '$ACADVER')
  g(1, 'AC1009')
  g(9, '$INSUNITS')
  g(70, 4)
  g(9, '$EXTMIN')
  g(10, f(minX))
  g(20, f(minY))
  g(30, f(0))
  g(9, '$EXTMAX')
  g(10, f(maxX))
  g(20, f(maxY))
  g(30, f(0))
  g(0, 'ENDSEC')

  // --- TABLES: เลเยอร์ CUT (แดง) / CREASE (เขียว) ตามธรรมเนียม dieline ---
  g(0, 'SECTION')
  g(2, 'TABLES')
  g(0, 'TABLE')
  g(2, 'LAYER')
  g(70, 2)
  for (const [name, color] of [
    ['CUT', 1],
    ['CREASE', 3],
  ] as const) {
    g(0, 'LAYER')
    g(2, name)
    g(70, 0)
    g(62, color)
    g(6, 'CONTINUOUS')
  }
  g(0, 'ENDTAB')
  g(0, 'ENDSEC')

  // --- ENTITIES ---
  g(0, 'SECTION')
  g(2, 'ENTITIES')
  for (const l of lines) {
    g(0, 'LINE')
    g(8, l.layer)
    g(10, f(l.a.x))
    g(20, f(l.a.y))
    g(30, f(0))
    g(11, f(l.b.x))
    g(21, f(l.b.y))
    g(31, f(0))
  }
  g(0, 'ENDSEC')
  g(0, 'EOF')

  return out.join('\r\n') + '\r\n'
}
