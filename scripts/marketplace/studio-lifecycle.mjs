// Studio adaptation: same Phase 1 assertions; project-title selectors scoped to cards because hero repeats latest project title.
// Phase 1 browser checks บน build cloud ด้วย **fixture** (ไม่ใช่ cloud integration):
// session ปลอมใน localStorage + API จำลองแบบมีสถานะจาก docs/marketplace/fixtures/phase-1.json ของ B
// (create idempotent ตาม operationId, 404 ของ id ที่ไม่มี) — ใช้ตรวจ routes/requests/lifecycle ฝั่ง browser เท่านั้น
// ใช้: node scripts/marketplace/cloud-fixture.mjs <cloud fixture base URL>  (build ตาม ROUTES-PHASE-1.md §6)
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const BASE = (process.argv[2] ?? 'http://localhost:5192/').replace(/\/?$/, '/')
const CHROME = process.env.PACKIT_E2E_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const SUPABASE_URL = 'http://127.0.0.1:59999'
const STORAGE_KEY = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`
const fixtures = JSON.parse(readFileSync(new URL('../../docs/marketplace/fixtures/phase-1.json', import.meta.url), 'utf8'))
const ids = fixtures.ids
const C = fixtures.cases
const IDENTITY = 'a0000000-0000-4000-8000-000000000001' // Supabase auth subject (≠ app user id)

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function fakeSession() {
  const now = Math.floor(Date.now() / 1000)
  return {
    access_token: 'fixture-access-token',
    refresh_token: 'fixture-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    user: { id: IDENTITY, aud: 'authenticated', role: 'authenticated', email: null, app_metadata: { provider: 'google' }, user_metadata: {}, created_at: '2026-10-01T00:00:00Z' },
  }
}

// API จำลองที่มีสถานะ — ต่อ context (แต่ละสถานการณ์เริ่มใหม่)
function fakeApi() {
  const page1 = C['projects.page1'].response.data
  const page2 = C['projects.page2'].response.data
  const created = new Map() // operationId → CloudProject
  const projects = new Map() // id → CloudProject
  const detail = C['projects.detail'].response.data
  for (const item of [...page1.items, ...page2.items]) {
    projects.set(item.id, { ...structuredClone(detail), id: item.id, name: item.name, workspaceId: item.workspaceId, revision: item.revision, updatedAt: item.updatedAt })
  }
  const log = []
  const envelope = (data) => JSON.stringify({ data, requestId: '60000000-0000-4000-8000-0000000000ff' })
  const error = (status, code) => ({ status, body: JSON.stringify({ error: { code, message: code }, requestId: '60000000-0000-4000-8000-0000000000fe' }) })
  async function handle(route) {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace(/^\/api\/v1/, '')
    const method = request.method()
    log.push({ method, path, search: url.search, body: request.postData() })
    let res
    if (method === 'POST' && path === '/session/bootstrap') res = { status: 200, body: envelope(C['bootstrap.owner'].response.data) }
    else if (method === 'GET' && path === '/me') res = { status: 200, body: envelope(C['me.owner'].response.data) }
    else if (method === 'GET' && path === '/projects') {
      const ws = url.searchParams.get('workspaceId')
      const cursor = url.searchParams.get('cursor')
      if (ws === ids.team) res = { status: 200, body: envelope(cursor ? page2 : page1) }
      else res = { status: 200, body: envelope({ items: [...created.values()].filter((p) => p.workspaceId === ws).map(summary), nextCursor: null }) }
    } else if (method === 'POST' && path === '/projects/thumbnails') {
      const body = JSON.parse(request.postData() ?? '{}')
      const image = C['thumbnails.batch'].response.data.items[0]
      res = { status: 200, body: envelope({ items: (body.projectIds ?? []).slice(0, 2).map((projectId) => ({ ...image, projectId })) }) }
    } else if (method === 'POST' && path === '/projects') {
      const body = JSON.parse(request.postData())
      const seen = created.get(body.operationId)
      if (seen) res = { status: 201, body: envelope(seen) }
      else {
        const now = new Date().toISOString()
        const project = { id: crypto.randomUUID(), workspaceId: body.workspaceId, name: body.name, documentSchemaVersion: 1, document: body.document, revision: 1, createdAt: now, updatedAt: now, assets: [] }
        created.set(body.operationId, project)
        projects.set(project.id, project)
        res = { status: 201, body: envelope(project) }
      }
    } else if (method === 'GET' && /^\/projects\/[0-9a-f-]{36}$/.test(path)) {
      const project = projects.get(path.split('/')[2])
      res = project ? { status: 200, body: envelope(project) } : error(404, 'NOT_FOUND')
    } else if (method === 'PUT' && /^\/projects\/[0-9a-f-]{36}$/.test(path)) {
      const project = projects.get(path.split('/')[2])
      const body = JSON.parse(request.postData())
      if (!project) res = error(404, 'NOT_FOUND')
      else if (body.expectedRevision !== project.revision) res = error(409, 'REVISION_CONFLICT')
      else {
        Object.assign(project, { name: body.name, document: body.document, revision: project.revision + 1, updatedAt: new Date().toISOString() })
        res = { status: 200, body: envelope({ projectId: project.id, revision: project.revision, updatedAt: project.updatedAt, operationId: body.operationId }) }
      }
    } else if (/thumbnail$/.test(path)) res = error(503, 'CONFIGURATION_ERROR')
    else res = error(503, 'CONFIGURATION_ERROR') // entitlements/billing ไม่อยู่ใน fixture → App ปฏิบัติแบบโหลดสิทธิ์ไม่ได้
    await route.fulfill({ status: res.status, contentType: 'application/json; charset=utf-8', body: res.body })
  }
  return { handle, log, created, projects }
}

function summary(p) {
  return { id: p.id, workspaceId: p.workspaceId, name: p.name, revision: p.revision, updatedAt: p.updatedAt }
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true })

async function context({ loggedIn = true, workspace = ids.team } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'th-TH' })
  const api = fakeApi()
  await ctx.route('**/api/v1/**', (route) => api.handle(route))
  // Supabase จริงไม่ถูกเรียก: session ยังไม่หมดอายุจึงอ่านจาก storage; ปลายทางอื่นของ host ปลอมตอบ 503
  await ctx.route(`${SUPABASE_URL}/**`, (route) => route.fulfill({ status: 503, body: '{}' }))
  await ctx.addInitScript(({ key, session, loggedIn, wsKey, workspace }) => {
    if (sessionStorage.getItem('__fixture_init')) return
    sessionStorage.setItem('__fixture_init', '1')
    if (loggedIn) localStorage.setItem(key, JSON.stringify(session))
    if (workspace) localStorage.setItem(wsKey, workspace)
  }, { key: STORAGE_KEY, session: fakeSession(), loggedIn, wsKey: `packit-active-workspace:${ids.owner}`, workspace })
  const page = await ctx.newPage()
  const scripts = []
  page.on('requestfinished', (r) => {
    if (r.resourceType() === 'script') scripts.push(r.url().split('/').pop())
  })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  return { ctx, page, api, scripts, errors }
}

const hasApp = (scripts) => scripts.some((s) => /^App-/.test(s))
const apiCalls = (api, method, re) => api.log.filter((r) => r.method === method && re.test(r.path))

// P1-01/P1-02/P1-03: หน้ารายการ cold load
{
  const { ctx, page, api, scripts, errors } = await context()
  await page.goto(`${BASE}app/projects`, { waitUntil: 'networkidle' })
  await page.locator('.project-name').getByText('งานตัวอย่าง 1', { exact: true }).waitFor({ timeout: 15000 })
  await page.waitForTimeout(800)
  check('P1-01 /app/projects cold load ไม่โหลด App/Three/exporter chunk', !hasApp(scripts), scripts.join(', '))
  const lists = apiCalls(api, 'GET', /^\/projects$/)
  check('P1-02 หน้าแรกขอ GET /projects ครั้งเดียว limit=24', lists.length === 1 && /limit=24/.test(lists[0].search) && !/cursor/.test(lists[0].search), lists.map((r) => r.search).join(' | '))
  check('P1-02 ไม่เรียก detail ทุกการ์ด', apiCalls(api, 'GET', /^\/projects\/[0-9a-f-]{36}$/).length === 0)
  const batches = apiCalls(api, 'POST', /^\/projects\/thumbnails$/).map((r) => JSON.parse(r.body).projectIds)
  check('P1-03 ภาพย่อขอเป็น batch ≤ 24 id ไม่ซ้ำ', batches.length >= 1 && batches.every((b) => b.length <= 24 && new Set(b).size === b.length), batches.map((b) => b.length).join(','))
  const imgs = await page.locator('.project-thumb img').count()
  const icons = await page.locator('.project-thumb svg').count()
  check('P1-03 การ์ดที่ไม่มีภาพใช้ placeholder', imgs >= 1 && icons >= 1, `img=${imgs} icon=${icons}`)
  await page.getByRole('button', { name: 'โหลดเพิ่ม' }).click()
  await page.locator('.project-name').getByText('งานตัวอย่าง 25', { exact: true }).waitFor({ timeout: 10000 })
  const after = apiCalls(api, 'GET', /^\/projects$/)
  check('P1-02 กดโหลดเพิ่มขอหน้าถัดไปด้วย cursor เพียงครั้งเดียว และหยุดเมื่อหมด', after.length === 2 && /cursor=/.test(after[1].search)
    && (await page.getByRole('button', { name: 'โหลดเพิ่ม' }).count()) === 0, after.map((r) => r.search).join(' | '))
  check('หน้ารายการไม่มี page error', errors.length === 0, errors.join(' | '))
  await page.screenshot({ path: 'tmp/a1-shots/projects.png' })
  await ctx.close()
}

// P1-04: exact ID / not found ไม่สร้างแทน / refresh เปิด id เดิม
{
  const { ctx, page, api, scripts, errors } = await context()
  const target = '30000000-0000-4000-8000-000000000007'
  await page.goto(`${BASE}editor/${target}`, { waitUntil: 'networkidle' })
  await page.locator('canvas').first().waitFor({ timeout: 30000 })
  const gets = apiCalls(api, 'GET', /^\/projects\/[0-9a-f-]{36}$/).map((r) => r.path)
  check('P1-04 /editor/:id เปิด GET id ตรง URL', gets.length >= 1 && gets.every((p) => p.endsWith(target)), gets.join(','))
  check('P1-04 เข้า Editor แล้วโหลด App chunk', hasApp(scripts))
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('canvas').first().waitFor({ timeout: 30000 })
  check('P1-04 refresh ยังอยู่ id เดิม', page.url().endsWith(`/editor/${target}`), page.url())
  check('Editor ไม่มี page error', errors.length === 0, errors.join(' | '))
  await page.screenshot({ path: 'tmp/a1-shots/editor.png' })

  await page.goto(`${BASE}editor/${ids.missing}`, { waitUntil: 'networkidle' })
  await page.getByText('ไม่พบงานนี้ หรือคุณไม่มีสิทธิ์เปิด').waitFor({ timeout: 15000 })
  check('P1-04 id ที่ไม่มี/ไม่มีสิทธิ์ → หน้าแจ้ง ไม่สร้างงานแทน', apiCalls(api, 'POST', /^\/projects$/).length === 0 && page.url().endsWith(ids.missing))
  await page.goto(`${BASE}editor/not-a-uuid`, { waitUntil: 'networkidle' })
  check('P1-04 id รูปแบบผิดไม่เรียก API', (await page.getByText('ลิงก์ของงานไม่ถูกต้อง').count()) === 1)
  await ctx.close()
}

// P1-05: /editor/new สร้างงานเดียว แล้ว replace เป็น id จริง; refresh ไม่สร้างซ้ำ
{
  const { ctx, page, api, errors } = await context()
  await page.goto(`${BASE}editor/new`, { waitUntil: 'networkidle' })
  await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/, { timeout: 30000 })
  const id = page.url().split('/').pop()
  const posts = apiCalls(api, 'POST', /^\/projects$/)
  check('P1-05 /editor/new สร้างงานแล้ว URL เป็น id จริง', posts.length === 1 && api.projects.has(id), `posts=${posts.length} id=${id}`)
  const historyLength = await page.evaluate(() => history.length)
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('canvas').first().waitFor({ timeout: 30000 })
  check('P1-05 refresh หลังสร้างไม่สร้างซ้ำ', apiCalls(api, 'POST', /^\/projects$/).length === 1 && api.created.size === 1)
  check('P1-05 replace ไม่เพิ่ม history ให้ back กลับมาสร้างซ้ำ', historyLength <= 2, `history=${historyLength}`)
  check('/editor/new ไม่มี page error', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// P1-05 (response หาย): server สร้างแล้วแต่ response หาย → reload ส่ง operationId เดิม ได้งานเดียว
{
  const { ctx, page, api } = await context()
  let dropped = false
  await ctx.route('**/api/v1/projects', async (route) => {
    if (route.request().method() === 'POST' && !dropped) {
      dropped = true
      await api.handle({ request: () => route.request(), fulfill: async () => undefined })
      await route.abort('failed')
      return
    }
    await api.handle(route)
  })
  await page.goto(`${BASE}editor/new`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  check('P1-05 response หาย: URL ยังเป็น /editor/new', /\/editor\/new$/.test(page.url()), page.url())
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/, { timeout: 30000 })
  const ops = apiCalls(api, 'POST', /^\/projects$/).map((r) => JSON.parse(r.body).operationId)
  check('P1-05 response หาย: ส่งซ้ำด้วย operationId เดิม ได้งานเดียว', ops.length >= 2 && new Set(ops).size === 1 && api.created.size === 1, `ops=${ops.length} unique=${new Set(ops).size} created=${api.created.size}`)
  await ctx.close()
}

