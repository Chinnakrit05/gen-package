# Backend implementation progress

อัปเดตล่าสุด: 22 กันยายน 2026

เอกสารนี้บันทึกผลที่รันจริง แยกจาก blueprint ใน `backend-implementation-spec.md`

## P0.1 — Baseline

สถานะ: เสร็จสำหรับการตรวจ baseline

- Branch: `feat/supabase-backend`
- จุดเริ่มทำงาน: `908c4d1`; worktree สะอาดก่อนเริ่ม
- Runtime ที่ใช้ตรวจล่าสุด: Node.js `v24.19.0`, npm `11.17.0`
- `npm ci`: ผ่านจาก `package-lock.json` โดยไม่แก้ lockfile
- `npm test`: ผ่าน 21 test files, 343 tests
- `npm run build`: ผ่านทั้ง API bundle, `tsc --noEmit` และ Vite production build; มี warning เดิมเรื่อง chunk ใหญ่กว่า 500 kB
- รัน API bundler ผ่าน และสร้าง `api/backend.js`; `api/box-spec.js` ที่ build ด้วย pnpm มี diff จาก transitive dependency layout/version จึงไม่เก็บ artifact ที่ไม่เกี่ยวข้องนั้นไว้
- หลังติดตั้งใหม่ด้วย npm และ build ซ้ำ `api/box-spec.js` ตรงกับ artifact เดิม ไม่มี generated diff ที่ไม่เกี่ยวข้อง
- `npm audit`: dependency tree ทั้งหมดรายงาน 7 รายการ (moderate 4, high 3); เมื่อ `--omit=dev` เหลือ production transitive `fflate` 1 รายการระดับ moderate ยังไม่ได้สั่ง `audit fix` อัตโนมัติ

## P0.2 — Foundations

สถานะ: implemented และผ่าน local unit/build checks; ยังไม่ได้ทดสอบบน Vercel

สิ่งที่เพิ่ม:

- shared HTTP/error/system contracts ที่ไม่ import React หรือ provider SDK
- strict client config สำหรับ `local | cloud`; local เป็นค่าเริ่มต้น และ cloud ที่ขาด public config จะหยุดพร้อมข้อความ ไม่ fallback ไป mock login
- strict server config สำหรับ environment/origin allowlist; production-like runtime ต้องตั้ง `APP_ENV` และ allowed origins
- shared `/api/v1` router พร้อม request ID, response envelope, `Cache-Control: no-store`, health endpoint, JSON 404 และ 405
- Vite dev/preview adapter และ Vercel entrypoint ใช้ router เดียวกัน
- explicit Vercel rewrite จาก `/api/v1/*` ไป generated `api/backend.js`
- build script สร้างทั้ง legacy AI function และ backend function พร้อม normalize generated source labels ระหว่าง npm/pnpm
- `.env.example` สำหรับ local/cloud/server variables โดยไม่มี secret จริง

ผลทดสอบสำคัญ:

- config tests: local default, cloud fail-closed, URL/origin validation และ production fail-closed
- router tests: health envelope/request ID, unknown route เป็น JSON 404, method mismatch เป็น 405
- rewrite adapter tests: Vercel catch-all path/query mapping
- HTTP smoke test บน Vite dev: health 200, unknown 404 JSON, POST health 405 + `Allow: GET`
- frontend production bundle scan ผ่าน: ไม่พบ `SUPABASE_SECRET_KEY`, `service_role` หรือ server module paths; ชื่อ public `VITE_*` อยู่ใน client ตามที่ตั้งใจ

ยังไม่รัน:

- Supabase remote/staging
- Vercel preview/deployed route parity
- Google OAuth บน remote/staging, project CRUD และ storage (Phase 1)

Data/rollback impact: ไม่มี migration และไม่เปลี่ยน project/file schema; local demo ยังใช้พฤติกรรมเดิม และ P1.2 เชื่อม cloud auth ต่อจาก foundation นี้แล้ว

## P0.3 — Local Supabase foundations

สถานะ: เสร็จและผ่าน local database checks

