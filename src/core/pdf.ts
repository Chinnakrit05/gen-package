import type { Dieline } from './types'
import { pathToPolylines } from './dxf'

// Export dieline เป็น PDF สเกล 1:1 สำหรับพิมพ์ตรวจและส่งโรงงาน
//
// เขียน PDF เองแทนการลงไลบรารี เพราะไฟล์นี้มีแค่เส้นกับข้อความสั้น ๆ
// (ตัวแตกเส้นโค้งใช้ซ้ำจาก dxf.ts) การลง jspdf/pdf-lib จะบวม bundle
// หลายร้อย KB เพื่อฟีเจอร์ที่ไม่ได้ใช้เลย
//
// เลเยอร์: ใช้ Optional Content Group (OCG) ซึ่งเป็นเลเยอร์จริงของ PDF —
// Acrobat/Illustrator กดปิด-เปิดได้ ทำให้ปิดเลเยอร์ dims ก่อนส่งโรงงานได้
// เหมือนฝั่ง SVG ไม่ต้องมานั่งลบเส้นทีละเส้น
//
// หมายเหตุ: ใช้ฟอนต์ Helvetica มาตรฐาน (base-14) จึงไม่ต้องฝังฟอนต์
// แต่รองรับแค่ ASCII — ป้ายบอกขนาดตอนนี้เป็น "W 80.8" อยู่แล้ว
// ถ้าอนาคตมีข้อความไทยต้องเปลี่ยนไปฝังฟอนต์จริง

const K = 72 / 25.4 // มม. → point (หน่วยของ PDF)

const n = (v: number) => (Math.abs(v) < 1e-6 ? 0 : v).toFixed(3)

