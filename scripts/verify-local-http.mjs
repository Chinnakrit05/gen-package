import { createPrivateKey, generateKeyPairSync, randomUUID, sign as signBytes } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'

const APP_ORIGIN = 'http://127.0.0.1:5175'
const status = readLocalStatus()
const localSigningKey = readLocalSigningKey()
const sql = postgres(status.DB_URL, { max: 2, idle_timeout: 2 })
const admin = createClient(status.API_URL, status.SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
let authUserId = null
let appUserId = null

try {
  const email = `http-parity-${randomUUID()}@example.test`
  const password = `Local-${randomUUID()}!aA1`
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error || !created.data.user) throw created.error ?? new Error('create auth user failed')
  authUserId = created.data.user.id

  const browserClient = createClient(status.API_URL, status.PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const signedIn = await browserClient.auth.signInWithPassword({ email, password })
  if (signedIn.error || !signedIn.data.session) throw signedIn.error ?? new Error('sign in failed')

  for (const mode of ['dev', 'preview']) {
    const server = startVite(mode)
    try {
      await waitForHttp(`${APP_ORIGIN}/api/v1/health`)
      const verifiedAppUserId = await verifyApiContract(mode, signedIn.data.session.access_token)
      appUserId ??= verifiedAppUserId
    } finally {
      await stopProcess(server)
    }
  }

  process.stdout.write('Local dev/preview HTTP parity: PASS\n')
  process.stdout.write('Verified JSON 401/404/405/410/413, expired/foreign bearer rejection, direct Data API denial, and request IDs.\n')
} finally {
  if (!appUserId && authUserId) {
    const rows = await sql`select app_user_id from app_private.auth_identities where subject = ${authUserId}`.catch(() => [])
    appUserId = rows[0]?.app_user_id ?? null
  }
  if (appUserId) await cleanupAppData(appUserId).catch(() => undefined)
  if (authUserId) await admin.auth.admin.deleteUser(authUserId).catch(() => undefined)
  await sql.end({ timeout: 1 }).catch(() => undefined)
}

async function verifyApiContract(mode, accessToken) {
  const request = (pathname, init = {}) => fetch(`${APP_ORIGIN}${pathname}`, {
    ...init,
    headers: { origin: APP_ORIGIN, ...init.headers },
  })

  await expectJson(request('/api/v1/health'), 200, (body) => body.data?.status === 'ok', `${mode} health`)

  const method = await request('/api/v1/health', { method: 'POST' })
  await expectJson(Promise.resolve(method), 405, (body) => body.error?.code === 'METHOD_NOT_ALLOWED', `${mode} method`)
  assert(method.headers.get('allow') === 'GET', `${mode} 405 response did not advertise Allow: GET`)

  await expectJson(
    request('/api/v1/not-a-route'),
    404,
    (body) => body.error?.code === 'NOT_FOUND',
    `${mode} unknown route`,
  )
  await expectJson(
    request('/api/v1/me'),
    401,
    (body) => body.error?.code === 'AUTH_REQUIRED',
    `${mode} missing bearer`,
  )
  const bootstrap = await expectJson(
    request('/api/v1/session/bootstrap', {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
    }),
    200,
    (body) => typeof body.data?.user?.id === 'string',
    `${mode} session bootstrap`,
  )
  const now = Math.floor(Date.now() / 1000)
  const expiredToken = resignJwt(accessToken, { iat: now - 3600, exp: now - 60 }, localSigningKey)
  const { privateKey: foreignSigningKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const foreignToken = resignJwt(
    accessToken,
    { iss: 'https://another-project.example/auth/v1' },
    foreignSigningKey,
  )
  for (const [label, token] of [['expired', expiredToken], ['foreign-project', foreignToken]]) {
    await expectJson(
      request('/api/v1/session/bootstrap', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
      401,
      (body) => body.error?.code === 'SESSION_INVALID',
      `${mode} ${label} bearer`,
    )
  }
  await expectDirectRpcDenied('anon', status.ANON_KEY, bootstrap.data.user.id)
  await expectDirectRpcDenied('authenticated', accessToken, bootstrap.data.user.id)
  await expectDirectTableHidden('anon', status.ANON_KEY)
  await expectDirectTableHidden('authenticated', accessToken)
  await expectJson(
    request('/api/v1/projects', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ padding: 'x'.repeat(1024 * 1024) }),
    }),
    413,
    (body) => body.error?.code === 'BODY_TOO_LARGE',
    `${mode} oversized JSON`,
  )
  const legacy = await request('/api/box-spec', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'test' }),
  })
  assert(legacy.status === 410, `${mode} legacy endpoint: expected 410, received ${legacy.status}`)
  assert(legacy.headers.get('content-type')?.includes('application/json'), `${mode} legacy endpoint was not JSON`)
  const legacyBody = await legacy.json()
  assert(typeof legacyBody.error === 'string', `${mode} legacy endpoint error missing`)
  return bootstrap.data.user.id
}

