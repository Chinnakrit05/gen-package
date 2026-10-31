// 0-A3 baseline smoke (local-demo build): แก้งาน → undo → สลับ V1/V2 → 3D → export → refresh
import { chromium } from 'playwright-core'
const base = process.argv[2] ?? 'http://localhost:5191/'
const browser = await chromium.launch({ executablePath: process.env.PACKIT_E2E_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu'] })
const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 }, locale: 'th-TH' })).newPage()
const errs = []
page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)))
const proj = () => page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('gen-package-projects-v1') ?? 'null')
  const p = s?.projects?.find((x) => x.id === s.activeId)
  return p ? { id: p.id, fill: p.fillColor ?? null, decos: p.decos?.length ?? 0, hist: p.history?.length ?? 0 } : null
})
const setFill = async (hex) => {
  await page.locator('[role=tab]:visible', { hasText: 'ตกแต่ง' }).first().click()
  const inputs = page.locator('input[type=color]')
  for (let i = 0; i < (await inputs.count()); i++) {
    const lab = await inputs.nth(i).getAttribute('aria-label')
    if (lab && /พื้น|background/i.test(lab)) {
      await inputs.nth(i).evaluate((el, v) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })) }, hex)
      return lab
    }
  }
  return null
}
const out = {}
await page.goto(base, { waitUntil: 'networkidle' })
await page.getByText('เริ่มใช้งานบนเครื่องนี้').click()
await page.waitForTimeout(2500)
out.start = await proj()
out.fillLabel = await setFill('#c8402f')
await page.waitForTimeout(800)
out.afterFill = await proj()
await page.locator('body').click({ position: { x: 5, y: 5 } })
await page.keyboard.press('Control+z')
await page.waitForTimeout(800)
out.afterUndo = await proj()
await page.keyboard.press('Control+Shift+z')
await page.waitForTimeout(800)
out.afterRedo = await proj()
await page.locator('[aria-label="เวอร์ชันหน้าเว็บ"] button', { hasText: 'V2' }).click()
await page.waitForTimeout(1200)
out.v2 = { editorV2Nodes: await page.locator('.editor-v2').count(), project: await proj() }
await page.locator('[aria-label="เวอร์ชันหน้าเว็บ"] button', { hasText: 'V1' }).click()
await page.waitForTimeout(1200)
out.backToV1 = { editorV2Nodes: await page.locator('.editor-v2').count(), project: await proj() }
out.canvas3d = await page.locator('canvas').count()
await page.locator('[role=tab]:visible', { hasText: 'ส่งออก' }).first().click()
await page.waitForTimeout(500)
out.exportButtons = await page.locator('.export-item').count()
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
out.afterReload = await proj()
out.errs = errs
console.log(JSON.stringify(out, null, 1))
await browser.close()
