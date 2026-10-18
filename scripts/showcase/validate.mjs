// ตรวจ + เติมไฟล์งานที่ agent เขียน: node scripts/showcase/validate.mjs <input.genpkg.json> [--write]
// - เติม placeholder ใน ImageEl.src: "preset:<id>:<#สี>" → SVG data URL จากไลบรารีลาย, "file:<name>.svg" → data URL จากไฟล์ข้างกัน
// - เติม w ของข้อความที่ไม่ได้ใส่ (ประมาณ 0.55 × size × จำนวนตัวอักษรบรรทัดที่ยาวสุด)
// - parse ด้วย parseProjectFile ตัวจริงของแอป แล้วรายงาน: ผ่าน/ไม่ผ่าน, คำเตือน, จำนวน element แต่ละชนิด, ชิ้นที่ parse ทิ้ง
// --write = เขียนไฟล์ที่เติมแล้วทับ (ไฟล์พร้อมนำเข้าแอป)
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const coreUrl = pathToFileURL(path.resolve('tmp/showcase/core.mjs')).href
const { parseProjectFile, PRESETS, presetDataUrl, TEMPLATES, MATERIALS } = await import(coreUrl)

const file = process.argv[2]
const write = process.argv.includes('--write')
if (!file) {
  console.error('ใช้: node scripts/showcase/validate.mjs <file.genpkg.json> [--write]')
  process.exit(2)
}
const dir = path.dirname(path.resolve(file))
const raw = JSON.parse(readFileSync(file, 'utf8'))
const problems = []

function svgDataUrl(svg) {
  return 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64')
}
function svgAspect(svg) {
  const vb = /viewBox\s*=\s*"([^"]+)"/.exec(svg)
  if (vb) {
    const [, , w, h] = vb[1].trim().split(/[\s,]+/).map(Number)
    if (w > 0 && h > 0) return w / h
  }
  const w = Number(/\swidth\s*=\s*"([\d.]+)/.exec(svg)?.[1])
  const h = Number(/\sheight\s*=\s*"([\d.]+)/.exec(svg)?.[1])
  return w > 0 && h > 0 ? w / h : 1
}

const project = raw.project ?? raw
const decos = Array.isArray(project.decos) ? project.decos : []
decos.forEach((d, i) => {
  if (!d || typeof d !== 'object') return
  if (!d.id) d.id = `el-${i + 1}`
  if (d.type === 'image' && typeof d.src === 'string') {
    const preset = /^preset:([a-z0-9-]+)(?::(#[0-9a-fA-F]{6}))?$/.exec(d.src)
    const fileRef = /^file:(.+)$/.exec(d.src)
    if (preset) {
      const p = PRESETS.find((x) => x.id === preset[1])
      if (!p) problems.push(`ชิ้น ${d.id}: ไม่มีลาย preset "${preset[1]}" (มี: ${PRESETS.map((x) => x.id).join(', ')})`)
      else {
        const color = preset[2] ?? '#0f6e56'
        d.src = presetDataUrl(p.svg(color))
        d.aspect = p.aspect
        d.preset = p.id
        d.presetColor = color
        if (!(d.h > 0)) d.h = d.w / p.aspect
      }
    } else if (fileRef) {
      const fp = path.join(dir, fileRef[1])
      if (!existsSync(fp)) problems.push(`ชิ้น ${d.id}: ไม่พบไฟล์ ${fileRef[1]} ข้างไฟล์งาน`)
      else {
        const svg = readFileSync(fp, 'utf8')
        if (!/<svg[\s>]/.test(svg)) problems.push(`ชิ้น ${d.id}: ${fileRef[1]} ไม่ใช่ SVG`)
        else {
          d.src = svgDataUrl(svg)
          d.aspect = svgAspect(svg)
          if (!(d.h > 0)) d.h = d.w / d.aspect
        }
      }
    }
  }
  if (d.type === 'text') {
    if (!(d.w > 0)) {
      const longest = Math.max(...String(d.text ?? '').split('\n').map((l) => l.length), 1)
      d.w = Math.round(0.55 * Number(d.size || 10) * longest * 10) / 10
    }
    if (d.rot === undefined) d.rot = 0
  }
  if (d.rot === undefined) d.rot = 0
})
if (project.fillImage && typeof project.fillImage.src === 'string') {
  const fileRef = /^file:(.+)$/.exec(project.fillImage.src)
  if (fileRef) {
    const fp = path.join(dir, fileRef[1])
    if (!existsSync(fp)) problems.push(`รูปพื้น: ไม่พบไฟล์ ${fileRef[1]}`)
    else {
      const svg = readFileSync(fp, 'utf8')
      project.fillImage.src = svgDataUrl(svg)
      project.fillImage.aspect = svgAspect(svg)
    }
  }
}

const envelope = raw.project ? raw : { app: 'gen-package', schemaVersion: 16, exportedAt: Date.now(), project }
envelope.app = 'gen-package'
if (!envelope.schemaVersion) envelope.schemaVersion = 16
const text = JSON.stringify(envelope, null, 2)
const result = parseProjectFile(text)

const report = { file, ok: result.ok, problems }
if (!result.ok) {
  report.error = result.error
  const live = project.live ?? {}
  if (!TEMPLATES.some((t) => t.id === live.template)) report.hint = `template "${live.template}" ไม่มี — ใช้: ${TEMPLATES.map((t) => t.id).join(', ')}`
  else if (!MATERIALS.some((m) => m.id === live.materialId)) report.hint = `materialId "${live.materialId}" ไม่มี — ใช้: ${MATERIALS.map((m) => m.id).join(', ')}`
} else {
  const p = result.project
  report.warnings = result.warnings
  report.name = p.name
  report.live = p.live
  const counts = {}
  for (const d of p.decos) counts[d.type] = (counts[d.type] ?? 0) + 1
  report.elements = counts
  report.elementCount = p.decos.length
  const kept = new Set(p.decos.map((d) => d.id))
  const dropped = decos.filter((d) => d && !kept.has(d.id)).map((d) => `${d.id} (${d.type})`)
  if (dropped.length) report.dropped = dropped
  if (p.decos.length < 4) problems.push(`มี element ที่ใช้ได้แค่ ${p.decos.length} ชิ้น (ต้องอย่างน้อย 4)`)
  // รายงานตัวเลือกโดยย่อ data URL (รูปพื้นเป็น base64 ยาวมาก)
  const brief = (v) => (typeof v === 'string' && v.startsWith('data:') ? `${v.slice(0, 30)}… (${v.length} chars)` : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, brief(x)])) : v)
  report.options = Object.fromEntries(
    Object.entries(p)
      .filter(([k, v]) => !['id', 'name', 'updatedAt', 'live', 'qty', 'decos', 'history', 'histIdx', 'fillColor'].includes(k) && v !== undefined && v !== null)
      .map(([k, v]) => [k, brief(v)]),
  )
  if (write) writeFileSync(file, text)
}
console.log(JSON.stringify(report, null, 2))
process.exit(result.ok && problems.length === 0 ? 0 : 1)
