// ลายน้ำบนพรีวิว (Freemium) — ข้อความซ้ำเฉียง −30° คลุมทั้งแผ่น ใช้ร่วม 3 พื้นผิว:
// blueprint (SVG <text>), texture 3D (canvas) และแผ่นสติกเกอร์ (SVG) — คำนวณตำแหน่งชุดเดียวกัน
// ห้ามทำเป็น Deco: Deco ไหลเข้า snap/DPI/contour/ไฟล์ส่งออก ส่วนลายน้ำต้องอยู่บนพรีวิวเท่านั้น

export interface WatermarkTile {
  x: number // มม. (จุดกึ่งกลางข้อความ)
  y: number
  angle: number // องศา (ตามเข็ม เหมือน rotate ของ SVG/canvas)
  size: number // ขนาดตัวอักษร มม.
}

export const WATERMARK_TEXT = { th: 'PackIt · ตัวอย่าง', en: 'PackIt · PREVIEW' } as const

export const WATERMARK_ANGLE = -30
export const WATERMARK_ALPHA = 0.18
export const WATERMARK_SIZE_MIN = 6
export const WATERMARK_SIZE_MAX = 40
// ระยะแถว ≈ 2.2×ขนาด → เห็น ~3–5 แถวบนด้านสั้นของแผ่น; ระยะคอลัมน์ = ขนาด × ความยาวข้อความ (em)
// ข้อความ 'PackIt · PREVIEW' ตัวหนากว้าง ~8.6em จึงใช้ 9.5 ให้มีช่องว่างระหว่างคอลัมน์ไม่ทับกัน
export const WATERMARK_ROW_PITCH = 2.2
export const WATERMARK_COL_PITCH = 9.5

// ขนาดตัวอักษร = 1/10 ของด้านสั้น แต่ไม่เล็กกว่า 6 มม. (อ่านออกบนสติกเกอร์เล็ก) และไม่ใหญ่กว่า 40 มม.
export function watermarkSize(w: number, h: number): number {
  const m = Math.min(Math.abs(w), Math.abs(h)) / 10
  return Math.min(WATERMARK_SIZE_MAX, Math.max(WATERMARK_SIZE_MIN, m))
}

// ตำแหน่งข้อความทั้งหมดที่คลุมแผ่น w×h มม.: วางกริดในพิกัดหมุน −30° รอบกึ่งกลางแผ่น
// (แถวเว้น rowPitch, คอลัมน์เว้น colPitch สลับฟันปลาครึ่งคอลัมน์) แล้วตัดทิ้งจุดที่พ้นแผ่นเกิน 1 ขนาดตัวอักษร
// deterministic — ค่าเดียวกันทุกครั้ง; แผ่นจิ๋วได้อย่างน้อย 1 จุดกลางแผ่นเสมอ
export function watermarkTiles(w: number, h: number): WatermarkTile[] {
  const size = watermarkSize(w, h)
  const rowPitch = size * WATERMARK_ROW_PITCH
  const colPitch = size * WATERMARK_COL_PITCH
  const rad = (WATERMARK_ANGLE * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const cx = w / 2
  const cy = h / 2
  // รัศมีครึ่งเส้นทแยง + เผื่อ 1 ระยะ ให้กริดหมุนคลุมมุมแผ่นครบ
  const R = Math.hypot(w, h) / 2 + Math.max(rowPitch, colPitch)
  const rows = Math.ceil(R / rowPitch)
  const cols = Math.ceil(R / colPitch)
  const tiles: WatermarkTile[] = []
  for (let i = -rows; i <= rows; i++) {
    const v = i * rowPitch
    const stagger = i % 2 === 0 ? 0 : colPitch / 2
    for (let j = -cols; j <= cols; j++) {
      const u = j * colPitch + stagger
      const x = cx + u * cos - v * sin
      const y = cy + u * sin + v * cos
      if (x < -size || x > w + size || y < -size || y > h + size) continue
      tiles.push({ x, y, angle: WATERMARK_ANGLE, size })
    }
  }
  if (tiles.length === 0) tiles.push({ x: cx, y: cy, angle: WATERMARK_ANGLE, size })
  return tiles
}

// วาดลายน้ำลง canvas (px = มม. × s) — ใช้กับ texture 3D ทุก viewer; ฟอนต์โหลดไว้แล้วโดยแอป ไม่ต้อง await
// ตัวอักษรเข้ม + ขอบขาวบาง ๆ ให้อ่านออกทั้งบนพื้นอ่อน/เข้ม, โปร่ง 0.18 ไม่บังลายที่ออกแบบ
export function drawWatermark(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  s: number,
  text: string,
): void {
  const tiles = watermarkTiles(w, h)
  ctx.save()
  ctx.globalAlpha = WATERMARK_ALPHA
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  for (const tile of tiles) {
    const px = tile.size * s
    ctx.save()
    ctx.translate(tile.x * s, tile.y * s)
    ctx.rotate((tile.angle * Math.PI) / 180)
    ctx.font = `700 ${px}px "Noto Sans Thai", system-ui, sans-serif`
    ctx.lineWidth = Math.max(0.5, px * 0.04)
    ctx.strokeStyle = '#ffffff'
    ctx.strokeText(text, 0, 0)
    ctx.fillStyle = '#111111'
    ctx.fillText(text, 0, 0)
    ctx.restore()
  }
  ctx.restore()
}
