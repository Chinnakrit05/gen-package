// Bundle the Vercel serverless entries into self-contained files. จำเป็นเพราะ Vercel รันฟังก์ชัน
// แบบ native ESM และ "ไม่ bundle" import
// ข้ามโฟลเดอร์ (../src, ../server) ให้ — ปล่อยไว้จะ ERR_MODULE_NOT_FOUND ตอนรัน
// รวมทุก dependency ไว้ในไฟล์เดียว (ยกเว้น node builtins) เหลือแค่ import 'node:*' ที่ runtime มีให้อยู่แล้ว
import * as esbuild from 'esbuild'
import { readFile, writeFile } from 'node:fs/promises'

await esbuild.build({
  entryPoints: {
    'box-spec': 'server/handler.ts',
    backend: 'server/entrypoints/vercel.ts',
  },
  outdir: 'api',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  banner: {
    js: '// GENERATED โดย scripts/build-api.mjs — อย่าแก้ไฟล์นี้ตรง ๆ (แก้ที่ server/handler.ts แล้วรัน npm run build:api)',
  },
  logLevel: 'info',
})

// esbuild ใส่ตำแหน่ง source ลงใน comment/module labels; npm กับ pnpm จัด node_modules
// ต่างกันทั้งที่ bundle ทำงานเหมือนกัน ทำให้ generated artifact diff ใหญ่โดยไม่จำเป็น
for (const output of ['api/box-spec.js', 'api/backend.js']) {
  const source = await readFile(output, 'utf8')
  const normalized = source
    .replace(/node_modules\/\.pnpm\/[^/\r\n]+\/node_modules\//g, 'node_modules/')
    .replace(/[ \t]+$/gm, '')
  await writeFile(output, normalized)
}

console.log('bundled → api/box-spec.js, api/backend.js')
