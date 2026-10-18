// bundle core (TypeScript) ให้ Node ใช้ตรง ๆ: node scripts/showcase/bundle-core.mjs → tmp/showcase/core.mjs
import * as esbuild from 'esbuild'
import { mkdir } from 'node:fs/promises'

await mkdir('tmp/showcase', { recursive: true })
await esbuild.build({
  entryPoints: { core: 'scripts/showcase/core-entry.ts' },
  outdir: 'tmp/showcase',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'warning',
})
console.log('bundled → tmp/showcase/core.mjs')
