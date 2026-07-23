import { describe, expect, it } from 'vitest'
import { dielineDXFString } from './dxf'
import { TEMPLATES } from './templates'
import { getMaterial } from './materials'
import { obroundPath } from './templates/shared'
import type { Dieline } from './types'

// อ่าน DXF กลับเป็นคู่ (code, value) เพื่อตรวจโครงสร้างจริง ไม่ใช่แค่ smoke test
function parse(dxf: string): [string, string][] {
  const t = dxf.split('\r\n')
  const out: [string, string][] = []
  for (let i = 0; i + 1 < t.length; i += 2) out.push([t[i].trim(), t[i + 1]])
  return out
}

function lines(dxf: string) {
  const p = parse(dxf)
  const out: { layer: string; a: [number, number]; b: [number, number] }[] = []
  for (let i = 0; i < p.length; i++) {
    if (p[i][0] === '0' && p[i][1] === 'LINE') {
      const g: Record<string, string> = {}
      for (let j = i + 1; j < p.length && p[j][0] !== '0'; j++) g[p[j][0]] = p[j][1]
      out.push({
        layer: g['8'],
        a: [Number(g['10']), Number(g['20'])],
        b: [Number(g['11']), Number(g['21'])],
      })
    }
  }
  return out
}

describe('dxf: คณิตศาสตร์ arc', () => {
  // obroundPath ที่ length == thick คือวงกลมแท้ — เทียบทุกจุดกับรัศมีจริง
  const cx = 40
  const cy = 30
  const dia = 24
  const H = 100
  const fake: Dieline = {
    width: 100,
    height: H,
    segments: [{ kind: 'cut', d: obroundPath(cx, cy, dia, dia) }],
    panels: [],
    dims: [],
  }
  const ls = lines(dielineDXFString(fake))
  const pts = ls.flatMap((l) => [l.a, l.b])
  const CY = H - cy // พลิกแกน y แล้ว

  it('ทุกจุดอยู่บนวงกลมภายใน tolerance 0.02mm', () => {
    const maxDev = Math.max(...pts.map(([x, y]) => Math.abs(Math.hypot(x - cx, y - CY) - dia / 2)))
    expect(maxDev).toBeLessThanOrEqual(0.02)
  })

  it('ไม่มี NaN และคอนทัวร์ปิดสนิท', () => {
    expect(pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true)
    const first = ls[0].a
    const last = ls[ls.length - 1].b
    expect(Math.hypot(first[0] - last[0], first[1] - last[1])).toBeLessThan(1e-6)
  })

  it('เส้นรอบวงใกล้ 2πr (คลาด < 0.1%)', () => {
    const per = ls.reduce((s, l) => s + Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]), 0)
    const exact = Math.PI * dia
    expect(Math.abs(per - exact) / exact).toBeLessThan(0.001)
  })
})

describe('dxf: พลิกแกน y', () => {
  it('ขอบบนแผ่น (y=0) กลายเป็น Y=height ใน DXF', () => {
    const H = 200
    const fake: Dieline = {
      width: 100,
      height: H,
      segments: [{ kind: 'crease', d: 'M 0 0 L 100 0' }],
      panels: [],
      dims: [],
    }
    const l = lines(dielineDXFString(fake))[0]
    expect(l.a[1]).toBe(H)
    expect(l.b[1]).toBe(H)
  })
})

describe.each(TEMPLATES.map((t) => [t.id, t] as const))('dxf: template %s', (_id, t) => {
  const mat = getMaterial(t.id === 'mailer' ? 'corrugated-b' : 'carton-300')
  const d = t.generate({ ...t.defaults, handle: t.supportsHandle }, mat)
  const dxf = dielineDXFString(d)
  const ls = lines(dxf)
  const p = parse(dxf)

  it('โครงสร้าง SECTION/ENDSEC สมดุลและจบด้วย EOF', () => {
    const nSec = p.filter((r) => r[0] === '0' && r[1] === 'SECTION').length
    const nEnd = p.filter((r) => r[0] === '0' && r[1] === 'ENDSEC').length
    expect(nSec).toBe(3)
    expect(nEnd).toBe(3)
    expect(p[p.length - 1][1]).toBe('EOF')
  })

  it('ใช้เฉพาะเลเยอร์ CUT/CREASE ที่ประกาศไว้ และมีครบทั้งคู่', () => {
    const declared = new Set(
      p.filter((r, i) => r[0] === '2' && i > 0 && p[i - 1][1] === 'LAYER').map((r) => r[1]),
    )
    const used = new Set(ls.map((l) => l.layer))
    expect(declared.has('CUT')).toBe(true)
    expect(declared.has('CREASE')).toBe(true)
    expect([...used].every((u) => declared.has(u))).toBe(true)
    expect(used.has('CUT')).toBe(true)
    expect(used.has('CREASE')).toBe(true)
  })

  it('เรขาคณิตอยู่ในขอบเขตแผ่น ไม่มี NaN ไม่มีเส้นยาวศูนย์', () => {
    const pts = ls.flatMap((l) => [l.a, l.b])
    expect(pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true)
    expect(pts.every(([x, y]) => x >= -0.01 && x <= d.width + 0.01 && y >= -0.01 && y <= d.height + 0.01)).toBe(true)
    expect(ls.every((l) => Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]) > 1e-9)).toBe(true)
  })
})