- เพิ่ม Supabase CLI 2.117.0 เป็น dev dependency และยืนยันว่า CLI รันได้
- ติดตั้ง Docker Desktop 4.91.0, Docker Engine 29.8.0 และ WSL 2.7.13; local Supabase stack รันได้
- เพิ่ม `supabase/config.toml`: local ports, app redirect 5173, automatic Data API grants ปิด และ private PNG/JPEG buckets จำกัด 10 MiB
- เพิ่ม foundation migration สำหรับ `app_private`, browser-role revokes และ default privileges ของ server-only tables/RPCs
- เพิ่ม pgTAP test 16 assertions สำหรับ schema privileges และ default ACL probes
- เพิ่ม local-only `seed.sql`, npm scripts ที่ระบุ `db reset --local` ชัดเจน และ [backend-setup.md](backend-setup.md)
- ปิด local analytics ที่ยังไม่ใช้เพื่อไม่ให้ Vector log collector รีสตาร์ตจาก Docker logs endpoint; DB, Auth, Storage และ Studio ยังเปิดตามปกติ
- `npm run db:reset`: ผ่านทั้ง migrations และ seed
- `npm run db:test`: ผ่าน foundation suite 16 assertions

Data/rollback impact: การ reset จำกัดเฉพาะ local database ด้วย `--local`; ยังไม่มีการ link หรือแก้ remote project

## P1.1 — Identity, personal workspace และ ACL

สถานะ: implemented และผ่าน local database/integration checks

- เพิ่ม server-only tables `app_users`, `auth_identities`, `workspaces` และ `workspace_members` ใน `app_private`
- เปิด RLS และ revoke browser roles ทุก table; ให้สิทธิ์เฉพาะ `service_role`
- เพิ่ม `bootstrap_personal_workspace` RPC แบบ security invoker ซึ่ง validate input, serialize ด้วย advisory transaction lock และสร้าง app user, Supabase identity, personal workspace และ owner membership แบบ idempotent
- ห้าม auto-link ด้วย email; issuer/subject เป็น identity key และ suspended/deleted user ถูกปฏิเสธ
- pgTAP identity/workspace suite ผ่าน 28 assertions; รวม database suites เป็น 2 files, 44 assertions
- integration test ยิง bootstrap พร้อมกัน 8 requests ผ่าน: ได้ user/workspace graph เดียว แล้ว cleanup สำเร็จ

Data/rollback impact: มี local migration เพิ่ม 4 tables, constraints/indexes, trigger และ RPC; ยังไม่แตะ remote database

## P1.2 — Real auth, session hydration และ legacy AI guard

สถานะ: implemented และผ่าน local auth/API checks; Google OAuth บน remote staging **PASS** ผ่าน local cloud-mode app

- เพิ่ม Supabase browser client แบบ PKCE สำหรับ Google OAuth; cloud mode ไม่ fallback ไป mock login
- เพิ่ม lifecycle `loading → anonymous → bootstrap → authenticated/error`; ทุก session เรียก `POST /api/v1/session/bootstrap` ก่อน mount editor
- server ใช้ `auth.getUser(accessToken)` ตรวจ bearer token แล้วกำหนด issuer จาก trusted server config ก่อนเรียก server-only bootstrap RPC
- server config บังคับ URL/secret เป็นคู่ และ staging/production ต้องมี Supabase credentials กับ origin allowlist
- เพิ่ม session epoch/AbortController กัน bootstrap เก่ากลับมาเขียน state หลังบัญชีเปลี่ยน และ refresh token ได้หนึ่งครั้งก่อนแสดงข้อผิดพลาด
- refactor editor store ออกจาก module singleton: cloud draft ใช้ key ตาม internal `app_user_id`; logout ไม่ลบ local project/legacy backup
- legacy `/api/box-spec` เปิดเฉพาะ local demo ใน development/test และตอบ 410 ใน cloud/staging/production; provider credential error เปลี่ยนเป็น upstream 502 ไม่ปะปนกับ app 401
- unit tests ผ่าน 24 files, 352 tests
- real local auth integration ผ่าน: สร้าง auth user, sign-in รับ token, verify/bootstrap ซ้ำได้ identity/workspace เดิม, forged token เป็น 401 และ cleanup สำเร็จ
- cloud-mode HTTP smoke ผ่าน: root 200, missing/forged bearer 401 JSON และ legacy AI 410