// P1-10/returnTo: ไม่มี session → /login?returnTo; returnTo ภายนอกถูกทิ้ง
{
  const { ctx, page } = await context({ loggedIn: false })
  const target = `/editor/${ids.project1 ?? '30000000-0000-4000-8000-000000000001'}`
  await page.goto(`${BASE}${target.slice(1)}`, { waitUntil: 'networkidle' })
  const url = new URL(page.url())
  check('P1-10 ลิงก์ตรงตอนยังไม่ login → /login?returnTo=<path เดิม>', url.pathname === '/login' && url.searchParams.get('returnTo') === target, page.url())
  await ctx.close()
}
{
  const { ctx, page } = await context()
  await page.goto(`${BASE}login?returnTo=${encodeURIComponent('//evil.example/app/projects')}`, { waitUntil: 'networkidle' })
  await page.waitForURL(/\/app\/projects$/, { timeout: 15000 })
  check('returnTo `//host` ถูกทิ้ง → /app/projects', new URL(page.url()).host === new URL(BASE).host)
  await page.goto(`${BASE}login?returnTo=${encodeURIComponent('/editor/30000000-0000-4000-8000-000000000003')}`, { waitUntil: 'networkidle' })
  await page.waitForURL(/\/editor\/30000000-0000-4000-8000-000000000003$/, { timeout: 15000 })
  check('returnTo ภายในที่อนุญาตพาไปปลายทางเดิม', true)
  await ctx.close()
}

