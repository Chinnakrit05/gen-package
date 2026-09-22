import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'

const databaseUrl = process.env.PACKIT_TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const sql = postgres(databaseUrl, { max: 12, idle_timeout: 2 })

interface BootstrapRow {
  app_user_id: string
  personal_workspace_id: string
  profile_display_name: string
  profile_email: string | null
  user_status: string
}

async function cleanupIdentity(issuer: string, subject: string): Promise<void> {
  const identities = await sql<{ app_user_id: string }[]>`
    select app_user_id
    from app_private.auth_identities
    where issuer = ${issuer} and subject = ${subject}
  `
  for (const { app_user_id: userId } of identities) {
    await sql.begin(async (tx) => {
      await tx`delete from app_private.workspace_members where user_id = ${userId}`
      await tx`delete from app_private.workspaces where owner_user_id = ${userId}`
      await tx`delete from app_private.auth_identities where app_user_id = ${userId}`
      await tx`delete from app_private.app_users where id = ${userId}`
    })
  }
}

afterAll(async () => {
  await sql.end()
})

describe('bootstrap_personal_workspace concurrency', () => {
  it('commits one user/workspace graph when the same identity arrives concurrently', async () => {
    const issuer = `https://race-${randomUUID()}.supabase.local/auth/v1`
    const subject = 'same-subject'

    try {
      const calls = Array.from({ length: 8 }, () => sql<BootstrapRow[]>`
        select * from public.bootstrap_personal_workspace(
          ${issuer}, ${subject}, 'Race user', 'race@example.test'
        )
      `)
      const results = (await Promise.all(calls)).flat()

      expect(results).toHaveLength(8)
      expect(new Set(results.map((row) => row.app_user_id)).size).toBe(1)
      expect(new Set(results.map((row) => row.personal_workspace_id)).size).toBe(1)

      const [counts] = await sql<{
        identities: number
        users: number
        workspaces: number
        memberships: number
      }[]>`
        select
          (select count(*)::integer from app_private.auth_identities
            where issuer = ${issuer} and subject = ${subject}) as identities,
          (select count(*)::integer from app_private.app_users
            where id = ${results[0].app_user_id}) as users,
          (select count(*)::integer from app_private.workspaces
            where owner_user_id = ${results[0].app_user_id} and kind = 'personal') as workspaces,
          (select count(*)::integer from app_private.workspace_members
            where user_id = ${results[0].app_user_id} and role = 'owner') as memberships
      `
      expect(counts).toEqual({ identities: 1, users: 1, workspaces: 1, memberships: 1 })
    } finally {
      await cleanupIdentity(issuer, subject)
    }
  })
})
