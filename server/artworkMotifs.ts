// Copilot describes the motif and its palette. The server draws the repeated
// details locally so the model doesn't have to write hundreds of SVG commands.
const motifDescriptions = {
  'rain-window': 'หน้าต่างโค้ง เห็นจันทร์ หมอก ฝน ระลอกน้ำและพรรณไม้ (กว้าง:สูง 210:244)',
  'sun-window': 'หน้าต่างโค้ง เห็นดวงอาทิตย์ เนินซ้อนและแสงบนผิวน้ำ (210:244)',
  'leaf-panel': 'ลายกิ่งใบและเส้นใบในกรอบแคบแนวตั้ง (36:104)',
  'grass-panel': 'ลายกอหญ้ากับระลอกน้ำในกรอบแคบแนวตั้ง (36:104)',
  'leaf-icon': 'เหรียญวงกลมรูปใบไม้ (1:1)',
  'grass-icon': 'เหรียญวงกลมรูปกอหญ้า (1:1)',
  'drop-icon': 'เหรียญวงกลมรูปหยดน้ำ (1:1)',
} as const

export const ARTWORK_MOTIF_GUIDE = Object.entries(motifDescriptions)
  .map(([id, description]) => `  ${id} = ${description}`).join('\n')

function svg(w: number, h: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${body}</svg>`
}

function path(d: string, fill: string, stroke = 'none', width = 1): string {
  return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`
}

function leaf(x: number, y: number, angle: number, scale: number, fill: string, ink: string): string {
  return `<g transform="translate(${x} ${y}) rotate(${angle}) scale(${scale})">`
    + path('M0 0C-15-9-16-26 0-44C16-26 15-9 0 0Z', fill, ink)
    + path('M0 0Q4-22 0-40M2-14L-7-23M3-19L10-28M2-26L-4-34', 'none', ink, 0.7) + '</g>'
}

function windowScene(base: string, color: string, ink: string, rain: boolean): string {
  const arch = 'M14 232V100C14 49 53 13 105 13S196 49 196 100V232Z'
  const weather = rain ? Array.from({ length: 38 }, (_, i) => {
    const x = 10 + (i * 43 + 8) % 192
    const y = 32 + (i * 37) % 124
    return `<path d="M${x} ${y}l-3 ${5 + i % 7}" stroke="${ink}" stroke-width=".8" opacity=".42"/>`
  }).join('') : ''
  const ripples = Array.from({ length: 14 }, (_, i) => {
    const x = 46 + (i * 53) % 134
    const y = 163 + (i * 19) % 61
    const r = 4 + i % 6 * 2
    return `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r / 5}" fill="none" stroke="${ink}" stroke-width=".7" opacity=".56"/>`
      + path(`M${103 - (i % 4) * 4} ${156 + i * 3}h${4 + i % 5 * 4}`, 'none', ink, 0.8)
  }).join('')
  const foliage = path('M26 230Q39 189 75 155M177 232Q170 191 152 166', 'none', ink, 1.5)
    + ([[30,216,-66,.68],[38,200,26,.8],[48,185,-51,.74],[61,169,41,.61],
      [175,223,66,.78],[170,205,-23,.73],[162,189,43,.66],[154,171,-45,.64]] as const)
      .map(([x, y, angle, scale]) => leaf(x, y, angle, scale, color, ink)).join('')
  const grass = Array.from({ length: 15 }, (_, i) => {
    const x = 9 + i * 13
    const h = 12 + i % 6 * 3
    return path(`M${x} 234q${i % 2 ? 3 : -3} ${-h * .8} ${i % 2 ? 11 : -9} ${-h}`, 'none', ink, 0.7)
  }).join('')
  return svg(210, 244, `<defs><clipPath id="arch">${path(arch, '#ffffff')}</clipPath>`
    + `<linearGradient id="sky" x2="0%" y2="100%"><stop offset="0" stop-color="${base}"/><stop offset=".76" stop-color="${color}"/></linearGradient>`
    + `<linearGradient id="water" x2="0%" y2="100%"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${base}"/></linearGradient></defs>`
    + `<g clip-path="url(#arch)"><rect width="210" height="244" fill="url(#sky)"/>`
    + `<circle cx="108" cy="58" r="21" fill="${ink}" opacity=".23"/><circle cx="108" cy="58" r="${rain ? 11 : 15}" fill="${ink}"/>`
    + path('M0 129Q27 96 52 109T92 114Q109 88 137 100T210 124V157H0Z', color)
    + `<g opacity=".55">${path('M0 138Q31 120 59 131T105 132Q124 117 149 123T210 135V166H0Z', base)}</g>`
    + path('M0 153Q48 145 95 152T210 147V244H0Z', 'url(#water)')
    + `<g opacity=".5">${path('M2 116Q59 127 100 113T199 112M1 143Q43 134 92 140T207 136M5 149Q53 141 97 149T205 143', 'none', ink, 1.5)}</g>`
    + ripples + weather + foliage + grass + '</g>'
    + path(arch, 'none', ink, 2.3)
    + path('M7 233V100C7 45 49 6 105 6S203 45 203 100V233M105 15V231M15 115H195M3 237H207', 'none', ink, 1.1)
    + path('M98 6L105 1L112 6L105 11Z', ink))
}

