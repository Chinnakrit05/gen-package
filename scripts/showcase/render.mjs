// เปิดไฟล์งาน .genpkg.json ในแอปจริง (local-demo บน dev server) ด้วย Chrome headless แล้วเก็บหลักฐาน:
// ภาพ 3D (พับสุด + กลางทางสำหรับงานพับ), ภาพแผ่นคลี่ (แท็บตกแต่ง) และไฟล์ส่งออกจริงจากปุ่มในแอป (PDF แบบพิมพ์ 1:1 + SVG dieline)
//   PACKIT_E2E_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//   node scripts/showcase/render.mjs tmp/showcase/agents/*/design.genpkg.json
// ต้องมี dev server โหมด local-demo รันอยู่ (ค่าเริ่มต้น http://localhost:5175 — ตั้ง SHOWCASE_BASE_URL ได้) และ tmp/showcase/core.mjs
import { chromium } from 'playwright-core'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const CHROME = process.env.PACKIT_E2E_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.SHOWCASE_BASE_URL ?? 'http://localhost:5175'
const OUT_ROOT = process.env.SHOWCASE_OUT ?? 'tmp/showcase/out'
const STORE_KEY = 'gen-package-projects-v1'
const files = process.argv.slice(2)
if (!files.length) {
  console.error('ใช้: node scripts/showcase/render.mjs <design.genpkg.json> [...]')
  process.exit(2)
}
const core = await import(pathToFileURL(path.resolve('tmp/showcase/core.mjs')).href)

const slugOf = (name) => name.trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').slice(0, 60) || 'งาน'
const setRange = async (locator, value) => {
  await locator.evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const context = await browser.newContext({
  viewport: { width: 1500, height: 980 },
  deviceScaleFactor: 2,
  acceptDownloads: true,
  locale: 'th-TH',
})
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') pageErrors.push(`console: ${m.text().slice(0, 300)}`)
})
await page.goto(BASE, { waitUntil: 'networkidle' })

const summary = []
for (const file of files) {
  const agent = path.basename(path.dirname(file))
  const outDir = path.join(OUT_ROOT, agent)
  await mkdir(outDir, { recursive: true })
  const record = { agent, file, outputs: [], errors: [] }
  summary.push(record)
  try {
    const parsed = core.parseProjectFile(await readFile(file, 'utf8'))
    if (!parsed.ok) throw new Error(`parse: ${parsed.error}`)
    const project = parsed.project
    record.name = project.name
    record.live = project.live
    record.elements = project.decos.length
    const slug = slugOf(project.name)
    pageErrors.length = 0

    // ยัดงานเข้า store ของแอป (โหมด local) แล้วโหลดใหม่ — เหมือนผู้ใช้เปิดงานนี้อยู่
    await page.evaluate(
      ([key, snap]) => {
        localStorage.setItem(key, JSON.stringify(snap))
        // หน้าต้อนรับโหมด local (main.tsx AUTH_KEY) — ข้ามเหมือนผู้ใช้ที่กด "เริ่มใช้งานบนเครื่องนี้" ไปแล้ว
        localStorage.setItem('packit-auth', '1')
      },
      [STORE_KEY, { projects: [project], activeId: project.id, showDims: true }],
    )
    await page.reload({ waitUntil: 'networkidle' })
    const start = page.getByRole('button', { name: 'เริ่มใช้งานบนเครื่องนี้' })
    if (await start.count()) await start.click()
    await page.getByRole('tab', { name: 'ออกแบบ' }).click()
    await page.evaluate(() => document.fonts.ready)

    // 3D: จอหลักของแท็บออกแบบ; ถ้าไม่มี (บางชนิดงาน) ขยาย PiP แทน
    let viewer = page.locator('.viewer-main')
    if (!(await viewer.count())) {
      const expand = page.getByRole('button', { name: 'ขยายมุมมอง 3D' })
      if (await expand.count()) await expand.click()
      viewer = page.locator('.viewer-pip.expanded')
    }
    await viewer.locator('canvas').first().waitFor({ timeout: 30_000 })
    await page.waitForTimeout(3500) // รอ texture ลาย/ฟอนต์ไทยวาดลง canvas
    await viewer.screenshot({ path: path.join(outDir, `${slug} - 3D.png`) })
    record.outputs.push(`${slug} - 3D.png`)

    // ภาพกลางทางพับ เฉพาะงานที่พับจริง (นามบัตร/สติกเกอร์แบน ไม่มีอะไรให้พับ)
    const flat = project.live.template === 'card' || project.live.template === 'sticker'
    const fold = page.getByRole('slider', { name: 'กาง-พับ' })
    if (!flat && (await fold.count())) {
      await setRange(fold.first(), '0.55')
      await page.waitForTimeout(900)
      await viewer.screenshot({ path: path.join(outDir, `${slug} - 3D กำลังพับ.png`) })
      record.outputs.push(`${slug} - 3D กำลังพับ.png`)
      await setRange(fold.first(), '1')
      await page.waitForTimeout(400)
    }

    // แผ่นคลี่ (แท็บตกแต่ง = blueprint เต็มจอ)
    await page.getByRole('tab', { name: 'ตกแต่ง' }).click()
    const blueprint = page.locator('.blueprint.card')
    await blueprint.locator('.dieline-svg').first().waitFor({ timeout: 30_000 })
    await page.waitForTimeout(1500)
    await blueprint.screenshot({ path: path.join(outDir, `${slug} - แผ่นคลี่.png`) })
    record.outputs.push(`${slug} - แผ่นคลี่.png`)

    // ส่งออกจริงจากปุ่มในแอป
    await page.getByRole('tab', { name: 'ส่งออก' }).click()
    const group = page.getByRole('button', { name: 'ดาวน์โหลดไฟล์' })
    if ((await group.count()) && (await group.getAttribute('aria-expanded')) !== 'true') await group.click()
    for (const [label, ext] of [
      ['แบบพิมพ์ 1:1', 'pdf'],
      ['dieline เวกเตอร์', 'svg'],
    ]) {
      const item = page.locator('.export-item').filter({ hasText: label })
      await item.waitFor({ timeout: 10_000 })
      const pending = page.waitForEvent('download', { timeout: 120_000 })
      await item.click()
      const download = await pending
      const target = path.join(outDir, `${slug}.${ext}`)
      await download.saveAs(target)
      record.outputs.push(`${slug}.${ext}`)
    }
    record.pageErrors = [...pageErrors]
  } catch (error) {
    record.errors.push(String(error?.message ?? error))
    try {
      await page.screenshot({ path: path.join(outDir, 'error.png'), fullPage: true })
    } catch {
      /* ignore */
    }
  }
}

await writeFile(path.join(OUT_ROOT, 'summary.json'), JSON.stringify(summary, null, 2))
await browser.close()
for (const r of summary) {
  console.log(`${r.errors.length ? '✗' : '✓'} ${r.agent} — ${r.name ?? '?'} (${r.elements ?? 0} elements): ${r.outputs.join(', ')}${r.errors.length ? ' | ' + r.errors.join('; ') : ''}${r.pageErrors?.length ? ` | page errors: ${r.pageErrors.length}` : ''}`)
}
process.exit(summary.some((r) => r.errors.length) ? 1 : 0)
