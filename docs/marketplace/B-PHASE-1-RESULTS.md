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

## ตรวจรับร่วม A/B 5 พฤศจิกายน 2026

ชุดแก้บน `codex/marketplace-phase-1-integration` ฐาน `a85de8bf39af6d9cdffa29cc2a2460262a4daaac` รวม router ของ A และ config ของ B แล้ว ใช้ contract `b-phase0-r1` ตรวจโดยแยกผลเบราว์เซอร์จำลอง ผล Supabase จริงในเครื่อง และผล staging ที่เผยแพร่อยู่

| รายการ | หลักฐานและผล |
|---|---|
| P1-01–P1-03 | Browser fixture ตรวจ cold load, หน้าแรก 24 รายการและ cursor, ภาพย่อแบบ batch และ placeholder API จริงตรวจ 24+1 รายการและ summary ไม่มี document/assets |
| P1-04–P1-06 | Browser + Auth/API จริงในเครื่องตรวจเปิด ID ตรง URL และ refresh, retry หลังคำตอบ create หายใช้ payload/operationId เดิม, เปิดร่างออฟไลน์จากหน้ารายการและลองบันทึกหลัง reconnect ชุด Cloud regression ตรวจ CAS 409 ข้ามแท็บและโหลดฉบับล่าสุด |
| P1-07 | Local-demo ตรวจแก้/undo/redo ข้าม V1/V2, ดู 3D, ส่งออก SVG และรีเฟรช Cloud regression ตรวจย้ายงานเดิมจากหน้ารายการ, preset/portable file และการดาวน์โหลด PDF/SVG ตามสิทธิ์ด้วยการจำลองการชำระในเครื่อง |
| P1-08–P1-09 | API และ browser กับบัญชีสังเคราะห์ owner/editor/viewer/outsider ตรวจสิทธิ์เขียน อ่าน สลับบัญชีในแท็บเดิม และ URL ที่ไม่มีสิทธิ์ เมื่อลดบทบาท editor เป็น viewer ขณะเปิดงาน API ปฏิเสธการแก้และ UI เปลี่ยนเป็นดูอย่างเดียวหลังอ่านสิทธิ์ใหม่ Browser fixture ตรวจสลับ workspace ระหว่างคำขอค้างและการแยกร่าง/ภาพย่อ |
| P1-10 | Staging ที่ `packit-design.vercel.app` ตอบ HTML 200 สำหรับลิงก์ตรง `/app/projects` และ `/editor/:id` ลิงก์ตรงกับ refresh เก็บ `returnTo` ในหน้า login, API `/api/v1/me` ตอบ 401 JSON, health ตอบ 200 JSON และไฟล์ static ที่ไม่มีตอบ 404 ตรวจเริ่ม Google PKCE และ `redirect_to` ตรง origin แล้ว |
| P1-11 | Browser fixture ตรวจ loading/empty, 503 แล้ว retry, offline แล้ว reconnect, refresh token ของบัญชีเดิม และ session หมดอายุแล้วกลับ login พร้อมปลายทางเดิม Cloud regression ตรวจ conflict/retry จริงในเครื่อง |
| P1-12 | TypeScript, build local-demo และ cloud fixture, full Vitest, pgTAP และ integration จริงในเครื่อง ตรวจ local-demo แยกจาก cloud และใช้ข้อมูลสังเคราะห์เท่านั้น |

Supabase CLI 2.117.0 และ PostgreSQL 17.6 ใช้ workdir `tmp/marketplace-phase1-local` แยกจาก stack อื่น พอร์ต API 55321 และ DB 55322 ชุด backend integration ผ่าน 25 เทสต์จาก 8 ไฟล์, pgTAP 359 assertions จาก 9 ไฟล์ และ fixture verifier 31 เคส Vercel routing matrix ผ่าน 35 เคส และ adapter ที่รันในเครื่องตอบ 200/401/404 เป็น JSON

Full Vitest ผ่าน 1,504 เทสต์ ข้าม 6 เทสต์ตามเงื่อนไขของชุดปกติ Browser fixture ผ่าน 33/33 และ browser ที่ต่อ Supabase จริงผ่านทั้งสองสคริปต์ด้านล่าง Build ของ API bundles, TypeScript และ Vite ทั้งสองโหมดผ่าน Vite แจ้งเตือนขนาด chunk ของ Editor ตอน build หน้ารายการและหน้าเข้าสู่ระบบยังเปิดได้โดยไม่โหลด chunk นี้ หน้า login ใช้ JavaScript ประมาณ 202 KB ใน local-demo และ 569 KB ใน cloud fixture ตามการวัดแบบไม่ใช้แคช

