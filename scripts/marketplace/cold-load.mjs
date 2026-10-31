// 0-A3 baseline: requests ของ cold load (เบราว์เซอร์ใหม่ ไม่มีแคช) ต่อสถานการณ์
import { chromium } from 'playwright-core'
// ใช้: node scripts/marketplace/cold-load.mjs <local-demo base URL> <cloud base URL> — คนละ build/คนละพอร์ต (ดู ROUTES-PHASE-1.md §6)
const LOCAL = process.argv[2] ?? 'http://localhost:5191/'
const CLOUD = process.argv[3] ?? 'http://localhost:5192/'
const CHROME = process.env.PACKIT_E2E_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const browser = await chromium.launch({ executablePath: CHROME, headless: true })
async function scenario(name, url, act) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'th-TH' })
  const page = await ctx.newPage()
  const reqs = []
  page.on('requestfinished', async (r) => {
    const res = await r.response()
    const len = Number((await res?.allHeaders())?.['content-length'] ?? 0) || (await res?.body().catch(() => Buffer.alloc(0)))?.length || 0
    reqs.push({ url: r.url().replace(/^https?:\/\/[^/]+/, ''), type: r.resourceType(), kb: +(len / 1024).toFixed(1) })
  })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  if (act) await act(page)
  await page.waitForTimeout(2500)
  const by = {}
  for (const r of reqs) { by[r.type] ??= { n: 0, kb: 0 }; by[r.type].n++; by[r.type].kb += r.kb }
  for (const k of Object.keys(by)) by[k].kb = +by[k].kb.toFixed(1)
  const scripts = reqs.filter((r) => r.type === 'script').map((r) => `${r.url.split('/').pop()} ${r.kb}KB`)
  const visible = (await page.locator('body').innerText()).slice(0, 80).replace(/\s+/g, ' ')
  console.log(JSON.stringify({ name, url, visible, by, scripts }, null, 1))
  await ctx.close()
}
await scenario('local: หน้า login (ยังไม่กดเริ่ม)', `${LOCAL}`)
await scenario('local: กดเริ่มใช้งาน → Editor', `${LOCAL}`, async (p) => { await p.getByText('เริ่มใช้งานบนเครื่องนี้').click(); await p.waitForTimeout(3000) })
await scenario('cloud fixture: หน้า login (ไม่มี session)', `${CLOUD}`)
await scenario('cloud fixture: deep link /editor/x (ยังไม่มี router)', `${CLOUD}editor/00000000-0000-4000-8000-000000000000`)
await browser.close()
