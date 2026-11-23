// ชุดสีที่ใช้ในงานออกแบบ (pure) — สรุปให้ใบสเปกขอราคา: ทุกสีที่พิมพ์จริงพร้อม HEX / RGB / CMYK และใช้ที่ไหน
// ใช้ได้ทุกชนิดงาน (กล่อง/ภาชนะ/ถุง/สติกเกอร์/นามบัตร) และทุกที่มา (ผู้ใช้ตั้งเอง หรือ AI วางให้) เพราะอ่านจากลายในงานตรง ๆ:
// สีพื้น · ข้อความ (ตัว/ขอบ/ไล่สี/เอฟเฟกต์) · รูปทรง · เส้นวาดเอง · ตารางโภชนาการ · ลายไลบรารี · รูป SVG (อ่านสีจากไฟล์) ·
// สีฝาภาชนะ (ภาพ 3D); ชิ้นฟอยล์ไม่พิมพ์ CMYK จึงแยกเป็นรายการงานพิมพ์พิเศษ; รูป raster นับจำนวน (สีในรูปไม่แจกแจง)
import type { Deco, FillImage, GradientDef, TextEl } from './artwork'
import { finishDef, isFoil } from './finish'
import { TEXT_FX_KINDS, resolveTextFx, textFxAutoColor } from './textFx'

export interface DesignColor {
  hex: string // #RRGGBB ตัวพิมพ์ใหญ่
  rgb: [number, number, number]
  cmyk: [number, number, number, number] // % (0–100) สูตรเดียวกับไฟล์ผลิต PDF
  uses: string[] // ใช้ที่ไหน (ไม่ซ้ำ เรียงตามที่พบ)
  count: number // จำนวนครั้งที่ใช้
}

export interface DesignPalette {
  colors: DesignColor[]
  foils: { name: string; spot: string; count: number }[] // ชิ้นฟอยล์ (ไม่พิมพ์หมึก)
  rasterImages: number // รูปภาพ raster (สีตามรูป — ไม่แจกแจง)
}

export interface DesignColorInput {
  decos: readonly Deco[]
  fillColor?: string | null
  fillImage?: FillImage | null
  capColor?: string | null // สีฝาภาชนะ (เฉพาะเมื่อมีฝา) — ภาพ 3D ไม่อยู่ในไฟล์พิมพ์
}

// #abc / #aabbcc / #aabbccdd → #AABBCC (ไม่ใช่สี hex = null เช่น 'none', '', url(...))
export function normHex(v: string | null | undefined): string | null {
  if (!v) return null
  const s = v.trim()
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s)
  if (m3) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`.toUpperCase()
  const m6 = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(s)
  return m6 ? `#${m6[1]}`.toUpperCase() : null
}

// RGB hex → CMYK (0..1) แบบตรง ไม่มี ICC profile — สูตรเดียวที่ไฟล์ผลิต PDF ใช้ (pdf.ts)
export function hexToCmyk(hex: string): [number, number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const k = 1 - Math.max(r, g, b)
  const f = (v: number) => (k >= 1 ? 0 : (1 - v - k) / (1 - k))
  return [f(r), f(g), f(b), k]
}

const SHAPE_TH: Record<string, string> = {
  rect: 'สี่เหลี่ยม',
  ellipse: 'วงรี',
  line: 'เส้น',
  triangle: 'สามเหลี่ยม',
  polygon: 'หลายเหลี่ยม',
  star: 'ดาว',
}

const clip = (s: string, n = 16) => {
  const one = s.replace(/\s+/g, ' ').trim()
  const chars = [...one]
  return chars.length > n ? `${chars.slice(0, n).join('')}…` : one
}

