import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const EXPECTED_PROJECT_REF = 'feuwdzgixarxpsscrwxp'
const EXPECTED_PROJECT_NAME = 'gen-package-staging'
const EXPECTED_ORGANIZATION_ID = 'xbevtlzmeoojfvsrvkng'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const supabaseCli = path.join(root, 'node_modules', 'supabase', 'dist', 'supabase.js')
const versionPattern = /^\d{14}$/

function fail(message) { throw new Error(message) }
function pass(message) { console.log(`PASS  ${message}`) }

// Supabase 2.117 returns a text table for migration list even with --output json.
// Parse only the Local/Remote columns; malformed output must never become READY.
export function parseMigrationRows(output) {
  const text = output.trim()
  let rows
  if (text.startsWith('{') || text.startsWith('[')) {
    const value = JSON.parse(text)
    rows = Array.isArray(value) ? value : value.migrations
    if (!Array.isArray(rows)) fail('Migration JSON has no migrations array')
  } else {
    const lines = text.split(/\r?\n/)
    const header = lines.findIndex(line => /^\s*\|?\s*Local\s*\|\s*Remote\s*\|\s*Time\s*\(UTC\)/.test(line))
    if (header < 0) fail('Migration output has no recognized Local/Remote header')
    rows = []
    for (const line of lines.slice(header + 1)) {
      if (!line.trim()) continue
      let cells = line.split('|').map(cell => cell.trim())
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) cells = cells.slice(1, -1)
      if (cells.every(cell => /^[-:+\s]+$/.test(cell))) continue
      if (cells.length !== 3) fail('Unrecognized migration table row')
      const clean = value => value.replace(/^`([^`]*)`$/, '$1').trim()
      rows.push({ local: clean(cells[0]), remote: clean(cells[1]) })
    }
  }
  if (rows.length === 0) fail('Migration output contains no rows')
  const seen = { local: new Set(), remote: new Set() }
  return rows.map(row => {
    const parsed = {}
    for (const side of ['local', 'remote']) {
      const value = row?.[side] ?? ''
      if (typeof value !== 'string' || (value !== '' && !versionPattern.test(value))) fail(`Invalid ${side} migration version`)
      if (value && seen[side].has(value)) fail(`Duplicate ${side} migration version: ${value}`)
      if (value) seen[side].add(value)
      parsed[side] = value
    }
    if (!parsed.local && !parsed.remote) fail('Empty migration row')
    if (parsed.local && parsed.remote && parsed.local !== parsed.remote) fail('Mismatched migration row')
    return parsed
  })
}

export function compareMigrationHistory(localVersions, rows) {
  const sorted = [...localVersions].sort()
  if (!sorted.length || new Set(sorted).size !== sorted.length || sorted.some(value => !versionPattern.test(value))) fail('Invalid local migration manifest')
  const listedLocal = rows.map(row => row.local).filter(Boolean).sort()
  if (JSON.stringify(sorted) !== JSON.stringify(listedLocal)) fail('CLI local history does not match repository migration files')
  const remote = rows.map(row => row.remote).filter(Boolean).sort()
  const remoteOnly = remote.filter(version => !sorted.includes(version))
  const missing = sorted.filter(version => !remote.includes(version))
  const latestRemote = remote.at(-1) ?? ''
  return {
    remoteOnly,
    historicalGaps: missing.filter(version => version < latestRemote),
    pending: missing.filter(version => version > latestRemote),
    ready: remoteOnly.length === 0 && missing.length === 0,
  }
}

function runSupabase(args) {
  const result = spawnSync(process.execPath, [supabaseCli, ...args], {
    cwd: root, encoding: 'utf8', shell: false, windowsHide: true,
    timeout: 60_000, maxBuffer: 5 * 1024 * 1024,
  })
  // Do not print CLI stderr, credentials, or connection strings on failures.
  if (result.error || result.status !== 0) fail(`Supabase read failed: ${args.slice(0, 2).join(' ')}; verify existing authorized CLI access`)
  return result.stdout
}

function expectConfig(text, pattern, label) {
  if (!pattern.test(text)) fail(`supabase/config.toml ไม่ตรง staging policy: ${label}`)
  pass(label)
}

export function main() {
  console.log('PackIt staging preflight (read-only metadata; no link, push, repair or reset)')
  const linkedRefPath = path.join(root, 'supabase', '.temp', 'project-ref')
  if (existsSync(linkedRefPath) && readFileSync(linkedRefPath, 'utf8').trim() !== EXPECTED_PROJECT_REF) {
    fail('Working copy is linked to a different project; stop and inspect it without changing the link')
  }
  const projects = JSON.parse(runSupabase(['projects', 'list', '--output', 'json']))
  if (!Array.isArray(projects)) fail('Project list is not an array')
  const project = projects.find(candidate => candidate.ref === EXPECTED_PROJECT_REF)
  if (!project || project.name !== EXPECTED_PROJECT_NAME || project.organization_id !== EXPECTED_ORGANIZATION_ID) {
    fail('Expected staging project identity is not available in this CLI account')
  }
  if (project.status !== 'ACTIVE_HEALTHY') fail(`Staging project is not healthy: ${project.status}`)
  pass(`${EXPECTED_PROJECT_NAME} (${EXPECTED_PROJECT_REF}) is ACTIVE_HEALTHY; explicit target, local linking not required`)

  const config = readFileSync(path.join(root, 'supabase', 'config.toml'), 'utf8')
  expectConfig(config, /\[storage\.buckets\.packit-staging\][\s\S]*?public\s*=\s*false[\s\S]*?file_size_limit\s*=\s*"10MiB"[\s\S]*?allowed_mime_types\s*=\s*\["image\/png",\s*"image\/jpeg"\]/, 'committed packit-staging policy: private PNG/JPEG, 10 MiB')
  expectConfig(config, /\[storage\.buckets\.packit-assets\][\s\S]*?public\s*=\s*false[\s\S]*?file_size_limit\s*=\s*"10MiB"[\s\S]*?allowed_mime_types\s*=\s*\["image\/png",\s*"image\/jpeg"\]/, 'committed packit-assets policy: private PNG/JPEG, 10 MiB')
  expectConfig(config, /site_url\s*=\s*"http:\/\/127\.0\.0\.1:5173"/, 'committed local Auth Site URL')
  expectConfig(config, /additional_redirect_urls\s*=\s*\["http:\/\/127\.0\.0\.1:5173",\s*"http:\/\/localhost:5173"\]/, 'committed local Auth redirect allowlist')

  const files = readdirSync(path.join(root, 'supabase', 'migrations')).filter(name => /^\d{14}_.+\.sql$/.test(name)).sort()
  const local = files.map(name => name.slice(0, name.indexOf('_')))
  const rows = parseMigrationRows(runSupabase(['migration', 'list', '--project-ref', EXPECTED_PROJECT_REF, '--output', 'json']))
  const result = compareMigrationHistory(local, rows)
  for (const [label, versions] of [
    ['REMOTE-ONLY — stop; inspect divergent history', result.remoteOnly],
    ['HISTORICAL GAP — inspect actual schema before any repair/replay', result.historicalGaps],
    ['PENDING — requires reviewed, authorized remote upgrade', result.pending],
  ]) {
    for (const version of versions) console.log(`${label}: ${files.find(name => name.startsWith(version + '_')) ?? version}`)
  }
  if (!result.ready) fail('Remote migration history differs. No remote mutation was attempted. See docs/marketplace/STAGING-ROLLOUT.md.')
  pass(`${local.length} migration versions match local and remote history`)
  console.log('\nMETADATA READY — not deployment or pilot acceptance. Version parity does not verify remote SQL contents, OAuth, bucket policies, Realtime, Vercel, backups or physical devices.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main() } catch (error) { console.error(`BLOCKED  ${error.message}`); process.exitCode = 1 }
}