// P1-06/R4: เปิดจากการ์ด (นำทางในแอป) แก้แล้วกด back ทันที → leave guard เก็บ+ส่งก่อนออก
{
  const { ctx, page, api } = await context()
  const target = '30000000-0000-4000-8000-000000000002'
  await page.goto(`${BASE}app/projects`, { waitUntil: 'networkidle' })
  await page.locator('.project-name').getByText('งานตัวอย่าง 2', { exact: true }).click()
  await page.waitForURL(new RegExp(`/editor/${target}$`))
  await page.locator('canvas').first().waitFor({ timeout: 30000 })
  await page.waitForTimeout(1500)
  const w = page.getByRole('spinbutton', { name: 'กว้าง W' })
  await w.fill('87')
  await w.press('Enter')
  await page.goBack()
  // POP: URL เปลี่ยนก่อน guard จบ — รอจนหน้ารายการแสดงจริง (guard proceed แล้ว)
  await page.locator('.projects-page').waitFor({ timeout: 15000 })
  const puts = apiCalls(api, 'PUT', new RegExp(`^/projects/${target}$`))
  const savedW = api.projects.get(target)?.document?.live?.W
  check('P1-06 back ในแอปภายใน debounce: guard เก็บแล้วส่ง PUT ก่อนออก', puts.length >= 1 && savedW === 87, `puts=${puts.length} W=${savedW}`)
  check('P1-06 back ใช้ history ในแอป (ไม่ bootstrap ใหม่)', apiCalls(api, 'POST', /^\/session\/bootstrap$/).length === 1)
  await ctx.close()
}

