// 0-A3: ขนาด module ที่แต่ละจุดเข้าดึงตามมาแบบ static (esbuild metafile, ไม่รวม dynamic import) — วัดจาก source ไม่ใช่ chunk
import { build } from 'esbuild'
const entries = {
  'ProjectGallery (การ์ด/รายการเดิม)': 'src/components/ProjectGallery.tsx',
  'thumbnailCache + core/thumbnail': 'src/services/thumbnails/thumbnailCache.ts',
  'services/api/projects (client)': 'src/services/api/projects.ts',
  'services/api/session (client)': 'src/services/api/session.ts',
  'core/project (freshProject/parse)': 'src/core/project.ts',
  'core/templates/index (TEMPLATES)': 'src/core/templates/index.ts',
  'core/materials': 'src/core/materials.ts',
  'Login': 'src/components/Login.tsx',
  'CloudRoot (static only)': 'src/CloudRoot.tsx',
  'CloudWorkspace (static only)': 'src/features/projects/CloudWorkspace.tsx',
}
for (const [name, entry] of Object.entries(entries)) {
  const r = await build({ entryPoints: [entry], bundle: true, write: false, metafile: true, minify: true, format: 'esm', platform: 'browser',
    loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl', '.woff2': 'empty', '.woff': 'empty' }, logLevel: 'silent', external: [] })
  const inputs = Object.keys(r.metafile.inputs)
  const out = Object.values(r.metafile.outputs)[0]
  const has = (re) => inputs.some((i) => re.test(i))
  console.log(`${name.padEnd(40)} ${(out.bytes / 1024).toFixed(1).padStart(8)} KB min  modules:${String(inputs.length).padStart(4)}  three:${has(/node_modules\/three\//) ? 'Y' : '-'} r3f:${has(/@react-three/) ? 'Y' : '-'} core/fold:${has(/src\/core\/fold\.ts/) ? 'Y' : '-'} templates:${has(/src\/core\/templates\/index/) ? 'Y' : '-'} pdf:${has(/src\/core\/pdf\.ts/) ? 'Y' : '-'} App:${has(/src\/App\.tsx/) ? 'Y' : '-'} supabase:${has(/@supabase/) ? 'Y' : '-'}`)
}
