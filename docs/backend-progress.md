# Backend implementation progress

อัปเดตล่าสุด: 18 กันยายน 2026

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

สถานะ: implemented และผ่าน local auth/API checks; Google OAuth บน remote/staging ยัง **NOT RUN**

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

Known gap: editor ใน cloud mode ยังเก็บเพียง account-scoped browser draft ไม่ได้ sync project ไปฐานข้อมูลจน P1.3; Google console/provider redirects และ Vercel preview ต้องทดสอบบน staging จริง

## งานถัดไป

เริ่ม P1.3: project RPC/repository/API พร้อม atomic revision compare-and-swap และ operation idempotency