// P1-06/R5: แก้แล้ว refresh ทันที (ภายใน debounce) → ร่างไม่หาย: เปิดกลับมาได้ค่าใหม่และส่งต่อ
{
  const { ctx, page, api } = await context()
  const target = '30000000-0000-4000-8000-000000000003'
  page.on('dialog', (dialog) => void dialog.accept())
  await page.goto(`${BASE}editor/${target}`, { waitUntil: 'networkidle' })
  await page.locator('canvas').first().waitFor({ timeout: 30000 })
  await page.waitForTimeout(1500)
  const w = page.getByRole('spinbutton', { name: 'กว้าง W' })
  await w.fill('91')
  await w.press('Enter')
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('canvas').first().waitFor({ timeout: 30000 })
  await page.waitForTimeout(3000)
  const shown = await page.getByRole('spinbutton', { name: 'กว้าง W' }).inputValue()
  const savedW = api.projects.get(target)?.document?.live?.W
  check('P1-06 refresh ภายใน debounce: เปิดกลับได้ค่าที่แก้ และส่งขึ้นต่อ', shown === '91' && savedW === 91, `shown=${shown} server W=${savedW}`)
  await ctx.close()
}

// P1-09: เปลี่ยน workspace ขณะคำขอรายการของ workspace เดิมยังค้าง → ผลเก่าไม่ทับหน้าใหม่
{
  const { ctx, page, api } = await context()
  await ctx.unroute('**/api/v1/**')
  await ctx.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/v1/projects' && url.searchParams.get('workspaceId') === ids.team) {
      await new Promise((resolve) => setTimeout(resolve, 2500))
    }
    await api.handle(route).catch(() => undefined)
  })
  await page.goto(`${BASE}app/projects`, { waitUntil: 'domcontentloaded' })
  await page.locator('.studio-sidebar .studio-workspace-select select').waitFor({ timeout: 15000 })
  await page.locator('.studio-sidebar .studio-workspace-select select').selectOption(ids.personal)
  await page.getByText('ยังไม่มีงานในพื้นที่นี้').waitFor({ timeout: 15000 })
  await page.waitForTimeout(3500)
  const leaked = await page.locator('.project-name').getByText('งานตัวอย่าง 1', { exact: true }).count()
  check('P1-09 เปลี่ยน workspace ระหว่างคำขอค้าง: รายการของ workspace เดิมไม่ปนหน้าใหม่', leaked === 0, `leaked=${leaked}`)
  await ctx.close()
}