ตรวจทานข้ามบทบาทกับ contract และทดสอบซ้ำหลังแก้สามจุด จำกัดการย้ายงานเดิมไว้ที่พื้นที่ส่วนตัว อ่านโทเคนของบัญชีเดิมอีกครั้งก่อนยืนยันอัปโหลด และอ่าน membership ใหม่หลัง API ปฏิเสธการเขียน สองชุดทดสอบใช้บัญชีสังเคราะห์คนละชุดในฐานเดียวกัน หลังจบตรวจว่า `auth.users`, `app_users` และ `projects` เหลือ 0 แล้วหยุด stack ทดสอบ

รัน Browser integration โดยใช้ Node 24 และ Chrome ที่ติดตั้งไว้ คำสั่งสร้างและลบ fixture เฉพาะบัญชีที่ชุดทดสอบสร้างขึ้น

    node scripts/marketplace/cloud-local.mjs tmp/marketplace-phase1-local
    PACKIT_E2E_PORT=52474 PACKIT_E2E_SUPABASE_WORKDIR=tmp/marketplace-phase1-local npm run test:e2e:local

**เงื่อนไขที่ยังเหลือก่อนปิด Phase 1** — Preview ของ commit ที่มีชุดแก้ล่าสุดพร้อมบัญชี Google ทดสอบที่เข้าถึงได้ แล้วตรวจ callback กลับเข้า URL เดิมและเปิดงานจริง บน staging ที่มีอยู่ได้ตรวจถึงขั้นเริ่ม OAuth เท่านั้น และ Preview ของ `b6f43f1` พาไป Vercel SSO ผลในเครื่องใช้เซสชันที่ Supabase ออกให้จริงโดยใช้รหัสผ่านสังเคราะห์ จึงไม่ใช่ผล Google callback

### ผลตรวจ Preview ของ 66a3fb2