Remote evidence 19 กันยายน 2026: ตั้ง Google Cloud Web client และ Supabase Google provider, เพิ่ม test user, ผ่าน PKCE callback กลับ `127.0.0.1:5173`, server token verification/personal-workspace bootstrap และ editor mount จริง โดย Google Auth app ยังอยู่สถานะ Testing ส่วน Vercel preview origin ยังต้องทดสอบหลัง deploy; cloud editor เปลี่ยนมาใช้ IndexedDB/controller ใน P1.6 แล้ว และ legacy localStorage migration UI อยู่ใน P1.7

## P1.3 — Project RPC, repository/API และ atomic save

สถานะ: เสร็จและผ่าน local database/integration/unit/build checks

- เพิ่ม private `projects` และ durable `project_operations` พร้อม RLS/revoke สำหรับ browser roles
- เพิ่ม server-only RPC สำหรับ actor resolution, `/me`, list/get/create/save/soft-delete; ตรวจ workspace membership ใน RPC แม้เรียกด้วย privileged client
- save/delete ใช้ row lock + expected revision compare-and-swap; retry ด้วย operation/payload เดิมคืน receipt เดิมโดยไม่เพิ่ม revision
- mutation ทุกชนิด serialize ตาม `(workspace, actor, operationId)`; operation ID เดิมแต่ payload/type/project ต่างกันถูก 409
- เพิ่ม strict Zod schemas สำหรับ project document/envelopes, 1 MiB JSON limit, safe bigint conversion, opaque cursor และ validation ของ `If-Match`/`Idempotency-Key`
- เพิ่ม browser HTTP repository สำหรับ `/me` และ project endpoints; ยังไม่ต่อเข้า editor state ก่อน codec/asset lifecycle
- unit tests ผ่าน 28 files, 368 tests; `tsc --noEmit` และ production build ผ่าน
- `npm run db:reset` ผ่าน migration/seed ครบ; pgTAP ผ่าน 3 files, 82 assertions (project suite 38 assertions)
- PostgreSQL integration ผ่าน 3 files, 4 tests: bootstrap/auth และ project ACL/concurrent create/CAS/receipt replay/cross-project operation-ID reuse

Data/rollback impact: มี migration เพิ่ม 2 tables และ 8 RPCs ใน local migration history; ยังไม่ link/push ไป remote database

## P1.4 — Image asset lifecycle และ private Storage

สถานะ: เสร็จสำหรับ local PNG/JPEG flow; native packaging บน Vercel/staging ยัง **NOT RUN**

- เพิ่ม private `assets`, `asset_operations`, `storage_usage`, `storage_reservations` และ `project_assets`; เปิด RLS และไม่มี browser allow policy
- upload intent สร้าง staging key ฝั่ง server, จองเต็มเพดาน bucket 10 MiB ต่อ ticket กัน client แจ้ง size ต่ำกว่าจริง; technical default จำกัด 20 pending tickets และ 250 MiB ต่อ workspace
- ใช้ Supabase signed upload URL อายุ 2 ชั่วโมงแบบ `upsert: false`; private download URL อายุ 5 นาที และไม่เก็บ capability URL ใน durable receipt
- validator ใช้ Sharp 0.35.4 decode จริง, รับเฉพาะ PNG/JPEG เฟรมเดียว, compressed/final ≤ 10 MiB และ ≤ 20 MP; auto-orient, re-encode เพื่อตัด metadata แล้วเก็บ SHA-256/dimensions ของ canonical bytes
- ready object เขียนด้วย server ไป immutable key ที่มี fencing version; completion claim จอง durable operation ก่อ decode กัน cross-asset retry/race
- project create/save สกัด asset IDs จาก validated document เอง, lock/check ready + same workspace และ replace `project_assets` ใน transaction เดียว; privileged RPC ก็ไม่รับ inline `src`
- SVG policy: cloud API **ยังไม่รองรับ SVG**; ไม่ส่ง SVG เข้า Sharp หรือ fetch resource ภายนอก migration ต้อง sanitize + rasterize แบบ isolated พร้อมขอความยินยอมเรื่องคุณภาพใน P1.5/P1.7; ระหว่างนี้ต้องรักษา portable original และรายงานว่าย้ายไม่ได้
- local checks: unit 30 files/374 tests, pgTAP 4 files/121 assertions, PostgreSQL/Storage integration 5 files/8 tests และ production build ผ่าน