async function expectDirectRpcDenied(role, bearer, appUserId) {
  const response = await fetch(`${status.REST_URL}/rpc/get_me`, {
    method: 'POST',
    headers: {
      apikey: status.PUBLISHABLE_KEY,
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ p_actor_user_id: appUserId }),
  })
  assert([401, 403].includes(response.status), `direct Data API ${role} RPC unexpectedly returned ${response.status}`)
}

async function expectDirectTableHidden(role, bearer) {
  const response = await fetch(`${status.REST_URL}/projects?select=*`, {
    headers: {
      apikey: status.PUBLISHABLE_KEY,
      authorization: `Bearer ${bearer}`,
    },
  })
  assert(response.status === 404, `direct Data API ${role} table unexpectedly returned ${response.status}`)
}

function resignJwt(token, patch, privateKey) {
  const [encodedHeader, encodedPayload] = token.split('.')
  assert(encodedHeader && encodedPayload, 'local access token is not a JWT')
  const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'))
  assert(header.alg === 'ES256', `local JWT algorithm ${header.alg} is unsupported by this test`)
  const payload = {
    ...JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')),
    ...patch,
  }
  const nextPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signingInput = `${encodedHeader}.${nextPayload}`
  const signature = signBytes('sha256', Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url')
  return `${signingInput}.${signature}`
}

async function expectJson(responsePromise, expectedStatus, predicate, label) {
  const response = await responsePromise
  assert(response.status === expectedStatus, `${label}: expected ${expectedStatus}, received ${response.status}`)
  assert(response.headers.get('content-type')?.includes('application/json'), `${label}: response was not JSON`)
  const body = await response.json()
  assert(typeof body.requestId === 'string' && body.requestId.length > 0, `${label}: requestId missing`)
  assert(predicate(body), `${label}: unexpected response ${JSON.stringify(body)}`)
  return body
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

function readLocalSigningKey() {
  const container = process.env.PACKIT_TEST_AUTH_CONTAINER ?? 'supabase_auth_gen-package'
  if (!/^supabase_auth_[A-Za-z0-9_-]+$/.test(container)) {
    throw new Error('PACKIT_TEST_AUTH_CONTAINER ไม่ใช่ชื่อ local Supabase Auth container ที่อนุญาต')
  }
  const result = spawnSync('docker', ['inspect', container, '--format', '{{json .Config.Env}}'], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error('อ่าน local Auth signing fixture ไม่สำเร็จ')
  const entry = JSON.parse(result.stdout).find((value) => value.startsWith('GOTRUE_JWT_KEYS='))
  if (!entry) throw new Error('local Auth container ไม่มี signing fixture')
  const parsed = JSON.parse(entry.slice('GOTRUE_JWT_KEYS='.length))
  const jwk = Array.isArray(parsed) ? parsed.find((key) => typeof key.d === 'string') : parsed
  if (jwk.kty !== 'EC' || jwk.alg !== 'ES256' || typeof jwk.d !== 'string') {
    throw new Error('local Auth signing fixture ไม่ใช่ private ES256 JWK')
  }
  return createPrivateKey({ key: jwk, format: 'jwk' })
}

function startVite(mode) {
  const vite = path.resolve('node_modules', 'vite', 'bin', 'vite.js')
  const args = mode === 'preview'
    ? [vite, 'preview', '--host', '127.0.0.1', '--port', '5175', '--strictPort']
    : [vite, '--host', '127.0.0.1', '--port', '5175', '--strictPort']
  return spawn(process.execPath, args, {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      VITE_APP_MODE: 'cloud',
      VITE_API_BASE_URL: '/api/v1',
      VITE_SUPABASE_URL: status.API_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
      APP_ENV: 'development',
      APP_ALLOWED_ORIGINS: APP_ORIGIN,
      SUPABASE_URL: status.API_URL,
      SUPABASE_SECRET_KEY: status.SECRET_KEY,
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

async function stopProcess(child) {
  if (child.killed) return
  child.kill()
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ])
}

async function cleanupAppData(userId) {
  await sql.begin(async (tx) => {
    await tx`delete from app_private.legacy_imports where user_id = ${userId}`
    await tx`delete from app_private.project_operations where actor_user_id = ${userId}`
    await tx`delete from app_private.projects where created_by = ${userId}`
    await tx`delete from app_private.workspace_members where user_id = ${userId}`
    await tx`delete from app_private.workspaces where owner_user_id = ${userId}`
    await tx`delete from app_private.auth_identities where app_user_id = ${userId}`
    await tx`delete from app_private.app_users where id = ${userId}`
  })
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
