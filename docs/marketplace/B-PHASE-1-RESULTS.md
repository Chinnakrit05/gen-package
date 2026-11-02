# ผลตรวจ Phase 1 ฝั่ง B

2 พฤศจิกายน 2026 — ทดสอบจากฐานโค้ด **b6cb70876f396381a06c04f547011504eca9457b** พร้อมไฟล์ที่ระบุ source hashes ใน [evidence/B-PHASE-1.json](evidence/B-PHASE-1.json) ตรวจ commit รุ่นส่งมอบจาก Git history ของเอกสารนี้

[B รับ A0-r2 และปิด 0-J1/0-J2](REVIEW-A0-r2-B.md) แล้ว ใช้ contract **b-phase0-r1** ตามเดิม ไม่มี endpoint/DTO/migration ใหม่ ไม่แก้ frontend หรือ PROGRESS-A

## สิ่งที่ทำและผลจริง

| งาน | ผลฝั่ง B | สิ่งที่ยังไม่ผ่าน integration ร่วม |
|---|---|---|
| 1-B1 | เรียก bootstrap/me/list/detail/create/thumbnails ผ่าน HTTP router + Auth/PostgreSQL จริงบน local; page 24+1 ไม่รวม document/assets; exact ID/404 และ permission ตรง contract | Requests/query lifecycle ของหน้าใหม่ A |
| 1-B2 | Create retry ไม่สร้างซ้ำ, changed payload 409, CAS owner/editor มีผู้ชนะคนเดียว, save receipt retry และ membership revocation ปฏิเสธ replay; editor delete retry ผ่าน | Browser intent/draft/leave และการหยุดคิวข้ามบัญชีของ A |
| 1-B3 | เพิ่ม SPA rewrite ใน vercel.json โดยคง API rewrite แรก; กัน API/assets/ไฟล์มีนามสกุล/เส้นทาง _vercel; unit path matrix และ Vercel route compiler รับ config | Direct-link/login-return บน router ใหม่ และ preview OAuth/API content type ที่ deploy จริง |
| 1-B4 | Unit/access/API/DB/Storage/billing regression ที่เกี่ยวข้องผ่าน; เตรียมวิธีรัน local และ evidence ไม่มี credentials | A browser checks และ joint acceptance P1-01..P1-12 |

### API integration ใหม่

`tests/integration/editor.api.test.ts` เปิด Node HTTP listener ชั่วคราวบน loopback ต่อ `createApiRouter` และ Supabase จริง ไม่ inject session/repository mocks สร้างบัญชี Auth ชั่วคราว owner/editor/viewer/outsider และ team workspace เพื่อทดสอบหกกลุ่ม:

1. Bootstrap ซ้ำ, /me membership, ไม่รับ local-demo header แทน Bearer และ unknown API ยังเป็น JSON
2. รายการ 24+1, summary fields, exact project ID, missing ID และ outsider ที่ปลอม workspace ไม่ได้สิทธิ์
3. Create retry / payload reuse และ operationId scoped ต่อ actor — editor ที่มีสิทธิ์ใช้ UUID เดียวกันสร้าง intent ของตนได้ ไม่ได้พิสูจน์ว่า replay ข้ามบัญชีจาก UI ปลอดภัย
4. Owner/editor ส่ง save พร้อมกัน expectedRevision เดียวกัน ได้ 200 หนึ่งรายและ 409 หนึ่งราย; retry ผู้ชนะไม่เพิ่ม revision
5. Viewer อ่านได้แต่ create/save/delete/thumbnail write ไม่ได้; editor เขียนภาพได้; batch ของ outsider ไม่คืนภาพข้าม workspace
6. ถอน membership แล้ว replay create ไม่ได้ และ editor ลบด้วย headers เดิมซ้ำได้ receipt เดิม

หลังชุดทดสอบจบตรวจ app_users/projects/auth.users ใน instance ทดสอบ **เหลือ 0 ทั้งสามตาราง** ไม่มีบัญชีหรือรหัสผ่านค้างสำหรับเปิด browser แทนผู้ใช้จริง

### Routing

