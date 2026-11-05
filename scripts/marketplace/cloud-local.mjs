// Browser acceptance with real local Supabase Auth, PackIt HTTP and PostgreSQL.
// Run against a dedicated PackIt Supabase stack; never pass remote credentials.
// node scripts/marketplace/cloud-local.mjs <supabase-workdir>
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright-core'
import postgres from 'postgres'

const workdir = process.argv[2]
assert(workdir, 'Pass the workdir of the isolated PackIt Supabase stack')
const origin = 'http://127.0.0.1:52473'
const executablePath = process.env.PACKIT_E2E_CHROME ?? (
  process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : process.platform === 'win32'
      ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
      : '/usr/bin/google-chrome'
)
const status = spawnSync(process.execPath, [
  path.resolve('node_modules/supabase/dist/supabase.js'), 'status', '-o', 'json', '--workdir', workdir,
], { encoding: 'utf8' })
assert.equal(status.status, 0, 'Start the isolated PackIt Supabase stack first')
const local = JSON.parse(status.stdout)
for (const value of [local.API_URL, local.DB_URL]) {
  assert.equal(new URL(value).hostname, '127.0.0.1', 'Only a loopback test stack is supported')
}
assert(local.PUBLISHABLE_KEY && local.SECRET_KEY, 'Missing local stack keys')

const auth = { persistSession: false, autoRefreshToken: false }
const admin = createClient(local.API_URL, local.SECRET_KEY, { auth })
const sql = postgres(local.DB_URL, { max: 4 })
const tokenKey = `sb-${new URL(local.API_URL).hostname.split('.')[0]}-auth-token`
const authIds = []
const browserErrors = []
let vite, browser

async function eventually(probe, message, timeout = 20000) {
  const until = Date.now() + timeout
  do {
    if (await probe()) return
    await new Promise(resolve => setTimeout(resolve, 100))
  } while (Date.now() < until)
  throw new Error(message)
}

