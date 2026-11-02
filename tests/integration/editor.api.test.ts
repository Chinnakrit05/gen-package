import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { MeData, SessionBootstrapData } from '../../shared/contracts/auth'
import type { CloudProject, ProjectPage, SaveReceipt } from '../../shared/contracts/projects'
import { createApiRouter } from '../../server/http/router'

type Role = 'owner' | 'editor' | 'viewer' | 'outsider'
interface TestUser { role: Role; authId: string; token: string; userId: string; workspaceId: string }
interface LocalStatus { API_URL: string; DB_URL: string; PUBLISHABLE_KEY: string; SECRET_KEY: string }

const document = {
  live: { template: 'tuck-end', materialId: 'carton-300', W: 80, D: 50, H: 120, handle: false },
  qty: 500, fillColor: null, decos: [], history: [], histIdx: -1,
}

describe('Editor routes against real local Auth, HTTP API and PostgreSQL', () => {
  let sql: ReturnType<typeof postgres>
  let admin: ReturnType<typeof createClient>
  let server: Server | undefined
  let origin: string
  let teamId: string
  const users: TestUser[] = []
  const authIds: string[] = []
  const projectIds: string[] = []
  const user = (role: Role) => users.find((entry) => entry.role === role)!

  async function api<T = Record<string, unknown>>(
    route: string, actor?: TestUser, method = 'GET', body?: unknown, headers: Record<string, string> = {},
  ) {
    const response = await fetch(`${origin}/api/v1${route}`, {
      method,
      headers: {
        ...(actor ? { authorization: `Bearer ${actor.token}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('cache-control')).toBe('no-store')
    const payload = await response.json() as {
      data: T; error?: { code: string; details?: { currentRevision?: number } }; requestId: string
    }
    expect(payload.requestId).toBe(response.headers.get('x-request-id'))
    return { status: response.status, ...payload }
  }

  async function create(actor: TestUser, name: string, operationId = randomUUID()) {
    const input = { workspaceId: teamId, operationId, name, documentSchemaVersion: 1, document }
    const result = await api<CloudProject>('/projects', actor, 'POST', input)
    expect(result.status).toBe(201)
    return { input, project: result.data }
  }

  beforeAll(async () => {
    // Same local CLI discovery as the existing integration suites. No env file or
    // linked remote credentials are read, and status (which contains keys) is never printed.
    const result = spawnSync(process.execPath, [
      path.resolve('node_modules/supabase/dist/supabase.js'), 'status', '-o', 'json',
    ], { encoding: 'utf8' })
    if (result.status !== 0) throw new Error('Start the isolated PackIt local Supabase stack first')
    const status = JSON.parse(result.stdout) as LocalStatus
    for (const value of [status.API_URL, status.DB_URL]) {
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value).hostname)) {
        throw new Error('Editor integration fixtures require a loopback local stack')
      }
    }
    sql = postgres(status.DB_URL, { max: 4 })
    admin = createClient(status.API_URL, status.SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const router = createApiRouter({
      appEnv: 'test', allowedOrigins: [], ai: null,
      supabase: { url: status.API_URL, secretKey: status.SECRET_KEY, issuer: `${status.API_URL}/auth/v1` },
    })
    server = createServer((req, res) => {
      void router({ method: req.method, url: req.url, headers: req.headers, raw: req }, res)
    })
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject)
      server!.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing local test listener')
    origin = `http://127.0.0.1:${address.port}`

    for (const role of ['owner', 'editor', 'viewer', 'outsider'] as const) {
      const email = `editor-api-${role}-${randomUUID()}@example.test`
      const password = `Local-${randomUUID()}!aA1`
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
      if (created.error || !created.data.user) throw new Error('Cannot create local fixture account')
      authIds.push(created.data.user.id)
      const browser = createClient(status.API_URL, status.PUBLISHABLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const signedIn = await browser.auth.signInWithPassword({ email, password })
      if (signedIn.error || !signedIn.data.session) throw new Error('Cannot sign in local fixture account')
      const entry: TestUser = { role, authId: created.data.user.id, token: signedIn.data.session.access_token, userId: '', workspaceId: '' }
      users.push(entry)
      const bootstrap = await api<SessionBootstrapData>('/session/bootstrap', entry, 'POST', {})
      expect(bootstrap.status).toBe(200)
      entry.userId = bootstrap.data.user.id
      entry.workspaceId = bootstrap.data.personalWorkspace.id
    }
    const [team] = await sql<{ id: string }[]>`
      insert into app_private.workspaces(kind, owner_user_id, name)
      values ('team', ${user('owner').userId}, 'Editor API synthetic team') returning id
    `
    teamId = team.id
    for (const role of ['owner', 'editor', 'viewer'] as const) {
      await sql`insert into app_private.workspace_members(workspace_id, user_id, role)
        values (${teamId}, ${user(role).userId}, ${role})`
    }
    for (let index = 0; index < 25; index++) {
      projectIds.push((await create(user('owner'), `Page fixture ${index}`)).project.id)
    }
  }, 60_000)

  afterAll(async () => {
    if (sql) {
      // Delete only graphs created by this file, including partial bootstrap setup.
      const appUsers = authIds.length ? await sql<{ id: string }[]>`
        select app_user_id as id from app_private.auth_identities where subject in ${sql(authIds)}
      ` : []
      const ids = appUsers.map((entry) => entry.id)
      if (ids.length) await sql.begin(async (tx) => {
        const workspaces = await tx<{ id: string }[]>`select id from app_private.workspaces where owner_user_id in ${tx(ids)}`
        const workspaceIds = workspaces.map((entry) => entry.id)
        if (workspaceIds.length) {
          await tx`delete from app_private.project_operations where workspace_id in ${tx(workspaceIds)}`
          await tx`delete from app_private.projects where workspace_id in ${tx(workspaceIds)}`
          await tx`delete from app_private.workspace_members where workspace_id in ${tx(workspaceIds)}`
          await tx`delete from app_private.workspaces where id in ${tx(workspaceIds)}`
        }
        await tx`delete from app_private.auth_identities where app_user_id in ${tx(ids)}`
        await tx`delete from app_private.app_users where id in ${tx(ids)}`
      })
      await sql.end()
    }
    if (admin) for (const id of authIds) await admin.auth.admin.deleteUser(id)
    if (server) {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server!.close(() => resolve()))
    }
  })

  it('bootstraps idempotently, returns real memberships and rejects a local-demo flag as auth', async () => {
    const actor = user('viewer')
    const bootstrap = await api<SessionBootstrapData>('/session/bootstrap', actor, 'POST', {})
    expect(bootstrap.data.user.id).toBe(actor.userId)
    expect(bootstrap.data.personalWorkspace.id).toBe(actor.workspaceId)
    const me = await api<MeData>('/me', actor)
    expect(me.data.workspaces).toContainEqual(expect.objectContaining({ id: teamId, role: 'viewer' }))
    const unauthenticated = await api('/me', undefined, 'GET', undefined, { 'x-packit-local-demo': 'true' })
    expect(unauthenticated).toMatchObject({ status: 401, error: { code: 'AUTH_REQUIRED' } })
    expect(await api('/not-a-route')).toMatchObject({ status: 404, error: { code: 'NOT_FOUND' } })
  })

  it('returns 24+1 summaries without documents or assets and opens the exact ID', async () => {
    const first = await api<ProjectPage>(`/projects?workspaceId=${teamId}&limit=24`, user('owner'))
    expect(first.status).toBe(200)
    expect(first.data.items).toHaveLength(24)
    expect(first.data.nextCursor).toBeTypeOf('string')
    const second = await api<ProjectPage>(`/projects?workspaceId=${teamId}&limit=24&cursor=${encodeURIComponent(first.data.nextCursor!)}`, user('owner'))
    expect(second.data.items).toHaveLength(1)
    expect(second.data.nextCursor).toBeNull()
    const items = [...first.data.items, ...second.data.items]
    expect(new Set(items.map((entry) => entry.id)).size).toBe(25)
    for (const summary of items) {
      expect(Object.keys(summary).sort()).toEqual(['id', 'name', 'revision', 'updatedAt', 'workspaceId'])
    }
    expect((await api<CloudProject>(`/projects/${projectIds[0]}`, user('viewer'))).data.id).toBe(projectIds[0])
    expect(await api(`/projects/${randomUUID()}`, user('owner'))).toMatchObject({ status: 404, error: { code: 'NOT_FOUND' } })
    expect(await api(`/projects/${projectIds[0]}`, user('outsider'))).toMatchObject({ status: 404, error: { code: 'NOT_FOUND' } })
    expect(await api(`/projects?workspaceId=${teamId}`, user('outsider'))).toMatchObject({ status: 404, error: { code: 'NOT_FOUND' } })
  })

  it('preserves create receipts on retry and scopes operation IDs to the authorized actor', async () => {
    const created = await create(user('owner'), 'Create retry')
    const retry = await api<CloudProject>('/projects', user('owner'), 'POST', created.input)
    expect(retry.data.id).toBe(created.project.id)
    expect(await api('/projects', user('owner'), 'POST', { ...created.input, name: 'Changed intent' }))
      .toMatchObject({ status: 409, error: { code: 'IDEMPOTENCY_KEY_REUSED' } })
    expect(await api('/projects', user('outsider'), 'POST', created.input))
      .toMatchObject({ status: 404, error: { code: 'NOT_FOUND' } })
    const anotherActor = await api<CloudProject>('/projects', user('editor'), 'POST', created.input)
    expect(anotherActor.status).toBe(201)
    expect(anotherActor.data.id).not.toBe(created.project.id)
    const [count] = await sql<{ n: number }[]>`select count(*)::integer as n from app_private.project_operations
      where workspace_id = ${teamId} and operation_id = ${created.input.operationId}`
    expect(count.n).toBe(2)
  })

  it('allows one concurrent CAS save and retries its receipt without writing another revision', async () => {
    const { project } = await create(user('owner'), 'Concurrent save')
    const inputs = [0, 1].map((index) => ({ operationId: randomUUID(), expectedRevision: 1,
      name: `Writer ${index}`, documentSchemaVersion: 1, document: { ...document, qty: 501 + index } }))
    const saves = await Promise.all(inputs.map((input, index) => api<SaveReceipt>(
      `/projects/${project.id}`, user(index === 0 ? 'owner' : 'editor'), 'PUT', input,
    )))
    expect(saves.map((entry) => entry.status).sort()).toEqual([200, 409])
    expect(saves.find((entry) => entry.status === 409)?.error)
      .toMatchObject({ code: 'REVISION_CONFLICT', details: { currentRevision: 2 } })
    const winner = saves.findIndex((entry) => entry.status === 200)
    const actor = user(winner === 0 ? 'owner' : 'editor')
    const retry = await api<SaveReceipt>(`/projects/${project.id}`, actor, 'PUT', inputs[winner])
    expect(retry.data.revision).toBe(2)
    expect(await api(`/projects/${project.id}`, actor, 'PUT', { ...inputs[winner], name: 'Different' }))
      .toMatchObject({ status: 409, error: { code: 'IDEMPOTENCY_KEY_REUSED' } })
    expect((await api<CloudProject>(`/projects/${project.id}`, actor)).data.revision).toBe(2)
  })

  it('allows viewer reads but denies create/save/delete/thumbnail writes and outsider thumbnail access', async () => {
    const id = projectIds[projectIds.length - 1]
    const imageBase64 = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#ffffff' } }).jpeg().toBuffer()
      .then((buffer) => buffer.toString('base64'))
    const thumbnail = { mimeType: 'image/jpeg', imageBase64, kind: 'box', label: 'Fixture box' }
    const put = await api<{ version: string }>(`/projects/${id}/thumbnail`, user('editor'), 'PUT', thumbnail)
    expect(put.status).toBe(200)
    const read = await api<{ items: { projectId: string; version: string }[] }>('/projects/thumbnails', user('viewer'), 'POST', { workspaceId: teamId, projectIds: [id, randomUUID()] })
    expect(read.data.items).toHaveLength(1)
    expect(read.data.items[0]).toMatchObject({ projectId: id, version: put.data.version })
    const summary = await api<ProjectPage>(`/projects?workspaceId=${teamId}&limit=24`, user('viewer'))
    expect(summary.data.items.find((entry) => entry.id === id)?.thumbnail?.version).toBe(put.data.version)
    const denied = await Promise.all([
      api('/projects', user('viewer'), 'POST', { workspaceId: teamId, operationId: randomUUID(), name: 'Denied', documentSchemaVersion: 1, document }),
      api(`/projects/${id}`, user('viewer'), 'PUT', { operationId: randomUUID(), expectedRevision: 1, name: 'Denied', documentSchemaVersion: 1, document }),
      api(`/projects/${id}`, user('viewer'), 'DELETE', undefined, { 'x-expected-revision': '1', 'idempotency-key': randomUUID() }),
      api(`/projects/${id}/thumbnail`, user('viewer'), 'PUT', thumbnail),
      api('/projects/thumbnails', user('outsider'), 'POST', { workspaceId: teamId, projectIds: [id] }),
    ])
    for (const response of denied) expect(response).toMatchObject({ status: 404, error: { code: 'NOT_FOUND' } })
    const foreign = await api<{ items: unknown[] }>('/projects/thumbnails', user('outsider'), 'POST', { workspaceId: user('outsider').workspaceId, projectIds: [id] })
    expect(foreign).toMatchObject({ status: 200, data: { items: [] } })
  })

  it('denies replay after membership revocation and keeps editor delete receipts idempotent', async () => {
    const actor = user('editor')
    const created = await create(actor, 'Revoked receipt')
    await sql`delete from app_private.workspace_members where workspace_id = ${teamId} and user_id = ${actor.userId}`
    try {
      expect(await api('/projects', actor, 'POST', created.input)).toMatchObject({ status: 404, error: { code: 'NOT_FOUND' } })
    } finally {
      await sql`insert into app_private.workspace_members(workspace_id, user_id, role) values (${teamId}, ${actor.userId}, 'editor')`
    }
    const headers = { 'x-expected-revision': '1', 'idempotency-key': randomUUID() }
    const removed = await api(`/projects/${created.project.id}`, actor, 'DELETE', undefined, headers)
    expect(removed.status).toBe(200)
    expect((await api(`/projects/${created.project.id}`, actor, 'DELETE', undefined, headers)).data).toEqual(removed.data)
    expect(await api(`/projects/${created.project.id}`, actor)).toMatchObject({ status: 404, error: { code: 'NOT_FOUND' } })
  })
})