รูปแบบ negative lookahead ใน rewrite ใช้ capture group ตาม [Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json#negative-lookahead) การตรวจด้วย `@vercel/routing-utils` **6.6.1** (ติดตั้งเฉพาะใต้ tmp ไม่แก้ package/lockfile) ได้ transformed routes โดยไม่มี validation error มี filesystem phase ก่อน rewrite และคง API destination เดิม

`server/entrypoints/deploymentRouting.test.ts` ตรวจ UI direct paths, query/trailing slash, unknown UI, API/legacy functions, missing assets, fonts, browser fixtures และ reserved paths จำนวน **35 cases** เป็น config coverage ไม่ใช่การจำลอง CDN/filesystem หรือผล preview จริง

ข้อจำกัด: paths ที่มีจุดจะไม่เข้า SPA fallback เพื่อไม่ส่ง HTML แทนไฟล์ที่หาย; routes Phase 1 ใช้ UUID และไม่มีจุด รักษา OAuth กลับ origin ตาม A0-r2 ไม่เปลี่ยน remote provider settings

## ผลตรวจและ environment

| การตรวจ | ผล |
|---|---|
| TypeScript noEmit | PASS |
| Unit selected server/API/auth/project + deployment routing | **252 tests / 27 files**, ไม่ fail/skip |
| Real local integration รวม API suite ใหม่ | **25 tests / 8 files**, ไม่ fail/skip |
| pgTAP | **359 assertions / 9 files**, PASS |
| npm run build:local | PASS รวม build:api/typecheck/Vite |
| Cloud fixture build | PASS ใช้ public URL/key ปลอม ไม่ใช่ cloud integration |
| Fixture verifier | PASS **31 synthetic scenarios** |
| Router ใหม่/browser/preview OAuth | NOT_RUN — รอ A/environment |

ใช้ Node **24.10.0**, Supabase CLI **2.117.0**, PostgreSQL **17.6** ใน instance **packit-marketplace-b** แยกจาก Jasper API ที่ `127.0.0.1:55321`, DB พอร์ต `55322` ใช้ migrations ทั้ง 9 ไฟล์ปัจจุบัน ไม่ query/reset อีกโปรเจกต์ ไม่ apply remote migration และไม่ deploy

Local workdir อยู่ `tmp/marketplace-b-local` (ignored): คัดลอก config/seed, เปลี่ยน project_id, เปลี่ยนพอร์ตกลุ่ม 5432x เป็น 5532x และ inspector 8083 เป็น 55883; migrations/tests และ source/dependencies ใช้ symlink จาก checkout ไม่แก้ config ของแอป ปิด realtime/studio/mail/edge runtime ที่ไม่ได้ใช้

หลังตรวจเสร็จใช้ `supabase stop --workdir tmp/marketplace-b-local` หยุดเฉพาะ instance ที่สร้างในรอบนี้และเก็บ local data ไว้ ไม่หยุด Docker หรือ containers ของ Jasper/โปรเจกต์อื่น

## รันซ้ำ

บนเครื่องที่มี PackIt local stack แยกและยืนยันเจ้าของแล้ว ใช้คู่มือ backend เดิมและคำสั่งปกติได้ ชุดทดสอบจะสร้าง/ลบ fixture ของตัวเอง ห้ามชี้ไป remote หรือ instance ของอีกโปรเจกต์

    npm run db:test
    npm run db:test:integration

รอบ B ใช้ CLI `start --workdir tmp/marketplace-b-local` พร้อม exclude services ที่ไม่ใช้ แล้ว `test db --workdir tmp/marketplace-b-local` การรัน Vitest ต้องให้ cwd/root เป็น workdir นี้ (มี symlink node_modules/tests/server/shared/src) เพราะชุด real Auth อ่าน CLI status ตาม cwd และตั้ง PACKIT_TEST_DATABASE_URL จาก DB_URL ของ **instance นี้** ใน memory ก่อน spawn ไม่พิมพ์ URL ที่มี password หรือ status ที่มี keys

คำสั่ง unit/build ที่รันจาก checkout (ใช้ PATH ของ Node 24):

    node node_modules/typescript/bin/tsc --noEmit
    node node_modules/vitest/vitest.mjs run server/entrypoints server/http server/modules/projects server/modules/assets server/adapters/supabase src/services/api src/services/auth src/services/projects --reporter=json --outputFile=tmp/marketplace-b-phase1-unit.json
    npm run build:local
    VITE_APP_MODE=cloud VITE_SUPABASE_URL=http://127.0.0.1:59999 VITE_SUPABASE_PUBLISHABLE_KEY=fixture-not-a-real-key VITE_API_BASE_URL=/api/v1 node node_modules/vite/bin/vite.js build --manifest --outDir tmp/marketplace-b-phase1-build-cloud --emptyOutDir
    node docs/marketplace/fixtures/verify.mjs

Build มี chunk-size warning ของ Editor เดิม ไม่ได้ทำให้งาน lazy boundary ของ A ผ่าน Generated API จาก build เก็บสำเนาใต้ tmp/marketplace-b-phase1-generated เพื่อตรวจแล้วคืน tracked snapshots ให้ตรงฐาน เนื่องจากรอบนี้ไม่แก้ source ของ API และ working tree เริ่มสะอาดทั้งสองไฟล์ ไม่ทิ้งการแก้ของผู้อื่น; ก่อน deploy ยังคงต้องใช้ build workflow เดิมที่ regenerate จาก source

Raw JSON/log อยู่ tmp ของเครื่อง B ไม่อยู่ใน Git ใช้ evidence JSON ที่แนบสำหรับผลส่งต่อ ส่วน environment นี้เป็น local ของ B ไม่ใช่ staging ที่ A เปิดข้ามเครื่องได้

## ส่งต่อ A

Gate Phase 0 ผ่านในฝั่ง B แล้ว เริ่ม 1-A1/1-A2 และงาน frontend ที่ dependency พร้อมได้ ใช้ API/permissions b-phase0-r1 ตามเดิม งานที่ B รอเพื่อปิด Phase 1 คือ browser recovery/identity isolation ของ A และ preview direct-link/OAuth/API checks บน commit ที่รวม router/config จริง ห้ามนับผล local นี้เป็น preview หรือผล P1-01..P1-12 ทั้งชุด
