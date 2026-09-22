import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSupabaseAssetService } from '../../server/adapters/supabase/assetService'
import { createSupabaseProjectRepository } from '../../server/adapters/supabase/projectRepository'
import type { Actor } from '../../server/modules/identity/actor'
import { ProjectService } from '../../server/modules/projects/projectService'
import type { CloudProjectDocumentV1 } from '../../shared/contracts/projects'

interface LocalStatus {
  API_URL: string
  DB_URL: string
  PUBLISHABLE_KEY: string
  SECRET_KEY: string
}

interface BootstrapRow {
  app_user_id: string
  personal_workspace_id: string
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

describe('real asset lifecycle and project references', () => {
  let status: LocalStatus
  let sql: ReturnType<typeof postgres>
  const userIds: string[] = []
  const storageKeys = { staging: [] as string[], final: [] as string[] }

  beforeAll(() => {
    status = readLocalStatus()
    sql = postgres(status.DB_URL, { max: 4 })
  })

  afterAll(async () => {
    const admin = createClient(status.API_URL, status.SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    if (storageKeys.staging.length) {
      await admin.storage.from('packit-staging').remove(storageKeys.staging)
    }
    if (storageKeys.final.length) {
      await admin.storage.from('packit-assets').remove(storageKeys.final)
    }
    for (const userId of userIds) {
      await sql.begin(async (tx) => {
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
    await sql?.end()
  })

  it('validates immutable bytes, authorizes downloads, and links only ready same-tenant assets', async () => {
    const issuer = `https://asset-integration-${randomUUID()}.test/auth/v1`
    const [owner] = await sql<BootstrapRow[]>`
      select * from public.bootstrap_personal_workspace(
        ${issuer}, 'owner', 'Asset owner', 'asset-owner@example.test'
      )
    `
    const [other] = await sql<BootstrapRow[]>`
      select * from public.bootstrap_personal_workspace(
        ${issuer}, 'other', 'Asset other', 'asset-other@example.test'
      )
    `
    userIds.push(owner.app_user_id, other.app_user_id)
    const config = {
      url: status.API_URL,
      secretKey: status.SECRET_KEY,
      issuer: `${status.API_URL}/auth/v1`,
    }
    const assets = createSupabaseAssetService(config)
    const projects = new ProjectService(createSupabaseProjectRepository(config))
    const ownerActor: Actor = {
      userId: owner.app_user_id,
      identityIssuer: issuer,
      identitySubject: 'owner',
      requestId: randomUUID(),
    }
    const otherActor: Actor = {
      userId: other.app_user_id,
      identityIssuer: issuer,
      identitySubject: 'other',
      requestId: randomUUID(),
    }

    const source = await sharp({
      create: { width: 8, height: 6, channels: 4, background: '#8855ccaa' },
    }).png().withMetadata({ orientation: 1 }).toBuffer()
    const intent = await assets.createIntent(ownerActor, {
      workspaceId: owner.personal_workspace_id,
      purpose: 'project-fill',
      declaredMime: 'image/png',
      declaredSize: source.length,
      operationId: randomUUID(),
    })
    expect(intent.asset.state).toBe('pending')
    expect(intent.upload).not.toBeNull()
    const [keys] = await sql<{ staging_key: string }[]>`
      select staging_key from app_private.assets where id = ${intent.asset.id}
    `
    storageKeys.staging.push(keys.staging_key)

    const uploadResponse = await fetch(intent.upload!.url, {
      method: intent.upload!.method,
      headers: intent.upload!.headers,
      body: source,
    })
    expect(uploadResponse.ok).toBe(true)

    const completeOperationId = randomUUID()
    const ready = await assets.complete(ownerActor, {
      assetId: intent.asset.id,
      operationId: completeOperationId,
    })
    expect(ready).toMatchObject({ state: 'ready', width: 8, height: 6, mimeType: 'image/png' })
    expect(ready.sha256).toMatch(/^[0-9a-f]{64}$/)
    await expect(assets.complete(ownerActor, {
      assetId: intent.asset.id,
      operationId: completeOperationId,
    })).resolves.toMatchObject({ state: 'ready', sha256: ready.sha256 })

    const [readyRow] = await sql<{ object_key: string }[]>`
      select object_key from app_private.assets where id = ${intent.asset.id}
    `
    storageKeys.final.push(readyRow.object_key)
    const anonymous = createClient(status.API_URL, status.PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: anonymousList, error: listError } = await anonymous.storage
      .from('packit-assets')
      .list(`assets/${owner.personal_workspace_id}`)
    expect(listError).toBeNull()
    expect(anonymousList).toEqual([])
    const publicResponse = await fetch(
      `${status.API_URL}/storage/v1/object/public/packit-assets/${readyRow.object_key}`,
    )
    expect(publicResponse.ok).toBe(false)

    const downloads = await assets.createDownloadTickets(ownerActor, [intent.asset.id])
    expect(downloads.tickets).toHaveLength(1)
    const downloadResponse = await fetch(downloads.tickets[0].url)
    expect(downloadResponse.ok).toBe(true)
    const downloaded = Buffer.from(await downloadResponse.arrayBuffer())
    expect(createHash('sha256').update(downloaded).digest('hex')).toBe(ready.sha256)
    await expect(assets.createDownloadTickets(otherActor, [intent.asset.id])).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    })

    const document: CloudProjectDocumentV1 = {
      live: { template: 'tuck-end', materialId: 'carton-300', W: 80, D: 50, H: 120, handle: false },
      qty: 500,
      fillColor: null,
      fillImage: { assetId: intent.asset.id, aspect: 8 / 6 },
      decos: [],
      history: [],
      histIdx: -1,
    }
    const project = await projects.create(ownerActor, {
      workspaceId: owner.personal_workspace_id,
      operationId: randomUUID(),
      name: 'Asset project',
      documentSchemaVersion: 1,
      document,
    })
    expect(project.assets).toEqual([expect.objectContaining({ id: intent.asset.id, state: 'ready' })])

    await expect(projects.create(otherActor, {
      workspaceId: other.personal_workspace_id,
      operationId: randomUUID(),
      name: 'Cross tenant asset',
      documentSchemaVersion: 1,
      document,
    })).rejects.toMatchObject({ status: 422, code: 'ASSET_NOT_READY' })

    const invalidBytes = Buffer.from('not a PNG')
    const invalidIntent = await assets.createIntent(ownerActor, {
      workspaceId: owner.personal_workspace_id,
      purpose: 'project-decoration',
      declaredMime: 'image/png',
      declaredSize: invalidBytes.length,
      operationId: randomUUID(),
    })
    const [invalidKey] = await sql<{ staging_key: string }[]>`
      select staging_key from app_private.assets where id = ${invalidIntent.asset.id}
    `
    storageKeys.staging.push(invalidKey.staging_key)
    const invalidUpload = await fetch(invalidIntent.upload!.url, {
      method: 'PUT', headers: invalidIntent.upload!.headers, body: invalidBytes,
    })
    expect(invalidUpload.ok).toBe(true)
    await expect(assets.complete(ownerActor, {
      assetId: invalidIntent.asset.id,
      operationId: randomUUID(),
    })).resolves.toMatchObject({ state: 'rejected', rejectionCode: 'INVALID_IMAGE' })
  })
})
