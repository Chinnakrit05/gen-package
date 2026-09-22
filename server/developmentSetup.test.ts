import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveConfig } from 'vite'

const folders: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
})

describe('developer onboarding', () => {
  it('isolates local-demo from env files and inherited cloud/AI keys', async () => {
    vi.stubEnv('VITE_APP_MODE', 'cloud')
    vi.stubEnv('VITE_SUPABASE_URL', 'https://not-used.example.test')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-public-not-used')
    vi.stubEnv('APP_ENV', 'production')
    vi.stubEnv('SUPABASE_SECRET_KEY', 'test-secret-not-used')
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-ai-not-used')
    const config = await resolveConfig({ configFile: resolve('vite.config.ts'), mode: 'local-demo' }, 'serve')
    expect(config.envDir).toBe(false)
    expect(config.envPrefix).toEqual([])
    expect(config.define).toMatchObject({
      'import.meta.env.VITE_APP_MODE': '"local"',
      'import.meta.env.VITE_API_BASE_URL': '"/api/v1"',
    })
    expect(config.env).not.toHaveProperty('VITE_SUPABASE_PUBLISHABLE_KEY')
    expect(config.env).not.toHaveProperty('SUPABASE_SECRET_KEY')
    expect(config.env).not.toHaveProperty('ANTHROPIC_API_KEY')
  })

  it('creates an optional cloud template without credentials', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'packit-setup-test-'))
    folders.push(folder)
    const output = execFileSync(process.execPath, [resolve('scripts/setup-cloud.mjs')], { cwd: folder, encoding: 'utf8' })
    expect(await readFile(join(folder, '.env.local'), 'utf8')).toBe(await readFile('.env.cloud.example', 'utf8'))
    expect(output).toContain('no credentials included')
  })

  it('never overwrites or prints an existing .env.local, even on repeated setup', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'packit-setup-test-'))
    folders.push(folder)
    const original = 'VITE_APP_MODE=cloud\nSUPABASE_SECRET_KEY=sentinel-do-not-print\n'
    await writeFile(join(folder, '.env.local'), original)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const output = execFileSync(process.execPath, [resolve('scripts/setup-cloud.mjs')], { cwd: folder, encoding: 'utf8' })
      expect(output).toContain('nothing was overwritten')
      expect(output).not.toContain('sentinel-do-not-print')
    }
    expect(await readFile(join(folder, '.env.local'), 'utf8')).toBe(original)
  })
})
