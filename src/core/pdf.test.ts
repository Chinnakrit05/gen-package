import { describe, expect, it } from 'vitest'
import { dielinePDFBytes } from './pdf'
import { dielineDXFString } from './dxf'
import { computeGuides } from './guides'
import { TEMPLATES } from './templates'
import { getMaterial } from './materials'

const dec = (b: Uint8Array) => new TextDecoder('latin1').decode(b) // 1 อักขระ = 1 ไบต์

// ตรวจว่า offset ทุกแถวในตาราง xref ชี้ไปที่ "N 0 obj" จริง — จุดที่พังง่ายที่สุด
// ของ PDF เขียนมือ โดยเฉพาะเมื่อมี stream แบบ binary ปน
function xrefOffsetsOk(s: string): { ok: boolean; size: number; detail: string } {
  const sx = /startxref\s+(\d+)/.exec(s)
  if (!sx) return { ok: false, size: 0, detail: 'ไม่มี startxref' }
  const xp = Number(sx[1])
  if (s.slice(xp, xp + 4) !== 'xref') return { ok: false, size: 0, detail: 'startxref ชี้ผิด' }
  const head = /xref\n0 (\d+)\n/.exec(s.slice(xp))
  if (!head) return { ok: false, size: 0, detail: 'หัวตารางผิด' }
  const size = Number(head[1])
  const all = s.slice(xp + head[0].length).split('\n') // all[0] = free entry ของ object 0
  if (!/^0000000000 65535 f/.test(all[0])) return { ok: false, size, detail: 'free entry ผิด' }
  for (let i = 1; i < size; i++) {
    const m = /^(\d{10}) 00000 n/.exec(all[i])
    if (!m) return { ok: false, size, detail: `แถว ${i} รูปแบบผิด` }
    const off = Number(m[1])
    const expect = `${i} 0 obj`
    if (s.slice(off, off + expect.length) !== expect) {
      return { ok: false, size, detail: `object ${i} offset ${off} ชี้ผิด` }
    }
  }
  return { ok: true, size, detail: '' }
}

const fakeJpeg = () => {
  // ไบต์ JPEG ปลอมขั้นต่ำ (SOI..EOI) พอสำหรับตรวจโครงสร้างการฝัง
  const b = new Uint8Array(64)
  b[0] = 0xff
  b[1] = 0xd8
  b[b.length - 2] = 0xff
  b[b.length - 1] = 0xd9
  return b
}

