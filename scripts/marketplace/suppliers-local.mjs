// Local Phase 2 acceptance. Pass a dedicated Supabase workdir with TOTP enabled.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'

const workdir = process.argv[2]
assert(workdir, 'Pass the workdir of the isolated PackIt Phase 2 Supabase stack')
const config = readFileSync(resolve(workdir, 'supabase/config.toml'), 'utf8')
assert.match(config, /^project_id\s*=\s*"packit-marketplace-phase2-local"/m)
const cli = resolve('node_modules/supabase/dist/supabase.js')
const status = spawnSync(process.execPath, [cli, 'status', '-o', 'json', '--workdir', workdir], { encoding: 'utf8' })
assert.equal(status.status, 0, 'Start the isolated PackIt Phase 2 Supabase stack first')
const local = JSON.parse(status.stdout)
for (const value of [local.API_URL, local.DB_URL]) assert.equal(new URL(value).hostname, '127.0.0.1')
const origin = 'http://127.0.0.1:52476'
const auth = { persistSession: false, autoRefreshToken: false }
const admin = createClient(local.API_URL, local.SECRET_KEY, { auth })
const sql = postgres(local.DB_URL, { max: 4 })
const authIds = []
let vite

async function request(path, { actor, method = 'GET', body, expectStatus = 200, code } = {}) {
  const response = await fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      ...(actor ? { authorization: `Bearer ${actor.token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  })
  assert.match(response.headers.get('content-type') ?? '', /^application\/json/)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const payload = await response.json()
  assert.equal(response.status, expectStatus, `${method} ${path.split('?')[0]} returned ${payload.error?.code ?? 'success'}`)
  if (code) assert.equal(payload.error?.code, code)
  return payload
}

async function account(label) {
  const email = `phase2-${label}-${randomUUID()}@example.test`
  const password = `Local-${randomUUID()}!aA1`
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  assert(created.data.user && !created.error, 'Could not create synthetic account')
  authIds.push(created.data.user.id)
  const client = createClient(local.API_URL, local.PUBLISHABLE_KEY, { auth })
  const signIn = await client.auth.signInWithPassword({ email, password })
  assert(signIn.data.session && !signIn.error, 'Could not sign in synthetic account')
  const actor = { client, token: signIn.data.session.access_token }
  const session = await request('/session/bootstrap', { actor, method: 'POST', body: {} })
  return { ...actor, id: session.data.user.id }
}

function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const bits = Array.from(secret.replace(/=+$/, ''), (letter) => alphabet.indexOf(letter).toString(2).padStart(5, '0')).join('')
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((octet) => parseInt(octet, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const hash = createHmac('sha1', key).update(counter).digest()
  const offset = hash.at(-1) & 15
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0')
}

async function verifyMfa(actor) {
  const enrolled = await actor.client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Local acceptance' })
  assert(enrolled.data?.type === 'totp' && !enrolled.error, 'Enable TOTP in the isolated local test config')
  const verified = await actor.client.auth.mfa.challengeAndVerify({ factorId: enrolled.data.id, code: totp(enrolled.data.totp.secret) })
  assert(verified.data?.access_token && !verified.error, 'Local TOTP challenge failed')
  return { ...actor, token: verified.data.access_token }
}

async function cleanup() {
  if (!authIds.length) return
  await sql.begin(async (tx) => {
    const users = await tx`select app_user_id as id from app_private.auth_identities where subject in ${tx(authIds)}`
    const ids = users.map((row) => row.id)
    if (!ids.length) return
    const workspaces = await tx`select id from app_private.workspaces where owner_user_id in ${tx(ids)}`
    const spaces = workspaces.map((row) => row.id)
    if (spaces.length) {
      const suppliers = await tx`select id from app_private.supplier_profiles where workspace_id in ${tx(spaces)}`
      const supplierIds = suppliers.map((row) => row.id)
      if (supplierIds.length) {
        await tx`delete from app_private.notification_outbox where event_id in (
          select id from app_private.activity_events where supplier_id in ${tx(supplierIds)})`
        await tx`delete from app_private.activity_events where supplier_id in ${tx(supplierIds)}`
        await tx`delete from app_private.supplier_create_operations where supplier_id in ${tx(supplierIds)}`
        await tx`delete from app_private.supplier_profiles where id in ${tx(supplierIds)}`
      }
      await tx`delete from app_private.credit_balances where workspace_id in ${tx(spaces)}`
      await tx`delete from app_private.workspace_members where workspace_id in ${tx(spaces)}`
      await tx`delete from app_private.workspaces where id in ${tx(spaces)}`
    }
    await tx`delete from app_private.platform_staff where user_id in ${tx(ids)}`
    await tx`delete from app_private.auth_identities where app_user_id in ${tx(ids)}`
    await tx`delete from app_private.app_users where id in ${tx(ids)}`
  })
  for (const id of authIds) {
    const deleted = await admin.auth.admin.deleteUser(id)
    assert(!deleted.error, 'Could not clean up synthetic Auth account')
  }
}

try {
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '52476', '--strictPort'], {
    env: {
      ...process.env,
      NODE_ENV: 'development', APP_ENV: 'test', APP_ALLOWED_ORIGINS: origin, ANTHROPIC_API_KEY: '',
      VITE_APP_MODE: 'cloud', VITE_API_BASE_URL: '/api/v1', VITE_SUPABASE_URL: local.API_URL,
      VITE_MARKETPLACE_SUPPLIERS_ENABLED: 'true',
      VITE_SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY, SUPABASE_URL: local.API_URL, SUPABASE_SECRET_KEY: local.SECRET_KEY,
    },
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Local API startup timed out')), 20000)
    vite.stdout.on('data', (chunk) => {
      if (chunk.toString().includes(origin)) { clearTimeout(timeout); resolve() }
    })
    vite.once('exit', () => { clearTimeout(timeout); reject(new Error('Local API failed to start')) })
    vite.once('error', (error) => { clearTimeout(timeout); reject(error) })
  })
  const manager = await account('manager')
  const reviewer = await account('reviewer')
  const viewer = await account('viewer')
  const slug = `local-print-shop-${randomUUID()}`
  const profile = {
    kind: 'print_shop', name: 'Local Print Shop', slug, description: 'Local acceptance fixture',
    contactEmail: 'private@example.test', capabilities: ['digital_printing', 'lamination'],
  }
  const create = { actor: manager, method: 'POST', body: { ...profile, operationId: randomUUID() }, expectStatus: 201 }
  const [first, retry] = await Promise.all([request('/suppliers', create), request('/suppliers', create)])
  assert.deepEqual(retry.data, first.data)
  const { id, workspaceId } = first.data.profile
  const supplier = `/suppliers/${id}`
  const published = `/suppliers/public/${slug}`
  assert.equal(first.data.role, 'manager')
  assert.equal(first.data.profile.status, 'draft')
  await request('/suppliers', { ...create, body: { ...create.body, name: 'Different intent' }, expectStatus: 409, code: 'IDEMPOTENCY_KEY_REUSED' })
  await request(published, { expectStatus: 404, code: 'NOT_FOUND' })
  await sql`insert into app_private.workspace_members(workspace_id,user_id,role) values (${workspaceId},${viewer.id},'viewer')`
  await request(supplier, { actor: viewer, expectStatus: 404, code: 'NOT_FOUND' })
  await sql`insert into app_private.workspace_marketplace_members(workspace_id,user_id,role) values (${workspaceId},${viewer.id},'viewer')`
  assert.equal((await request(supplier, { actor: viewer })).data.role, 'viewer')
  await request(`${supplier}/submit`, { actor: viewer, method: 'POST', body: { expectedRevision: 1 }, expectStatus: 403 })
  await sql`delete from app_private.workspace_members where workspace_id=${workspaceId} and user_id=${viewer.id}`
  await request(supplier, { actor: viewer, expectStatus: 404, code: 'NOT_FOUND' })
  console.log('PASS concurrent onboarding, private drafts and independent workspace membership')

  const pending = await request(`${supplier}/submit`, { actor: manager, method: 'POST', body: { expectedRevision: 1 } })
  assert.equal(pending.data.profile.status, 'pending')
  await request(published, { expectStatus: 404, code: 'NOT_FOUND' })
  await sql`insert into app_private.platform_staff(user_id,role) values (${reviewer.id},'supplier_reviewer')`
  assert.deepEqual((await request('/marketplace/context', { actor: reviewer })).data.staff, { canReviewSuppliers: true, requiresMfa: true })
  await request('/admin/suppliers', { actor: reviewer, expectStatus: 403, code: 'MARKETPLACE_MFA_REQUIRED' })
  const verifiedManager = await verifyMfa(manager)
  await request('/admin/suppliers', { actor: verifiedManager, expectStatus: 403, code: 'MARKETPLACE_FORBIDDEN' })
  const verifiedReviewer = await verifyMfa(reviewer)
  assert.deepEqual((await request('/marketplace/context', { actor: verifiedReviewer })).data.staff, { canReviewSuppliers: true, requiresMfa: false })
  const queue = await request('/admin/suppliers?status=pending', { actor: verifiedReviewer })
  assert(queue.data.items.some((item) => item.id === id && item.revision === 2))
  console.log('PASS separate reviewer grant, real TOTP and pending queue')

  const review = (action, expectedRevision, expectStatus = 200, code) => request(`/admin/suppliers/${id}/review`, {
    actor: verifiedReviewer, method: 'POST', body: { expectedRevision, action, reason: 'Local review evidence' }, expectStatus, code,
  })
  const stale = await review('approve', 1, 409, 'REVISION_CONFLICT')
  assert.equal(stale.error.details.currentRevision, 2)
  assert.equal((await review('approve', 2)).data.status, 'approved')
  const publicData = (await request(published)).data
  assert.deepEqual(Object.keys(publicData).sort(), ['capabilities', 'description', 'id', 'kind', 'name', 'slug'])
  assert.equal((await review('suspend', 3)).data.status, 'suspended')
  await request(published, { expectStatus: 404, code: 'NOT_FOUND' })
  assert.equal((await review('resume', 4)).data.status, 'approved')
  const changed = await request(supplier, { actor: manager, method: 'PUT', body: { ...profile, name: 'Revised Print Shop', expectedRevision: 5 } })
  assert.equal(changed.data.profile.status, 'draft')
  await request(published, { expectStatus: 404, code: 'NOT_FOUND' })
  const history = await sql`select activity.action, outbox.audience
    from app_private.activity_events activity join app_private.notification_outbox outbox on outbox.event_id=activity.id
    where activity.supplier_id=${id} order by activity.revision`
  assert.deepEqual(history.map((row) => row.action), ['created', 'submitted', 'approve', 'suspend', 'resume', 'reopened'])
  console.log('PASS revision checks, publish/suspend/resume, private fields and atomic audit/outbox')
} finally {
  vite?.kill()
  try { await cleanup() } finally { await sql.end() }
}
