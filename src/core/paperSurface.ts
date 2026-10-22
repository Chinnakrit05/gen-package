import type { PaperSurface } from './types'

// ผิวกระดาษพิเศษ (pure) — ใช้ทำแผนที่นูนต่ำของ 3D (useFinishMaps) และพื้นรุ้งของฟิล์มโฮโลแกรม
// ค่าความสูงเป็น "ระดับเทา" บวก/ลบรอบเทากลาง (127 ระดับ = RELIEF_MM ใน useFinishMaps) — เนื้อกระดาษนูนแค่ไม่กี่ร้อยมม.
// จึงใช้ช่วงแคบ ±GRAIN_AMP ไม่ให้แย่งปั๊มนูน/จมที่อยู่บนแผนที่เดียวกัน

export const GRAIN_AMP = 14

// ผิวที่มีเนื้อนูน (holo = ฟิล์มเรียบ ไม่มีแผนที่นูน)
export const hasGrain = (s: PaperSurface | undefined): s is 'felt' | 'linen' | 'kraft' =>
  s === 'felt' || s === 'linen' || s === 'kraft'

// hash จำนวนเต็ม → [0,1) คงที่ทุกครั้ง (ลายเดิมทุกการวาด ไม่กระพริบเมื่อแก้งาน)
function hash(x: number, y: number, seed: number): number {
  let n = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed, 1442695041)) | 0
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  n ^= n >>> 16
  return (n >>> 0) / 4294967296
}

// value noise แบบ bilinear + smoothstep ขนาดเซลล์ cx×cy พิกเซล (ยืดแกนได้ — เส้นใยคราฟท์)
function noise(x: number, y: number, cx: number, cy: number, seed: number): number {
  const fx = x / cx
  const fy = y / cy
  const ix = Math.floor(fx)
  const iy = Math.floor(fy)
  const tx = fx - ix
  const ty = fy - iy
  const sx = tx * tx * (3 - 2 * tx)
  const sy = ty * ty * (3 - 2 * ty)
  const a = hash(ix, iy, seed)
  const b = hash(ix + 1, iy, seed)
  const c = hash(ix, iy + 1, seed)
  const d = hash(ix + 1, iy + 1, seed)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}

// ความสูงเนื้อกระดาษ (−GRAIN_AMP..GRAIN_AMP) ต่อพิกเซลของภาพ w×h ที่ s px/มม.
//  felt  = เนื้อฟูเป็นปุยไม่มีทิศ (คอตตอน/เท็กซ์เจอร์) สองขนาดซ้อนกัน
//  linen = ลายผ้าทอ เส้นนอน-ตั้งสลับกันเป็นตาราง ระยะ ~0.6 มม. + เส้นด้ายไม่สม่ำเสมอเล็กน้อย
//  kraft = เส้นใยยาวตามแนวนอน (ทิศเยื่อกระดาษ) + เม็ดละเอียด
export function paperGrain(surface: 'felt' | 'linen' | 'kraft', w: number, h: number, s: number): Float32Array {
  const out = new Float32Array(w * h)
  const mm = (v: number) => Math.max(1, v * s)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v: number
      if (surface === 'felt') {
        v = 0.6 * noise(x, y, mm(0.35), mm(0.35), 1) + 0.4 * noise(x, y, mm(1.1), mm(1.1), 2) - 0.5
      } else if (surface === 'linen') {
        const p = 0.6 // ระยะเส้นด้าย มม.
        const u = x / s / p
        const w2 = y / s / p
        const jitter = 0.25 * (noise(x, y, mm(2.5), mm(0.4), 3) - 0.5)
        const hor = Math.abs(Math.sin(Math.PI * (w2 + jitter))) // สันเส้นนอน
        const ver = Math.abs(Math.sin(Math.PI * (u + jitter))) // สันเส้นตั้ง
        // ทอสลับ: ช่องคู่เส้นนอนอยู่บน ช่องคี่เส้นตั้งอยู่บน
        const over = (Math.floor(u) + Math.floor(w2)) % 2 === 0
        v = 0.5 * (over ? 0.7 * hor + 0.3 * ver : 0.3 * hor + 0.7 * ver) - 0.25 + 0.15 * (noise(x, y, mm(0.3), mm(0.3), 4) - 0.5)
      } else {
        v = 0.55 * noise(x, y, mm(1.8), mm(0.22), 5) + 0.3 * noise(x, y, mm(0.6), mm(0.12), 6) + 0.15 * noise(x, y, mm(0.2), mm(0.2), 7) - 0.5
      }
      out[y * w + x] = Math.max(-1, Math.min(1, v * 2)) * GRAIN_AMP
    }
  }
  return out
}

// สีรุ้งของฟิล์มโฮโลแกรม ณ ตำแหน่ง t (0..1 ตามแนวทแยง) — แถบสีวนซ้ำหลายรอบ อ่อนแบบเหลือบโลหะ
export function holoColor(t: number): string {
  const hue = ((t * 3 * 360) % 360 + 360) % 360
  return `hsl(${Math.round(hue)}, 70%, 78%)`
}

// ระบายพื้นรุ้งทั้งผืน (canvas ของ texture ลาย) — ทแยงสองทิศซ้อนกันให้เหลือบไม่เป็นแถบตรงทื่อ
// strength < 1 = เหลือบจางทับสีกระดาษ (กระดาษมุก)
export function paintHolo(ctx: CanvasRenderingContext2D, w: number, h: number, strength = 1) {
  const lin = (x0: number, y0: number, x1: number, y1: number, alpha: number, shift: number) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1)
    for (let i = 0; i <= 24; i++) g.addColorStop(i / 24, holoColor(i / 24 + shift))
    ctx.globalAlpha = alpha
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }
  ctx.save()
  lin(0, 0, w, h, strength, 0)
  lin(w, 0, 0, h, 0.45 * strength, 0.17)
  ctx.restore()
}
