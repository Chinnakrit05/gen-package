import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSupabaseSessionService } from '../../server/adapters/supabase/sessionService'

interface LocalStatus {
  API_URL: string
  DB_URL: string
  PUBLISHABLE_KEY: string
  SECRET_KEY: string
}

function readLocalStatus(): LocalStatus {
  const cli = path.resolve('node_modules', 'supabase', 'dist', 'supabase.js')
  const result = spawnSync(process.execPath, [cli, 'status', '-o', 'json'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error('Local Supabase stack is not running')
  return JSON.parse(result.stdout) as LocalStatus
}

describe('real Supabase session bootstrap', () => {
  let status: LocalStatus
  let sql: ReturnType<typeof postgres> | undefined
  let authUserId: string | undefined
  let appUserId: string | undefined

  beforeAll(() => {
    status = readLocalStatus()
    sql = postgres(status.DB_URL, { max: 1 })
  })

  afterAll(async () => {
    const cleanupAppUserId = appUserId
    if (cleanupAppUserId && sql) {
      await sql.begin(async (tx) => {
        await tx`delete from app_private.workspace_members where user_id = ${cleanupAppUserId}`
        await tx`delete from app_private.workspaces where owner_user_id = ${cleanupAppUserId}`
        await tx`delete from app_private.auth_identities where app_user_id = ${cleanupAppUserId}`
        await tx`delete from app_private.app_users where id = ${cleanupAppUserId}`
      })
    }
    if (authUserId) {
      const admin = createClient(status.API_URL, status.SECRET_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      await admin.auth.admin.deleteUser(authUserId)
    }
    await sql?.end()
  })

  it('verifies a real access token and idempotently creates one personal workspace', async () => {
    const email = `session-${crypto.randomUUID()}@example.test`
    const password = `Local-${crypto.randomUUID()}!aA1`
    const admin = createClient(status.API_URL, status.SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: 'Local Session Tester' },
    })
    expect(createError).toBeNull()
    authUserId = created.user?.id
    expect(authUserId).toBeTruthy()

    const browser = createClient(status.API_URL, status.PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: signedIn, error: signInError } = await browser.auth.signInWithPassword({ email, password })
    expect(signInError).toBeNull()
    expect(signedIn.session?.access_token).toBeTruthy()

    const service = createSupabaseSessionService({
      url: status.API_URL,
      secretKey: status.SECRET_KEY,
      issuer: `${status.API_URL}/auth/v1`,
    })
    const first = await service.bootstrap(signedIn.session!.access_token, crypto.randomUUID())
    const second = await service.bootstrap(signedIn.session!.access_token, crypto.randomUUID())
    appUserId = first.user.id
    const actor = await service.authenticate(signedIn.session!.access_token, 'request-authenticate')

    expect(second).toEqual(first)
    expect(first.user).toMatchObject({ displayName: 'Local Session Tester', email })
    expect(actor).toMatchObject({
      userId: first.user.id,
      identityIssuer: `${status.API_URL}/auth/v1`,
      identitySubject: authUserId,
      requestId: 'request-authenticate',
    })

    const [counts] = await sql!<[{ users: number; identities: number; workspaces: number; memberships: number }]>`
      select
        (select count(*)::int from app_private.app_users where id = ${appUserId}) as users,
        (select count(*)::int from app_private.auth_identities where app_user_id = ${appUserId}) as identities,
        (select count(*)::int from app_private.workspaces where owner_user_id = ${appUserId}) as workspaces,
        (select count(*)::int from app_private.workspace_members where user_id = ${appUserId}) as memberships
    `
    expect(counts).toEqual({ users: 1, identities: 1, workspaces: 1, memberships: 1 })

    await expect(service.bootstrap('forged-token', crypto.randomUUID())).rejects.toMatchObject({
      status: 401,
      code: 'SESSION_INVALID',
    })
  })
})
