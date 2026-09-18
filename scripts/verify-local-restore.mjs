import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import sharp from 'sharp'

const container = process.env.PACKIT_TEST_DB_CONTAINER ?? 'supabase_db_gen-package'
if (!/^supabase_db_[A-Za-z0-9_-]+$/.test(container)) {
  throw new Error('PACKIT_TEST_DB_CONTAINER ไม่ใช่ชื่อ local Supabase DB container ที่อนุญาต')
}

const sourceUrl = process.env.PACKIT_TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
const restoreDatabase = `packit_restore_${suffix}`
const containerDump = `/tmp/packit-restore-${suffix}.dump`
if (!/^packit_restore_[0-9a-f]{12}$/.test(restoreDatabase)) throw new Error('unsafe restore database name')
if (!/^\/tmp\/packit-restore-[0-9a-f]{12}\.dump$/.test(containerDump)) throw new Error('unsafe dump path')

const source = postgres(sourceUrl, { max: 1, idle_timeout: 2 })
const localStatus = readLocalStatus()
const storage = createClient(
  process.env.PACKIT_TEST_SUPABASE_URL ?? localStatus.API_URL,
  process.env.PACKIT_TEST_SUPABASE_SECRET_KEY ?? localStatus.SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
).storage
const storageBucket = 'packit-assets'
const storagePath = `restore-drill/${suffix}.png`
let restored = null
let actorId = null
let projectId = null
let storageObjectExists = false

try {
  const issuer = `https://restore-${suffix}.test/auth/v1`
  const [actor] = await source`
    select * from public.bootstrap_personal_workspace(
      ${issuer}, ${`restore-${suffix}`}, 'Restore drill', ${`restore-${suffix}@example.test`}
    )
  `
  actorId = actor.app_user_id
  const operationId = randomUUID()
  const [created] = await source`
    select public.create_project(
      ${actor.app_user_id}, ${actor.personal_workspace_id}, ${operationId}, ${'a'.repeat(64)},
      'Restore fixture', 1, ${source.json({ fixture: suffix, decos: [] })}
    ) as result
  `
  projectId = created.result.id

  dockerExec('pg_dump', '-U', 'postgres', '-d', 'postgres', '--format=custom', '--no-owner',
    '--no-privileges', '--schema=app_private', '--file', containerDump)
  dockerExec('createdb', '-U', 'postgres', restoreDatabase)
  dockerExec('pg_restore', '-U', 'postgres', '-d', restoreDatabase, '--no-owner', '--no-privileges', containerDump)

  const restoredUrl = new URL(sourceUrl)
  restoredUrl.pathname = `/${restoreDatabase}`
  restored = postgres(restoredUrl.toString(), { max: 1, idle_timeout: 2 })
  const [evidence] = await restored`
    select
      (select count(*)::integer from app_private.app_users where id = ${actorId}) as users,
      (select count(*)::integer from app_private.projects where id = ${projectId}) as projects,
      (select count(*)::integer from app_private.project_operations
        where operation_id = ${operationId}) as operations,
      (select document->>'fixture' from app_private.projects where id = ${projectId}) as fixture
  `
  if (
    evidence.users !== 1
    || evidence.projects !== 1
    || evidence.operations !== 1
    || evidence.fixture !== suffix
  ) throw new Error(`restore verification failed: ${JSON.stringify(evidence)}`)

  const objectBackup = await sharp({
    create: { width: 3, height: 2, channels: 4, background: { r: 32, g: 96, b: 160, alpha: 1 } },
  }).png().toBuffer()
  const expectedObjectHash = sha256(objectBackup)
  await uploadStorageObject(objectBackup)
  storageObjectExists = true
  if (await downloadStorageHash() !== expectedObjectHash) throw new Error('initial storage object checksum mismatch')

  await removeStorageObject()
  storageObjectExists = false
  await uploadStorageObject(objectBackup)
  storageObjectExists = true
  if (await downloadStorageHash() !== expectedObjectHash) throw new Error('restored storage object checksum mismatch')

  process.stdout.write('Local database + Storage restore drill: PASS\n')
  process.stdout.write('Verified app user, project document, durable operation receipt, and a sample object checksum after restore.\n')
} finally {
  if (storageObjectExists) await removeStorageObject().catch(() => undefined)
  if (restored) await restored.end({ timeout: 1 }).catch(() => undefined)
  if (actorId) await cleanupSourceFixture(source, actorId).catch(() => undefined)
  await source.end({ timeout: 1 }).catch(() => undefined)
  dockerExecBestEffort('dropdb', '-U', 'postgres', '--if-exists', '--force', restoreDatabase)
  dockerExecBestEffort('rm', '--', containerDump)
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

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function uploadStorageObject(bytes) {
  const { error } = await storage.from(storageBucket).upload(storagePath, bytes, {
    contentType: 'image/png',
    upsert: false,
  })
  if (error) throw new Error(`storage upload failed: ${error.message}`)
}

async function downloadStorageHash() {
  const { data, error } = await storage.from(storageBucket).download(storagePath)
  if (error || !data) throw new Error(`storage download failed: ${error?.message ?? 'missing bytes'}`)
  return sha256(Buffer.from(await data.arrayBuffer()))
}

async function removeStorageObject() {
  const { error } = await storage.from(storageBucket).remove([storagePath])
  if (error) throw new Error(`storage cleanup failed: ${error.message}`)
}

function dockerExec(...args) {
  const result = spawnSync('docker', ['exec', container, ...args], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`docker exec ${args[0]} failed: ${(result.stderr || result.stdout).trim()}`)
  }
}

function dockerExecBestEffort(...args) {
  spawnSync('docker', ['exec', container, ...args], { encoding: 'utf8' })
}

async function cleanupSourceFixture(sql, userId) {
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
