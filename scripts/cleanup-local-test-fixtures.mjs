import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'

const apply = process.argv.includes('--apply')
const status = readLocalStatus()
const sql = postgres(status.DB_URL, { max: 1, idle_timeout: 2 })
const admin = createClient(status.API_URL, status.SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const fixtureEmail = /^(?:browser(?:-second)?|http-parity)-[0-9a-f-]{36}@example\.test$|^restore-[0-9a-f]{12}@example\.test$/

try {
  const users = await sql`
    select id, email, created_at
    from app_private.app_users
    where email like '%@example.test'
    order by created_at, id
  `
  const fixtures = users.filter((user) => fixtureEmail.test(user.email ?? ''))
  process.stdout.write(`${JSON.stringify({ mode: apply ? 'apply' : 'dry-run', fixtures }, null, 2)}\n`)
  if (!apply) {
    process.stdout.write('ไม่ได้ลบข้อมูล; ใส่ --apply เพื่อลบเฉพาะ fixture email pattern ที่รายงานข้างต้น\n')
  } else {
    for (const fixture of fixtures) await cleanupAppData(fixture.id)
    await cleanupAuthUsers()
    process.stdout.write(`ลบ local test fixtures แล้ว ${fixtures.length} app users\n`)
  }
} finally {
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

async function cleanupAppData(userId) {
  const assets = await sql`select staging_key, object_key from app_private.assets where created_by = ${userId}`
  const staging = assets.map((asset) => asset.staging_key).filter(Boolean)
  const canonical = assets.map((asset) => asset.object_key).filter(Boolean)
  if (staging.length) {
    const { error } = await admin.storage.from('packit-staging').remove(staging)
    if (error) throw new Error(`ลบ staging fixture ไม่สำเร็จ: ${error.message}`)
  }
  if (canonical.length) {
    const { error } = await admin.storage.from('packit-assets').remove(canonical)
    if (error) throw new Error(`ลบ asset fixture ไม่สำเร็จ: ${error.message}`)
  }
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

async function cleanupAuthUsers() {
  let page = 1
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    const fixtures = data.users.filter((user) => fixtureEmail.test(user.email ?? ''))
    for (const fixture of fixtures) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(fixture.id)
      if (deleteError) throw deleteError
    }
    if (data.users.length < 1000) return
    page += 1
  }
}