function botanicalPanel(base: string, color: string, ink: string, grass: boolean): string {
  const foliage = grass ? Array.from({ length: 13 }, (_, i) => {
    const x = 5 + i * 2
    return path(`M18 91Q${x} ${45 + i % 4 * 4} ${x} ${15 + i % 6 * 7}`, 'none', i % 3 ? color : ink, .55)
  }).join('') : path('M17 90Q7 59 22 14', 'none', ink, .9)
    + ([[16,83,47,.39],[13,69,-42,.36],[15,56,45,.39],[17,43,-39,.35],[20,30,38,.32],[21,21,-25,.26]] as const)
      .map(([x, y, angle, scale]) => leaf(x, y, angle, scale, color, ink)).join('')
  const rain = Array.from({ length: 12 }, (_, i) => path(`M${7 + i * 9 % 23} ${6 + i * 13 % 82}l-1.4 4`, 'none', color, .36)).join('')
  return svg(36, 104, `<rect x="3" y="1" width="30" height="101" rx="13" fill="${base}" stroke="${ink}" stroke-width=".35"/>`
    + rain + foliage + `<ellipse cx="18" cy="91" rx="9" ry="2.1" fill="none" stroke="${ink}" stroke-width=".5"/>`
    + `<ellipse cx="18" cy="91" rx="5" ry="1.1" fill="none" stroke="${color}" stroke-width=".4"/>`)
}

function icon(id: string, base: string, color: string, ink: string): string {
  const symbol = id === 'leaf-icon' ? leaf(13, 25, 31, .48, color, ink)
    : id === 'grass-icon' ? path('M16 24Q14 15 7 10M16 24Q15 11 13 6M16 24Q17 13 24 9M16 24Q21 17 25 17M16 24Q13 19 9 17', 'none', color, 1.5)
      : path('M16 6C12 11 10 15 10 18A6 6 0 0 0 22 18C22 15 20 11 16 6Z', color, ink)
        + path('M13 18Q13 21 16 22', 'none', base, 1.4)
  return svg(32, 32, `<circle cx="16" cy="16" r="14" fill="${base}" stroke="${ink}"/>` + symbol)
}

function renderMotif(source: string): string | null {
  const match = /^motif:([a-z-]+):(#[\da-f]{6}):(#[\da-f]{6}):(#[\da-f]{6})$/i.exec(source)
  if (!match) return null
  const [, id, base, color, ink] = match
  switch (id) {
    case 'rain-window': return windowScene(base, color, ink, true)
    case 'sun-window': return windowScene(base, color, ink, false)
    case 'leaf-panel': return botanicalPanel(base, color, ink, false)
    case 'grass-panel': return botanicalPanel(base, color, ink, true)
    case 'leaf-icon':
    case 'grass-icon':
    case 'drop-icon': return icon(id, base, color, ink)
    default: return null
  }
}

// Keep the wire format and editor import unchanged. Expanded motifs go through
// the same SVG validation, fitting and cloud rasterization as other artwork.
export function expandArtworkMotifs(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || !('elements' in raw) || !Array.isArray(raw.elements)) return raw
  return { ...raw, elements: raw.elements.map((element: unknown) => {
    if (!element || typeof element !== 'object' || !('type' in element) || element.type !== 'image'
      || !('src' in element) || typeof element.src !== 'string' || !element.src.startsWith('motif:')) return element
    const rendered = renderMotif(element.src)
    return rendered ? { ...element, src: `svg:${rendered}` } : element
  }) }
}