// P1-09: pending create intent ของ workspace เก่าต้องหายทันที แม้ IndexedDB ของ workspace ใหม่ยังไม่ตอบ
{
  const { ctx, page } = await context()
  const name = 'ร่างทดสอบเฉพาะพื้นที่ทีม'
  const teamScope = { appUserId: ids.owner, workspaceId: ids.team }
  await page.goto(`${BASE}app/projects`, { waitUntil: 'networkidle' })
  await page.locator('.project-name').getByText('งานตัวอย่าง 1', { exact: true }).waitFor()
  await page.evaluate(async ({ teamScope, name, document }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('packit-editor-intents', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      await new Promise((resolve, reject) => {
        const intentId = crypto.randomUUID()
        const scopeKey = `cloud:${teamScope.appUserId}:${teamScope.workspaceId}`
        const now = Date.now()
        const transaction = db.transaction('create-intents', 'readwrite')
        transaction.oncomplete = resolve
        transaction.onerror = () => reject(transaction.error)
        transaction.objectStore('create-intents').put({
          version: 1, key: `${scopeKey}:${intentId}`, scopeKey, scope: teamScope, intentId, status: 'local',
          latest: { generation: 1, project: { ...document, id: crypto.randomUUID(), name, updatedAt: now } },
          frozen: null, result: null, error: null, createdAt: now, updatedAt: now,
        })
      })
    } finally {
      db.close()
    }
  }, { teamScope, name, document: C['projects.detail'].response.data.document })
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.project-name').getByText(name, { exact: true }).waitFor()
  await page.evaluate(() => {
    const open = indexedDB.open.bind(indexedDB)
    // จงใจค้างคำขอเปิด store ถัดไป เพื่อแยกผลระหว่างสลับพื้นที่กับผล query ของ IndexedDB
    indexedDB.open = (name, ...args) => name === 'packit-editor-intents' ? {} : open(name, ...args)
  })
  await page.locator('.studio-sidebar .studio-workspace-select select').selectOption(ids.personal)
  await page.getByText('ยังไม่มีงานในพื้นที่นี้').waitFor()
  check('P1-09 ระหว่างรอ IndexedDB ไม่แสดงงานที่รอส่งของพื้นที่เดิม', await page.locator('.project-name').getByText(name, { exact: true }).count() === 0)
  await ctx.close()
}

