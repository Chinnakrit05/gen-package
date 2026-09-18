# PackIt backend local setup

อัปเดตล่าสุด: 18 กันยายน 2026

คู่มือนี้ครอบคลุม local Supabase, auth/session และ project API ของ Phase 1 ยังไม่สร้างหรือแก้ remote project

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
```

`db:reset` ในโปรเจกต์นี้ระบุ `--local` ชัดเจน: ลบและสร้างใหม่เฉพาะ local database แล้วใช้ migrations กับ `seed.sql` ตามลำดับ ส่วน `db:test` รัน pgTAP files ใต้ `supabase/tests/` และ `db:test:integration` ทดสอบ bootstrap/auth, project CAS/idempotency และ Storage asset lifecycle/quota กับ local services จริง ดูรูปแบบ pgTAP ทางการได้ที่ [Testing Overview](https://supabase.com/docs/guides/local-development/testing/overview)

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

P1.2 เชื่อม cloud mode แล้ว สำหรับ local smoke ให้ใช้ URL/publishable/secret values จาก `npx supabase status` เท่านั้น ห้ามคัดลอก local secret ไป staging/production และอย่า commit `.env.local`

หลัง sign-in browser ส่ง access token ไป `POST /api/v1/session/bootstrap`; server ตรวจ token กับ Supabase Auth แล้วสร้าง app user/personal workspace ผ่าน server-only RPC หลังจากนั้นมี `GET /api/v1/me` และ `/api/v1/projects` CRUD สำหรับ bearer token เดิม แต่งานใน editor ยังเป็น account-scoped browser draft จนกว่า P1.5–P1.6 จะต่อ codec, asset references และ save queue เข้าด้วยกัน

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

OAuth จริงต้องตรวจบน staging อีกครั้ง เพราะ local email-auth integration test พิสูจน์ token verification/bootstrap ได้ แต่ไม่พิสูจน์ Google console และ redirect allowlist ของ remote project

## Remote/staging

ยังไม่ทำใน milestone นี้ การ link, `db push`, OAuth provider, storage CORS และ Vercel secrets ต้องทำภายหลังเมื่อได้รับ project/สิทธิ์ชัดเจน ห้ามใช้ `db reset --linked` กับ staging/production และห้ามใส่ secrets ลงเอกสารหรือ Git

## Verification status บนเครื่องนี้

- Supabase CLI 2.117.0: ติดตั้งและรันได้
- Docker Desktop 4.91.0, Docker Engine 29.8.0 และ WSL 2.7.13: รัน local stack ได้; stale socket จากการเริ่มครั้งก่อนไม่ปรากฏแล้ว
- `supabase db reset --local`: **PASS** — foundation, identity/workspace, project และ asset migrations พร้อม seed
- `supabase test db`: **PASS** — 4 files, 121 assertions
- `npm run db:test:integration`: **PASS** — 5 files, 8 tests; รวม Storage byte lifecycle, private access, quota/concurrency และ project asset links
- `npm test`, `tsc --noEmit`, `npm run build`: **PASS หลัง P1.4** — 30 files, 374 unit tests
- cloud-mode HTTP smoke: **PASS** — root 200, missing/forged bearer 401 JSON, legacy `/api/box-spec` 410
- Google OAuth บน remote/staging: **NOT RUN** — ยังไม่มี remote project/provider credentials
- Remote/staging: **NOT RUN**