Known gaps: ยังไม่มี scheduled reaper สำหรับ abandoned staging reservations/orphan fencing objects; ยังไม่ทดสอบ Sharp native dependency ใน Vercel runtime หรือ remote Storage CORS

Data/rollback impact: มี local migration เพิ่ม 5 tables, asset RPCs และแก้ project RPC ให้ enforce asset references; ยังไม่ link/push ไป remote database

## P1.5 — Cloud/editor codec และ portable file compatibility

สถานะ: เสร็จและผ่าน unit/build checks; ต่อเข้า cloud controller/editor แล้วใน P1.6

- เพิ่ม codec แยก editor `Project` ออกจาก cloud document schema 1: `dehydrateProject` แทน runtime image `src` ด้วย `assetId` และ `hydrateProject` คืน authorized bytes เป็น data URL ก่อนเข้า parser เดิม
- ตรวจ data URL signature จริงเบื้องต้น, รับเฉพาะ PNG/JPEG ≤ 10 MiB และหยุดพร้อม error สำหรับ SVG/ชนิดที่ไม่รองรับโดยไม่แก้ project ต้นฉบับ
- dedupe upload ตาม SHA-256 + purpose และเพิ่ม sidecar snapshot ที่ scope ด้วย `appUserId/workspaceId`; sidecar เป็น cache hint เท่านั้น ส่วน save RPC ยังตรวจ tenant/readiness ซ้ำ
- hydration ตรวจ metadata, workspace/purpose, byte size และ SHA-256; หากรูปขาดหรือ checksum ไม่ตรงจะไม่คืน project ที่รูปถูกตัดทิ้ง
- เพิ่ม HTTP asset transfer สำหรับ intent → signed upload → complete และ signed download; bearer token ส่งเฉพาะ app API ไม่ส่งไป capability URL
- portable export hydrate bytes ก่อนใช้ file schema 6 เดิม จึงยังฝัง data URL ครบและไม่รั่ว `assetId`/signed URL; ไม่ bump file schema โดยไม่จำเป็น
- fixture round-trip ครอบคลุม image/text/shape/nutrition/path, background, history และ vessel/pouch options โดยไม่มี field/ภาพหาย
- local checks: unit 32 files/380 tests, `tsc --noEmit` และ production build ผ่าน

Data/rollback impact: ไม่มี migration หรือ remote write; เพิ่ม browser codec/transport และ tests เท่านั้น

## P1.6 — Project controller, durable save queue และ IndexedDB drafts

สถานะ: implemented และผ่าน local unit/build checks; real browser multi-tab/offline E2E ยัง **NOT RUN**

- เพิ่ม IndexedDB `project-drafts` แยก key ตาม `appUserId/workspaceId/projectId/clientId`; แต่ละแท็บมี client ID จาก sessionStorage จึงไม่เขียน draft ทับกัน
- ทุก edit persist editor project + asset sidecar ก่อน debounce/network; storage error เปลี่ยนสถานะเป็น error แทนการกลืนเงียบ
- save queue ใช้ debounce 1 วินาที/max wait 5 วินาที, หนึ่ง in-flight ต่อโปรเจกต์ และ persist exact payload/expected revision/operationId ก่อนยิง API
- reload หลัง commit แต่ response หาย replay mutation เดิม; retry 429/503 แบบ bounded และปุ่ม retry ยังใช้ operationId เดิม
- edit ระหว่าง save แยกเป็น generation ใหม่ รอ receipt ก่อนใช้ revision ล่าสุดส่งต่อ; late response หลัง switch/logout ไม่ล้าง durable mutation
- offline เก็บ draft และเปิดงานที่เคยโหลดครบจาก IndexedDB ได้; create/import/delete/เพิ่มรูปใหม่ถูกปิดจน online ส่วนการแก้ข้อความ/geometry ยังทำต่อได้
- สองแท็บใช้ draft คนละ record และให้ server CAS ตัดสิน; revision conflict หยุด autosave พร้อมปุ่มโหลด cloud ล่าสุดหรือสร้างสำเนา ไม่ last-write-win เงียบ
- ต่อ `CloudWorkspace` เข้า `CloudRoot/App`: list/get/create/save/delete/import, project switching, save-state indicator, token refresh retry และ capture ล่าสุดก่อน switch/logout
- SVG import จากผู้ใช้ยังถูกปิดใน cloud mode; built-in preset เปิดผ่าน trusted rasterizer ใน P1.7 แล้ว และ local mode ไม่เปลี่ยน
- unit tests จำลอง response loss, reload replay, edit-during-save, concurrent tabs, offline/reconnect, switch/dispose, explicit retry และ controller draft restore
- local checks: unit 34 files/390 tests, `tsc --noEmit` และ production build ผ่าน