// สี hex ที่อยู่ใน SVG data URL (fill/stroke/stop-color/style) — ลายไลบรารีและรูปที่ AI วาดเป็น SVG
export function svgDataUrlColors(src: string): string[] {
  const m = /^data:image\/svg\+xml(;base64)?,(.*)$/is.exec(src)
  if (!m) return []
  let body = m[2]
  try {
    body = m[1] ? atob(body) : decodeURIComponent(body)
  } catch {
    return []
  }
  const out: string[] = []
  for (const hit of body.matchAll(/(?:fill|stroke|stop-color|color)\s*[:=]\s*["']?\s*(#[0-9a-f]{3,8})\b/gi)) {
    const h = normHex(hit[1])
    if (h && !out.includes(h)) out.push(h)
  }
  return out
}

export function designPalette(input: DesignColorInput): DesignPalette {
  const map = new Map<string, DesignColor>()
  const add = (raw: string | null | undefined, use: string) => {
    const hex = normHex(raw)
    if (!hex) return
    let c = map.get(hex)
    if (!c) {
      const n = parseInt(hex.slice(1), 16)
      c = {
        hex,
        rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255],
        cmyk: hexToCmyk(hex).map((v) => Math.round(v * 100)) as DesignColor['cmyk'],
        uses: [],
        count: 0,
      }
      map.set(hex, c)
    }
    c.count++
    if (!c.uses.includes(use)) c.uses.push(use)
  }
  const grad = (g: GradientDef | undefined, use: string) => {
    if (!g) return
    add(g.from, `${use} (ไล่สี)`)
    add(g.to, `${use} (ไล่สี)`)
  }

  add(input.fillColor, 'สีพื้นแพ็กเกจ')
  let rasterImages = 0
  if (input.fillImage) {
    const svg = svgDataUrlColors(input.fillImage.src)
    if (svg.length) svg.forEach((h) => add(h, 'รูปพื้น (SVG)'))
    else rasterImages++
  }

  const foilCount = new Map<string, { name: string; spot: string; count: number }>()
  for (const e of input.decos) {
    if (e.hidden) continue
    if (isFoil(e.finish)) {
      const def = finishDef(e.finish)!
      const f = foilCount.get(def.id) ?? { name: def.nameTh, spot: def.spot, count: 0 }
      f.count++
      foilCount.set(def.id, f)
      continue // ฟอยล์แทนหมึก — สีของชิ้นไม่ถูกพิมพ์
    }
    const label = e.name?.trim()
    if (e.type === 'text') {
      const who = label || `ข้อความ "${clip(e.text)}"`
      if (e.grad) grad(e.grad, who)
      else add(e.color, who)
      if (e.strokeColor && (e.strokeW ?? 0) > 0) add(e.strokeColor, `${who} (ขอบ)`)
      textFx(e, who, add)
    } else if (e.type === 'shape') {
      const who = label || `รูปทรง${SHAPE_TH[e.shape] ?? ''}`
      if (e.shape !== 'line') {
        if (e.grad) grad(e.grad, who)
        else if (e.fill !== 'none') add(e.fill, who)
      }
      if (e.stroke !== 'none' && e.strokeW > 0) add(e.stroke, e.shape === 'line' ? who : `${who} (เส้นขอบ)`)
    } else if (e.type === 'path') {
      const who = label || 'เส้นวาดเอง'
      if (e.closed) {
        if (e.grad) grad(e.grad, who)
        else if (e.fill !== 'none') add(e.fill, who)
      }
      if (e.stroke !== 'none' && e.strokeW > 0) add(e.stroke, `${who} (เส้น)`)
    } else if (e.type === 'nutrition') {
      const who = label || 'ตารางโภชนาการ'
      add(e.ink ?? '#000000', who)
      if (e.paper !== false) add('#FFFFFF', `${who} (พื้น)`)
    } else if (e.type === 'image') {
      const who = label || (e.preset ? 'ลายจากคลัง' : 'รูป SVG')
      if (e.preset && e.presetColor) {
        add(e.presetColor, who)
        continue
      }
      const svg = svgDataUrlColors(e.src)
      if (svg.length) svg.forEach((h) => add(h, who))
      else rasterImages++
    }
  }
  add(input.capColor, 'สีฝา (ภาพ 3D เท่านั้น)')

  const colors = [...map.values()].sort((a, b) => b.count - a.count)
  return { colors, foils: [...foilCount.values()], rasterImages }
}

// สีของเอฟเฟกต์ข้อความ (สีว่าง = อัตโนมัติจากสีตัวอักษร ตามที่ตัววาดใช้จริง)
function textFx(e: TextEl, who: string, add: (hex: string | null | undefined, use: string) => void) {
  const fx = resolveTextFx(e) // รวมค่าเริ่มต้นของเอฟเฟกต์ (สีที่ไม่ได้ตั้ง = สีเริ่มต้นที่ตัววาดใช้จริง)
  if (!fx) return
  const name = TEXT_FX_KINDS.find((k) => k.id === fx.kind)?.nameTh ?? fx.kind
  const use = `${who} (เอฟเฟกต์${name})`
  if (fx.kind === 'hollow') return // กลวง = ใช้สีตัวอักษรเป็นเส้น ไม่มีสีเพิ่ม
  add(fx.color || textFxAutoColor(fx.kind, e), use)
  if (fx.kind === 'double' && fx.color2) add(fx.color2, use)
}