const rgb = (hex: string) =>
  [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ')

const CUT = '#e30613'
const CREASE = '#009640'
const DIM = '#1b6ea8'

// PDF string: หนี \ ( ) และตัดอักขระนอก ASCII ทิ้ง (Helvetica แสดงไม่ได้อยู่ดี)
// การคุม PDF ให้เป็น ASCII ล้วนยังทำให้ความยาวสตริง = จำนวนไบต์ ซึ่ง xref ต้องใช้
const pdfStr = (s: string) =>
  '(' + s.replace(/[\\()]/g, (c) => '\\' + c).replace(/[^\x20-\x7e]/g, '?') + ')'

// ความกว้างตัวอักษร Helvetica แบบประมาณ ใช้จัดข้อความให้อยู่กึ่งกลางเส้นบอกขนาด
const CHAR_W: Record<string, number> = { ' ': 0.278, '.': 0.278, ',': 0.278 }
const textWidth = (s: string, size: number) =>
  size * [...s].reduce((w, c) => w + (CHAR_W[c] ?? (/[A-Z]/.test(c) ? 0.7 : 0.556)), 0)

export interface PdfArtwork {
  jpeg: Uint8Array
  w: number
  h: number
}

export function dielinePDFBytes(d: Dieline, withDims: boolean, artwork?: PdfArtwork): Uint8Array {
  const pad = withDims ? 26 : 5
  const pageW = (d.width + pad * 2) * K
  const pageH = (d.height + pad * 2) * K

  // พิกัดแผ่นคลี่ y ชี้ลง แต่ PDF y ชี้ขึ้น — พลิกแล้วเลื่อนตามระยะขอบ
  const tx = (x: number) => x + pad
  const ty = (y: number) => d.height - y + pad

  const strokeOf = (kind: 'cut' | 'crease') => {
    const parts: string[] = []
    for (const s of d.segments) {
      if (s.kind !== kind) continue
      for (const poly of pathToPolylines(s.d)) {
        if (poly.length < 2) continue
        parts.push(`${n(tx(poly[0].x))} ${n(ty(poly[0].y))} m`)
        for (let i = 1; i < poly.length; i++) {
          parts.push(`${n(tx(poly[i].x))} ${n(ty(poly[i].y))} l`)
        }
      }
    }
    return parts.length ? parts.join('\n') + '\nS' : ''
  }

  // แต่ละเลเยอร์ครอบด้วย q/Q เพื่อไม่ให้สี/เส้นประรั่วข้ามเลเยอร์
  const layer = (ocName: string, setup: string, body: string) =>
    body ? `q\n/OC /${ocName} BDC\n${setup}\n${body}\nEMC\nQ\n` : ''

  const cutBody = layer('OC1', `${rgb(CUT)} RG\n0.35 w\n1 J\n1 j`, strokeOf('cut'))
  const creaseBody = layer(
    'OC2',
    `${rgb(CREASE)} RG\n0.35 w\n1 J\n1 j\n[4 2.5] 0 d`,
    strokeOf('crease'),
  )

  let dimsBody = ''
  if (withDims) {
    const parts: string[] = []
    const size = 6
    for (const m of d.dims) {
      const vert = Math.abs(m.a.x - m.b.x) < 0.001
      const ax = tx(m.a.x)
      const ay = ty(m.a.y)
      const bx = tx(m.b.x)
      const by = ty(m.b.y)
      parts.push(`${n(ax)} ${n(ay)} m\n${n(bx)} ${n(by)} l`)
      // ขีดปลายทั้งสองข้าง ตั้งฉากกับเส้นบอกขนาด
      if (vert) {
        parts.push(`${n(ax - 2.5)} ${n(ay)} m\n${n(ax + 2.5)} ${n(ay)} l`)
        parts.push(`${n(bx - 2.5)} ${n(by)} m\n${n(bx + 2.5)} ${n(by)} l`)
      } else {
        parts.push(`${n(ax)} ${n(ay - 2.5)} m\n${n(ax)} ${n(ay + 2.5)} l`)
        parts.push(`${n(bx)} ${n(by - 2.5)} m\n${n(bx)} ${n(by + 2.5)} l`)
      }
    }
    const strokes = parts.length ? parts.join('\n') + '\nS' : ''

    const labels = d.dims
      .map((m) => {
        const vert = Math.abs(m.a.x - m.b.x) < 0.001
        const mx = tx((m.a.x + m.b.x) / 2)
        const my = ty((m.a.y + m.b.y) / 2)
        const half = textWidth(m.label, size) / 2
        // แนวตั้งหมุนข้อความ 90° ให้อ่านจากล่างขึ้นบน (เมทริกซ์ 0 1 -1 0)
        const tm = vert
          ? `0 1 -1 0 ${n(mx - 2)} ${n(my - half)} Tm`
          : `1 0 0 1 ${n(mx - half)} ${n(my + 2)} Tm`
        return `BT\n/F1 ${size} Tf\n${tm}\n${pdfStr(m.label)} Tj\nET`
      })
      .join('\n')

    dimsBody = layer('OC3', `${rgb(DIM)} RG\n${rgb(DIM)} rg\n0.25 w`, `${strokes}\n${labels}`)
  }

  // เลขวัตถุ: 1-5 คงที่ (catalog/pages/page/contents/font) จากนั้น OCG แล้วปิดท้ายด้วยภาพ
  let num = 6
  const cutOCG = num++
  const creaseOCG = num++
  const dimsOCG = withDims ? num++ : 0
  const artOCG = artwork ? num++ : 0
  const imgNum = artwork ? num++ : 0
  const lastObj = num - 1

  // เลเยอร์ artwork วาดก่อน (ล่างสุด) ให้เส้น cut/crease โชว์ทับเป็นไกด์
  // ภาพครอบพื้นที่แผ่น [pad, pad+width] × [pad, pad+height] ในหน่วย มม. (อยู่ใน K space)
  const artBody = artwork
    ? `q\n/OC /OCa BDC\n${n(d.width)} 0 0 ${n(d.height)} ${n(pad)} ${n(pad)} cm\n/Im0 Do\nEMC\nQ\n`
    : ''

  // ทั้งหน้าอยู่ในระบบ มม. โดยสเกลครั้งเดียวที่นี่ ตัวเลขในสตรีมจึงอ่านเป็น มม. ตรง ๆ
  const stream = `q\n${n(K)} 0 0 ${n(K)} 0 0 cm\n${artBody}${cutBody}${creaseBody}${dimsBody}Q\n`

  const ocgRefs: string[] = [`${cutOCG} 0 R`, `${creaseOCG} 0 R`]
  if (dimsOCG) ocgRefs.push(`${dimsOCG} 0 R`)
  if (artOCG) ocgRefs.push(`${artOCG} 0 R`)
  const ocgList = ocgRefs.join(' ')

  const props: string[] = [`/OC1 ${cutOCG} 0 R`, `/OC2 ${creaseOCG} 0 R`]
  if (dimsOCG) props.push(`/OC3 ${dimsOCG} 0 R`)
  if (artOCG) props.push(`/OCa ${artOCG} 0 R`)
  const xobj = artwork ? ` /XObject << /Im0 ${imgNum} 0 R >>` : ''

  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  let len = 0
  const push = (c: string | Uint8Array) => {
    const b = typeof c === 'string' ? enc.encode(c) : c
    parts.push(b)
    len += b.length
  }
  const offsets: number[] = []
  const obj = (body: string) => {
    offsets.push(len)
    push(body)
  }

  // คอมเมนต์ไบต์สูงหลัง header บอกเครื่องมือว่าไฟล์มีข้อมูล binary
  push('%PDF-1.5\n%\xE2\xE3\xCF\xD3\n')
  obj(
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [${ocgList}] ` +
      `/D << /Order [${ocgList}] /ON [${ocgList}] >> >> >>\nendobj\n`,
  )
  obj('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')
  obj(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(pageW)} ${n(pageH)}] ` +
      `/Contents 4 0 R /Resources << /Font << /F1 5 0 R >>${xobj} /Properties << ${props.join(' ')} >> >> >>\nendobj\n`,
  )
  obj(`4 0 obj\n<< /Length ${enc.encode(stream).length} >>\nstream\n${stream}endstream\nendobj\n`)
  obj('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n')
  obj(`${cutOCG} 0 obj\n<< /Type /OCG /Name ${pdfStr('cut')} >>\nendobj\n`)
  obj(`${creaseOCG} 0 obj\n<< /Type /OCG /Name ${pdfStr('crease')} >>\nendobj\n`)
  if (dimsOCG) obj(`${dimsOCG} 0 obj\n<< /Type /OCG /Name ${pdfStr('dims')} >>\nendobj\n`)
  if (artOCG) obj(`${artOCG} 0 obj\n<< /Type /OCG /Name ${pdfStr('artwork')} >>\nendobj\n`)
  if (artwork) {
    offsets.push(len)
    push(
      `${imgNum} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${artwork.w} /Height ${artwork.h} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${artwork.jpeg.length} >>\nstream\n`,
    )
    push(artwork.jpeg)
    push('\nendstream\nendobj\n')
  }

  const xrefPos = len
  let xref = `xref\n0 ${lastObj + 1}\n0000000000 65535 f \n`
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`
  push(xref)
  push(`trailer\n<< /Size ${lastObj + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`)

  const out = new Uint8Array(len)
  let p = 0
  for (const part of parts) {
    out.set(part, p)
    p += part.length
  }
  return out
}
