import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'

const databaseUrl = process.env.PACKIT_TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const sql = postgres(databaseUrl, { max: 12, idle_timeout: 2 })

interface BootstrapRow {
  app_user_id: string
  personal_workspace_id: string
}

interface ImportResult {
  sourceProjectKey: string
  project: { id: string }
}

async function cleanupUser(userId: string): Promise<void> {
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

afterAll(async () => {
  await sql.end()
})

describe('legacy import concurrency', () => {
  it('maps concurrent operations for one source to exactly one project', async () => {
    const issuer = `https://legacy-${randomUUID()}.test/auth/v1`
    const [actor] = await sql<BootstrapRow[]>`
      select * from public.bootstrap_personal_workspace(
        ${issuer}, 'owner', 'Legacy owner', 'legacy-owner@example.test'
      )
    `
    const installationId = randomUUID()
    const sourceHash = 'a'.repeat(64)

    try {
      const imports = Array.from({ length: 8 }, (_, index) => sql<{ result: ImportResult }[]>`
        select public.import_legacy_project(
          ${actor.app_user_id}, ${actor.personal_workspace_id}, ${randomUUID()},
          ${String(index + 1).repeat(64).slice(0, 64)}, ${installationId}, 'projects:0',
          ${sourceHash}, ${`Imported ${index}`}, 1, ${sql.json({ decos: [] })}
        ) as result
      `)
      const results = (await Promise.all(imports)).map(([row]) => row.result)
      expect(new Set(results.map((result) => result.project.id)).size).toBe(1)

      const [counts] = await sql<{ projects: number; mappings: number }[]>`
        select
          (select count(*)::integer from app_private.projects
            where workspace_id = ${actor.personal_workspace_id}) as projects,
          (select count(*)::integer from app_private.legacy_imports
            where user_id = ${actor.app_user_id}
              and source_installation_id = ${installationId}
              and source_project_key = 'projects:0') as mappings
      `
      expect(counts).toEqual({ projects: 1, mappings: 1 })
    } finally {
      await cleanupUser(actor.app_user_id)
    }
  })
})
