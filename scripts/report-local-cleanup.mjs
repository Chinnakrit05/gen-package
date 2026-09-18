import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'

const status = readLocalStatus()
const sql = postgres(status.DB_URL, { max: 1, idle_timeout: 2 })
const storage = createClient(status.API_URL, status.SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
}).storage

try {
  const assets = await sql`
    select id, state, staging_key, object_key, ticket_expires_at, processing_lease_until
    from app_private.assets
    order by created_at, id
  `
  const reservations = await sql`
    select asset_id, state, expires_at
    from app_private.storage_reservations
    order by expires_at, asset_id
  `
  const unreferencedReady = await sql`
    select assets.id
    from app_private.assets assets
    left join app_private.project_assets links on links.asset_id = assets.id
    where assets.state = 'ready' and links.asset_id is null
    order by assets.id
  `

  const [stagingObjects, canonicalObjects] = await Promise.all([
    listStorageObjects('packit-staging'),
    listStorageObjects('packit-assets'),
  ])
  const now = Date.now()
  const expectedStaging = new Set(assets.map((asset) => asset.staging_key).filter(Boolean))
  const expectedCanonical = new Set(assets.map((asset) => asset.object_key).filter(Boolean))
  const stagingSet = new Set(stagingObjects)
  const canonicalSet = new Set(canonicalObjects)

  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'dry-run',
    counts: {
      assets: assets.length,
      stagingObjects: stagingObjects.length,
      canonicalObjects: canonicalObjects.length,
    },
    candidates: {
      expiredTickets: assets
        .filter((asset) => ['pending', 'validating'].includes(asset.state)
          && new Date(asset.ticket_expires_at).getTime() < now)
        .map((asset) => asset.id),
      expiredValidationLeases: assets
        .filter((asset) => asset.state === 'validating'
          && asset.processing_lease_until
          && new Date(asset.processing_lease_until).getTime() < now)
        .map((asset) => asset.id),
      expiredReservations: reservations
        .filter((reservation) => reservation.state === 'reserved'
          && new Date(reservation.expires_at).getTime() < now)
        .map((reservation) => reservation.asset_id),
      unreferencedReadyAssets: unreferencedReady.map((asset) => asset.id),
      rejectedOrDeletedAssets: assets
        .filter((asset) => ['rejected', 'deleted'].includes(asset.state))
        .map((asset) => asset.id),
      orphanStagingObjects: stagingObjects.filter((key) => !expectedStaging.has(key)),
      orphanCanonicalObjects: canonicalObjects.filter((key) => !expectedCanonical.has(key)),
      missingStagingObjects: assets
        .filter((asset) => ['pending', 'validating'].includes(asset.state)
          && asset.staging_key
          && !stagingSet.has(asset.staging_key))
        .map((asset) => asset.id),
      missingCanonicalObjects: assets
        .filter((asset) => asset.state === 'ready'
          && asset.object_key
          && !canonicalSet.has(asset.object_key))
        .map((asset) => asset.id),
    },
    note: 'รายงานเท่านั้น: ไม่มีการลบหรือแก้ DB/Storage จนกว่าจะยืนยัน retention และ operator approval',
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
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

async function listStorageObjects(bucket) {
  const objects = []
  const pendingPrefixes = ['']
  while (pendingPrefixes.length > 0) {
    const prefix = pendingPrefixes.pop()
    let offset = 0
    while (true) {
      const { data, error } = await storage.from(bucket).list(prefix, {
        limit: 1000,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      })
      if (error) throw new Error(`list ${bucket}/${prefix} failed: ${error.message}`)
      for (const entry of data) {
        const key = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.id || entry.metadata) objects.push(key)
        else pendingPrefixes.push(key)
      }
      if (data.length < 1000) break
      offset += data.length
    }
  }
  return objects.sort()
}