Known gaps: ยังไม่มี durable journal สำหรับ create/delete ทั่วไปหรือ BroadcastChannel เพื่อแจ้งแท็บ clean ให้ reload เชิงรุก; CAS ยังป้องกัน overwrite ได้ งานเหล่านี้รวมกับ legacy migration journal/P1.7 และ browser E2E/P1.8

Data/rollback impact: ไม่มี database migration/remote write; browser cloud mode เปลี่ยนจาก account-scoped localStorage draft เป็น IndexedDB โดยยังไม่ลบ key เดิม

## P1.7 — Resumable legacy migration และ trusted preset rasterization

สถานะ: implemented; ผ่าน local database/integration/unit/build/browser E2E และ remote-staging migration smoke

- เพิ่ม IndexedDB migration journal ที่ scope ด้วย `appUserId/workspaceId/installationId`; สร้าง installation ID แบบคงที่ใน localStorage และเก็บ exact raw backup ก่อน parse/repair เสมอ
- discovery รองรับทั้งคลัง `gen-package-projects-v1` และงานเดี่ยวรุ่น `gen-package-design-v1`; แสดงรายการ repair/skipped และไม่ลบหรือแก้ localStorage ต้นทาง
- UI หลัง login ขอความยินยอมก่อนย้าย, แสดง progress/result/error, retry ได้ และ resume journal ที่ยินยอมแล้วอัตโนมัติ; ถ้าเคยกด “ยังไม่ย้าย” จะมีปุ่มเปิด consent กลับมาได้โดยไม่เปลี่ยน raw backup/items
- แต่ละรายการมี stable source key/hash/operation ID; source เดิมที่เนื้อหาเปลี่ยนถูก mark conflict ไม่ overwrite เป้าหมาย
- เพิ่ม private `legacy_imports` mapping และ server-only `import_legacy_project` RPC/API; advisory lock + unique source mapping ทำให้ retry, lost response, StrictMode และ concurrent request คืนโปรเจกต์เดิม
- migration อัปโหลด asset ผ่าน codec/sidecar เดิมด้วย concurrency ที่จำกัด แล้ว GET โปรเจกต์กลับมาตรวจ document ก่อน mark complete
- built-in preset ไม่ render SVG ที่มากับข้อมูล: regenerate จาก preset ID/color ที่อยู่ใน registry เท่านั้นแล้ว rasterize เป็น PNG ด้านยาว 2048px; คำนวณมิติแบบ deterministic และรักษา aspect ratio สำหรับแนวตั้ง/แนวนอน/จัตุรัส ใช้ได้ทั้งเพิ่ม/เปลี่ยนสีใน cloud, portable import และ legacy migration
- arbitrary/user SVG ยังไม่ผ่านเข้า cloud validator; migration เก็บ raw backup แล้วรายงาน skipped แทนการ render เนื้อหาที่ไม่น่าเชื่อถือ
- local checks: unit 36 files/399 tests, pgTAP 5 files/133 assertions, PostgreSQL integration 6 files/9 tests และ production build ผ่าน