describe.each(TEMPLATES.map((t) => [t.id, t] as const))('pdf: template %s', (_id, t) => {
  const mat = getMaterial('carton-300')
  const d = t.generate({ ...t.defaults, handle: t.supportsHandle }, mat)

  it.each([true, false])('โครงสร้างถูกต้อง (dims=%s)', (withDims) => {
    const s = dec(dielinePDFBytes(d, withDims))
    expect(s.startsWith('%PDF-1.5')).toBe(true)
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true)
    const x = xrefOffsetsOk(s)
    expect(x.detail).toBe('')
    expect(x.ok).toBe(true)
    // /Length ของ content stream ตรงกับข้อมูลจริง
    const lm = /<< \/Length (\d+) >>\nstream\n/.exec(s)!
    const start = lm.index + lm[0].length
    expect(s.indexOf('endstream', start) - start).toBe(Number(lm[1]))
    // BDC/EMC และ q/Q จับคู่ครบ
    expect((s.match(/BDC/g) ?? []).length).toBe((s.match(/EMC/g) ?? []).length)
    expect((s.match(/\bq\n/g) ?? []).length).toBe((s.match(/\bQ\n/g) ?? []).length)
    // เลเยอร์ dims มีเฉพาะเมื่อเปิด
    expect(s.includes('(dims)')).toBe(withDims)
  })

  it('MediaBox = ขนาดแผ่นจริงสเกล 1:1', () => {
    const s = dec(dielinePDFBytes(d, false))
    const mb = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(s)!
    const K = 72 / 25.4
    expect(Number(mb[1]) / K).toBeCloseTo(d.width + 10, 1) // pad 5 สองข้าง
    expect(Number(mb[2]) / K).toBeCloseTo(d.height + 10, 1)
  })

  it('ทุกจุดของ DXF ปรากฏใน PDF ตรงตำแหน่ง (คลาด ≤ 0.002mm)', () => {
    // ทั้งสองไฟล์ใช้ pathToPolylines ชุดเดียวกัน — เทียบข้ามยืนยันว่าการแปลงพิกัดตรงกัน
    const withDims = true
    const pad = 26
    const s = dec(dielinePDFBytes(d, withDims))
    const sm = /<< \/Length \d+ >>\nstream\n/.exec(s)!
    const stream = s.slice(sm.index + sm[0].length, s.indexOf('endstream', sm.index))
    const pdfPts: [number, number][] = []
    for (const blk of stream.split('/OC /').slice(1)) {
      const name = blk.slice(0, 3)
      if (name !== 'OC1' && name !== 'OC2') continue
      for (const m of blk.slice(0, blk.indexOf('EMC')).matchAll(/(-?[\d.]+) (-?[\d.]+) [ml]\b/g)) {
        pdfPts.push([Number(m[1]) - pad, Number(m[2]) - pad])
      }
    }
    const dxf = dielineDXFString(d)
    const tok = dxf.split('\r\n')
    const dxfPts: [number, number][] = []
    for (let i = 0; i < tok.length - 1; i++) {
      if (tok[i].trim() === '10' || tok[i].trim() === '11') dxfPts.push([Number(tok[i + 1]), NaN])
      if (tok[i].trim() === '20' || tok[i].trim() === '21') dxfPts[dxfPts.length - 1][1] = Number(tok[i + 1])
    }
    const pts = dxfPts.slice(2) // ตัดคู่ $EXTMIN/$EXTMAX
    // เทียบด้วย tolerance — PDF ปัด 3 ตำแหน่ง DXF ปัด 4 การปัดซ้ำทำ key ตรง ๆ ไม่ได้
    const missing = pts.filter(
      (q) => !pdfPts.some((p) => Math.abs(p[0] - q[0]) <= 0.002 && Math.abs(p[1] - q[1]) <= 0.002),
    )
    expect(missing.length).toBe(0)
  })
})

describe('pdf: เลเยอร์เสริม', () => {
  const t = TEMPLATES[0]
  const d = t.generate(t.defaults, getMaterial('carton-300'))

  it('artwork: ฝัง JPEG เป็น OCG + xref ยังถูกทั้งที่มี binary ปน', () => {
    const s = dec(dielinePDFBytes(d, false, { jpeg: fakeJpeg(), w: 100, h: 100 }))
    expect(s.includes('(artwork)')).toBe(true)
    expect(s.includes('/Im0 Do')).toBe(true)
    expect(s.includes('/DCTDecode')).toBe(true)
    expect(xrefOffsetsOk(s).ok).toBe(true)
  })

  it('guides: เป็น OCG ของตัวเอง และ xref ถูกเมื่อรวมทุกเลเยอร์', () => {
    const g = computeGuides(d.panels)
    const s = dec(dielinePDFBytes(d, true, { jpeg: fakeJpeg(), w: 10, h: 10 }, g))
    expect(s.includes('(guides)')).toBe(true)
    expect(s.includes('/OC /OCg BDC')).toBe(true)
    const x = xrefOffsetsOk(s)
    expect(x.ok).toBe(true)
    expect(x.size - 1).toBe(11) // ครบทุกเลเยอร์ = 11 objects
  })

  it('fill: สีพื้นเป็น OCG vector (rg + f) และ xref ถูกเมื่อรวมทุกเลเยอร์', () => {
    const g = computeGuides(d.panels)
    const s = dec(dielinePDFBytes(d, true, { jpeg: fakeJpeg(), w: 10, h: 10 }, g, '#0f6e56'))
    expect(s.includes('(fill)')).toBe(true)
    expect(s.includes('/OC /OCf BDC')).toBe(true)
    expect(/[\d.]+ [\d.]+ [\d.]+ rg/.test(s)).toBe(true) // ตั้งสีเติม
    expect(xrefOffsetsOk(s).ok).toBe(true)
    expect(xrefOffsetsOk(s).size - 1).toBe(12) // + fill OCG = 12 objects
  })

  it('ไม่มีสีพื้น → ไม่มีเลเยอร์ fill', () => {
    expect(dec(dielinePDFBytes(d, false)).includes('(fill)')).toBe(false)
  })
})
