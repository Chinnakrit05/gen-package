# PackIt backend local setup

อัปเดตล่าสุด: 13 ตุลาคม 2026

คู่มือนี้ครอบคลุม local Supabase, auth/session, project API ของ Phase 1, คีย์ AI ฝั่ง server/แพ็กเกจ (Freemium/Pro) และสถานะ staging ที่ link แล้ว

ถ้าต้องการออกแบบในเครื่องอย่างเดียว ดู [README](../README.md): `npm ci` แล้ว `npm run dev:local` ได้เลย **ไม่ต้องมี Docker หรือคีย์ใด ๆ** ขั้นตอนข้างล่างสำหรับผู้พัฒนา backend/Cloud เท่านั้น

ถ้าใช้ Supabase development/staging ที่ทีมเตรียมไว้แล้ว รัน `npm run setup:cloud` เพื่อสร้าง `.env.local` แบบไม่ทับของเดิม รับ URL/keys จากผู้ดูแลผ่านช่องทางปลอดภัย แล้วรัน `npm run dev`; ไม่ต้องสร้าง OAuth client ใหม่ทุกเครื่อง และห้ามนำ server secret ไปไว้ใน `VITE_*`

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

`db:reset` ในโปรเจกต์นี้ระบุ `--local` ชัดเจน: ลบและสร้างใหม่เฉพาะ local database แล้วใช้ migrations กับ `seed.sql` ตามลำดับ ส่วน `db:test` รัน pgTAP files ใต้ `supabase/tests/` และ `db:test:integration` ทดสอบ bootstrap/auth, project CAS/idempotency, Storage asset lifecycle/quota และ billing lifecycle (entitlements, order/dev-fulfil, design license, เครดิต AI จอง/คืน) กับ local services จริง `db:test:restore` dump/restore เฉพาะ `app_private` ไปฐานข้อมูลชั่วคราวชื่อ `packit_restore_*` และซ้อมสำรอง/ลบ/คืน Storage object ตัวอย่างพร้อม SHA-256 โดย cleanup fixture หลังจบ `test:e2e:local` ใช้ Chrome ที่ติดตั้งในเครื่องทดสอบ browser flow จริง และ `test:http:local` build แล้วตรวจ contract เดียวกันบน Vite dev/preview ดูรูปแบบ pgTAP ทางการได้ที่ [Testing Overview](https://supabase.com/docs/guides/local-development/testing/overview)

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

รัน `npm run setup:cloud` (สร้างจาก `.env.cloud.example` เฉพาะเมื่อยังไม่มี `.env.local`) แล้วใช้ค่าจาก `npx supabase status`; ถ้ามีไฟล์อยู่แล้วให้แก้เฉพาะค่าที่ต้องการโดยรักษาค่าเดิมไว้:

```dotenv
VITE_APP_MODE=cloud
VITE_API_BASE_URL=/api/v1
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=<local publishable/anon key>

APP_ENV=development
APP_ALLOWED_ORIGINS=http://127.0.0.1:5173,http://localhost:5173
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SECRET_KEY=<local secret/service-role key>

# AI บน Cloud: คีย์ของระบบฝั่ง server (ไม่บังคับ; ไม่ตั้ง = แถบ AI ตอบ 503 CONFIGURATION_ERROR)
ANTHROPIC_API_KEY=
BOX_SPEC_MODEL=
```

cloud mode เชื่อม Auth, project controller, IndexedDB drafts/mutation journal, private assets และ legacy migration แล้ว สำหรับ local smoke ให้ใช้ URL/publishable/secret values จาก `npx supabase status` เท่านั้น ห้ามคัดลอก local secret ไป staging/production และอย่า commit `.env.local`

## คีย์ AI ฝั่ง server และแพ็กเกจ

ตั้งแต่ 13 ตุลาคม 2026 `POST /api/v1/ai/box-spec` ใช้ **`ANTHROPIC_API_KEY` ของระบบ** (server env; บน Vercel ตั้งเป็น Secret) และ `BOX_SPEC_MODEL` (ว่าง = `claude-opus-5-5`) เท่านั้น — browser ไม่ส่งคีย์ของผู้ใช้อีกต่อไป (header BYOK ถูกถอดออก; การกรอกคีย์ใน UI เหลือเฉพาะ local demo กับ legacy `/api/box-spec`) ไม่ตั้งคีย์ → route ตอบ 503 `CONFIGURATION_ERROR` โดยไม่หักเครดิต

คำขอ AI หัก 1 เครดิตของ workspace ตอนจอง (`reserve_ai_credit`) และคืนเมื่อ provider ล้ม; เครดิตมาจากการซื้อรายแบบ 149 บาท หรือ Pro 399 บาท/เดือน ตาม [billing-freemium-pro.md](billing-freemium-pro.md) (ตาราง/RPC ใน migration `20261013000600_billing.sql`; ราคาและจำนวนเครดิตแก้ที่ `app_private.plan_catalog`) ยังไม่เลือกผู้ให้บริการชำระเงิน: `POST /api/v1/billing/orders` สร้าง order `pending` (`provider = 'none'`) และ `POST /api/v1/billing/orders/:id/dev-fulfil` จำลองการจ่ายได้เฉพาะ `APP_ENV=development|test` (staging/production ตอบ 404) ห้ามนำ dev-fulfil ไปเปิดบน environment ที่มีผู้ใช้จริง

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
2. **DONE** ตรวจ dry-run แล้ว push migrations 5 รายการ (19 ก.ย. 2026) และ migration billing `20261013000600_billing.sql` (14 ต.ค. 2026 — dry run แสดงไฟล์เดียว ไม่มี seed/role, ใช้ `--skip-vault`); `npm run staging:readiness` ยืนยัน remote up to date แบบ read-only
3. **DONE** สร้าง private buckets, ตั้ง local Site URL/Redirect URLs, เปิด Google provider และทดสอบ callback/PKCE/server bootstrap กับ remote staging แล้ว
4. **DONE** ตั้ง Vercel staging config: frontend ใช้ publishable key; `SUPABASE_SECRET_KEY` เป็น Secret ฝั่ง server; ยังต้องตรวจ Storage CORS ด้วย staging origin จริง
5. Google login/bootstrap และเปิดงานผ่านบน Vercel แล้ว; create/save/reload, PNG signed upload/download และ legacy migration ผ่านจาก local cloud-mode app; ยังเหลือ deployed write/upload flows, authenticated 413 และ Storage CORS
6. ทดสอบ Sharp native packaging และซ้อม restore database + object manifest/checksum ก่อนเปิด public pilot

## Remote/staging status

- Supabase project `gen-package-staging` ใน Singapore: **ACTIVE_HEALTHY และ link แล้ว**
- migrations 6 รายการ (รวม billing): **PUSHED / local-remote parity PASS (14 ตุลาคม 2026)** — staging ใช้ Postgres 17.6 เท่ากับ local; `inspect db table-stats` เห็นตาราง billing ครบ 7 ตาราง (`plan_catalog` 2 แถว ตารางอื่นว่าง) และข้อมูลเดิมไม่เปลี่ยน; แอปที่ deploy อยู่ (โค้ด main เดิม) ยังตอบ root/health 200 และ 401 เมื่อไม่ login
- private buckets `packit-staging` และ `packit-assets`: **CREATED** — PNG/JPEG, 10 MiB; ไม่มี broad browser Storage policy โดยตั้งใจ เพราะ browser ใช้ API-issued signed URL
- Auth Site URL: `https://packit-design.vercel.app`; Redirect URLs มีโดเมนใหม่นี้, `https://gen-package-staging.vercel.app` และ local `127.0.0.1:5173`/`localhost:5173`: **CONFIGURED**
- Google OAuth provider/callback: **PASS remote + local app** — Google client และ test user ตั้งแล้ว; PKCE callback กลับ `127.0.0.1:5173`, server bootstrap และ editor mount สำเร็จ (Google app ยังเป็น Testing)
- Storage signed upload/download จาก `127.0.0.1:5173`: **PASS remote + local app** — PNG fixture ผ่าน validation, autosave และโหลด private asset กลับหลัง reload; deployed-origin CORS ยัง **NOT RUN**
- Legacy migration จาก `127.0.0.1:5173`: **PASS remote + local app** — decline/reopen consent, ย้าย 1 งาน, เปิด/reload แล้วได้ขนาดเดิม 80×50×120 มม.; source localStorage/raw backup ยังอยู่และไม่มี browser console error
- Vercel env (ตรวจ 14 ตุลาคม 2026 ด้วย `vercel env pull` แล้วอ่านเฉพาะคีย์ที่ต้องการ): Production มี `APP_ENV=staging`, `VITE_APP_MODE=cloud` และตัวแปร Supabase (`SUPABASE_SECRET_KEY` เป็นชนิด sensitive ดึงลงเครื่องไม่ได้) ยังไม่มี `ANTHROPIC_API_KEY`/`BOX_SPEC_MODEL`; **Preview และ Development ไม่มีตัวแปรของแอปเลย** — preview deployment จึงรัน frontend เป็นโหมด local และ API เริ่มไม่ขึ้นเพราะไม่มี `APP_ENV` (เส้นทาง dev-fulfil จึงเปิดบน preview ไม่ได้) และ preview ถูกปิดด้วย Vercel Authentication; ถ้าต้องการ preview ที่ใช้ cloud ได้ ให้เพิ่มตัวแปรชุดเดียวกับ Production ใน Preview โดย `APP_ENV=staging` เสมอ ห้ามใช้ development/test
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
- `supabase db reset --local`: **PASS (15 ตุลาคม 2026, macOS + Docker Desktop, Supabase CLI 2.117.0, Postgres 17.6)** — 7 migrations รวม `20261013000600_billing.sql` และ `20261015000700_open_access.sql` พร้อม seed และ private buckets
- `supabase test db`: **PASS (15 ตุลาคม 2026)** — 7 files, 305 assertions (`0006_billing.test.sql` 131, `0007_open_access.test.sql` 41)
- `npm run db:test:integration`: **PASS (15 ตุลาคม 2026)** — 7 files, 19 tests; รวม Storage byte lifecycle, private access, quota/concurrency, project asset links, legacy import dedupe และ billing lifecycle (entitlements, 402, order/fulfil idempotent, จอง/คืนเครดิต, เก็บการใช้งาน AI, cap คำขอพร้อมกัน, Pro license, ผู้ใช้อื่นเห็น 404, open access ผ่าน `BillingService` จริง)
- `npm test`: **PASS ล่าสุดใน local worktree (15 ตุลาคม 2026)** — 81 files, 973 passed + 1 skipped (รวม onboarding isolation/no-overwrite, tab-focus bootstrap, loading UI/logo และ billing: `PaywallModal`, `watermark`, `services/api/billing`, `billingService`, router 402/409); loading continuity browser checks 12 กรณีผ่านแยกต่างหาก; ผล deploy ของ continuity ยังไม่ได้ตรวจ
- `npm run build`: **PASS หลัง P1.8** — API bundles, `tsc --noEmit` และ Vite production build
- `npm run db:test:restore`: **PASS (14 ตุลาคม 2026 หลังเพิ่มตาราง billing)** — restore `app_private` ไป isolated database; project document, `project_assets`, asset metadata และ Storage object ที่คืนมามี ID/key/checksum ตรงกัน
- `npm run test:e2e:local`: **PASS (14 ตุลาคม 2026 รัน 2 รอบติด และ 15 ตุลาคม 2026 หลังเพิ่ม open access, macOS Chrome ผ่าน `PACKIT_E2E_CHROME`)** — auth/account isolation, migration consent/raw backup/dedupe, trusted preset + portable roundtrip, clean/dirty cross-tab, offline create/delete/import/upload restrictions + edit/reconnect, create/delete replay หลัง response หาย และ paywall: Freemium กดดาวน์โหลด → paywall → สั่งซื้อรายแบบ → จำลองชำระ → ได้ SVG จริงที่ไม่มีลายน้ำ + DB มี license `purchase` และเครดิต 10; สคริปต์อัปเดต selector ตามแกลเลอรีงาน (ปุ่ม "สร้างงาน", ลบ/สลับงานใน dialog "งานทั้งหมด") ซึ่งเปลี่ยนตั้งแต่ commit `d89625f` ทำให้ E2E บน main ก่อนหน้านี้พังที่ขั้นออฟไลน์
- `npm run test:http:local`: **PASS (15 ตุลาคม 2026)** — Vite dev/preview parity สำหรับ JSON 401/404/405/410/413, Cloud AI 401 (ไม่มี bearer) / 503 (server ไม่มีคีย์ — สคริปต์ตั้ง `ANTHROPIC_API_KEY` ว่างให้ child process) / 422 (ไม่มี `operationId`), billing smoke (`purchasesEnabled`, `openAccess` ปิดใน development, export-authorizations 402 ตอนฟรี → สั่ง Pro → dev-fulfil → 200), expired/foreign-shaped bearer rejection, anon/authenticated direct Data API RPC denial และ request ID
- `npm run ops:cleanup:report`: **PASS (14 ตุลาคม 2026)** — read-only DB/Storage reconciliation รวมตัวนับ billing; หลังล้าง fixture รายงานทุกค่าเป็นศูนย์
- `npm run ops:ai-usage:report`: **PASS (14 ตุลาคม 2026)** — รันกับ local ทั้งตอนว่างและกับข้อมูลตัวอย่างชั่วคราว (สำเร็จ 2 ล้มเหลว 1): ค่าเฉลี่ย/p95/ต้นทุนประมาณการและยอดเครดิตตรงที่คำนวณมือ แล้วลบข้อมูลตัวอย่างออก
- cloud-mode HTTP smoke: **PASS** — root 200, missing/forged bearer 401 JSON, legacy `/api/box-spec` 410
- Google OAuth บน remote/staging: **PASS** — provider, callback, PKCE, token verification, personal-workspace bootstrap และ editor mount ผ่านจาก local cloud-mode app; ไม่บันทึก credentials/tokens ลง Git
- Remote/staging foundation: **PASS** — project healthy/link, migration parity, private buckets, Auth URLs, Google login/bootstrap, local-origin project create/save/reload, private asset upload/download และ legacy migration; deployment-dependent smoke **PARTIAL** ตามขอบเขตด้านบน
- Billing / Freemium-Pro: ชุด local ทั้งหมดข้างบน **PASS เมื่อ 14 ตุลาคม 2026**; migration billing **push ขึ้น staging แล้ว (14 ตุลาคม 2026)**; ยังไม่ได้ตั้ง `ANTHROPIC_API_KEY`/`BOX_SPEC_MODEL` ใน Vercel และยังไม่ merge โค้ด (ขั้นตอนอยู่ใน PR Chinnakrit05/gen-package#4)

ดู checklist รายกรณีและ evidence ที่ [backend-acceptance-phase1.md](backend-acceptance-phase1.md)