Known gaps ณ ตอนจบ P1.7: real-browser migration flow, persisted PNG metadata/reference และ durable journal สำหรับ create/delete ยังไม่ถูกตรวจ; ปิดครบใน P1.8 และ remote-staging migration smoke แล้ว โดยตรวจ output pixel dimensions/aspect หลาย scale แทนการอ้าง DPI ที่ไฟล์ไม่ได้กำหนด

Data/rollback impact: เพิ่ม local migration 1 table + 1 RPC; raw legacy backup อยู่ใน browser IndexedDB และ source localStorage ไม่ถูกลบ; ยังไม่ link/push migration ไป remote database

## P1.8 — Durable mutations, browser E2E และ restore evidence

สถานะ: **local complete; staging foundation complete; deployed smoke PARTIAL**

- เพิ่ม IndexedDB journal สำหรับ create/delete โดย persist exact payload + operation ID ก่อน network, replay หลัง reload/reconnect และตรวจ scope/response ก่อนลบ receipt; same intent ที่ UI สร้าง operation ID ใหม่ยัง reuse pending operation เดิม
- เพิ่ม workspace/account-scoped `BroadcastChannel` metadata events; clean tab โหลด revision ใหม่ ส่วน dirty tab เข้าสถานะ conflict และหยุด autosave ไม่ overwrite เงียบ
- แก้ React StrictMode race ของ Three Fiber event target ด้วย guarded Canvas event manager และ pin React/Fiber/Drei เป็นชุดที่มี peer range ตรงกัน
- browser E2E ใช้ local Auth/API/DB/Storage จริง: consent + raw backup + legacy dedupe, trusted preset add/color/save/reload พร้อมตรวจ PNG 2048×2048/SHA-256/`project_assets`, clean-tab refresh, dirty-tab conflict/reload, offline create/delete/import/upload controls ถูกปิดแต่ geometry edit/reconnect ได้, portable export/import พร้อม hydrated PNG/no `assetId` leak, create/delete replay หลัง server commit แต่ response หาย และสลับสองบัญชีโดยไม่เห็นงานข้ามกัน
- restore drill dump/restore `app_private` ไป isolated temporary database แล้วตรวจ app user/project/document/create+save receipts, ready asset metadata และ `project_assets`; สำรอง/ลบ/คืน Storage object ที่ project อ้างจริงและตรวจ ID/key/SHA-256 ก่อน cleanup
- เพิ่ม dev/preview HTTP parity smoke ตรวจ health, JSON 401/404/405/410/413, `Allow` header, request ID, ES256 expired/foreign-shaped bearer rejection และ anon/authenticated direct Data API RPC denial ด้วย local Auth จริง
- เพิ่ม cleanup dry-run ที่ reconcile DB/Storage โดยไม่ mutate และ local test-fixture cleanup ที่จำกัด strict email pattern; แก้ E2E ให้ lookup internal app user ใน `finally` แม้ล้มก่อน migration step เพื่อไม่ทิ้ง fixture
- local checks ล่าสุด: unit 42 files/430 tests, pgTAP 5 files/133 assertions, integration 6 files/9 tests, restore drill, browser E2E, dev/preview HTTP parity (รวม Cloud AI auth/BYOK guards) และ production build ผ่าน
- เพิ่ม [backend-acceptance-phase1.md](backend-acceptance-phase1.md) แยก PASS/PARTIAL/NOT RUN พร้อม evidence และ operational boundary

Staging update 19 กันยายน 2026: สร้าง/link project `gen-package-staging`, push migrations 5 รายการ, สร้าง private buckets สองชุด, ตั้ง local Auth URLs และเปิด Google OAuth แล้ว; ทดสอบ PKCE callback, server bootstrap และ editor mount กับ remote Supabase สำเร็จ `npm run staging:readiness` ตรวจ project health, ref/org, migration parity, dry-run up-to-date และ committed policies โดยไม่แก้ remote state

