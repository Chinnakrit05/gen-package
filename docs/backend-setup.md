# PackIt backend local setup

อัปเดตล่าสุด: 22 กันยายน 2026

คู่มือนี้ครอบคลุม local Supabase, auth/session, project API ของ Phase 1 และสถานะ staging ที่ link แล้ว

## Prerequisites ที่ตรวจใช้

- Node.js 24.19.0 และ npm 11.17.0
- Container runtime ที่รองรับ Docker API; บน Windows แนะนำ Docker Desktop
- Supabase CLI ติดตั้งเป็น dev dependency และเรียกผ่าน `npx`/npm scripts

Supabase ระบุว่า local stack ต้องมี container runtime และแนะนำติดตั้ง CLI เป็น dev dependencyสำหรับ npm project: [Local Development & CLI](https://supabase.com/docs/guides/local-development)

## ติดตั้งและเริ่ม local stack

```powershell
npm ci
npm run supabase:start
```

คำสั่ง start ใช้ local containers และไม่ต้อง login/link remote จากนั้นตรวจ URL/keys ของ local instanceด้วย:

```powershell
npx supabase status
```

อย่า commit key ที่คำสั่งแสดง แม้ local key จะใช้เพื่อการพัฒนาเท่านั้น

ถ้าอยู่บนเครือข่ายสาธารณะที่ไม่เชื่อถือ ให้สร้าง Docker network ที่ bind เฉพาะ `127.0.0.1` ตาม [คำแนะนำ local network ของ Supabase](https://supabase.com/docs/guides/local-development) แทนการเปิด local ports ออกภายนอก

## Rebuild และทดสอบฐานข้อมูล

```powershell
npm run db:reset
npm run db:test
npm run db:test:integration
npm run db:test:restore
npm run test:e2e:local
npm run test:http:local
```

`db:reset` ในโปรเจกต์นี้ระบุ `--local` ชัดเจน: ลบและสร้างใหม่เฉพาะ local database แล้วใช้ migrations กับ `seed.sql` ตามลำดับ ส่วน `db:test` รัน pgTAP files ใต้ `supabase/tests/` และ `db:test:integration` ทดสอบ bootstrap/auth, project CAS/idempotency และ Storage asset lifecycle/quota กับ local services จริง `db:test:restore` dump/restore เฉพาะ `app_private` ไปฐานข้อมูลชั่วคราวชื่อ `packit_restore_*` และซ้อมสำรอง/ลบ/คืน Storage object ตัวอย่างพร้อม SHA-256 โดย cleanup fixture หลังจบ `test:e2e:local` ใช้ Chrome ที่ติดตั้งในเครื่องทดสอบ browser flow จริง และ `test:http:local` build แล้วตรวจ contract เดียวกันบน Vite dev/preview ดูรูปแบบ pgTAP ทางการได้ที่ [Testing Overview](https://supabase.com/docs/guides/local-development/testing/overview)

หาก Chrome ไม่อยู่ที่ path มาตรฐานของ Windows ให้ตั้ง `PACKIT_E2E_CHROME` เป็น executable path ก่อนรัน browser E2E; script ใช้ `playwright-core` และไม่ดาวน์โหลด browser binary ซ้ำ

ห้ามเปลี่ยนคำสั่งเป็น `supabase db reset --linked` เพราะคำสั่งนั้นลบฐานข้อมูล remote ที่ link อยู่ เอกสาร workflow อธิบายความต่างไว้ที่ [Local development workflow](https://supabase.com/docs/guides/local-development/cli-workflows)

หยุด containers โดยเก็บ local data ไว้:

```powershell
npm run supabase:stop
```

## Local endpoints

- App: `http://127.0.0.1:5173`
- Supabase API: `http://127.0.0.1:54321`
- PostgreSQL: `127.0.0.1:54322`
- Studio: `http://127.0.0.1:54323`
- Local mail UI: `http://127.0.0.1:54324`

`supabase/config.toml` ปิด automatic Data API grants และ local analytics ที่ milestone นี้ไม่ใช้, expose เฉพาะ `public`/`graphql_public`, เก็บข้อมูลธุรกิจใน `app_private` และสร้าง private local buckets `packit-staging`/`packit-assets` จำกัด PNG/JPEG 10 MiB

## Environment สำหรับแอป

คัดลอก `.env.example` เป็น `.env.local` แล้วใช้ค่าจาก `npx supabase status`:

```dotenv
VITE_APP_MODE=cloud
VITE_API_BASE_URL=/api/v1
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=<local publishable/anon key>

APP_ENV=development
APP_ALLOWED_ORIGINS=http://127.0.0.1:5173,http://localhost:5173
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SECRET_KEY=<local secret/service-role key>
```

cloud mode เชื่อม Auth, project controller, IndexedDB drafts/mutation journal, private assets และ legacy migration แล้ว สำหรับ local smoke ให้ใช้ URL/publishable/secret values จาก `npx supabase status` เท่านั้น ห้ามคัดลอก local secret ไป staging/production และอย่า commit `.env.local`

หลัง sign-in browser ส่ง access token ไป `POST /api/v1/session/bootstrap`; server ตรวจ token กับ Supabase Auth แล้วสร้าง app user/personal workspace ผ่าน server-only RPC หลังจากนั้น editor โหลดและบันทึก `/api/v1/projects` ผ่าน durable queue; browser draft, pending save/create/delete และ migration journal ถูก scope ด้วย internal app user/workspace

## Asset upload flow

1. `POST /api/v1/assets/upload-intents` ด้วย workspace, purpose, MIME, byte size และ operation UUID
2. PUT raw PNG/JPEG bytes ไป signed URL และ headers ที่ API คืนให้; URL/token นี้เป็น capability ห้าม log หรือ persist
3. `POST /api/v1/assets/:id/complete` ด้วย operation UUID; server ดาวน์โหลด/decode/re-encode และเปลี่ยนเป็น ready หรือ rejected
4. ออก URL อ่านด้วย `POST /api/v1/assets/download-tickets`; private bucket ไม่มี public URL

ข้อจำกัด local: PNG/JPEG เท่านั้น, 10 MiB, 20 MP, เฟรมเดียว; SVG ถูกปฏิเสธจนกว่า strict sanitizer + isolated rasterizer จะผ่าน tests ห้ามแปลงแล้วลดคุณภาพเงียบ ๆ

## Google OAuth redirects

ต้องตั้ง URL สองชั้นแยกกัน:

1. ใน Google OAuth client ให้ Authorized redirect URI ชี้ไป Supabase callback เช่น `https://<project-ref>.supabase.co/auth/v1/callback` (local provider ใช้ `http://127.0.0.1:54321/auth/v1/callback`)
2. ใน Supabase Auth URL configuration ให้ Site URL/Redirect URLs อนุญาต app root เช่น local `http://127.0.0.1:5173` และ staging/production origin จริง

จากนั้นเปิด Google provider ใน Supabase และใส่ Google client ID/secret ใน provider settings เท่านั้น ไม่ใส่ Google secret ใน `VITE_*` หรือ Git ดูขั้นตอนปัจจุบันได้ที่ [Login with Google](https://supabase.com/docs/guides/auth/social-login/auth-google)

staging ตรวจ Google OAuth จริงแล้วเมื่อ 19 กันยายน 2026: Google Cloud client แบบ Web ชี้ callback ไป remote Supabase, Supabase Google provider เปิดใช้งาน, แอปที่ `127.0.0.1:5173` ใช้ PKCE redirect กลับสำเร็จ และ server bootstrap session ก่อนเปิด editor ได้จริง Google Auth app ยังอยู่สถานะ Testing จึงใช้ได้เฉพาะ test users จนกว่าจะพร้อมเผยแพร่

## Backup/restore boundary

`npm run db:test:restore` เป็น local drill ที่พิสูจน์ application rows/operation receipts, asset metadata, project-to-asset link และ Storage checksum ที่สัมพันธ์กัน แม้ database backup กับ object bytes ต้องจัดเก็บแยกกันจริง ไม่ใช่ full Supabase disaster recovery:

- database dump ระบุ `app_private` ชัดเจน; ไม่อ้างว่ารวม managed `auth`/`storage` schemas หรือ provider configuration
- Storage backup ต้องเก็บ object bytes/metadata/manifest/checksum แยกจาก database backup
- Supabase Auth users, password/session และ OAuth provider settings ต้องใช้ขั้นตอน backup/migration ของ provider แยกต่างหาก
- ก่อน public pilot ยังต้อง restore staging snapshot จริง แล้วชี้ staging app ไปเปิดงาน restored พร้อมตรวจ asset links/checksums

## Cleanup แบบ dry-run

```powershell
npm run ops:cleanup:report
```

คำสั่งนี้อ่านอย่างเดียวและเทียบ `assets`/`project_assets`/reservations กับ object keys ใน `packit-staging` และ `packit-assets` เพื่อรายงาน expired tickets/leases, missing objects, orphan objects และ ready assets ที่ยังไม่มี reference โดย **ไม่ลบหรือแก้ข้อมูล** การลบ asset จริงยังห้ามเปิดอัตโนมัติจนกว่าจะยืนยัน retention, grace period และ operator approval

หาก local E2E ถูกหยุดกลางทาง ใช้ `npm run ops:test-fixtures:report` ตรวจบัญชี fixture ก่อน แล้วจึง `npm run ops:test-fixtures:cleanup`; cleanup นี้จำกัดเฉพาะ email pattern ที่ test scripts สร้างใต้ `@example.test` และใช้กับ local stack เท่านั้น ไม่ใช่ account-deletion workflow ของผู้ใช้จริง

## Remote/staging checklist

staging แยกถูกสร้างและ link แล้ว ขั้นตอนที่ทำเสร็จและขั้นตอนที่ยังต้องใช้ deployment/provider access มีดังนี้:

1. **DONE** link เฉพาะ `gen-package-staging` (`feuwdzgixarxpsscrwxp`); ห้ามใช้ production ref
2. **DONE** ตรวจ dry-run แล้ว push migrations 5 รายการ; `npm run staging:readiness` ยืนยัน remote up to date แบบ read-only
3. **DONE** สร้าง private buckets, ตั้ง local Site URL/Redirect URLs, เปิด Google provider และทดสอบ callback/PKCE/server bootstrap กับ remote staging แล้ว
4. **DONE** ตั้ง Vercel staging config: frontend ใช้ publishable key; `SUPABASE_SECRET_KEY` เป็น Secret ฝั่ง server; ยังต้องตรวจ Storage CORS ด้วย staging origin จริง
5. Google login/bootstrap และเปิดงานผ่านบน Vercel แล้ว; create/save/reload, PNG signed upload/download และ legacy migration ผ่านจาก local cloud-mode app; ยังเหลือ deployed write/upload flows, authenticated 413 และ Storage CORS
6. ทดสอบ Sharp native packaging และซ้อม restore database + object manifest/checksum ก่อนเปิด public pilot

## Remote/staging status

- Supabase project `gen-package-staging` ใน Singapore: **ACTIVE_HEALTHY และ link แล้ว**
- migrations 5 รายการ: **PUSHED / local-remote parity PASS**
- private buckets `packit-staging` และ `packit-assets`: **CREATED** — PNG/JPEG, 10 MiB; ไม่มี broad browser Storage policy โดยตั้งใจ เพราะ browser ใช้ API-issued signed URL
- Auth Site URL: `https://packit-design.vercel.app`; Redirect URLs มีโดเมนใหม่นี้, `https://gen-package-staging.vercel.app` และ local `127.0.0.1:5173`/`localhost:5173`: **CONFIGURED**
- Google OAuth provider/callback: **PASS remote + local app** — Google client และ test user ตั้งแล้ว; PKCE callback กลับ `127.0.0.1:5173`, server bootstrap และ editor mount สำเร็จ (Google app ยังเป็น Testing)
- Storage signed upload/download จาก `127.0.0.1:5173`: **PASS remote + local app** — PNG fixture ผ่าน validation, autosave และโหลด private asset กลับหลัง reload; deployed-origin CORS ยัง **NOT RUN**
- Legacy migration จาก `127.0.0.1:5173`: **PASS remote + local app** — decline/reopen consent, ย้าย 1 งาน, เปิด/reload แล้วได้ขนาดเดิม 80×50×120 มม.; source localStorage/raw backup ยังอยู่และไม่มี browser console error
- Vercel project `gen-package-staging`: **DEPLOYED** ที่ `https://packit-design.vercel.app` โดยใช้ Production slot ของโปรเจกต์ staging แยก, `APP_ENV=staging`, remote Supabase staging และ branch `feat/supabase-backend`; ไม่ใช่ production ของแอปเดิม
- Vercel runtime smoke: **PARTIAL** — root/health 200, missing/invalid bearer 401, unknown API 404, unsupported method 405 พร้อม `Allow`, legacy AI 410 และ request ID ผ่าน; frontend bundle มี publishable key แต่ไม่พบ `sb_secret_` pattern
- Deployed Google callback/session และ editor: **PASS ทั้งโดเมน staging เดิมและ `packit-design.vercel.app`** หลังแพตช์ `26381fa` ลบ Vercel rewrite metadata ทั้ง `apiPath`/`path` โดยคง strict query validation; เปิดงานเดิม 80×50×120 และ smoke W96 บนโดเมนเดิมได้ จากนั้นผู้ใช้ login ซ้ำบนโดเมนใหม่และตรวจ editor/งานเดิม 80×50×120 พร้อมสถานะบันทึกแล้ว
- โดเมน `gen-package-staging.vercel.app` และ `project-glry1.vercel.app` ส่งต่อ 307 ไป `packit-design.vercel.app`; ไม่ลบ alias เดิมหรือข้อมูล cloud โดย browser session/drafts แยกตาม origin จึงต้อง login ใหม่เมื่อย้ายโดเมน
- `APP_ALLOWED_ORIGINS` ตั้งชื่อใหม่และโดเมน staging เดิม แล้ว redeploy `26381fa` ด้วย settings ล่าสุด (`GRLAfTcAyiK9K2985qkBMqgUdkKQ`, Ready); ค่านี้ถูก validate แต่ shared router ยังไม่ได้ enforce CORS allowlist
- Deployed-origin Storage upload/download, Sharp processing, authenticated body limit/AI guards และ restore/open drill: **NOT RUN**

### เปลี่ยน staging ไปติดตาม main ในอนาคต

1. merge งาน backend และแพตช์ที่ทดสอบแล้วเข้า `main` ก่อน
2. ใน Vercel project นี้ เปิด Settings → Environments → Production → Branch Tracking แล้วเปลี่ยน `feat/supabase-backend` เป็น `main`
3. deploy commit จาก `main` ใหม่ และทดสอบ login, เปิด/บันทึกงาน และรูปภาพซ้ำ

การเปลี่ยน branch ไม่จำเป็นต้องเปลี่ยนโดเมนหรือสร้าง Supabase ใหม่; คง `APP_ENV=staging` และ credentials staging ไว้ อย่าสลับเป็น production data โดยปริยาย

รันตัวตรวจที่ไม่แก้ remote state ได้ด้วย:

```powershell
npm run staging:readiness
```

ห้ามใช้ `db reset --linked` กับ staging/production และห้ามใส่ access token, service secret, Google secret หรือ AI key ลงเอกสาร/Git

## Verification status บนเครื่องนี้

- Supabase CLI 2.117.0: ติดตั้งและรันได้
- Docker Desktop 4.91.0, Docker Engine 29.8.0 และ WSL 2.7.13: รัน local stack ได้; stale socket จากการเริ่มครั้งก่อนไม่ปรากฏแล้ว
- `supabase db reset --local`: **PASS** — foundation, identity/workspace, project และ asset migrations พร้อม seed
- `supabase test db`: **PASS** — 5 files, 133 assertions
- `npm run db:test:integration`: **PASS** — 6 files, 9 tests; รวม Storage byte lifecycle, private access, quota/concurrency, project asset links และ legacy import dedupe
- `npm test`: **PASS ล่าสุดใน local worktree** — 44 files, 455 unit tests (รวม tab-focus bootstrap และ loading UI/logo); loading continuity browser checks 12 กรณีผ่านแยกต่างหาก แพตช์ continuity ยังไม่ deploy
- `npm run build`: **PASS หลัง P1.8** — API bundles, `tsc --noEmit` และ Vite production build
- `npm run db:test:restore`: **PASS** — restore `app_private` ไป isolated database; project document, `project_assets`, asset metadata และ Storage object ที่คืนมามี ID/key/checksum ตรงกัน
- `npm run test:e2e:local`: **PASS** — auth/account isolation, migration consent/raw backup/dedupe, trusted preset + portable roundtrip, clean/dirty cross-tab, offline create/delete/import/upload restrictions + edit/reconnect และ create/delete replay หลัง response หาย
- `npm run test:http:local`: **PASS** — Vite dev/preview parity สำหรับ JSON 401/404/405/410/413, Cloud AI auth/BYOK guards, expired/foreign-shaped bearer rejection, anon/authenticated direct Data API RPC denial และ request ID
- `npm run ops:cleanup:report`: **PASS** — read-only DB/Storage reconciliation; หลังล้าง fixture รายงาน assets/objects/candidates เป็นศูนย์
- cloud-mode HTTP smoke: **PASS** — root 200, missing/forged bearer 401 JSON, legacy `/api/box-spec` 410
- Google OAuth บน remote/staging: **PASS** — provider, callback, PKCE, token verification, personal-workspace bootstrap และ editor mount ผ่านจาก local cloud-mode app; ไม่บันทึก credentials/tokens ลง Git
- Remote/staging foundation: **PASS** — project healthy/link, migration parity, private buckets, Auth URLs, Google login/bootstrap, local-origin project create/save/reload, private asset upload/download และ legacy migration; deployment-dependent smoke **PARTIAL** ตามขอบเขตด้านบน

ดู checklist รายกรณีและ evidence ที่ [backend-acceptance-phase1.md](backend-acceptance-phase1.md)