async function request(route, account, { method = 'GET', body } = {}) {
  const response = await fetch(origin + '/api/v1' + route, {
    method,
    headers: {
      ...(account ? { authorization: `Bearer ${account.session.access_token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  assert.match(response.headers.get('content-type') ?? '', /application\/json/)
  return { status: response.status, ...await response.json() }
}

async function account(role) {
  const email = `marketplace-${role}-${randomUUID()}@example.test`
  const password = `Local-${randomUUID()}!aA1`
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  assert(created.data.user && !created.error, 'Could not create local Auth fixture')
  authIds.push(created.data.user.id)
  const client = createClient(local.API_URL, local.PUBLISHABLE_KEY, { auth })
  const signedIn = await client.auth.signInWithPassword({ email, password })
  assert(signedIn.data.session && !signedIn.error, 'Could not sign in local Auth fixture')
  const result = { session: signedIn.data.session }
  const bootstrap = await request('/session/bootstrap', result, { method: 'POST', body: {} })
  assert.equal(bootstrap.status, 200)
  return { ...result, id: bootstrap.data.user.id, personalWorkspace: bootstrap.data.personalWorkspace.id }
}

async function signIn(page, user) {
  // The product exposes Google OAuth only. Load a session issued by local Auth
  // so the test can use synthetic accounts without sending them to Google.
  await page.evaluate(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), {
    key: tokenKey, session: user.session,
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
}

async function pageFor(context) {
  const page = await context.newPage()
  page.on('pageerror', error => browserErrors.push(error.name))
  return page
}

const editorTab = page => page.getByRole('tab', { name: 'ออกแบบ' })
const width = page => page.getByRole('spinbutton', { name: 'กว้าง W' }).first()
const projectRow = (page, name) => page.locator('.project-card').filter({ hasText: name })

async function cleanup() {
  if (!authIds.length) return
  await sql.begin(async tx => {
    const users = await tx`select app_user_id as id from app_private.auth_identities where subject in ${tx(authIds)}`
    const ids = users.map(row => row.id)
    if (!ids.length) return
    const workspaces = await tx`select id from app_private.workspaces where owner_user_id in ${tx(ids)}`
    const spaces = workspaces.map(row => row.id)
    if (spaces.length) {
      await tx`delete from app_private.project_operations where workspace_id in ${tx(spaces)}`
      await tx`delete from app_private.projects where workspace_id in ${tx(spaces)}`
      await tx`delete from app_private.credit_balances where workspace_id in ${tx(spaces)}`
      await tx`delete from app_private.workspace_members where workspace_id in ${tx(spaces)}`
      await tx`delete from app_private.workspaces where id in ${tx(spaces)}`
    }
    await tx`delete from app_private.auth_identities where app_user_id in ${tx(ids)}`
    await tx`delete from app_private.app_users where id in ${tx(ids)}`
  })
  for (const id of authIds) {
    const { error } = await admin.auth.admin.deleteUser(id)
    assert(!error, 'Could not clean up local Auth fixture')
  }
}

try {
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    APP_ENV: 'test',
    APP_ALLOWED_ORIGINS: origin,
    ANTHROPIC_API_KEY: '',
    VITE_APP_MODE: 'cloud',
    VITE_API_BASE_URL: '/api/v1',
    VITE_SUPABASE_URL: local.API_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY,
    SUPABASE_URL: local.API_URL,
    SUPABASE_SECRET_KEY: local.SECRET_KEY,
  }
  vite = spawn(process.execPath, [
    'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '52473', '--strictPort',
  ], { env, stdio: 'ignore' })
  await eventually(async () => {
    try {
      const response = await fetch(origin + '/api/v1/health', { signal: AbortSignal.timeout(1500) })
      return vite.exitCode === null && response.ok && response.headers.get('content-type')?.includes('application/json')
    } catch {
      return false
    }
  }, 'Could not start the local Cloud test server')

  const owner = await account('owner')
  const editor = await account('editor')
  const viewer = await account('viewer')
  const outsider = await account('outsider')
  const [team] = await sql`
    insert into app_private.workspaces(kind, owner_user_id, name)
    values ('team', ${owner.id}, 'Marketplace browser test') returning id
  `
  for (const [user, role] of [[owner, 'owner'], [editor, 'editor'], [viewer, 'viewer']]) {
    await sql`insert into app_private.workspace_members (workspace_id, user_id, role) values (${team.id}, ${user.id}, ${role})`
  }

  const name = 'กล่องทดสอบ Marketplace'
  const document = {
    live: { template: 'tuck-end', materialId: 'carton-300', W: 80, D: 50, H: 120, handle: false },
    qty: 500, fillColor: null, decos: [], history: [], histIdx: -1,
  }
  const seeded = await request('/projects', owner, {
    method: 'POST',
    body: { workspaceId: team.id, operationId: randomUUID(), name, documentSchemaVersion: 1, document },
  })
  assert.equal(seeded.status, 201)
  const projectId = seeded.data.id
  const editorPath = '/editor/' + projectId

  browser = await chromium.launch({ executablePath, headless: true })
  const context = await browser.newContext({ locale: 'th-TH', viewport: { width: 1500, height: 950 } })
  const page = await pageFor(context)

  assert.equal((await request('/me', null)).status, 401)
  await page.goto(origin + editorPath)
  await page.waitForURL(url => url.pathname === '/login' && url.searchParams.get('returnTo') === editorPath)
  await signIn(page, owner)
  await page.waitForURL(origin + editorPath)
  await editorTab(page).waitFor()
  await page.reload()
  await editorTab(page).waitFor()
  assert.equal(new URL(page.url()).pathname, editorPath)
  console.log('PASS P1-04/P1-10 — exact ID, direct URL, refresh, local Auth return target, JSON 401')

  // The first create succeeds in PostgreSQL but loses its response in the browser.
  // The real API receives both attempts and decides whether they are idempotent.
  const attempts = []
  const createUrl = origin + '/api/v1/projects'
  const dropFirstCreate = async route => {
    if (route.request().method() !== 'POST') return route.continue()
    attempts.push(route.request().postDataJSON())
    if (attempts.length !== 1) return route.continue()
    const response = await route.fetch()
    assert.equal(response.status(), 201)
    await route.abort('failed')
  }
  await page.route(createUrl, dropFirstCreate)
  await page.goto(origin + '/editor/new')
  await page.getByText('บันทึกไม่สำเร็จ', { exact: true }).waitFor()
  await page.reload()
  await page.waitForURL(url => /^\/editor\/[0-9a-f-]{36}$/.test(url.pathname))
  await page.unroute(createUrl, dropFirstCreate)
  assert(attempts.length >= 2, 'The browser did not retry the create')
  for (const attempt of attempts.slice(1)) assert.deepEqual(attempt, attempts[0])
  const [created] = await sql`select count(*)::integer as n from app_private.project_operations
    where actor_user_id = ${owner.id} and operation_id = ${attempts[0].operationId}`
  assert.equal(created.n, 1)
  console.log('PASS P1-05 — replay after a lost create response returned the same project')

  await page.goto(origin + editorPath)
  await width(page).waitFor()
  await page.getByRole('button', { name: 'งานของฉัน', exact: true }).click()
  await page.waitForURL(origin + '/app/projects')
  await projectRow(page, name).click()
  await page.waitForURL(origin + editorPath)
  await width(page).waitFor()
  await context.setOffline(true)
  await width(page).fill('92')
  await width(page).press('Tab')
  await page.getByText(/ออฟไลน์ · เก็บ draft แล้ว/).waitFor()
  await eventually(() => page.evaluate(async id => {
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open('gen-package-cloud-v1')
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    try {
      const drafts = await new Promise((resolve, reject) => {
        const read = db.transaction('project-drafts').objectStore('project-drafts').getAll()
        read.onsuccess = () => resolve(read.result)
        read.onerror = () => reject(read.error)
      })
      return drafts.some(draft => draft.projectId === id && draft.latestDraft.project.live.W === 92)
    } finally {
      db.close()
    }
  }, projectId), 'The offline edit was not persisted in IndexedDB')
  assert.equal((await request('/projects/' + projectId, owner)).data.document.live.W, 80)
  await page.getByRole('button', { name: 'งานของฉัน', exact: true }).click()
  await page.waitForURL(origin + '/app/projects')
  await page.getByText('งานที่เก็บร่างไว้ในแท็บนี้', { exact: true }).waitFor()
  await projectRow(page, name).click()
  await page.waitForURL(origin + editorPath)
  await width(page).waitFor()
  assert.equal(await width(page).inputValue(), '92')
  const saveUrl = origin + '/api/v1/projects/' + projectId
  const failSave = route => route.request().method() === 'PUT' ? route.abort('failed') : route.continue()
  await page.route(saveUrl, failSave)
  await context.setOffline(false)
  await page.reload()
  await width(page).waitFor()
  assert.equal(await width(page).inputValue(), '92')
  await page.getByText('บันทึกไม่สำเร็จ', { exact: true }).waitFor()
  assert.equal((await request('/projects/' + projectId, owner)).data.document.live.W, 80)
  await page.unroute(saveUrl, failSave)
  await page.getByRole('button', { name: 'ลองอีกครั้ง', exact: true }).click()
  await eventually(async () => (await request('/projects/' + projectId, owner)).data.document.live.W === 92,
    'The browser draft did not reach PostgreSQL after reconnect')
  console.log('PASS P1-06 — reopened the offline draft from the gallery, then retried a failed save after reload')

  // Logout from the actual app in the same browser tab before loading the next account.
  await page.getByRole('button', { name: 'ออกจากระบบ', exact: true }).click()
  await page.waitForURL(url => url.pathname === '/login')
  await signIn(page, viewer)
  await page.waitForURL(origin + '/app/projects')
  await page.getByLabel('พื้นที่งาน').selectOption(team.id)
  await projectRow(page, name).waitFor()
  assert(await page.getByRole('button', { name: 'สร้างงานใหม่', exact: true }).isDisabled())
  const viewerWrites = []
  page.on('request', request => {
    if (/\/api\/v1\/(projects|assets|ai)\b/.test(request.url())
      && request.method() !== 'GET' && !request.url().endsWith('/projects/thumbnails')) {
      viewerWrites.push(request.method())
    }
  })
  await projectRow(page, name).click()
  await page.getByText(/พื้นที่งานนี้คุณดูได้อย่างเดียว/).waitFor()
  for (const version of ['V1', 'V2']) {
    await page.getByRole('button', { name: version, exact: true }).click()
    await page.getByRole('tab', { name: 'ดู 3D', exact: true }).click()
    await page.locator('canvas').first().waitFor()
    await page.getByRole('tab', { name: 'แผ่นคลี่', exact: true }).click()
    await page.locator('.blueprint').first().waitFor()
    assert.equal(await page.getByRole('button', { name: 'สร้างงาน', exact: true }).count(), 0)
    assert.equal(await page.getByRole('tab', { name: 'ตกแต่ง', exact: true }).count(), 0)
    assert.equal(await width(page).count(), 0)
    await page.keyboard.press('Control+z')
  }
  assert.deepEqual(viewerWrites, [])
  await page.goto(origin + '/editor/new')
  await page.getByText('สร้างงานไม่ได้', { exact: true }).waitFor()
  console.log('PASS P1-08 — viewer can open and inspect, but cannot create or edit in V1/V2')

  await page.goto(origin + '/app/projects')
  await page.getByRole('button', { name: 'ออกจากระบบ', exact: true }).click()
  await page.waitForURL(url => url.pathname === '/login')
  await signIn(page, outsider)
  await page.waitForURL(origin + '/app/projects')
  assert.equal(await projectRow(page, name).count(), 0)
  assert.equal(await page.getByLabel('พื้นที่งาน').count(), 0)
  await page.goto(origin + editorPath)
  await page.getByText('ไม่พบงานนี้ หรือคุณไม่มีสิทธิ์เปิด', { exact: true }).waitFor()
  assert.equal(await editorTab(page).count(), 0)
  console.log('PASS P1-08/P1-09 — logout and same-tab outsider sign-in hid the team and denied its direct link')

  const editorContext = await browser.newContext({ locale: 'th-TH' })
  const editorPage = await pageFor(editorContext)
  await editorPage.goto(origin + editorPath)
  await editorPage.waitForURL(url => url.pathname === '/login')
  await signIn(editorPage, editor)
  await editorTab(editorPage).waitFor()
  await width(editorPage).fill('96')
  await width(editorPage).press('Tab')
  await eventually(async () => (await request('/projects/' + projectId, editor)).data.document.live.W === 96,
    'Authorized editor could not save the same project')
  await editorPage.getByText('บันทึกแล้ว', { exact: true }).waitFor()
  await sql`update app_private.workspace_members set role = 'viewer'
    where workspace_id = ${team.id} and user_id = ${editor.id}`
  await width(editorPage).fill('97')
  await width(editorPage).press('Tab')
  await editorPage.getByText(/พื้นที่งานนี้คุณดูได้อย่างเดียว/).waitFor()
  assert.equal(await width(editorPage).count(), 0)
  const afterDemotion = await request('/projects/' + projectId, editor)
  assert.equal(afterDemotion.status, 200)
  assert.equal(afterDemotion.data.document.live.W, 96)
  assert.deepEqual(browserErrors, [])
  console.log('PASS P1-08 — editor saved; a rejected write after demotion switched the UI to viewer')
} finally {
  try {
    await browser?.close()
    vite?.kill()
    await cleanup()
  } finally {
    await sql.end()
  }
}