Staging app smoke 19–20 กันยายน 2026: สร้าง `Staging Smoke 2026-09-19`, เปลี่ยนความกว้างเป็น 96 มม., autosave/reload แล้วยังได้ค่าเดิม จากนั้นอัปโหลด PNG fixture ผ่าน signed URL/validator, autosave และ reload แล้ว private asset กลับมาเป็น image layer ได้ โดย browser console ไม่มี error ต่อมาทดสอบ decline/reopen consent แล้วย้าย legacy project 1 งานขึ้น remote staging สำเร็จ; source localStorage และ exact raw backup ยังอยู่ เปิด cloud project ได้ 80×50×120 มม. และ reload แล้วค่าเดิมยังอยู่โดยไม่มี console error

Known gaps: deployed-origin Storage CORS, Vercel route/native Sharp packaging และการเปิด project จาก restored staging snapshot ยัง **NOT RUN**; Google OAuth/login/bootstrap, local-origin CRUD/asset smoke และ staging legacy migration ผ่านแล้ว แต่ยังไม่ได้ตรวจ deployed origin และ Google Auth app ยังเป็น Testing; local restore query + checksum ไม่ถูกอ้างว่าเทียบเท่า full Supabase/Auth disaster recovery ส่วน scheduled asset deletion/reaper ยังไม่เปิดโดยตั้งใจจนกว่าจะยืนยัน retention/grace period

Data/rollback impact: migrations 5 รายการถูก push ไป staging เท่านั้น; ไม่มี production write staging มี Google test user/personal workspace และ smoke project/PNG fixture ที่สร้างจากการทดสอบจริง Browser เพิ่ม journal/channel records ที่ scope ตาม account/workspace และ test scripts cleanup เฉพาะ fixture ที่สร้างเอง

## Cloud AI BYOK bridge

สถานะ: **implemented และผ่าน unit/type/build checks; deployed smoke NOT RUN**

- cloud editor ใช้ authenticated `POST /api/v1/ai/box-spec` แทน legacy endpoint ที่ cloud ตอบ 410
- ผู้ใช้ใส่ Anthropic API key ในช่อง password; เก็บใน React memory เฉพาะ session ของหน้า ไม่ลง localStorage, env หรือ project document
- browser ส่งคีย์ใน dedicated request header ไม่ใส่ JSON body; server ตรวจ bearer ก่อนอ่านคีย์ และไม่ echo คีย์ใน response
- Anthropic client ถูกสร้างต่อ request เพื่อไม่ cache/reuse BYOK key ข้ามผู้ใช้ พร้อม stable error codes สำหรับ missing/invalid/rate-limit/provider unavailable
- local/demo flow เดิมยังใช้ `/api/box-spec` และรองรับ mock ตาม config เดิม

Known gap: ต้องทดสอบ route นี้บน Vercel preview ด้วยคีย์ทดสอบของผู้ใช้หลัง deployment พร้อมตรวจ platform logs ว่าไม่บันทึก sensitive headers

## งานถัดไป

ทำรายการที่ยัง NOT RUN ใน acceptance matrix: deployed-origin app flows/CORS, authenticated Vercel parity + Sharp + Cloud AI BYOK smoke และ full staging restore/open drill ก่อน public pilot ห้าม production deploy โดยอนุมานสิทธิ์เอง

## Vercel staging — 21–22 กันยายน 2026

