// ไลบรารีลาย/รูปทรงสำเร็จ (badge/ริบบิ้น/ไอคอน) — แต่ละลายเป็น generator ที่รับ "สี" แล้วคืน SVG
// วางลงงานเป็น ImageEl (SVG data URL) จึงคมชัด + ใช้ระบบรูปเดิมได้หมด และเปลี่ยนสีทีหลังได้
// (เก็บ preset id + สีไว้บนชิ้น แล้ว regen src เมื่อเปลี่ยนสี)

export interface Preset {
  id: string
  cat: 'badge' | 'ribbon' | 'icon'
  nameTh: string
  aspect: number // กว้าง/สูง ของดีไซน์
  svg: (color: string) => string
}

// คูณความสว่างของสี hex (f<1 = เข้มลง) — ใช้ทำเงา/รอยพับของริบบิ้น
function shade(hex: string, f: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex)
  const n = m ? parseInt(m[1], 16) : 0x0f6e56
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f))
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f))
  const b = Math.min(255, Math.round((n & 255) * f))
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)
}

// path ของดาว/แฉก: n จุด สลับรัศมี outer/inner รอบจุด (50,50) เริ่มชี้ขึ้น
function burst(points: number, outer: number, inner: number): string {
  const cx = 50
  const cy = 50
  const step = Math.PI / points
  let d = ''
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner
    const a = i * step - Math.PI / 2
    d += (i === 0 ? 'M' : 'L') + (cx + r * Math.cos(a)).toFixed(1) + ' ' + (cy + r * Math.sin(a)).toFixed(1)
  }
  return d + 'Z'
}

// ห่อ SVG + ตั้ง width/height (ด้านยาว ~512px) ให้ rasterize ลง canvas (3D/PDF) คมชัด
function wrap(vw: number, vh: number, inner: string): string {
  const s = 512 / Math.max(vw, vh)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}"` +
    ` width="${Math.round(vw * s)}" height="${Math.round(vh * s)}">${inner}</svg>`
  )
}

// data URL ของ SVG (base64, รองรับ unicode)
export function presetDataUrl(svg: string): string {
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)))
}

export const PRESETS: Preset[] = [
  // --- ตรา / Badge ---
  {
    id: 'badge-burst',
    cat: 'badge',
    nameTh: 'ตราแฉก',
    aspect: 1,
    svg: (c) =>
      wrap(
        100,
        100,
        `<path d="${burst(16, 48, 39)}" fill="${c}"/>` +
          `<circle cx="50" cy="50" r="31" fill="none" stroke="#fff" stroke-width="2.5"/>`,
      ),
  },
  {
    id: 'badge-seal',
    cat: 'badge',
    nameTh: 'ตรากลม',
    aspect: 1,
    svg: (c) =>
      wrap(
        100,
        100,
        `<circle cx="50" cy="50" r="48" fill="${c}"/>` +
          `<circle cx="50" cy="50" r="40" fill="none" stroke="#fff" stroke-width="2"/>` +
          `<circle cx="50" cy="50" r="43.5" fill="none" stroke="#fff" stroke-width="1" stroke-dasharray="1.5 3"/>`,
      ),
  },
  {
    id: 'badge-shield',
    cat: 'badge',
    nameTh: 'โล่',
    aspect: 100 / 112,
    svg: (c) =>
      wrap(
        100,
        112,
        `<path d="M50 5 L92 19 V60 C92 86 72 102 50 108 C28 102 8 86 8 60 V19 Z" fill="${c}"/>` +
          `<path d="M50 13 L84 24 V59 C84 80 68 93 50 99 C32 93 16 80 16 59 V24 Z" fill="none" stroke="#fff" stroke-width="2"/>`,
      ),
  },
  {
    id: 'badge-sale',
    cat: 'badge',
    nameTh: 'ป้ายเซล',
    aspect: 1,
    svg: (c) =>
      wrap(
        100,
        100,
        `<path d="${burst(12, 49, 33)}" fill="${c}"/>` + `<circle cx="50" cy="50" r="26" fill="${shade(c, 0.82)}"/>`,
      ),
  },
  // --- ริบบิ้น / Ribbon ---
  {
    id: 'ribbon-banner',
    cat: 'ribbon',
    nameTh: 'แบนเนอร์',
    aspect: 200 / 62,
    svg: (c) =>
      wrap(
        200,
        62,
        // หางพับด้านหลัง (เข้มกว่า)
        `<path d="M8 16 H36 V52 L18 40 L8 46 Z" fill="${shade(c, 0.65)}"/>` +
          `<path d="M192 16 H164 V52 L182 40 L192 46 Z" fill="${shade(c, 0.65)}"/>` +
          // ตัวป้าย ปลายบากรูปตัว V
          `<path d="M28 6 H172 L156 25 L172 44 H28 L44 25 Z" fill="${c}"/>`,
      ),
  },
  {
    id: 'ribbon-corner',
    cat: 'ribbon',
    nameTh: 'ริบบิ้นมุม',
    aspect: 1,
    svg: (c) =>
      wrap(
        100,
        100,
        `<path d="M30 4 L96 70 L70 96 L4 30 Z" fill="${c}"/>` +
          `<path d="M22 12 L12 22 L4 30 L30 4 Z" fill="${shade(c, 0.65)}"/>` +
          `<path d="M88 78 L78 88 L70 96 L96 70 Z" fill="${shade(c, 0.65)}"/>`,
      ),
  },
  {
    id: 'ribbon-tag',
    cat: 'ribbon',
    nameTh: 'ป้ายห้อย',
    aspect: 120 / 68,
    svg: (c) =>
      wrap(
        120,
        68,
        `<path d="M40 6 H112 a4 4 0 0 1 4 4 V58 a4 4 0 0 1 -4 4 H40 L6 34 Z" fill="${c}"/>` +
          `<circle cx="30" cy="34" r="6" fill="#fff"/>`,
      ),
  },
  // --- ไอคอน / Icon ---
  {
    id: 'icon-star',
    cat: 'icon',
    nameTh: 'ดาว',
    aspect: 1,
    svg: (c) => wrap(100, 100, `<path d="${burst(5, 48, 20)}" fill="${c}"/>`),
  },
  {
    id: 'icon-leaf',
    cat: 'icon',
    nameTh: 'ใบไม้',
    aspect: 1,
    svg: (c) =>
      wrap(
        100,
        100,
        `<path d="M50 6 C20 28 18 68 50 94 C82 68 80 28 50 6 Z" fill="${c}"/>` +
          `<path d="M50 14 V86" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round"/>`,
      ),
  },
  {
    id: 'icon-heart',
    cat: 'icon',
    nameTh: 'หัวใจ',
    aspect: 100 / 90,
    svg: (c) =>
      wrap(100, 90, `<path d="M50 84 C6 52 10 18 34 18 C44 18 50 26 50 30 C50 26 56 18 66 18 C90 18 94 52 50 84 Z" fill="${c}"/>`),
  },
]

export const presetById = (id: string): Preset | undefined => PRESETS.find((p) => p.id === id)
export const PRESET_CATS: { id: Preset['cat']; nameTh: string }[] = [
  { id: 'badge', nameTh: 'ตรา' },
  { id: 'ribbon', nameTh: 'ริบบิ้น' },
  { id: 'icon', nameTh: 'ไอคอน' },
]
