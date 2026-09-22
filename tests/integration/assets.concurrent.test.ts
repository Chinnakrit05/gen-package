import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'

const databaseUrl = process.env.PACKIT_TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const sql = postgres(databaseUrl, { max: 16, idle_timeout: 2 })

interface BootstrapRow {
  app_user_id: string
  personal_workspace_id: string
}

async function cleanupUser(userId: string): Promise<void> {
  await sql.begin(async (tx) => {
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

afterAll(async () => {
  await sql.end()
})

describe('asset reservation concurrency', () => {
  it('deduplicates concurrent intent retries before reserving quota', async () => {
    const [actor] = await sql<BootstrapRow[]>`
      select * from public.bootstrap_personal_workspace(
        ${`https://asset-dedupe-${randomUUID()}.test/auth/v1`},
        'owner', 'Asset dedupe', 'asset-dedupe@example.test'
      )
    `
    const operationId = randomUUID()
    try {
      const requests = Array.from({ length: 8 }, () => sql<{ result: { id: string } }[]>`
        select public.create_asset_upload_intent(
          ${actor.app_user_id}, ${actor.personal_workspace_id}, ${operationId}, ${'a'.repeat(64)},
          'project-decoration', 'image/png', 100,
          statement_timestamp() + interval '2 hours'
        ) as result
      `)
      const assets = (await Promise.all(requests)).map(([row]) => row.result.id)
      expect(new Set(assets).size).toBe(1)
      const [usage] = await sql<{ reserved: number; pending: number }[]>`
        select reserved_bytes::integer as reserved, pending_count as pending
        from app_private.storage_usage where workspace_id = ${actor.personal_workspace_id}
      `
      expect(usage).toEqual({ reserved: 10 * 1024 * 1024, pending: 1 })
    } finally {
      await cleanupUser(actor.app_user_id)
    }
  })

  it('atomically caps concurrent pending tickets at twenty', async () => {
    const [actor] = await sql<BootstrapRow[]>`
      select * from public.bootstrap_personal_workspace(
        ${`https://asset-quota-${randomUUID()}.test/auth/v1`},
        'owner', 'Asset quota', 'asset-quota@example.test'
      )
    `
    try {
      const requests = Array.from({ length: 25 }, (_, index) => sql`
        select public.create_asset_upload_intent(
          ${actor.app_user_id}, ${actor.personal_workspace_id}, ${randomUUID()},
          ${index.toString(16).padStart(64, '0')},
          'project-decoration', 'image/png', 100,
          statement_timestamp() + interval '2 hours'
        )
      `)
      const settled = await Promise.allSettled(requests)
      expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(20)
      expect(settled.filter((result) => result.status === 'rejected')).toHaveLength(5)
      for (const rejected of settled.filter((result) => result.status === 'rejected')) {
        expect(String(rejected.reason?.message)).toContain('ASSET_QUOTA_EXCEEDED')
      }
      const [usage] = await sql<{ reserved: number; pending: number }[]>`
        select reserved_bytes::integer as reserved, pending_count as pending
        from app_private.storage_usage where workspace_id = ${actor.personal_workspace_id}
      `
      expect(usage).toEqual({ reserved: 20 * 10 * 1024 * 1024, pending: 20 })
    } finally {
      await cleanupUser(actor.app_user_id)
    }
  })

  it('reserves one completion operation before concurrent validators start', async () => {
    const [actor] = await sql<BootstrapRow[]>`
      select * from public.bootstrap_personal_workspace(
        ${`https://asset-complete-${randomUUID()}.test/auth/v1`},
        'owner', 'Asset complete', 'asset-complete@example.test'
      )
    `
    try {
      const assetIds: string[] = []
      for (const index of [1, 2]) {
        const [created] = await sql<{ result: { id: string } }[]>`
          select public.create_asset_upload_intent(
            ${actor.app_user_id}, ${actor.personal_workspace_id}, ${randomUUID()},
            ${String(index).repeat(64)}, 'project-decoration', 'image/png', 100,
            statement_timestamp() + interval '2 hours'
          ) as result
        `
        assetIds.push(created.result.id)
      }
      const sharedOperationId = randomUUID()
      const claims = await Promise.allSettled(assetIds.map((assetId, index) => sql`
        select public.claim_asset_validation(
          ${actor.app_user_id}, ${assetId}, ${sharedOperationId},
          ${index === 0 ? 'a'.repeat(64) : 'b'.repeat(64)},
          statement_timestamp() + interval '2 minutes'
        )
      `))
      expect(claims.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(claims.filter((result) => result.status === 'rejected')).toHaveLength(1)
      const rejected = claims.find((result) => result.status === 'rejected')
      if (!rejected) throw new Error('expected one rejected claim')
      expect(String(rejected.reason?.message)).toContain('IDEMPOTENCY_KEY_REUSED')
    } finally {
      await cleanupUser(actor.app_user_id)
    }
  })
})
