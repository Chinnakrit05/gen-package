import { randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright-core'
import postgres from 'postgres'

const APP_ORIGIN = 'http://127.0.0.1:5174'
const CHROME_PATH = process.env.PACKIT_E2E_CHROME
  ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const status = readLocalStatus()
const sql = postgres(status.DB_URL, { max: 4, idle_timeout: 2 })
const admin = createClient(status.API_URL, status.SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
let authUserId = null
let appUserId = null
let secondAuthUserId = null
let secondAppUserId = null
let browser = null
let server = null

try {
  const email = `browser-${randomUUID()}@example.test`
  const password = `Local-${randomUUID()}!aA1`
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'Browser E2E' },
  })
  if (created.error || !created.data.user) throw created.error ?? new Error('create auth user failed')
  authUserId = created.data.user.id

  const publicClient = createClient(status.API_URL, status.PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const signedIn = await publicClient.auth.signInWithPassword({ email, password })
  if (signedIn.error || !signedIn.data.session) throw signedIn.error ?? new Error('sign in failed')

  server = startVite(status)
  await waitForHttp(`${APP_ORIGIN}/api/v1/health`)

  browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true })
  const context = await browser.newContext()
  const legacyRaw = JSON.stringify({
    projects: [{
      id: 'legacy-browser-project',
      name: 'งานเดิมจาก browser',
      updatedAt: Date.now(),
      live: { template: 'tuck-end', materialId: 'carton-300', W: 88, D: 52, H: 122, handle: false },
      qty: 700,
      fillColor: '#ffffff',
      decos: [],
      history: [],
      histIdx: -1,
    }],
    activeId: 'legacy-browser-project',
    showDims: true,
  })
  await context.addInitScript(({ session, legacy }) => {
    if (!localStorage.getItem('sb-127-auth-token')) {
      localStorage.setItem('sb-127-auth-token', JSON.stringify(session))
    }
    if (!localStorage.getItem('gen-package-projects-v1')) {
      localStorage.setItem('gen-package-projects-v1', legacy)
    }
  }, { session: signedIn.data.session, legacy: legacyRaw })

  const page = await context.newPage()
  const browserErrors = []
  page.on('pageerror', (error) => browserErrors.push(error.stack ?? String(error)))
  await page.goto(APP_ORIGIN, { waitUntil: 'networkidle' })
  try {
    await page.getByRole('dialog', { name: 'ย้ายงานเดิมขึ้น Cloud' }).waitFor({ state: 'visible', timeout: 15_000 })
  } catch (error) {
    const body = (await page.locator('body').innerText()).slice(0, 1_500)
    throw new Error(`legacy migration dialog did not appear; page showed: ${body}`, { cause: error })
  }
  await page.getByRole('button', { name: 'ย้ายขึ้น Cloud' }).click()
  await page.getByText(/ย้ายสำเร็จ 1 งาน/).waitFor({ state: 'visible', timeout: 30_000 })

  appUserId = await waitForValue(async () => {
    const rows = await sql`select app_user_id from app_private.auth_identities where subject = ${authUserId}`
    return rows[0]?.app_user_id ?? null
  })
  const rawBackedUp = await page.evaluate(async (expectedRaw) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('gen-package-legacy-migrations-v1')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const journals = await new Promise((resolve, reject) => {
      const request = database.transaction('migration-journals', 'readonly').objectStore('migration-journals').getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    database.close()
    return journals.some((journal) => journal.rawBackups.some((backup) => backup.raw === expectedRaw))
  }, legacyRaw)
  assert(rawBackedUp, 'legacy raw backup was not persisted before migration')
  await page.getByRole('dialog', { name: 'ย้ายงานเดิมขึ้น Cloud' })
    .getByRole('button', { name: 'ปิด', exact: true }).click()

  await page.getByRole('tab', { name: 'ตกแต่ง' }).click()
  await page.getByRole('button', { name: 'ไลบรารีลาย' }).click()
  await page.getByRole('button', { name: 'เพิ่ม ดาว' }).click()
  const initialPresetDocument = await waitForProjectDocument(sql, appUserId, (document) => (
    document.decos?.some((deco) => deco.preset === 'icon-star' && typeof deco.assetId === 'string' && !('src' in deco))
  ))
  await assertPersistedPresetAsset(sql, appUserId, initialPresetDocument, 'icon-star')
  await page.getByText('บันทึกแล้ว', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })

  const colorInputs = page.locator('input[aria-label="สีลาย"]')
  const colorCount = await colorInputs.count()
  assert(colorCount >= 2, 'selected preset color control was not rendered')
  await colorInputs.nth(colorCount - 1).fill('#cc3366')
  const recoloredPresetDocument = await waitForProjectDocument(sql, appUserId, (document) => (
    document.decos?.some((deco) => deco.preset === 'icon-star' && deco.presetColor === '#cc3366')
  ))
  await assertPersistedPresetAsset(sql, appUserId, recoloredPresetDocument, 'icon-star')

  const [countsBeforeReload] = await sql`
    select
      (select count(*)::integer from app_private.projects where created_by = ${appUserId} and deleted_at is null) as projects,
      (select count(*)::integer from app_private.legacy_imports where user_id = ${appUserId}) as imports
  `
  assert(countsBeforeReload.projects === 2 && countsBeforeReload.imports === 1, 'legacy import did not deduplicate as expected')
  await page.reload({ waitUntil: 'networkidle' })
  assert(await page.getByRole('dialog', { name: 'ย้ายงานเดิมขึ้น Cloud' }).count() === 0, 'completed migration reopened')
  await page.getByRole('tab', { name: 'ตกแต่ง' }).click()
  await page.getByRole('button', { name: 'รูป', exact: true }).waitFor({ state: 'visible' })

  const secondPage = await context.newPage()
  secondPage.on('pageerror', (error) => browserErrors.push(error.stack ?? String(error)))
  await secondPage.goto(APP_ORIGIN, { waitUntil: 'networkidle' })
  await secondPage.getByRole('tab', { name: 'ออกแบบ' }).click()
  await page.getByRole('tab', { name: 'ออกแบบ' }).click()
  const firstWidth = page.getByLabel('กว้าง W').first()
  await firstWidth.fill('91')
  await waitForProjectDocument(sql, appUserId, (document) => document.live?.W === 91)
  await waitForInputValue(secondPage.getByLabel('กว้าง W').first(), '91')

  let releaseSecondSave
  let secondSaveIntercepted = false
  let secondSaveStatus = null
  const secondSaveGate = new Promise((resolve) => { releaseSecondSave = resolve })
  const secondSaveRoute = async (route) => {
    if (!secondSaveIntercepted && route.request().method() === 'PUT') {
      secondSaveIntercepted = true
      await secondSaveGate
      const response = await route.fetch()
      secondSaveStatus = response.status()
      await route.fulfill({ response })
      return
    }
    await route.continue()
  }
  await secondPage.route('**/api/v1/projects/*', secondSaveRoute)
  const secondWidth = secondPage.getByLabel('กว้าง W').first()
  await secondWidth.fill('93')
  await waitForValue(() => secondSaveIntercepted ? true : null)
  await firstWidth.fill('94')
  await waitForProjectDocument(sql, appUserId, (document) => document.live?.W === 94)
  await secondPage.getByText('มีการแก้ไขจากอีกแท็บ', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
  releaseSecondSave()
  await waitForValue(() => secondSaveStatus === 409 ? true : null)
  await secondPage.unroute('**/api/v1/projects/*', secondSaveRoute)
  secondPage.once('dialog', (dialog) => void dialog.accept())
  await secondPage.getByRole('button', { name: 'โหลดล่าสุด' }).click()
  await waitForInputValue(secondWidth, '94')
  await secondPage.getByText('บันทึกแล้ว', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })

  await context.setOffline(true)
  await page.getByText(/ออฟไลน์/).waitFor({ state: 'visible' })
  assert(await page.getByRole('button', { name: '+ งานใหม่' }).isDisabled(), 'offline create button remained enabled')
  const deleteButtons = page.getByRole('button', { name: /^ลบงาน / })
  assert(await deleteButtons.count() > 0, 'project delete controls were not rendered')
  assert(await deleteButtons.evaluateAll((buttons) => buttons.every((button) => button.disabled)), 'offline delete remained enabled')

  await page.getByRole('tab', { name: 'ตกแต่ง' }).click()
  const addArtwork = page.getByRole('button', { name: 'เพิ่มองค์ประกอบ' })
  if (await addArtwork.getAttribute('aria-expanded') !== 'true') await addArtwork.click()
  const cloudImageInputs = page.locator('input[type="file"][accept="image/png,image/jpeg"]')
  assert(await cloudImageInputs.count() > 0, 'cloud image upload controls were not rendered')
  assert(await cloudImageInputs.evaluateAll((inputs) => inputs.every((input) => input.disabled)), 'offline image upload remained enabled')

  await page.getByRole('tab', { name: 'ส่งออก' }).click()
  const backupGroup = page.getByRole('button', { name: 'สำรอง / ย้ายงาน' })
  if (await backupGroup.getAttribute('aria-expanded') !== 'true') await backupGroup.click()
  assert(
    await page.locator('input[type="file"][accept*="application/json"]').isDisabled(),
    'offline portable import remained enabled',
  )
  await page.getByRole('tab', { name: 'ออกแบบ' }).click()
  await firstWidth.fill('92')
  await context.setOffline(false)
  await waitForProjectDocument(sql, appUserId, (document) => document.live?.W === 92)
  await page.getByText('บันทึกแล้ว', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })

  await page.getByRole('tab', { name: 'ส่งออก' }).click()
  const portableBackupGroup = page.getByRole('button', { name: 'สำรอง / ย้ายงาน' })
  if (await portableBackupGroup.getAttribute('aria-expanded') !== 'true') await portableBackupGroup.click()
  await page.evaluate(() => {
    const createObjectURL = URL.createObjectURL.bind(URL)
    URL.createObjectURL = (blob) => {
      window.__packitPortableExport = blob
      return createObjectURL(blob)
    }
  })
  await page.getByRole('button', { name: /ส่งออกงานนี้/ }).click()
  const portableText = await waitForValue(() => page.evaluate(async () => (
    window.__packitPortableExport ? window.__packitPortableExport.text() : null
  )))
  const portable = JSON.parse(portableText)
  const portableRaw = JSON.stringify(portable)
  assert(portableRaw.includes('data:image/png;base64,'), 'portable export did not hydrate the preset image')
  assert(!portableRaw.includes('"assetId"'), 'portable export leaked cloud asset references')
  await page.locator('input[type="file"][accept*="application/json"]').setInputFiles({
    name: 'browser-roundtrip.genpkg.json',
    mimeType: 'application/json',
    buffer: Buffer.from(portableText),
  })
  await waitForValue(async () => {
    const rows = await sql`select count(*)::integer as count from app_private.projects
      where created_by = ${appUserId} and deleted_at is null`
    return rows[0]?.count === 3 ? true : null
  })
  await page.getByText('บันทึกแล้ว', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })

  const [countsAfterReload] = await sql`
    select
      (select count(*)::integer from app_private.projects where created_by = ${appUserId} and deleted_at is null) as projects,
      (select count(*)::integer from app_private.legacy_imports where user_id = ${appUserId}) as imports
  `
  assert(countsAfterReload.projects === 3 && countsAfterReload.imports === 1, 'reload/reconnect or portable import produced unexpected projects')

  const secondEmail = `browser-second-${randomUUID()}@example.test`
  const secondPassword = `Local-${randomUUID()}!aA1`
  const secondCreated = await admin.auth.admin.createUser({
    email: secondEmail,
    password: secondPassword,
    email_confirm: true,
    user_metadata: { full_name: 'Browser E2E second account' },
  })
  if (secondCreated.error || !secondCreated.data.user) throw secondCreated.error ?? new Error('create second auth user failed')
  secondAuthUserId = secondCreated.data.user.id
  const secondSignedIn = await publicClient.auth.signInWithPassword({ email: secondEmail, password: secondPassword })
  if (secondSignedIn.error || !secondSignedIn.data.session) throw secondSignedIn.error ?? new Error('second sign in failed')
  await page.evaluate((session) => {
    localStorage.removeItem('gen-package-projects-v1')
    localStorage.setItem('sb-127-auth-token', JSON.stringify(session))
  }, secondSignedIn.data.session)
  await page.reload({ waitUntil: 'networkidle' })
  secondAppUserId = await waitForValue(async () => {
    const rows = await sql`select app_user_id from app_private.auth_identities where subject = ${secondAuthUserId}`
    return rows[0]?.app_user_id ?? null
  })
  assert(secondAppUserId !== appUserId, 'account switch reused the first app user')
  assert(await page.getByText('งานเดิมจาก browser', { exact: true }).count() === 0, 'second account saw the first account project')

  await page.evaluate((session) => {
    localStorage.setItem('sb-127-auth-token', JSON.stringify(session))
  }, signedIn.data.session)
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('tab', { name: 'ออกแบบ' }).click()
  await waitForInputValue(page.getByLabel('กว้าง W').first(), '92')

  const durableName = `Durable replay ${randomUUID().slice(0, 8)}`
  let createResponseDropped = false
  const createRoute = async (route) => {
    if (!createResponseDropped && route.request().method() === 'POST') {
      const response = await route.fetch()
      assert(response.ok(), `durable create setup failed with ${response.status()}`)
      createResponseDropped = true
      await route.abort('failed')
      return
    }
    await route.continue()
  }
  await page.route(`${APP_ORIGIN}/api/v1/projects`, createRoute)
  const createAlert = page.waitForEvent('dialog')
  await page.getByRole('button', { name: '+ งานใหม่' }).click()
  const nameDialog = page.getByRole('dialog', { name: 'ตั้งชื่องานใหม่' })
  await nameDialog.getByLabel('ตั้งชื่องานใหม่').fill(durableName)
  await nameDialog.getByRole('button', { name: 'ตกลง' }).click()
  const createFailureDialog = await createAlert
  assert(createFailureDialog.type() === 'alert', 'lost create response did not surface an alert')
  await createFailureDialog.accept()
  await waitForValue(() => createResponseDropped ? true : null)
  await page.unroute(`${APP_ORIGIN}/api/v1/projects`, createRoute)

  const durableProjectId = await waitForValue(async () => {
    const rows = await sql`select id from app_private.projects
      where created_by = ${appUserId} and name = ${durableName}`
    return rows[0]?.id ?? null
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: durableName, exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
  const [createReplayEvidence] = await sql`
    select
      (select count(*)::integer from app_private.projects where id = ${durableProjectId}) as projects,
      (select count(*)::integer from app_private.project_operations
        where project_id = ${durableProjectId} and operation_type = 'create') as operations
  `
  assert(createReplayEvidence.projects === 1 && createReplayEvidence.operations === 1, 'durable create replay duplicated data')

  await page.getByRole('button', { name: durableName, exact: true }).click()
  let deleteResponseDropped = false
  const deleteRouteUrl = `${APP_ORIGIN}/api/v1/projects/${durableProjectId}`
  const deleteRoute = async (route) => {
    if (!deleteResponseDropped && route.request().method() === 'DELETE') {
      const response = await route.fetch()
      assert(response.ok(), `durable delete setup failed with ${response.status()}`)
      deleteResponseDropped = true
      await route.abort('failed')
      return
    }
    await route.continue()
  }
  await page.route(deleteRouteUrl, deleteRoute)
  const deleteDialogs = []
  const acceptDeleteDialogs = (dialog) => {
    deleteDialogs.push({ type: dialog.type(), message: dialog.message() })
    void dialog.accept()
  }
  page.on('dialog', acceptDeleteDialogs)
  await page.getByRole('button', { name: `ลบงาน ${durableName}` }).click()
  await waitForValue(() => deleteResponseDropped && deleteDialogs.some((dialog) => dialog.type === 'alert') ? true : null)
  page.off('dialog', acceptDeleteDialogs)
  await page.unroute(deleteRouteUrl, deleteRoute)
  await page.reload({ waitUntil: 'networkidle' })
  await waitForValue(async () => (
    await page.getByRole('button', { name: durableName, exact: true }).count()
  ) === 0 ? true : null)
  const [deleteReplayEvidence] = await sql`
    select
      (select count(*)::integer from app_private.projects
        where id = ${durableProjectId} and deleted_at is not null) as deleted_projects,
      (select count(*)::integer from app_private.project_operations
        where project_id = ${durableProjectId} and operation_type = 'delete') as operations
  `
  assert(deleteReplayEvidence.deleted_projects === 1 && deleteReplayEvidence.operations === 1, 'durable delete replay duplicated data')
  const pendingMutations = await countPendingMutations(page, appUserId)
  assert(pendingMutations === 0, 'durable create/delete journal did not clear after replay')
  assert(browserErrors.length === 0, `browser page errors: ${browserErrors.join(' | ')}`)

  await context.close()
  process.stdout.write('Local cloud browser E2E: PASS\n')
  process.stdout.write('Verified auth/account isolation, legacy migration, portable assets, cross-tab conflict, offline restrictions/reconnect, and lost-response mutation replay.\n')
} finally {
  await browser?.close().catch(() => undefined)
  if (server) stopProcess(server)
  if (!secondAppUserId && secondAuthUserId) {
    const rows = await sql`select app_user_id from app_private.auth_identities where subject = ${secondAuthUserId}`.catch(() => [])
    secondAppUserId = rows[0]?.app_user_id ?? null
  }
  if (!appUserId && authUserId) {
    const rows = await sql`select app_user_id from app_private.auth_identities where subject = ${authUserId}`.catch(() => [])
    appUserId = rows[0]?.app_user_id ?? null
  }
  if (secondAppUserId) await cleanupAppData(secondAppUserId).catch(() => undefined)
  if (appUserId) await cleanupAppData(appUserId).catch(() => undefined)
  if (secondAuthUserId) await admin.auth.admin.deleteUser(secondAuthUserId).catch(() => undefined)
  if (authUserId) await admin.auth.admin.deleteUser(authUserId).catch(() => undefined)
  await sql.end({ timeout: 1 }).catch(() => undefined)
}

function readLocalStatus() {
  const cli = path.resolve('node_modules', 'supabase', 'dist', 'supabase.js')
  const result = spawnSync(process.execPath, [cli, 'status', '-o', 'json'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error('Local Supabase stack is not running')
  return JSON.parse(result.stdout)
}

function startVite(localStatus) {
  const vite = path.resolve('node_modules', 'vite', 'bin', 'vite.js')
  return spawn(process.execPath, [vite, '--host', '127.0.0.1', '--port', '5174', '--strictPort'], {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      VITE_APP_MODE: 'cloud',
      VITE_API_BASE_URL: '/api/v1',
      VITE_SUPABASE_URL: localStatus.API_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: localStatus.PUBLISHABLE_KEY,
      APP_ENV: 'development',
      APP_ALLOWED_ORIGINS: APP_ORIGIN,
      SUPABASE_URL: localStatus.API_URL,
      SUPABASE_SECRET_KEY: localStatus.SECRET_KEY,
    },
  })
}

async function waitForHttp(url) {
  await waitForValue(async () => {
    try {
      const response = await fetch(url)
      return response.ok ? true : null
    } catch {
      return null
    }
  }, 20_000)
}

async function waitForProjectDocument(database, userId, predicate) {
  return waitForValue(async () => {
    const rows = await database`
      select document from app_private.projects
      where created_by = ${userId} and deleted_at is null
      order by updated_at desc, id desc
    `
    return rows.find((row) => predicate(row.document))?.document ?? null
  }, 30_000)
}

async function assertPersistedPresetAsset(database, userId, document, presetId) {
  const deco = document.decos?.find((candidate) => candidate.preset === presetId)
  assert(typeof deco?.assetId === 'string', `${presetId} document did not contain an asset ID`)
  const rows = await database`
    select state, mime_type, width, height, sha256,
      exists(select 1 from app_private.project_assets where asset_id = assets.id) as referenced
    from app_private.assets
    where id = ${deco.assetId} and created_by = ${userId}
  `
  const asset = rows[0]
  assert(asset?.state === 'ready', `${presetId} asset was not ready`)
  assert(asset.mime_type === 'image/png', `${presetId} asset was not persisted as PNG`)
  assert(asset.width === 2048 && asset.height === 2048, `${presetId} asset dimensions were not 2048x2048`)
  assert(/^[0-9a-f]{64}$/.test(asset.sha256 ?? ''), `${presetId} asset did not have a SHA-256 digest`)
  assert(asset.referenced === true, `${presetId} asset was not linked through project_assets`)
}

async function countPendingMutations(page, userId) {
  return page.evaluate(async (appUserId) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('gen-package-project-mutations-v1')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const records = await new Promise((resolve, reject) => {
      const request = database.transaction('project-mutations', 'readonly').objectStore('project-mutations').getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    database.close()
    return records.filter((record) => record.scope?.appUserId === appUserId).length
  }, userId)
}

async function waitForInputValue(locator, expected) {
  await waitForValue(async () => (await locator.getAttribute('value')) === expected ? true : null, 20_000)
}

async function waitForValue(probe, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const value = await probe()
      if (value !== null && value !== undefined && value !== false) return value
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw lastError ?? new Error(`condition timed out after ${timeoutMs}ms`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function stopProcess(child) {
  if (!child.killed) child.kill()
}

async function cleanupAppData(userId) {
  const assets = await sql`select staging_key, object_key from app_private.assets where created_by = ${userId}`
  const staging = assets.map((asset) => asset.staging_key).filter(Boolean)
  const canonical = assets.map((asset) => asset.object_key).filter(Boolean)
  if (staging.length) await admin.storage.from('packit-staging').remove(staging)
  if (canonical.length) await admin.storage.from('packit-assets').remove(canonical)
  await sql.begin(async (tx) => {
    await tx`delete from app_private.legacy_imports where user_id = ${userId}`
    await tx`delete from app_private.project_assets where workspace_id in (
      select workspace_id from app_private.workspace_members where user_id = ${userId}
    )`
    await tx`delete from app_private.project_operations where actor_user_id = ${userId}`
    await tx`delete from app_private.projects where created_by = ${userId}`
    await tx`delete from app_private.asset_operations where actor_user_id = ${userId}`
    await tx`delete from app_private.storage_reservations where workspace_id in (
      select workspace_id from app_private.workspace_members where user_id = ${userId}
    )`
    await tx`delete from app_private.assets where created_by = ${userId}`
    await tx`delete from app_private.storage_usage where workspace_id in (
      select workspace_id from app_private.workspace_members where user_id = ${userId}
    )`
    await tx`delete from app_private.workspace_members where user_id = ${userId}`
    await tx`delete from app_private.workspaces where owner_user_id = ${userId}`
    await tx`delete from app_private.auth_identities where app_user_id = ${userId}`
    await tx`delete from app_private.app_users where id = ${userId}`
  })
}