- สร้าง Vercel project `gen-package-staging` แยก, connect repo และใช้ Production slot ติดตาม `feat/supabase-backend` โดย `APP_ENV=staging` และ credentials ของ Supabase staging เท่านั้น
- Deployment แรก `d592815` Ready ที่ `https://gen-package-staging.vercel.app`; build command `npm run build`, Vite, Node 24.x, output `dist`; server key เป็น Vercel Secret และ frontend ใช้ publishable key
- Supabase Site URL เปลี่ยนเป็น staging URL และเพิ่มใน redirect allowlist โดยคง local URLs ทั้งสองไว้
- HTTP smoke ผ่าน root/health 200, missing/invalid bearer 401, unknown API 404, method 405/Allow, legacy AI 410 และ request ID; deployed frontend bundle ไม่พบ `sb_secret_` pattern
- User login Google บน staging แล้วพบ “query parameter ไม่ถูกต้อง” ตอน list projects: runtime log แสดงทั้ง `apiPath=projects` และ `path=projects`; แพตช์แรก `c78d463` รองรับ source-path แต่ยังไม่ตัด `path` จึงแก้ครบใน `26381fa` โดยไม่ยอมให้ metadata retarget route หรือทิ้ง caller query อื่น; regression 3 กรณี fail ก่อนแก้ และ suite 42 files/436 tests ผ่านหลังแก้ พร้อม API build/typecheck
- หลัง `26381fa` Ready ตรวจ browser เปิด editor/งานเดิม 80×50×120 และ `Staging Smoke 2026-09-19` ที่ W96 ได้แล้ว ไม่มี remote schema change หรือ fixture ใหม่จากการแก้ครั้งนี้
- `packit.vercel.app` ถูก Vercel ปฏิเสธเพราะ assigned ให้โปรเจกต์อื่น ผู้ใช้เลือก `packit-design.vercel.app` แทนและเพิ่มสำเร็จ; Site URL/redirect allowlist และ `APP_ALLOWED_ORIGINS` อัปเดตแล้ว โดยคง local redirect URLs และโดเมน staging เดิม
- redeploy `26381fa` พร้อม domain config ล่าสุด Ready (`GRLAfTcAyiK9K2985qkBMqgUdkKQ`); HTTP smoke บน `packit-design.vercel.app` ผ่าน 200/401/404/405/410 ผู้ใช้ยืนยัน Google login และตรวจ editor/งานเดิม 80×50×120 พร้อมสถานะบันทึกแล้วบน origin ใหม่
- โดเมน staging เดิมและ `project-glry1.vercel.app` ส่งต่อ 307 ไปชื่อใหม่แล้ว ไม่มี alias หรือข้อมูล cloud ถูกลบ
- ยังไม่อ้าง PASS สำหรับ deployed Storage CORS/Sharp processing, authenticated 413/AI BYOK หรือ staging restore/open drill; ไม่มีการเปิด reaper/retention

## Tab-focus session stability — 22 กันยายน 2026

สถานะ: **แก้ใน local worktree; ยังไม่ deploy**

- พบว่า Supabase ส่ง `SIGNED_IN` ซ้ำตอนกลับมาแท็บเดิม แต่ `CloudRoot` เดิม bootstrap ใหม่ทุกครั้งที่ session object เปลี่ยน ทำให้ editor unmount และโหลด project/draft ใหม่
- แยก bootstrap lifecycle ตาม account: repeated session confirmation และ token refresh ของบัญชีที่พร้อมแล้วไม่เปลี่ยน ready state; token ใหม่ยังส่งต่อให้ API ตามปกติ และ server authorization ไม่ถูกลดทอน
- session ว่าง/ออกจากระบบและสลับ account ต้อง bootstrap ใหม่; abort/epoch ป้องกัน response เก่าหรือ refresh ที่เสร็จหลัง logout คืนข้อมูลบัญชีเก่า พร้อม retry 401 ได้หนึ่งครั้ง
- ป้องกัน initial `getSession` ที่เสร็จช้าทับ Auth event ใหม่กว่า และไม่ render workspace ของคนเดิมระหว่าง account switch
- unit regression 15 กรณีผ่าน; suite 43 files/451 tests และ production build ผ่าน ยังไม่ได้ตรวจ browser tab-focus บน deployed patch
- ผู้ใช้เลือก loading animation แบบ 01 (Fold Studio); นำกล่องพับ CSS-only โทน teal มาใช้ร่วมกันที่ lazy cloud startup, account bootstrap และ project/draft loading แล้ว โดยไม่เพิ่มเวลารอหรือแสดงเปอร์เซ็นต์สมมติ; error states คงข้อความ/การออกจากระบบตามเดิม
- รองรับ light/dark theme, สถานะอ่านด้วย screen reader และ `prefers-reduced-motion` (กล่องอยู่นิ่ง); ตรวจ component จริงผ่าน local browser ทั้ง desktop light และ mobile dark 360px ไม่มี horizontal overflow หรือ console error
- หลังเพิ่ม loader render tests 3 กรณี: suite **44 files/454 tests** และ production build ผ่าน (คำเตือนขนาด 3D chunk เดิมยังอยู่); loading UI และ tab-focus fix ยังไม่ได้ push/deploy
