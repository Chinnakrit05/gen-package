// Bundle the Vercel serverless entry (server/handler.ts) into a single self-contained
// file api/box-spec.js. จำเป็นเพราะ Vercel รันฟังก์ชันแบบ native ESM และ "ไม่ bundle" import
// ข้ามโฟลเดอร์ (../src, ../server) ให้ — ปล่อยไว้จะ ERR_MODULE_NOT_FOUND ตอนรัน
// รวมทุก dependency ไว้ในไฟล์เดียว (ยกเว้น node builtins) เหลือแค่ import 'node:*' ที่ runtime มีให้อยู่แล้ว
import * as esbuild from 'esbuild'

await esbuild.build({
  entryPoints: ['server/handler.ts'],
  outfile: 'api/box-spec.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  banner: {
    js: '// GENERATED โดย scripts/build-api.mjs — อย่าแก้ไฟล์นี้ตรง ๆ (แก้ที่ server/handler.ts แล้วรัน npm run build:api)',
  },
  logLevel: 'info',
})

console.log('bundled → api/box-spec.js')
