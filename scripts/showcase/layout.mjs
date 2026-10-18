// แสดงผังแผ่นคลี่ของไฟล์งาน (ให้ agent รู้ว่าจะวาง element ที่พิกัดไหน): node scripts/showcase/layout.mjs <file.genpkg.json>
// พิมพ์: ชนิดงาน, ขนาดแผ่น (มม.), กรอบของแต่ละแผง (x0,y0 → x1,y1) และ element ที่หลุดนอกทุกแผง
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const core = await import(pathToFileURL(path.resolve('tmp/showcase/core.mjs')).href)
const { parseProjectFile, TEMPLATES, getMaterial, generateVessel, generatePouch, generateSticker } = core

const file = process.argv[2]
if (!file) {
  console.error('ใช้: node scripts/showcase/layout.mjs <file.genpkg.json>')
  process.exit(2)
}
const raw = JSON.parse(readFileSync(file, 'utf8'))
// เติม w ของข้อความชั่วคราว (parse ต้องการ) — ไม่เขียนทับไฟล์
const proj = raw.project ?? raw
for (const d of proj.decos ?? []) if (d?.type === 'text' && !(d.w > 0)) d.w = 0.55 * (d.size || 10) * Math.max(...String(d.text ?? '').split('\n').map((l) => l.length), 1)
for (const d of proj.decos ?? []) if (d?.type === 'image' && typeof d.src === 'string' && !d.src.startsWith('data:')) { d.src = 'data:image/svg+xml;base64,PHN2Zy8+'; d.aspect = d.aspect ?? 1; d.h = d.h ?? d.w }
const result = parseProjectFile(JSON.stringify({ app: 'gen-package', schemaVersion: 16, exportedAt: 0, project: proj }))
if (!result.ok) {
  console.log(JSON.stringify({ ok: false, error: result.error }, null, 2))
  process.exit(1)
}
const p = result.project
const mat = getMaterial(p.live.materialId)
const kind = mat.foldable ? 'box' : mat.form === 'pouch' ? 'pouch' : 'vessel'
let dieline
let note = ''
if (kind === 'vessel') {
  const v = generateVessel(p.live, mat, p.labelStyle ?? 'body', { neckH: p.neckH, shoulderH: p.shoulderH, shoulderStyle: p.shoulderStyle, label: p.labelBox, capStyle: p.capStyle })
  dieline = v.label
  note = `ฉลากพันรอบตัว: แผ่นฉลากกว้าง ${dieline.width.toFixed(1)} (เส้นรอบวง ${v.circ.toFixed(1)}) สูง ${dieline.height.toFixed(1)} มม. — กึ่งกลางแนวนอนของแผ่น = ด้านหน้าภาชนะ`
} else if (kind === 'pouch') {
  const pouch = generatePouch(p.live, mat, { style: p.pouchStyle, zipper: p.zipper, addons: p.pouchAddons })
  dieline = pouch.label
  note = `ถุง ${pouch.style}: พื้นที่พิมพ์หน้าถุง frontRect = ${JSON.stringify(pouch.frontRect)} หลัง backRect = ${JSON.stringify(pouch.backRect)} (วาง element หลักในกรอบนี้)`
} else {
  const tp = TEMPLATES.find((t) => t.id === p.live.template)
  dieline = tp.id === 'sticker' ? generateSticker(p.live, p.stickerCut?.shape === 'contour' ? 'rect' : (p.stickerCut?.shape ?? 'rect')) : tp.generate(p.live, mat)
  note = tp.id === 'card' ? 'นามบัตร: แผง card = หน้า, card-back = หลัง (ห่างกัน 10 มม.)' : tp.id === 'sticker' ? 'สติกเกอร์: แผงเดียว วาง element ภายในรูปทรง' : `กล่อง ${tp.id}: ชื่อแผงบอกหน้าที่ (front/back/side-*/lid/tuck/dust/glue) — วางลายหลักบน front/back`
}
const bbox = (pts) => ({ x0: Math.min(...pts.map((v) => v.x)), y0: Math.min(...pts.map((v) => v.y)), x1: Math.max(...pts.map((v) => v.x)), y1: Math.max(...pts.map((v) => v.y)) })
const r1 = (v) => Math.round(v * 10) / 10
const panels = dieline.panels.map((pn) => { const b = bbox(pn.outline); return { id: pn.id, x0: r1(b.x0), y0: r1(b.y0), x1: r1(b.x1), y1: r1(b.y1), w: r1(b.x1 - b.x0), h: r1(b.y1 - b.y0) } })
const elH = (d) => (d.type === 'image' ? d.h : d.type === 'text' ? d.size * (d.lh ?? 1.25) * String(d.text).split('\n').length : d.type === 'nutrition' ? d.w * 1.2 : d.h)
const outside = p.decos.filter((d) => {
  const cx = d.x + d.w / 2
  const cy = d.y + elH(d) / 2
  return !panels.some((pn) => cx >= pn.x0 && cx <= pn.x1 && cy >= pn.y0 && cy <= pn.y1)
}).map((d) => `${d.id} (${d.type}) center ≈ ${r1(d.x + d.w / 2)},${r1(d.y + elH(d) / 2)}`)
console.log(JSON.stringify({ kind, name: p.name, live: p.live, sheet: { width: r1(dieline.width), height: r1(dieline.height) }, note, panels, elementsOutsideAnyPanel: outside }, null, 2))
