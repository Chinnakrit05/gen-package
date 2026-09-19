import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const EXPECTED_PROJECT_REF = 'feuwdzgixarxpsscrwxp'
const EXPECTED_PROJECT_NAME = 'gen-package-staging'
const EXPECTED_ORGANIZATION_ID = 'xbevtlzmeoojfvsrvkng'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const supabaseCli = path.join(root, 'node_modules', 'supabase', 'dist', 'supabase.js')

function pass(message) {
  console.log(`PASS  ${message}`)
}

function fail(message) {
  throw new Error(message)
}

function runSupabase(args) {
  const result = spawnSync(process.execPath, [supabaseCli, ...args], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  })
  if (result.error) fail(`เรียก Supabase CLI ไม่สำเร็จ: ${result.error.message}`)
  if (result.status !== 0) fail(`Supabase CLI ล้มเหลว: npx supabase ${args.join(' ')}`)
  try {
    return JSON.parse(result.stdout.trim())
  } catch {
    fail(`Supabase CLI ไม่ได้คืน JSON ตามที่คาด: npx supabase ${args.join(' ')}`)
  }
}

function expectConfig(text, pattern, label) {
  if (!pattern.test(text)) fail(`supabase/config.toml ไม่ตรง staging policy: ${label}`)
  pass(label)
}

function sameValues(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

console.log('PackIt staging readiness (read-only)')

const linkedRefPath = path.join(root, 'supabase', '.temp', 'project-ref')
if (!existsSync(linkedRefPath)) fail('ยังไม่ได้ link Supabase project ใน working copy นี้')
const linkedRef = readFileSync(linkedRefPath, 'utf8').trim()
if (linkedRef !== EXPECTED_PROJECT_REF) {
  fail(`project ที่ link อยู่ไม่ใช่ staging ที่อนุญาต (พบ ${linkedRef || 'ค่าว่าง'})`)
}
pass(`linked project ref = ${EXPECTED_PROJECT_REF}`)

const projects = runSupabase(['projects', 'list', '--output', 'json'])
const project = projects.find((candidate) => candidate.ref === EXPECTED_PROJECT_REF)
if (!project) fail('ไม่พบ staging project ใน account ที่ Supabase CLI login อยู่')
if (project.name !== EXPECTED_PROJECT_NAME) fail(`ชื่อ staging project ไม่ตรง: ${project.name}`)
if (project.organization_id !== EXPECTED_ORGANIZATION_ID) fail('staging project อยู่ผิด organization')
if (project.status !== 'ACTIVE_HEALTHY') fail(`staging project ไม่ healthy: ${project.status}`)
if (!project.linked) fail('Supabase CLI ไม่รายงานว่า staging project ถูก link อยู่')
pass(`${EXPECTED_PROJECT_NAME} is ACTIVE_HEALTHY in the expected organization`)

const migrationFiles = readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort()
const localVersions = migrationFiles.map((name) => name.slice(0, name.indexOf('_')))
const migrationResult = runSupabase(['migration', 'list', '--linked'])
const migrationRows = Array.isArray(migrationResult.migrations) ? migrationResult.migrations : []
const remoteLocalVersions = migrationRows.map((row) => row.local).filter(Boolean).sort()
const remoteVersions = migrationRows.map((row) => row.remote).filter(Boolean).sort()
if (!sameValues(localVersions, remoteLocalVersions) || !sameValues(localVersions, remoteVersions)) {
  fail('local/remote migration history ไม่ตรงกัน')
}
pass(`${localVersions.length} migrations match local and remote history`)

const dryRun = runSupabase(['db', 'push', '--linked', '--dry-run'])
if (dryRun.upToDate !== true || dryRun.dryRun !== true || dryRun.migrations?.length !== 0) {
  fail('remote database ยังมี migration pending หรือ dry-run result ไม่ตรงที่คาด')
}
pass('linked database is up to date (db push --dry-run; no write)')

const config = readFileSync(path.join(root, 'supabase', 'config.toml'), 'utf8')
expectConfig(config, /\[storage\.buckets\.packit-staging\][\s\S]*?public\s*=\s*false[\s\S]*?file_size_limit\s*=\s*"10MiB"[\s\S]*?allowed_mime_types\s*=\s*\["image\/png",\s*"image\/jpeg"\]/, 'packit-staging bucket policy is private PNG/JPEG, 10 MiB')
expectConfig(config, /\[storage\.buckets\.packit-assets\][\s\S]*?public\s*=\s*false[\s\S]*?file_size_limit\s*=\s*"10MiB"[\s\S]*?allowed_mime_types\s*=\s*\["image\/png",\s*"image\/jpeg"\]/, 'packit-assets bucket policy is private PNG/JPEG, 10 MiB')
expectConfig(config, /site_url\s*=\s*"http:\/\/127\.0\.0\.1:5173"/, 'local Auth Site URL is tracked')
expectConfig(config, /additional_redirect_urls\s*=\s*\["http:\/\/127\.0\.0\.1:5173",\s*"http:\/\/localhost:5173"\]/, 'local Auth redirect allowlist is tracked')

console.log('\nREADY  Linked staging project, migrations, and committed policies are consistent.')
console.log('MANUAL Google OAuth, deployed Vercel/Sharp parity, remote Storage CORS, and restore/open drill remain gated.')
