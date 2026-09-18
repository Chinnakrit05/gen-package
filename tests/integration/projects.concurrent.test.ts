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

interface ProjectResult {
  id?: string
  projectId?: string
  revision: number
}

async function cleanupUser(userId: string): Promise<void> {
  await sql.begin(async (tx) => {
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

describe('project mutation concurrency and idempotency', () => {
  it('deduplicates create and allows only one CAS save for a revision', async () => {
    const issuer = `https://projects-${randomUUID()}.test/auth/v1`
    const [actor] = await sql<BootstrapRow[]>`
      select * from public.bootstrap_personal_workspace(
        ${issuer}, 'owner', 'Project owner', 'project-owner@example.test'
      )
    `
    const createOperation = randomUUID()
    const createHash = 'a'.repeat(64)
    const document = { live: 'initial' }

    try {
      const creates = Array.from({ length: 8 }, () => sql<{ result: ProjectResult }[]>`
        select public.create_project(
          ${actor.app_user_id}, ${actor.personal_workspace_id}, ${createOperation},
          ${createHash}, 'Concurrent project', 1, ${sql.json(document)}
        ) as result
      `)
      const created = (await Promise.all(creates)).map(([row]) => row.result)
      expect(new Set(created.map((result) => result.id)).size).toBe(1)
      expect(new Set(created.map((result) => result.revision))).toEqual(new Set([1]))
      const projectId = created[0].id!

      const [counts] = await sql<{ projects: number; operations: number }[]>`
        select
          (select count(*)::integer from app_private.projects where id = ${projectId}) as projects,
          (select count(*)::integer from app_private.project_operations
            where operation_id = ${createOperation}) as operations
      `
      expect(counts).toEqual({ projects: 1, operations: 1 })

      const saveInputs = [
        { operationId: randomUUID(), hash: 'b'.repeat(64), name: 'Writer A' },
        { operationId: randomUUID(), hash: 'c'.repeat(64), name: 'Writer B' },
      ]
      const saves = await Promise.allSettled(saveInputs.map((input) => sql<{ result: ProjectResult }[]>`
        select public.save_project(
          ${actor.app_user_id}, ${projectId}, ${input.operationId}, ${input.hash},
          1, ${input.name}, 1, ${sql.json({ live: input.name })}
        ) as result
      `))
      expect(saves.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(saves.filter((result) => result.status === 'rejected')).toHaveLength(1)
      const fulfilled = saves.find((result) => result.status === 'fulfilled')
      const rejected = saves.find((result) => result.status === 'rejected')
      if (!fulfilled || !rejected) throw new Error('expected one fulfilled and one rejected save')
      expect(String(rejected.reason?.message)).toContain('REVISION_CONFLICT')
      expect(fulfilled.value[0].result.revision).toBe(2)

      const winnerIndex = saves.findIndex((result) => result.status === 'fulfilled')
      const winner = saveInputs[winnerIndex]
      const [retry] = await sql<{ result: ProjectResult }[]>`
        select public.save_project(
          ${actor.app_user_id}, ${projectId}, ${winner.operationId}, ${winner.hash},
          1, ${winner.name}, 1, ${sql.json({ live: winner.name })}
        ) as result
      `
      expect(retry.result.revision).toBe(2)

      await expect(sql`
        select public.save_project(
          ${actor.app_user_id}, ${projectId}, ${winner.operationId}, ${'d'.repeat(64)},
          2, 'Changed payload', 1, ${sql.json({ live: 'changed' })}
        )
      `).rejects.toMatchObject({ message: expect.stringContaining('IDEMPOTENCY_KEY_REUSED') })
    } finally {
      await cleanupUser(actor.app_user_id)
    }
  })

  it('serializes one operation ID across different projects in the same workspace', async () => {
    const issuer = `https://operation-${randomUUID()}.test/auth/v1`
    const [actor] = await sql<BootstrapRow[]>`
      select * from public.bootstrap_personal_workspace(
        ${issuer}, 'owner', 'Operation owner', 'operation-owner@example.test'
      )
    `

    try {
      const projectIds: string[] = []
      for (const suffix of ['first', 'second']) {
        const [created] = await sql<{ result: ProjectResult }[]>`
          select public.create_project(
            ${actor.app_user_id}, ${actor.personal_workspace_id}, ${randomUUID()},
            ${suffix === 'first' ? '1'.repeat(64) : '2'.repeat(64)},
            ${suffix}, 1, ${sql.json({ live: suffix })}
          ) as result
        `
        projectIds.push(created.result.id!)
      }

      const sharedOperationId = randomUUID()
      const saves = await Promise.allSettled(projectIds.map((id, index) => sql<{ result: ProjectResult }[]>`
        select public.save_project(
          ${actor.app_user_id}, ${id}, ${sharedOperationId},
          ${index === 0 ? '3'.repeat(64) : '4'.repeat(64)},
          1, ${`saved-${index}`}, 1, ${sql.json({ live: `saved-${index}` })}
        ) as result
      `))

      expect(saves.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(saves.filter((result) => result.status === 'rejected')).toHaveLength(1)
      const rejected = saves.find((result) => result.status === 'rejected')
      if (!rejected) throw new Error('expected one rejected save')
      expect(String(rejected.reason?.message)).toContain('IDEMPOTENCY_KEY_REUSED')

      const rows = await sql<{ id: string; revision: number }[]>`
        select id, revision::integer
        from app_private.projects
        where id in ${sql(projectIds)}
        order by id
      `
      expect(rows.map((row) => row.revision).sort()).toEqual([1, 2])
    } finally {
      await cleanupUser(actor.app_user_id)
    }
  })
})