Vercel สร้าง Preview ของ `66a3fb2749e7c3d4ce24c7cdf26f4105c1bed66a` สำเร็จ หลังผู้ใช้ผ่าน Vercel SSO ตรวจใน Safari แล้ว `/app/projects` แสดง Editor แบบ local-demo และ `/api/v1/health` ตอบ `500 FUNCTION_INVOCATION_FAILED` Runtime Logs ของคำขอนี้ระบุว่าไม่มี `APP_ENV` ขณะรันใน Vercel [Preview ที่ตรวจ](https://gen-package-staging-o4whck5yy-chinnakrit05s-projects.vercel.app/app/projects) · [Deployment](https://vercel.com/chinnakrit05s-projects/gen-package-staging/HM8V8WwhocGWQdGXMRwKPmEHHVN7)

`P1-10` รอ Cloud config ของ Supabase staging สำหรับ Preview สาขาทดสอบ และ URL กลับเข้าแอปที่อนุญาตใน Supabase Auth จากนั้นจึง deploy ใหม่และตรวจ health, API JSON, Google callback และการกลับไปยังงานเดิมด้วยบัญชีทดสอบ

### ผลตรวจหลัง redeploy จาก commit เดิม

เพิ่ม Cloud config 8 รายการเฉพาะ Preview ของ `codex/marketplace-phase-1-integration` และเพิ่ม origin ประจำสาขาในรายการ redirect ของ Supabase staging ตรวจซ้ำแล้วว่ามี URL ตรงกันเพียงหนึ่งรายการและเก็บ URL เดิมครบสี่รายการ Vercel ยืนยันว่า deployment `dpl_6cygmJZjXecyvy4rycbXVyXeFc7N` สถานะ Ready ใช้ SHA `66a3fb2749e7c3d4ce24c7cdf26f4105c1bed66a` และ URL ประจำสาขาชี้มาที่ deployment นี้ [Preview](https://gen-package-staging-git-codex-mar-442afb-chinnakrit05s-projects.vercel.app) · [Deployment](https://vercel.com/chinnakrit05s-projects/gen-package-staging/6cygmJZjXecyvy4rycbXVyXeFc7N)

Safari หลังผ่าน Vercel SSO แสดง JSON `data.status: ok` ที่ `/api/v1/health` และ Vercel request logs ของ deployment นี้ยืนยัน `200` ที่ health กับ `401` ที่ `/api/v1/me` ก่อนเข้าสู่ PackIt คำขอเริ่ม Google PKCE ไปยัง Supabase staging ตอบ `302` ไป Google พร้อม callback ของ Supabase staging

รอบทดสอบด้วยบัญชีจริงใน Safari เปิดหน้ารวมงานและ Editor ของงานเดิมได้ Vercel request logs ของ deployment นี้พบ `POST /api/v1/session/bootstrap`, `GET /api/v1/me`, `GET /api/v1/projects` และ `GET /api/v1/projects/:id` ตอบ `200`

`P1-10` ผ่านบน Preview นี้ เปิด `/editor/:id` ของงานทดสอบที่มีอยู่ในหน้าต่าง Safari ส่วนตัว เริ่มจาก Vercel SSO และหน้าเข้าสู่ PackIt ผู้ใช้เข้าสู่ระบบด้วย Google แล้วกลับมาที่ Editor ในหน้าต่างเดิม URL ตรงกับลิงก์ก่อนเข้าสู่ระบบและเครื่องมือ Editor แสดงครบ รีเฟรชแล้วยังเปิดงานเดิมได้ จากนั้นเปิด `/app/projects` ด้วย URL ตรงและรีเฟรช หน้ารวมงานโหลดได้ทั้งสองครั้ง

Vercel request logs ของ deployment เดียวกันช่วง 23:11–23:13 น. เวลาไทยยืนยัน `GET /editor/:id` และ `GET /app/projects` ตอบ `200` หลัง Google กลับที่ origin `POST /api/v1/session/bootstrap`, `GET /api/v1/me`, `GET /api/v1/projects` และ `GET /api/v1/projects/:id` ตอบ `200` โดย ID ใน API ตรงกับลิงก์ที่เปิด ตรวจ JSON ของ health และ `401` ก่อนเข้าสู่ PackIt ในรอบก่อนหน้าแล้ว

พบ `PUT /api/v1/projects/:id/thumbnail` ตอบ `503` บน Preview เดียวกัน ตรวจ migration history และ catalog ของ `gen-package-staging` ด้วย `SELECT` พบว่าฐานข้อมูลใช้ migrations ถึง `20261015000700` และยังไม่มีตาราง `app_private.project_thumbnails` หรือ RPC สำหรับบันทึกและอ่านภาพย่อทั้งสามตัว ส่วนภาพย่อของ `P1-03` และ `P1-08` บน Preview จึงยังรอ migration `20261024000800_project_thumbnails.sql` ผลทดสอบภาพย่อในเครื่องยังใช้เป็นหลักฐานของ local เท่านั้น

Supabase CLI `db push --linked --project-ref <staging-ref> --workdir <temp> --skip-vault --dry-run` ผ่าน โดยโฟลเดอร์ชั่วคราวใช้ migrations 001–008 จาก commit ที่ deploy และตรวจชื่อโครงการปลายทางก่อนรัน Dry-run แสดงเฉพาะไฟล์ภาพย่อ `20261024000800_project_thumbnails.sql` การรันจริงยังรออนุญาต เพราะเปลี่ยน schema ของฐาน staging ที่ Preview และเว็บ staging ใช้ร่วมกัน

### ตรวจภาพย่อบน staging 6 พฤศจิกายน 2026

หลังผู้ใช้อนุญาต ตรวจชื่อโครงการ `gen-package-staging` และเทียบ migration กับ `main` แล้วรัน dry-run อีกครั้งก่อน apply เฉพาะ `20261024000800_project_thumbnails.sql` ประวัติ migration ตรงกับไฟล์ 001–008 ตาราง `app_private.project_thumbnails` เปิด RLS และฟังก์ชันภาพย่อทั้งสามให้สิทธิ์เรียกเฉพาะ `service_role` ตรวจด้วย catalog ของ staging แล้ว

ก่อนทดสอบ งานเดิมมีแคชภาพในแท็บ Preview จากรอบที่อัปโหลดไม่ผ่าน และฐาน staging ยังไม่มีแถวภาพย่อของงานนี้ เปิดงานเดียวกันที่ `packit-design.vercel.app` ด้วยบัญชีทดสอบที่มีสิทธิ์แก้ไข Editor สร้างภาพอัตโนมัติและ `PUT /api/v1/projects/:id/thumbnail` ตอบ `200` เวลา 22:22 น. จาก deployment `dpl_Eo1SP8BEZdXwwJaxU4YxXgupS6Ub` ตรวจแถวของงานใน staging แบบอ่านอย่างเดียว พบ JPEG 10,164 ไบต์ เวอร์ชันภาพตรงกับช่วงทดสอบ ตรวจ revision ของงานได้ 14 ทั้งก่อนและหลังทดสอบ

เปิดหน้ารวมงานผ่าน Preview ซึ่งใช้แคชอีกชุด พบ `POST /api/v1/projects/thumbnails` ตอบ `200` เวลา 22:23 น. รีเฟรช `/app/projects` ใน Safari บน `packit-design.vercel.app` แล้วเห็นภาพจริงบนการ์ดงานเดิม การบันทึกและอ่านภาพย่อของ `P1-03` ผ่านบน staging ด้วยงานทดสอบหนึ่งงาน ส่วนสิทธิ์แต่ละบทบาทของ `P1-08` อ้างอิงผลตรวจฐานจริงในเครื่องและ catalog ข้างต้น การทดสอบผ่านเว็บรอบนี้ใช้บัญชีที่มีสิทธิ์แก้ไข [หน้ารวมงาน staging](https://packit-design.vercel.app/app/projects)