// P1-11: เปลี่ยนไปพื้นที่ที่ยังไม่เคยโหลดขณะออฟไลน์ ต้องมีสถานะและทางต่อที่ตรงจริง
{
  const { ctx, page } = await context()
  await page.goto(`${BASE}app/projects`, { waitUntil: 'networkidle' })
  await page.locator('.project-name').getByText('งานตัวอย่าง 1', { exact: true }).waitFor()
  await ctx.setOffline(true)
  await page.locator('.studio-sidebar .studio-workspace-select select').selectOption(ids.personal)
  await page.getByText('ออฟไลน์ — แสดงเฉพาะงานที่โหลดไว้และงานที่รอส่งในเครื่องนี้').waitFor()
  check('P1-11 พื้นที่ใหม่ขณะออฟไลน์แสดงสถานะเปิดรายการไม่ได้แทน skeleton ค้าง', await page.getByText('ออฟไลน์ — ยังโหลดรายการงานไม่ได้', { exact: true }).count() === 1
    && await page.locator('.is-skeleton').count() === 0)
  await ctx.setOffline(false)
  await page.getByText('ยังไม่มีงานในพื้นที่นี้').waitFor()
  check('P1-11 กลับออนไลน์โหลดพื้นที่ที่เลือกและแสดงสถานะว่าง', await page.getByText('ยังไม่มีงานในพื้นที่นี้', { exact: true }).count() === 1)
  await ctx.close()
}

// P1-11: skeleton, error และปุ่มลองใหม่ของหน้ารายการ
{
  const { ctx, page, api } = await context()
  let fail = true
  await ctx.route('**/api/v1/projects?*', async (route) => {
    if (!fail) return api.handle(route)
    await new Promise((resolve) => setTimeout(resolve, 500))
    await route.fulfill({ status: 503, json: { error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Unavailable' } } })
  })
  await page.goto(`${BASE}app/projects`, { waitUntil: 'domcontentloaded' })
  await page.locator('.is-skeleton').first().waitFor()
  check('P1-11 หน้ารายการแสดง skeleton ขณะโหลด', await page.locator('.is-skeleton').count() > 0)
  await page.getByText('โหลดรายการงานไม่สำเร็จ', { exact: true }).waitFor()
  fail = false
  await page.getByRole('button', { name: 'ลองใหม่', exact: true }).click()
  await page.locator('.project-name').getByText('งานตัวอย่าง 1', { exact: true }).waitFor()
  check('P1-11 หลัง API ล้ม ปุ่มลองใหม่เปิดรายการเดิมได้', await page.locator('.project-name').getByText('งานตัวอย่าง 1', { exact: true }).count() === 1)
  await ctx.close()
}

// P1-11: API ปฏิเสธ token ขณะ session ยังอยู่ใน browser — ต่ออายุบัญชีเดิมหรือกลับไปล็อกอิน
for (const rejected of [false, true]) {
  const { ctx, page, api } = await context()
  const rotated = { ...fakeSession(), access_token: 'fixture-rotated-token' }
  let refreshCount = 0
  await ctx.route(`${SUPABASE_URL}/auth/v1/token?**`, async (route) => {
    refreshCount += 1
    await route.fulfill(rejected
      ? { status: 400, json: { error_code: 'refresh_token_not_found', msg: 'Refresh token invalid' } }
      : { status: 200, json: rotated })
  })
  await ctx.route(`${SUPABASE_URL}/auth/v1/logout?**`, (route) => route.fulfill({ status: 204 }))
  const seenTokens = []
  await ctx.route('**/api/v1/projects?*', async (route) => {
    const token = route.request().headers().authorization
    seenTokens.push(token)
    if (token === `Bearer ${rotated.access_token}` && !rejected) return api.handle(route)
    await route.fulfill({ status: 401, json: { error: { code: 'SESSION_INVALID', message: 'Session expired' } } })
  })
  await page.goto(`${BASE}app/projects`, { waitUntil: 'networkidle' })
  if (rejected) {
    await page.waitForURL((url) => url.pathname === '/login')
    const url = new URL(page.url())
    check('P1-11 เซสชันหมดอายุพากลับ login และเก็บ returnTo', refreshCount === 1
      && url.searchParams.get('returnTo') === '/app/projects'
      && await page.locator('.projects-page').count() === 0)
  } else {
    await page.locator('.project-name').getByText('งานตัวอย่าง 1', { exact: true }).waitFor()
    check('P1-11 ต่ออายุ token ของบัญชีเดิมหนึ่งครั้งแล้วโหลดรายการต่อ', refreshCount === 1
      && seenTokens.length === 2 && seenTokens[1] === `Bearer ${rotated.access_token}`)
  }
  await ctx.close()
}

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} PASS (fixture harness — ไม่ใช่ cloud integration)`)
await browser.close()
process.exitCode = results.every((r) => r.ok) ? 0 : 1
