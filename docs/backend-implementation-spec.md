# PackIt — Backend Implementation Specification & Handoff

วันที่: 17 กันยายน 2026 · เป้าหมายผู้รับงาน: GPT Sol / ผู้พัฒนาระบบ

Repository: `https://github.com/Chinnakrit05/gen-package.git`

Workspace ปัจจุบัน: `D:/projects/gen-package`

Branch: `feat/supabase-backend`

Baseline ที่ตรวจ: `d32a573` (แผน), application baseline `8e0eea9`

สถานะ: **เอกสารออกแบบสำหรับลงมือพัฒนาภายหลัง ไม่ใช่ระบบที่สร้างหรือทดสอบแล้ว**

แนวทางอ่าน: เริ่มส่วน 0–2 เพื่อเข้าใจขอบเขต; ส่วน 3–9 เป็น implementation ของเฟสแรก; ส่วน 10–13 เป็นเฟสถัดไป; ส่วน 14–17 เป็น setup/tests/milestones/operations; ส่วน 18 เป็นแผนย้ายระบบ; ส่วน 19–20 เป็นข้อห้ามและรูปแบบส่งงาน

## 0. วิธีใช้เอกสารและขอบเขตการส่งต่อ

อ่านคู่กับ [แผนภาพรวม](backend-plan.md) และ `CLAUDE.md` แต่ตรวจ source จริงก่อนแก้ เพราะคำอธิบายบางจุดล้าสมัย เช่น file schema ใน source เป็น version 6 แล้ว

สิ่งที่ผู้ใช้ตกลงแล้ว:

- ใช้ Supabase ก่อนโครงการได้รับอนุมัติ และออกแบบให้ย้ายได้
- คง React/Vite/TypeScript และ editor/3D เดิม
- เตรียมทางไป NestJS + PostgreSQL + Object Storage โดยไม่บังคับย้ายทั้งหมดทันที
- แบ่งงาน 5 เฟส: บัญชี/Cloud save → AI → Billing → Export → Team/Operations

รายละเอียดระดับ implementation ในเอกสารนี้เป็นข้อเสนอที่เลือกให้เริ่มงานได้ ไม่ใช่ข้อกำหนดธุรกิจที่ผู้ใช้อนุมัติครบทุกข้อแล้ว โดยเฉพาะราคา โควตา retention และเงื่อนไขซื้อรายแบบ

**Default scope ของการเริ่มพัฒนา: Phase 0 และ Phase 1 เท่านั้น** ทำเป็นช่วงย่อยที่ทดสอบได้ ไม่ลงมือทุกเฟสในครั้งเดียว หากยังไม่มี credentials ให้ทำโค้ด migration และ local tests ต่อได้ พร้อมแยกสิ่งที่ยังไม่ได้ทดสอบกับบริการจริง

ไม่สร้าง cloud project, ซื้อบริการ, เปิดเก็บเงินจริง, apply migration บน production, ลบข้อมูล หรือ commit/push โดยอัตโนมัติจากเอกสารนี้ ต้องมีคำสั่งหรือสิทธิ์สำหรับการกระทำนั้นต่างหาก ห้ามขอ secret ให้ผู้ใช้วางในแชต; ให้ตั้งใน environment/secret manager

### Prompt สำหรับส่งให้ GPT Sol

> อ่าน docs/backend-implementation-spec.md และ docs/backend-plan.md ทั้งไฟล์ แล้วตรวจ source และคำแนะนำใน repository อีกครั้ง เริ่มพัฒนาเฉพาะ Phase 0 และ Phase 1 บน branch feat/supabase-backend ตาม API-first architecture ที่ระบุ รักษา editor/3D และ .genpkg.json เดิม ไม่เริ่ม Billing/paid Export/Team และไม่ deploy หรือใช้ production โดยไม่ได้รับอนุญาต ทำทีละ milestone พร้อม tests หากพบสเปกขัดกับ source หรือเกิด tradeoff ที่ทำให้ข้อมูลเดิมสูญหาย ให้รายงานก่อนเปลี่ยนแนวทาง อย่าใช้ mock มาอ้างว่าทดสอบ Supabase จริงผ่าน เมื่อส่งงานให้สรุปไฟล์ที่แก้ tests ที่รัน สิ่งที่ยังไม่ผ่าน และขั้นตอนตั้งค่าที่ผู้ใช้ต้องทำ

## 1. สิ่งที่มีอยู่จริงและจุดที่ต้องแตะ

| Source | สิ่งที่พบ | ผลต่อ backend |
| --- | --- | --- |
| `src/main.tsx` | `packit-auth` จำลอง login; logout ลบ local project keys | เปลี่ยน auth lifecycle และห้ามลบงานเงียบ ๆ |
| `src/App.tsx` | `store0 = loadStore()` ที่ระดับ module; autosave 300 ms เขียนทุกงานลง localStorage | ต้อง hydrate หลังรู้บัญชี ไม่ใช้ singleton ข้าม session |
| `src/App.tsx` | `flushInto`, switch/new/delete/rename/import/export ผูกกับ editor state | แยก controller ทีละส่วน ไม่แทนที่ effect เดิมด้วย fetch ตรง ๆ |
| `src/core/project.ts` | `Project` และ parser ที่ซ่อม/clamp ข้อมูล | ใช้สำหรับ compatibility; API ต้องมี strict validation เพิ่ม |
| `src/core/projectFile.ts` | file schema 6; import สร้าง UUID ใหม่เสมอ | แยก file schema, cloud schema และ revision; ไม่ใช้ import parser สร้าง ID ซ้ำทุก retry |
| `src/core/artwork.ts` | image deco parser รับเฉพาะ `data:image/`; fill image รับ string ได้กว้างกว่า | cloud document ต้องเป็นคนละ DTO และมี codec/hydration |
| `src/core/ai.ts` | เรียก `/api/box-spec` ไม่มี token/cancellation | เพิ่ม auth, request ID และ session/project guard |
| `server/boxSpec.ts`, `server/handler.ts` | dev กับ production มี transport คนละตัว | รวม application service เพื่อไม่ให้ security แตกต่างกัน |
| `scripts/build-api.mjs`, `api/box-spec.js` | esbuild สร้าง serverless bundle; JS เป็น generated file | แก้ source/build script ไม่แก้ generated JS ด้วยมือ |
| `src/core/pdf.ts`, `dxf.ts` | มีส่วน pure ที่แชร์ได้ | ไม่จำเป็นต้องเขียน geometry ใหม่ |
| `src/core/artwork.ts`, `specSheet.ts` | Canvas, DOM, Image, font loading | server export ต้อง refactor หรือใช้ isolated browser worker |

รายละเอียดข้อมูลที่ห้ามตกหล่น: `live`, `qty`, `fillColor`, `fillImage`, `labelStyle`, `pouchStyle`, `zipper`, `pouchAddons`, `decos`, `history`, `histIdx` รวมทุกชนิด artwork ใน union ปัจจุบัน

`history` เดิมเป็นประวัติ spec/AI สูงสุด 30 รายการ ไม่ใช่ snapshot artwork ทั้งงาน ส่วน undo เป็น state ในเครื่องสูงสุด 50 snapshots ไม่ใช่ cloud version history

## 2. Architecture decision: API-first, Supabase เป็น infrastructure adapter

เอกสารภาพรวมเคยเปิดทางให้ CRUD จาก browser ผ่าน Supabase ได้ เอกสารละเอียดนี้เลือก **ให้ business data ทั้งหมดผ่าน API ของเรา** เพื่อลดจุดผูกกับ provider และรวม validation/authorization ไว้ในที่เดียว

```text
React editor / project controller
  ├─ Auth adapter ──────────────────────> Supabase Auth (Google)
  ├─ HTTP repositories ── Bearer JWT ──> /api/v1/* (Node TypeScript)
  │                                       ├─ Auth verifier → Actor
  │                                       ├─ Application services / domain rules
  │                                       ├─ Repository ports → Supabase RPC → PostgreSQL
  │                                       ├─ Storage port → Supabase Storage
  │                                       └─ AI port → Anthropic
  └─ Authorized upload ticket ──────────> private staging storage

Future: HTTP layer → NestJS controllers; domain/services/contracts คงเดิม
        repository/storage adapters เปลี่ยนแยกกันเมื่อมีเหตุผล
```

### ข้อแลกเปลี่ยนที่ยอมรับ

- มี API เพิ่มกว่าใช้ Supabase client CRUD ตรง แต่ไม่ต้องย้าย database calls จาก UI อีกรอบ
- ยังใช้ Supabase Auth/Storage ช่วยลดงาน infrastructure ไม่เขียนระบบ password/session เอง
- Node API และ Supabase อาจมี network hop เพิ่ม จึงเลือก region ใกล้กันและวัด latency
- server credential มีสิทธิ์สูง: ต้องตรวจ actor และ tenant ในทุก repository operation; ห้ามอ้างว่า RLS จะป้องกัน bug ฝั่ง service role ให้เอง
- ไม่ใช้ Next.js, NestJS, Redis, Kafka, Kubernetes, GraphQL หรือ monorepo tooling ใน Phase 1 โดยไม่มีเหตุผลเพิ่มเติม

### Trust boundaries

1. Browser ไม่น่าเชื่อถือ: IDs, ราคา, role, revision, MIME, checksums และสถานะ paid ต้องตรวจใหม่
2. JWT ยืนยันตัวตน ไม่ใช่สิทธิ์โปรเจกต์: ตรวจ membership ในฐานข้อมูลทุกครั้ง
3. Storage URL เป็น temporary capability: ผู้ได้ URL ใช้ได้จนหมดอายุ; ไม่ใช่ตัวตนถาวรของไฟล์
4. AI output ไม่น่าเชื่อถือ: validate ด้วย schema และ registry ของระบบก่อนคืนหรือบันทึก
5. Payment redirect ไม่ยืนยันการจ่าย: ใช้ verified webhook/reconciliation เท่านั้น

## 3. โครงสร้างโค้ดที่เสนอ

ชื่อไฟล์ปรับได้เล็กน้อย แต่ต้องรักษาทิศทาง dependency นี้ ไม่สร้างแฟ้มว่างทั้งหมดล่วงหน้า

```text
shared/
  contracts/                 # DTO / request / response; ไม่ import React หรือ provider SDK
    auth.ts projects.ts assets.ts ai.ts errors.ts
  validation/                # strict runtime schemas; แนะนำ Zod
    projectDocument.ts
  domain/                    # pure rules / canonicalization; เพิ่มเมื่อมีงานจริง
server/
  config.ts                  # validate env; startup fail-closed
  compositionRoot.ts         # ประกอบ services + adapters
  http/
    router.ts                # routing เดียวสำหรับ dev/production
    auth.ts body.ts errors.ts requestContext.ts
  entrypoints/
    vercel.ts                # HTTP transport, ไม่มี business rule
    vite.ts
  modules/
    identity/                # bootstrap/resolve app user
    projects/                # service + repository port
    assets/                  # service + repository/storage ports
    ai/                      # service/provider port; quota เพิ่ม Phase 2
    billing/                 # Phase 3 เท่านั้น
    exports/                 # Phase 4 เท่านั้น
    workspaces/              # personal membership เริ่มต้น; team UI Phase 5
  adapters/
    supabase/                # auth verifier, RPC repositories, storage; server only
    anthropic/
  boxSpec.ts                 # ค่อยแยก provider/mock ออก รักษาพฤติกรรมเดิม
  handler.ts                 # legacy route ชั่วคราว → shared handler/service
src/
  services/
    auth/                    # AuthService + Supabase browser adapter
    api/                     # HTTP client, auth header, error mapping
    projects/                # HTTP ProjectRepository + cloud/editor codec
    assets/                  # HTTP/ticket upload + asset resolution cache
    ai/                      # HTTP AiService
    drafts/                  # IndexedDB scoped drafts + migration journal
  features/projects/
    useProjectController.ts
    useSaveQueue.ts
    legacyMigration.ts
  features/auth/
    AuthProvider.tsx
  core/                      # geometry/editor domain เดิม; ไม่ย้ายทั้งหมดในครั้งเดียว
supabase/
  config.toml
  migrations/
  tests/database/
  seed.sql                   # local fixtures เท่านั้น ไม่มี production PII/secrets
tests/
  contracts/ integration/ e2e/
docs/
  backend-implementation-spec.md
  backend-setup.md            # สร้างตอน implementation ตามสิ่งที่ทำได้จริง
  backend-progress.md         # milestones, test evidence, known gaps
```

กฎ dependency:

- UI → controller → HTTP repository; ห้าม UI import server/Supabase database SDK
- application service → port interface; adapter implement port ไม่ให้ service ผูก `.from()`/`.rpc()`
- server ใช้ `import type` สำหรับ editor types; ห้ามลากไฟล์ browser-only เข้ารันใน Node โดยไม่ตรวจ side effects
- เพิ่ม `shared` และ tests ใน typecheck config; แยก browser/server tsconfig เมื่อจำเป็นเพื่อจับ import ผิดฝั่ง
- SQL migrations เป็นแหล่งจริงของ database schema; generate Supabase DB types ได้ แต่ห้ามเปิด Prisma migration แข่งอีกชุด

Dependencies ที่มีเหตุผล: `@supabase/supabase-js`, Zod, helper IndexedDB เช่น `idb`; image validator/decoder เช่น `sharp` เมื่อทำ assets ต้องทดสอบ native packaging บน deployment จริง เลือกเวอร์ชันที่เข้ากันแล้ว pin ผ่าน lockfile ไม่ใส่เลขเวอร์ชันจากความจำ

## 4. Identity, session และ mode การทำงาน

### 4.1 Identity ที่เป็นของแอป

ใช้ `app_user_id` เป็น UUID ภายใน ไม่ใช้ email หรือ Google ID เป็น foreign key ของโปรเจกต์

```ts
interface Actor {
  userId: string;             // internal app user id
  identityIssuer: string;     // verified issuer
  identitySubject: string;    // verified JWT sub
  requestId: string;
}
```

- Auth adapter ตรวจ access token กับ Supabase Auth (`getUser(token)` เป็น baseline ที่เข้าใจง่าย) ก่อน bootstrap/resolve identity
- ถ้าใช้ getUser ให้กำหนด issuer จาก Supabase project configuration ที่เชื่อถือได้ และ subject จาก user ID ที่ provider ยืนยัน ไม่อ่าน unverified claims มาเลือก issuer หรือ actor
- หากเปลี่ยนเป็น local JWT verification ภายหลัง ต้องตรวจ signature/algorithm, issuer, audience, exp และการหมุน key ไม่ใช่ decode อย่างเดียว
- ใช้ issuer + subject ที่ตรวจแล้วเป็น unique identity key; provider ตอนนี้ `supabase` ไม่ใช่ใช้ Google subject มาปะปน
- Bootstrap ทำเป็น transaction เดียว: app_user + identity + personal workspace + owner membership
- Concurrent bootstrap ต้องคืน user/workspace เดิม ไม่มี orphan; ใช้ lock/unique constraint และ retry ที่ชัดเจน
- ห้าม auto-link บัญชีด้วย email ตรงกัน; ห้ามรับ app_user_id/role จาก client มาเชื่อม identity
- ไม่ FK โปรเจกต์ทั้งหมดไป `auth.users`; การลบบัญชี provider ต้องไม่ cascade ลบงาน/รายการซื้อเอง
- app_user ที่ suspended/deleted ต้องถูกปฏิเสธ แม้ token ยังตรวจลายเซ็นผ่าน

Auth session/verification และข้อกำหนด Google redirect อ้างอิง [Supabase JWT](https://supabase.com/docs/guides/auth/jwts) และ [Google login](https://supabase.com/docs/guides/auth/social-login/auth-google)

### 4.2 Frontend auth lifecycle

- `loading → anonymous | authenticated | error`; อย่า mount editor ด้วยข้อมูลบัญชีเก่าระหว่างโหลด session
- ใช้ SDK จัดการ OAuth/PKCE ตามเวอร์ชันที่ติดตั้ง; redirect กลับ root URL ที่ allowlist ไว้ได้ ไม่จำเป็นต้องเพิ่ม router ทั้งแอป
- สอง redirect คนละหน้าที่: Google → Supabase callback และ Supabase → app URL; ระบุใน setup guide แยก local/staging/production
- หลัง sign-in เรียก `POST /api/v1/session/bootstrap` แล้วค่อยโหลด workspace/projects
- เพิ่ม `sessionEpoch`; เมื่อบัญชีเปลี่ยน abort requests, clear in-memory asset cache และ mount controller ใหม่ตาม app_user_id
- token refresh ทำได้หนึ่งครั้งก่อน retry; mutation ต้อง retry ด้วย operation ID เดิม; ไม่วน retry 401 ไม่จบ
- logout: รักษา unsynced draft แบบ account-scoped หรือให้ผู้ใช้ดาวน์โหลดสำรองก่อน ห้ามลบ cloud และห้าม replay draft ไปอีกบัญชี
- IndexedDB isolation เป็นการแยกข้อมูลระดับแอป ไม่ใช่ encryption ป้องกันผู้ที่เข้าถึง browser profile ได้ ต้องแจ้งข้อจำกัดเครื่องใช้ร่วมกันและมี clear-local-data action
- Auth token ไม่บันทึกเองซ้ำใน log/draft; client-side session มีความเสี่ยงจาก XSS จึงต้องรักษา CSP และตรวจ SVG/HTML imports

### 4.3 Local demo กับ cloud

- มี explicit mode `local` หรือ `cloud`; รักษา editor local demo ไว้สำหรับพัฒนาโดยไม่มี credentials
- cloud mode ที่ config ไม่ครบต้องแสดง configuration error ไม่ fallback เป็น mock auth เงียบ ๆ
- local demo ห้ามได้รับ server privileges และห้ามเปิด paid AI บน public deployment
- Phase 1 ต้องปิดหรือ authenticate `/api/box-spec` เดิมด้วย ไม่ปล่อยเส้นทางเก่าเป็นช่องข้าม security
- ก่อน Phase 2 ผ่าน ให้ public cloud deployment ปิด paid AI หรือใช้ mock ที่แสดงชัดเจน ห้ามถือว่า login อย่างเดียวคุมค่า AI ได้แล้ว

## 5. Data model และขอบเขตฐานข้อมูล

### 5.1 Schema/access strategy ที่เลือก

- ตารางธุรกิจอยู่ใน `app_private` ซึ่งไม่อยู่ใน exposed Data API schemas
- Public schema มีเฉพาะ RPC wrappers ที่จำเป็นต่อ server adapter; `EXECUTE` เฉพาะ `service_role`
- revoke grants ของ `PUBLIC`, `anon`, `authenticated` บนตาราง/sequence/RPC ของเรา พร้อมตั้ง default privileges สำหรับ role ที่สร้าง object จริง
- enable RLS บนตารางธุรกิจ แต่ไม่มี direct-client allow policy ใน Phase 1: browser อ่าน/เขียนตารางโดยตรงไม่ได้
- server role ได้ explicit schema/table privileges ที่จำเป็น; เริ่ม RPC ด้วย `SECURITY INVOKER` เพราะ role นี้มีสิทธิ์อยู่แล้ว
- server Supabase client ต้องแยกจาก session client: ไม่เรียก signIn/setSession ด้วย token ผู้ใช้บน singleton privileged client; ส่ง actor ที่ resolve แล้วเป็น RPC parameter เฉพาะฝั่ง server
- ไม่ใช้ `SECURITY DEFINER` โดยอัตโนมัติ หากจำเป็นต้องอธิบายเหตุผล กำหนด owner/search_path ให้ปลอดภัย fully qualify names และ revoke default execute
- **RLS ไม่ป้องกัน service-role bug**: ทุก RPC ต้องตรวจ actor + membership + object scope เอง แม้เป็น read/list/download
- ไม่ปิด Data API ทั้งบริการ เพราะ server adapter ยังใช้ RPC ผ่าน API นี้

นี่เป็นการเลือก API-only authorization boundary ไม่ใช่แบบ browser CRUD + per-user RLS; อย่าผสมสองแบบโดยไม่มีการทบทวนสิทธิ์ใหม่ แนวทาง grants/schema/RPC อ้างอิง [Securing the Data API](https://supabase.com/docs/guides/api/securing-your-api) และ [Database functions](https://supabase.com/docs/guides/database/functions)

### 5.2 ตาราง Phase 1

ทุกเวลาใช้ `timestamptz` จาก server/DB และ UUID เป็น identifiers; email ไม่ใช่ identity key

| ตาราง | คอลัมน์หลัก | Constraints/index ที่ต้องมี |
| --- | --- | --- |
| `app_users` | id, display_name, email nullable, status, created_at, updated_at | status active/suspended/deleted; จำกัดความยาวชื่อ; client เปลี่ยน status ไม่ได้ |
| `auth_identities` | id, app_user_id, provider, issuer, subject, created_at | UNIQUE(issuer,subject); FK app_user; ไม่มี client write |
| `workspaces` | id, kind, owner_user_id, name, created_at | kind personal/team; partial UNIQUE(owner_user_id) WHERE kind=personal |
| `workspace_members` | workspace_id, user_id, role, created_at | PK(workspace_id,user_id), index(user_id,workspace_id); Phase 1 bootstrap owner เท่านั้น |
| `projects` | id, workspace_id, created_by, name, document_schema_version, document JSONB, revision bigint, created_at, updated_at, deleted_at | revision เริ่ม 1; name 1–60; UNIQUE(id,workspace_id); index(workspace_id,updated_at DESC,id DESC) WHERE deleted_at IS NULL |
| `assets` | id, workspace_id, created_by, purpose, state, provider, staging_key, object_key, mime_type, byte_size, sha256, width, height, created_at, updated_at, ticket_expires_at, processing_lease_until, processing_fencing_version | state pending/validating/ready/rejected/deleting/deleted; immutable เมื่อ ready; UNIQUE(id,workspace_id), UNIQUE(provider,object_key) เมื่อมีค่า |
| `asset_operations` | workspace_id, actor_user_id, operation_id, operation_type, request_hash, asset_id, result metadata, created_at | UNIQUE(workspace_id,actor_user_id,operation_id); durable logical receipt ไม่เก็บ signed token ลง log/ผลถาวร |
| `storage_usage` | workspace_id, quota_bytes, reserved_bytes, committed_bytes, pending_count | PK(workspace_id); counts >=0; reserve/settle ใน transaction |
| `storage_reservations` | asset_id, workspace_id, reserved_bytes, state, expires_at, settled_at | UNIQUE(asset_id); reserved/settled/released; ticket expiry + grace และ settlement idempotent |
| `project_assets` | project_id, asset_id, workspace_id | PK(project_id,asset_id); composite FK ไป projects และ assets พร้อม workspace_id กัน cross-tenant reference |
| `project_operations` | workspace_id, actor_user_id, operation_id, operation_type, request_hash, project_id, result_revision, result metadata, created_at | UNIQUE(workspace_id,actor_user_id,operation_id); durable receipt สำหรับ mutation retry |
| `legacy_imports` | user_id, source_installation_id, source_project_key, source_hash, target_project_id, completed_at | UNIQUE(user_id,source_installation_id,source_project_key); mapping คงเดิมเมื่อ retry |

เพิ่มเติม:

- บทบาท enum/constraint เตรียม owner/editor/viewer ได้ แต่ Phase 1 ไม่มี invite/role-change endpoint; ไม่ให้ client เพิ่ม membership เอง
- มี personal workspace ตั้งแต่แรกเพื่อไม่ต้อง backfill tenant ไปทุกตารางตอนทำทีม ไม่สร้าง team billing ตอนนี้
- `created_by` ไม่ใช่ tenant authorization: สิทธิ์ยึด workspace membership
- soft delete project ใน Phase 1; ไม่ hard-delete assets ตามทันที เพราะมีงานอื่นหรือ export snapshot อ้างอยู่ได้
- ไม่สร้าง full snapshot ทุก autosave ใน Phase 1; revision เป็นเลข concurrency ไม่ใช่ประวัติที่กู้คืนได้ทุกเลข
- เก็บ operation receipt ต่อไปจนมีนโยบาย retention ที่ยืนยันแล้ว; ไม่ลบทิ้งสั้น ๆ จน offline retry สร้างงานซ้ำ
- server-generated fields เปลี่ยนโดย RPC เท่านั้น; ห้าม mass assignment จาก request ลง row

### 5.3 Cloud document ต่างจาก editor model

```ts
// Type illustration: runtime schema ต้อง validate ทุก union member จริง
type CloudImage = Omit<ImageEl, 'src'> & { assetId: string };
type CloudFillImage = Omit<FillImage, 'src'> & { assetId: string };
type CloudDeco = Exclude<Deco, ImageEl> | CloudImage;

interface CloudProjectDocumentV1 {
  live: CurrentSpec;
  qty: number;
  fillColor: string | null;
  fillImage?: CloudFillImage | null;
  labelStyle?: LabelStyle;
  pouchStyle?: PouchStyle;
  zipper?: boolean;
  pouchAddons?: PouchAddons;
  decos: CloudDeco[];
  history: DesignVersion[];       // AI/spec history เดิม ไม่ใช่ cloud snapshots
  histIdx: number;
}

interface CloudProject {
  id: string;
  workspaceId: string;
  name: string;
  documentSchemaVersion: 1;
  document: CloudProjectDocumentV1;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
```

- DB bigint ส่งออกเป็น JSON safe integer หลังตรวจช่วง ไม่ parse เป็น Number แล้วปล่อย precision หาย
- cloud document ห้ามมี data URL, blob URL, signed URL, arbitrary external URL, provider key หรือ token
- `project_assets` สร้างจาก asset references ที่ server สกัดจาก document ไม่เชื่อ array ที่ client แนบมาเอง
- ทุก reference ต้องเป็น ready asset ใน workspace เดียวกัน ตรวจใหม่ใน save transaction
- parser สำหรับ API ต้อง reject unknown/invalid fields ตาม schema ไม่ clamp แล้วตอบว่าสำเร็จ; compatibility importer ซ่อมได้แต่ต้องแสดง warnings
- ตรวจ registry material/template, pack kind, enum styles, ตัวเลข finite/range, path command shape และทุกชนิด deco ไม่ใช่ตรวจเฉพาะ object ชั้นบน
- API limits เริ่มต้นที่เสนอ: JSON body 1 MiB, decos 500 ชิ้น, path points รวม 20,000, text ต่อชิ้น 10,000 ตัวอักษร, history 30, JSON depth 20; เป็น technical defaults ไม่ใช่แพ็กเกจขาย ต้องเทียบ fixture งานจริงก่อน freeze
- ถ้างานเดิมเกิน limit ให้แจ้งเหตุผลและรักษาต้นฉบับ ไม่ตัดชิ้นงานเงียบ ๆ

## 6. API contracts

### 6.1 Convention

- Base `/api/v1`; JSON UTF-8; bearer token ทุก endpoint ยกเว้น health ที่ไม่เผยข้อมูลลับ และ payment webhook ในเฟสหลัง
- Identity bootstrap ใช้ verified external identity; route อื่นใช้ resolved Actor
- ไม่รับ actor/userId/role/price/paid จาก request มาเป็น authoritative value
- mutation มี `operationId` UUID; request ID สำหรับ tracing เป็นคนละค่าและ server สร้าง/validate
- response success `{ data, requestId }`; error `{ error: { code, message, details? }, requestId }`
- status หลัก: 400 malformed, 401 session invalid, 403 action denied, 404 missing/not visible, 409 revision/idempotency conflict, 413 too large, 422 schema invalid, 429 rate/quota, 503 dependency unavailable
- โครงการ/asset ที่ผู้ใช้ไม่มีสิทธิ์ควรคืน 404 แบบเดียวกับไม่มีข้อมูล เพื่อไม่เปิดเผย existence
- authenticated responses `Cache-Control: no-store`; อย่าเปิด shared cache ของข้อมูลผู้ใช้
- pagination แบบ cursor `(updated_at,id)` มี limit สูงสุด 100; ค่า cursor/query ต้อง validate และใช้ parameterized SQL
- logs ไม่มี Authorization, signed URLs, image bytes, full document หรือ prompt เต็มโดย default

### 6.2 Endpoints Phase 1

| Method/path | Input | Output/behavior |
| --- | --- | --- |
| GET `/health` | none | readiness ขั้นพื้นฐาน ไม่เผย env/key/schema dump |
| POST `/session/bootstrap` | empty body + token | app user + personal workspace; idempotent ต่อ identity |
| GET `/me` | token | profile + permitted workspace summaries |
| GET `/projects?workspaceId=&cursor=&limit=` | workspace scope | metadata list ไม่ส่ง document/ภาพทุกงาน |
| POST `/projects` | workspaceId, name, documentSchemaVersion, document, operationId | CloudProject, revision 1 |
| GET `/projects/:id` | project id | CloudProject + referenced asset metadata ที่ได้รับอนุญาต |
| PUT `/projects/:id` | expectedRevision, name, documentSchemaVersion, document, operationId | mutation receipt; revision และ updatedAt ของการ save นี้ |
| DELETE `/projects/:id` | `X-Expected-Revision: <revision>` และ `Idempotency-Key: <operation UUID>` | soft-delete receipt; validate headers และไม่ใช้ DELETE body (Vercel ตรวจ `If-Match` ก่อนถึง API) |
| POST `/projects/import-legacy` | stable source identifiers + hash + document/name + operationId | project mapping/receipt; duplicate import ไม่สร้างงานซ้ำ |
| POST `/assets/upload-intents` | workspaceId, purpose, declaredMime, declaredSize, operationId | assetId + restricted upload ticket + provider-specific expiry |
| POST `/assets/:id/complete` | operationId | ready metadata หรือ processing/rejected; ต้องตรวจ bytes จริง |
| POST `/assets/:id/upload-ticket` | operationId | renew ticket ของ pending asset เดิมหลังตรวจสิทธิ์/สถานะ/โควตา; ไม่สร้าง asset ใหม่ |
| POST `/assets/download-tickets` | assetIds สูงสุด 50 | authorized URLs + expiresAt; เฉพาะ ready และ purpose ที่มีสิทธิ์ |

หาก completion ต้อง background processing ให้คืน 202 และมี `GET /assets/:id` สำหรับ status; Phase 1 อาจ sync ได้หากอยู่ใน resource limit ที่วัดแล้ว แต่ contract ต้องไม่สัญญาว่า upload สำเร็จเท่ากับ ready

### 6.3 ตัวอย่าง save

```json
{
  "operationId": "<uuid>",
  "expectedRevision": 7,
  "name": "กล่องสบู่รุ่น A",
  "documentSchemaVersion": 1,
  "document": "<CloudProjectDocumentV1 object; ไม่ใช่ string ใน request จริง>"
}
```

```json
{
  "data": { "projectId": "<uuid>", "revision": 8, "updatedAt": "<ISO timestamp>", "operationId": "<uuid>" },
  "requestId": "<server request id>"
}
```

```json
{
  "error": { "code": "REVISION_CONFLICT", "message": "งานนี้ถูกแก้ไขจากอีกหน้าต่าง", "details": { "currentRevision": 9 } },
  "requestId": "<server request id>"
}
```

### 6.4 Ports ที่ต้องมีจริง

```ts
interface ProjectRepository { // server port; ทุกเมธอดรับ actor
  list(actor: Actor, query: ProjectListQuery): Promise<ProjectPage>;
  get(actor: Actor, id: string): Promise<CloudProject>;
  create(actor: Actor, input: CreateProjectInput): Promise<CreateProjectResult>;
  save(actor: Actor, input: SaveProjectInput): Promise<SaveReceipt>;
  remove(actor: Actor, input: DeleteProjectInput): Promise<DeleteReceipt>;
  importLegacy(actor: Actor, input: LegacyImportInput): Promise<ImportReceipt>;
}

interface ObjectStorage { // server port; capability issuance ไม่ใช่ business authorization
  createUploadIntent(key: string, restrictions: UploadRestrictions): Promise<UploadTicket>;
  inspect(key: string): Promise<ObjectMetadata>;
  read(key: string): Promise<BoundedByteStream>;
  putImmutable(key: string, bytes: BoundedByteStream, metadata: ObjectMetadata): Promise<void>;
  signDownload(key: string, options: DownloadOptions): Promise<DownloadTicket>;
  remove(key: string): Promise<void>; // ใช้เฉพาะ authorized cleanup flow
}
```

Frontend repository ใช้ DTO/method ที่สอดคล้องกันแต่ไม่รับ Actor จาก UI; HTTP client แนบ token ของ session ปัจจุบัน ตัวอย่างเหล่านี้เป็น interface design ต้องนิยามชนิดย่อยและ error mapping ตอน implementation

## 7. Atomic save, idempotency และ autosave

### 7.1 Transaction ฝั่งฐานข้อมูล

SQL RPC เป็น transaction boundary ไม่ทำ select revision แล้ว update แยก HTTP calls

```text
save_project(actor, project, expected_revision, operation_id, canonical_input)
  1. resolve project/workspace + check active actor + membership; lock target project
  2. find prior operation for actor/workspace/operation_id
     - same operation type/target/request hash -> return original receipt
     - different payload/target -> IDEMPOTENCY_KEY_REUSED (409)
  3. check project not deleted + current revision == expected_revision
  4. validate referenced assets ready / same workspace and database invariants
  5. update name/document; revision := revision + 1; DB timestamp
  6. replace project_assets links and insert operation receipt
  7. commit; all-or-nothing
```

- **ตรวจ receipt ก่อน revision conflict** เพื่อให้ retry หลัง response หายไม่กลายเป็น conflict ทั้งที่บันทึกแล้ว
- authorization ต้องตรวจใหม่ก่อน replay receipt เสมอ ผู้ถูกถอนสิทธิ์ไม่ควรอ่านผลเก่าได้
- request hash คำนวณ server จาก canonical validated payload รวม operation type, target, expectedRevision, schema ไม่ใช้ hash ที่ client ยืนยันเอง
- concurrent create/import ไม่มี row ให้ lock ต้อง lock operation/source key หรือใช้ insert-on-conflict + transaction retry; ห้ามปล่อย create สอง rows ก่อน receipt ชน
- idempotency lookup กับ business write ต้อง commit เดียวกัน; service ห้ามรายงาน saved ก่อน transaction สำเร็จ
- mutation receipt อาจมี revision เก่ากว่า latest ถ้ามี save ต่อมาแล้ว; client ห้ามย้อน state ตาม receipt เก่า ให้ใช้กับ snapshot ที่ส่งเท่านั้น
- delete retry ต้องอ่าน tombstone/receipt หลังตรวจสิทธิ์ได้ ไม่ filter deleted row ทิ้งก่อนตรวจ dedupe; save ใหม่ใส่ deleted project ต้องถูกปฏิเสธ ไม่ resurrect งาน
- service-only RPC ต้อง reject actor ที่ไม่มีสิทธิ์ แม้ถูกเรียกจาก test ด้วย privileged key

### 7.2 Save queue ฝั่ง browser

Save state: `loading | clean | dirty | saving | offline | conflict | error`

- queue แยกตาม `(appUserId, workspaceId, projectId)`; หนึ่ง in-flight save ต่อโปรเจกต์
- debounce cloud save เริ่มที่ประมาณ 1 วินาทีและ max wait 5 วินาที; วัด UX ภายหลัง ไม่ใช้ 300 ms เขียนทุกงานแบบเดิม
- snapshot ที่ส่ง immutable และมี operationId เดิมตลอด retry; ระหว่างรอเก็บ latest pending draft แยก
- **ก่อนส่ง network ต้อง persist unresolved mutation ด้วย**: operationId, exact submitted payload/hash, expectedRevision และสถานะ แยกจาก latest unsent draft; หลัง reload ให้ replay operation เดิมก่อนส่ง edits ใหม่ ไม่สร้าง ID ใหม่เพราะจำ ack ไม่ได้
- เมื่อ ack มา อัปเดต base revision เฉพาะ session/project ที่ตรงกัน ถ้ามี edits ใหม่อย่าประกาศ clean
- ถ้า revision conflict ให้หยุด auto-retry เก็บ draft แล้วเสนอ reload cloud หรือบันทึกเป็นสำเนา; Phase 1 ยังไม่มี auto-merge/force overwrite
- `401` หยุด queue หลัง refresh ที่จำกัด; `429/503` bounded retry พร้อม backoff/jitter; validation error ไม่ retry
- persist draft ใน IndexedDB ก่อนพึ่ง network; storage เต็มต้องแสดง error ไม่ swallow เหมือน localStorage เดิม
- เปลี่ยนงาน/สร้างงาน/ออกจากระบบต้อง capture editor state ล่าสุดทันที ไม่รอ debounce ที่อาจถูก cancel
- ปิดแท็บไม่รับประกัน request สุดท้ายสำเร็จ; ใช้ draft persistence ต่อเนื่อง ไม่ถือ beforeunload/sendBeacon เป็นหลักประกัน
- BroadcastChannel ใช้แจ้งแท็บอื่นได้ แต่ CAS server เป็นตัวตัดสิน ไม่พึ่ง client lock อย่างเดียว
- ผล AI หรือ asset upload ที่กลับช้าต้องมี sessionEpoch/project guard ไม่ไปแก้อีกงานหรืออีกบัญชี

นโยบาย offline ของ cloud mode ใน Phase 1: แก้โปรเจกต์ที่โหลดครบแล้วและดาวน์โหลด portable backup ได้; create/import/delete/เพิ่มรูปใหม่ต้อง online โดยแสดงเหตุผลเมื่อปิดปุ่ม ไม่เปลี่ยน local-demo mode ที่สร้างงานในเครื่องได้ตามเดิม การสร้างงานใหม่แบบ offline เป็นขอบเขตเพิ่มที่ต้องมี temporary-ID mapping และ persistent operation queue ก่อนเปิด

ก่อน delete ให้ resolve in-flight save และ unsent draft ก่อน (บันทึก/สำรอง/ยืนยันละทิ้งโดยผู้ใช้) แล้วใช้ revision ล่าสุด; cancel queue หลัง tombstone สำเร็จ และไม่ให้ autosave เก่ากู้โปรเจกต์กลับมา

## 8. Assets, image validation และ portable file compatibility

### 8.1 Lifecycle

```text
pending upload → validating → ready (immutable final object)
                         └→ rejected
unreferenced + retention rules → deleting → deleted
```

1. API ตรวจสิทธิ์ workspace, purpose, declared size และ rate/storage quota ก่อนสร้าง intent
2. server สร้าง object key เอง เช่น `staging/<workspace>/<asset>/<nonce>` ไม่รับ path/filename เป็น object key
3. client upload ไป private staging ด้วย ticket ที่จำกัด object; ไม่ผ่าน JSON/base64 API ของเรา
4. complete ตรวจ object จริงทั้งขนาด signature/MIME และ decode limit; ห้ามเชื่อ extension/client checksum อย่างเดียว
5. validator สร้าง canonical final object ใหม่ที่เขียนโดย server เท่านั้น เช่น `assets/<workspace>/<asset>/<version>`
6. transaction เปลี่ยน metadata เป็น ready หลัง final object สำเร็จ พร้อม checksum; references ใช้ assetId

- แยก staging กับ ready bucket; browser ไม่มี general insert/update/delete/list/select grants บน storage.objects
- signed upload ticket เป็น capability เฉพาะ object อย่ารายงาน expiry สั้นกว่าที่ SDK/provider รองรับจริง
- จำกัด bucket ขนาดไฟล์และจำนวน pending; ticket ไม่ได้แปลว่าบังคับขนาดเท่าที่ client declare ได้เสมอ จึง reserve bytes ตามเพดานที่ ticket อัปโหลดได้จริง (หรือขอบเขตที่พิสูจน์ว่า provider บังคับได้) ไม่จองเพียง declaredSize ที่ผู้ใช้ปลอมเป็น 1 byte ได้
- ใช้ storage_usage/storage_reservations คุม concurrent tickets; วัด canonical final size อีกครั้งก่อน ready ถ้าเกิน reservation ให้ reserve เพิ่มแบบ atomic หรือ reject ก่อนเผยแพร่ ไม่คิดจากต้นฉบับอย่างเดียว
- กรณี ticket หมดอายุ ให้ตรวจว่ามี bytes แล้วหรือไม่: ถ้ามีให้ complete; ถ้าไม่มีให้ออก ticket ใหม่สำหรับ pending asset เดิมหลัง reauthorize และต่อ reservation ไม่ replay URL หมดอายุหรือสร้าง asset ซ้ำ
- `upsert: false`; ห้ามให้ ticket สำหรับแก้ ready object หาก replay upload เปลี่ยน staging หลัง complete ต้องไม่เปลี่ยน final bytes
- completion เป็น idempotent; ใช้ state/lease คุม concurrent complete และไม่ถือ DB transaction ระหว่าง download/decode/upload ที่นาน
- เพิ่ม fencing version ต่อ validation attempt; final key มี attempt/version และ DB finalize สำเร็จเฉพาะ lease/version ปัจจุบัน ป้องกัน validator เก่ามา mark ready หลัง recovery; orphan ของ attempt เก่าค่อย cleanup
- ถ้า network/DB ล้มหลัง final upload ให้มี reconciliation ตรวจ object + row ก่อน retry ไม่ overwrite final แบบสุ่ม
- ตรวจ MIME จาก bytes, จำกัด compressed bytes/decoded pixels/frame count, strip metadata ตาม policy; ป้องกัน decompression bomb
- technical defaults เสนอ: PNG/JPEG, <=10 MiB/file, <=20 megapixels, single-frame; ต้อง benchmark memory/runtime จริง
- private download ให้ URL อายุสั้น เช่น 5 นาที (ถ้ารองรับ); blob/data cache ล้างเมื่อเปลี่ยนบัญชี ไม่ log URL
- generic asset ticket endpoint ต้องตรวจ purpose; ในอนาคตห้ามใช้ endpoint นี้ข้ามสิทธิ์ซื้อไฟล์ export

Storage private bucket และ access control อ้างอิง [Buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals) และ [Storage access control](https://supabase.com/docs/guides/storage/security/access-control)

### 8.2 SVG เป็น compatibility gate ไม่ใช่เรื่องเล็ก

ระบบเดิมรับ SVG และมี preset ที่สร้าง SVG เป็น data URL การ strip `<script>` ด้วย regex เดิมไม่ใช่ security sanitizer ที่พอสำหรับ backend

- Phase 1 ห้าม server/worker fetch arbitrary URL จาก `src` ของไฟล์ import (SSRF)
- แนวทางเริ่มต้น: cloud เก็บ raster PNG/JPEG; SVG เดิมต้องผ่าน strict sanitization แบบไม่โหลด external resource แล้ว rasterize ก่อน upload
- ต้องครอบคลุม scripts, event attributes, foreignObject, external href/url(), entities และ active content ไม่ใช่ลบ script อย่างเดียว
- หาก SVG แปลงแล้วมีผลต่อความคม/เวกเตอร์ ให้แสดงผลกระทบและขอผู้ใช้ยืนยันต่อไฟล์ เก็บ portable original ไว้; ไม่ลดคุณภาพเงียบ ๆ
- การเลือก sanitizer/rasterizer และ resolution เป็นงานย่อยที่ต้องทดสอบก่อนเปิด migration ที่มี SVG ถ้ายังไม่ผ่าน ให้รายงานรายการที่ยังย้ายไม่ได้โดยรักษาต้นฉบับ
- หากต้องรักษา SVG vector เต็มรูปแบบ ให้เสนอ trusted sanitizer + isolated renderer เป็นขอบเขตเพิ่ม ห้ามอ้างว่ารองรับแล้วโดยไม่มี tests

### 8.3 Codec สำหรับ editor และ .genpkg.json

- คง editor `Project` ใน memory เป็นข้อมูลแบบเดิมในระยะแรก
- `dehydrateProject`: validate editor → อัปโหลด/หา asset เดิม → แทน image src ด้วย assetId → CloudDocument
- `hydrateProject`: CloudDocument → resolve authorized bytes → data URLs → editor Project
- เริ่มด้วย data URL ใน memory เพื่อรักษา parser/export เดิม; ไม่ cache รูปของทุกโปรเจกต์พร้อมกัน และ dedupe ตาม assetId
- เก็บ sidecar mapping ของ runtime source/content hash → ready assetId แยกจาก Project และ scope ด้วย user/workspace; persist mapping ที่จำเป็นคู่กับ draft เพื่อให้แก้ข้อความแล้วไม่อัปโหลดรูปเดิมทุกครั้ง อย่าเพิ่ม hidden field แล้วหวังว่า parseProject จะเก็บไว้
- sidecar เป็นเพียง cache hint; server ยังตรวจ tenant/readiness ใหม่ และ content เปลี่ยนต้องได้ asset ใหม่ ไม่แก้ bytes ของ asset เดิม
- จะใช้ blob URL เพื่อลด memory ได้ภายหลัง แต่ต้องปรับ runtime parser และ portable serializer โดยเจตนา ไม่ใส่ URL ลง model เดิมแล้วหวังว่า parse ผ่าน
- cloud schema เริ่ม 1 ไม่ใช่ file schema 6; revision เริ่ม 1 ไม่ใช่ schema version
- file export v6 ต้อง embed image bytes ให้พกพาได้ ไม่ส่ง signed URL/assetId ของ private bucket ออกไปแทน
- file import สร้างโปรเจกต์ใหม่ตามพฤติกรรมเดิม; legacy migration ใช้ stable mapping ไม่ใช่ import ที่ random UUID ทุก retry
- หาก portable file structure เปลี่ยนจริง ค่อย bump PROJECT_FILE_VERSION พร้อม migration/tests ไม่ bump เพียงเพราะเพิ่ม cloud metadata
- ถ้าภาพ hydrate ไม่สำเร็จ ให้ retry/error placeholder และห้าม auto-save document ที่รูปถูกตัดทิ้ง

## 9. ย้ายงาน localStorage เดิมอย่างปลอดภัย

1. หยุดเส้นทาง `loadStore()` เดิมที่อาจลบ legacy key; อ่าน raw source แบบ read-only และเก็บ backup ก่อน parse
2. หลัง login ถามว่าให้ย้ายงานใน browser นี้เข้าบัญชีปัจจุบันหรือไม่ เพราะข้อมูลเดิมไม่ผูกบัญชี อาจเป็นงานคนก่อนบนเครื่องร่วม
3. สร้าง stable installation ID และ source key ต่อรายการจากต้นทาง เก็บ journal ก่อนเริ่ม network
4. แสดงผล parse/repair warnings และรายการไม่รองรับ; ไม่ silently filter งานเสียแล้วรายงานว่าย้ายครบ
5. migrate assets แบบ resumable และ bounded concurrency; upload ซ้ำใช้ operation ID เดิมต่อไฟล์
6. ส่ง document ที่ assets ready แล้วไป import endpoint; บันทึก unique source mapping และ receipt ใน transaction
7. หาก response หาย ให้ retry/lookup mapping เดิม ไม่สร้าง UUID ใหม่; StrictMode/remount ต้องไม่ทำงานซ้ำ
8. reload จาก cloud แล้วตรวจจำนวนงาน fields และ asset checksums/การเปิดภาพ ก่อน mark complete
9. เก็บ raw backup ต่อไป; การล้าง legacy data เป็น action ของผู้ใช้หลังยืนยัน ไม่ทำเองเมื่อ logout หรือ import สำเร็จ

ถ้า source content เปลี่ยนหลังเริ่ม migration แต่ใช้ source key เดิม ให้คืน conflict ให้ผู้ใช้เลือก update/copy อย่า overwrite target เงียบ ๆ

Draft key/journal ต้องมี app_user_id และ cloud project ID ที่ map แล้ว; ห้าม sync ข้ามบัญชี แม้ email เหมือนกัน

## 10. Phase 2 — AI service, quota และต้นทุน

### 10.1 Boundary และ API

- `POST /api/v1/ai/box-spec`: operationId, current spec, prompt, optional projectId และ referenceAssetId
- prompt 1–2,000 ตัวอักษรตามข้อจำกัดเดิม; image ใช้ authorized ready asset purpose=ai-reference ไม่ส่ง arbitrary URL
- คืน spec ที่ validate แล้ว พร้อม mock flag; usage/cost ภายในไม่ต้องเปิดเผยทุก field ต่อ client
- คง wrapper `requestBoxSpec()` เพื่อไม่แก้ PromptBar เกินจำเป็น แต่เพิ่ม AbortSignal และ captured project/session
- `/api/box-spec` เดิมต้อง delegate ผ่าน auth/quota service เดียวกัน หรือปิดด้วย 410 หลัง client เปลี่ยน ไม่มีเส้นทางฟรีหลงเหลือ
- แยก provider result เป็น `{ spec, model, usage, providerRequestId }`; `askClaude()` เดิมคืนเพียง spec จึงต้องเพิ่ม adapter สำหรับ usage
- CLI backend ใช้ local development เท่านั้น; production provider/config ผิดให้ error ไม่ fallback mock แบบหลอกว่าจริง
- provider authentication error เป็น upstream service error ไม่ใช่ 401 ของผู้ใช้; 401 ใช้เฉพาะ app session

### 10.2 ตารางที่เพิ่ม

| ตาราง | ข้อมูลและ invariant |
| --- | --- |
| `ai_requests` | id, workspace_id, actor_user_id, operation_id, request_hash, state, model, provider_request_id, result, usage_bucket_id, reserved_units, settlement_state, settled_at, lease_until, fencing_version, error_code, created_at, updated_at; unique(workspace_id,actor_user_id,operation_id) |
| `usage_buckets` | id, workspace_id, metric, period_start/end, limit_value, reserved, consumed; unique(workspace_id,metric,period_start); counts ไม่ติดลบ |
| `ai_usage_events` | request_id, provider usage/token/cache metrics, cost estimate, currency, pricing_version, outcome, created_at; unique finalization key |
| `rate_limit_buckets` | subject/action/window/count หรือกลไก atomic เทียบเท่า; ไม่ใช้ Map ใน memory อย่างเดียวบนหลาย Functions |

Phase 2 เริ่มโควตาต่อ personal workspace (มีหนึ่ง user) ก่อน; ก่อน Team ต้องตัดสินใจว่า pool ทั้งทีม/รายคน ไม่เปลี่ยนหน่วยเงียบ ๆ

### 10.3 Reservation protocol

```text
validated/authenticated request
  → transaction: dedupe + atomic reserve quota + create ai_request
  → commit
  → claim running lease + call provider (นอก DB transaction)
  → transaction: validate result + persist result/usage + settle reservation
```

- สถานะอย่างน้อย reserved/running/succeeded/failed/unknown; retry key เดิมที่สำเร็จแล้วคืน result เดิม
- ถ้า request ยัง running คืนสถานะให้ poll หรือ 409 AI_REQUEST_IN_PROGRESS ไม่เรียก provider ซ้ำ
- lease/fencing ป้องกันผลจาก worker/request เก่ามา finalize ทับหลัง recovery
- timeout หลังส่ง provider มีโอกาสถูกคิดเงินแล้ว: บันทึก unknown ไม่สัญญาว่าไม่เสียเงิน และไม่ retry external call อัตโนมัติ
- user quota กับ provider cost เป็นคนละบัญชี: จะคืน quota ผู้ใช้ได้ตาม policy แต่ต้องเก็บต้นทุนที่เกิด/ไม่ทราบผลตามจริง
- settle/release ไป usage_bucket_id เดิมที่ reserve เสมอ แม้ข้ามเดือนระหว่างรอผล; settlement transition ต้องเกิดครั้งเดียว ไม่คำนวณ bucket ใหม่จากเวลาที่ finalize
- กำหนดเดือน/รอบ quota จาก server เช่น calendar UTC หรือ billing period ที่ยืนยันแล้ว ไม่ใช้เวลาจาก browser
- แยก per-user/workspace rate limit, concurrent requests และ budget alerts; maximum output/model allowlist กำหนด server
- ค่า model และราคาต้องตรวจจาก provider ตอน implement ไม่รับ model name จาก client และไม่ hardcode ว่าค่า default ใน repo ยังใช้งานได้
- ปิด feature เมื่อ budget/config ผิดตาม policy ที่สื่อสาร ไม่เปลี่ยนแพ็กเกจขายโดยไม่แจ้ง

ยังไม่ต้องเพิ่ม Redis หาก PostgreSQL atomic counters รองรับ load จริงได้; เพิ่มเมื่อวัด bottleneck ไม่ใช่เพราะเป็น checklist ของ backend

## 11. Phase 3 — Billing และ entitlement

**ยังไม่เลือก payment provider ในเอกสารนี้ และไม่เปิดขายก่อน Phase 4 ส่งมอบไฟล์ตามสิทธิ์ได้จริง** Phase 3 ทำ sandbox/contract tests ได้ก่อน

### 11.1 โมดูลและตาราง

| ตาราง | หน้าที่ |
| --- | --- |
| `plans` / `plan_prices` | server-owned plan code, currency, amount_minor, version, provider_price_id, effective dates |
| `billing_customers` | mapping workspace → provider/customer; unique(provider,provider_customer_id) |
| `orders` | workspace, purchaser, order type, target design/license, immutable amount/currency, status, provider IDs |
| `subscriptions` | workspace, provider subscription ID, state, period_start/end, cancellation state |
| `entitlements` | capability, scope/target, source order/subscription, valid_from/until, revocation state |
| `design_licenses` | stable license id, owner workspace, structure schema/hash, correction window และ approved structure revisions |
| `payment_events` | provider/event_id unique, received/processed/error, payload ที่ลด PII ตามจำเป็น |
| `outbox_jobs` | งานหลัง transaction เช่น notification/reconciliation ที่ต้องไม่หายเมื่อ process crash |

- เงินเก็บ integer หน่วยย่อย เช่น satang ไม่ใช้ floating point; currency explicit
- order เชื่อม workspace/target ที่ server ตรวจแล้ว ห้ามเปลี่ยนผู้รับสิทธิ์จาก webhook metadata ที่ไม่เทียบ pending order
- subscription ไม่ใช่ entitlement ทั้งหมด; การซื้อรายแบบไม่หายเพราะ subscription หมดอายุ
- ไม่ใช้ project UUID อย่างเดียวเป็นนิยาม “แบบที่ซื้อ” และไม่ใช้ hash อย่างเดียวแทนหลักฐานซื้อ
- structure fingerprint ต้องมี version และรวม fields ที่มีผลต่อการผลิตของแต่ละ pack kind ไม่ใช่เฉพาะ W/D/H เช่น material/template/handle/label/pouch options ตามนโยบายที่ยืนยัน
- clone/import โปรเจกต์ไม่สร้าง paid entitlement เอง; server ตรวจ license และ structure ทุกครั้ง

### 11.2 API และ webhook

- `POST /billing/checkout`: planCode หรือ design target + operationId; server คำนวณราคา/สิทธิ์และสร้าง provider checkout
- `GET /billing/status`, `GET /entitlements`: เฉพาะ workspace ที่มีสิทธิ์; role ที่ดูข้อมูลชำระเงินต้องกำหนด
- `POST /webhooks/payments/:provider`: อ่าน **raw request bytes** ตรวจ signature ก่อน parse; ไม่ผ่าน body parser ทั่วไป
- durable event receipt + entitlement mutation ต้องเป็น transaction เดียว หรือ inbox/outbox ที่ replay ได้
- duplicate/same event ต้องไม่ให้สิทธิ์ซ้ำ; event ordering ไม่รับประกัน ให้ reconcile provider state ตาม contract
- ตอบ 2xx หลังบันทึก event แบบ durable แล้ว ไม่ตอบก่อนเก็บข้อมูล; ถ้า async ต้องมี retry/failed queue ที่ดูได้
- success URL ของ checkout แสดง pending ได้ แต่ไม่ตั้ง paid จาก query string

หลัก duplicate/unordered delivery และ signature verification อ้างอิง [Stripe webhooks](https://docs.stripe.com/webhooks) เป็นตัวอย่างแนวทาง ไม่ใช่การเลือก Stripe อัตโนมัติ

### 11.3 Business decisions ที่ต้องถามก่อน production billing

ค่าจากข้อเสนอเดิม: รายแบบ 149 บาท, เดือน 390 บาท, ปี 3,900 บาท, กลุ่ม 25,000 บาท/ปี 50 บัญชี; ฟรี/รายแบบ AI 5 ครั้ง/เดือน และสมาชิกระบุ “ไม่จำกัด”

ต้องยืนยัน:

- ราคา final, ภาษี/เอกสารที่ต้องออก, currency และวิธีจ่ายที่ provider รองรับจริง
- 7 วันแก้โครงสร้างเริ่มเมื่อจ่าย/เมื่อ export ครั้งแรก และแก้แล้วได้สิทธิ์หลายเวอร์ชันหรือแทนที่เวอร์ชันเดิม
- อะไรคือโครงสร้างกับ artwork; material change นับอย่างไร; pouch/vessel options นับอะไรบ้าง
- refund/dispute/cancel/retry/grace period และการถอนสิทธิ์มีผลต่อไฟล์ที่ได้แล้วอย่างไร
- fair use ของ “ไม่จำกัด” และรอบโควตาที่สื่อสารกับลูกค้า
- ใครเป็นเจ้าของ license เมื่อสมาชิกออกจากทีม/องค์กรเลิกใช้

ถ้ายังไม่ทราบ ห้าม model เดาแล้วเปิดเงินจริง ให้ทำ sandbox และ interfaces ต่อได้

## 12. Phase 4 — Export pipeline และ immutable delivery

### 12.1 ขอบเขตและ schema

เพิ่ม `export_jobs`, `export_artifacts`, `export_asset_refs`, `download_grants` ตามความจำเป็น:

- job ผูก workspace, requested_by, project_id, project_revision, operation_id, snapshot, validated options, engine_version, entitlement decision
- artifact เก็บ immutable object key, format, checksum, size, created_at; artifact ไม่ถูก overwrite ตามการแก้โปรเจกต์
- export snapshot เก็บ document + asset versions + material/template data version + fonts/renderer version ที่จำเป็นต่อการตรวจย้อนหลัง
- download grant แยกจากสิทธิ์ generate ใหม่; subscription หมดอายุแล้วยังเปิด artifact เดิมตามนโยบายที่ตกลง
- ไม่ cascade ลบ artifact/grant เพียงเพราะลบ project; account deletion/refund policy ต้องกำหนดต่างหาก
- worker state queued/running/succeeded/failed พร้อม lease/fencing, bounded attempts และ error classification

### 12.2 API และ flow

```text
POST /exports { projectId, revision, format, options, operationId }
  → check tenant + strict options + generate entitlement
  → capture immutable snapshot + enqueue transactionally
  → return 202 jobId
worker claims lease
  → load authorized snapshot assets
  → generate / verify / write immutable artifact
  → commit result + permanent download grant ตามสิทธิ์
GET /exports/:jobId
POST /exports/:artifactId/download-ticket
  → verify grant → short-lived signed URL
```

- ห้าม worker โหลด latest project ตอนทำจริงแทน snapshot ที่ซื้อ/ขอ export
- ถ้าสมาชิกหมดอายุระหว่างรอ job ให้ใช้นโยบายเวลาที่ตรวจสิทธิ์อย่างชัดเจน; ห้ามตัดสินตาม timestamp ของ browser
- options เช่น showDims, guides, sheet preset/custom dimensions, gutter อยู่ใน UI บางส่วน ไม่อยู่ Project เดิม ต้องส่งและ validate แยก
- pure geometry/DXF/PDF logic ย้ายแชร์ได้เฉพาะส่วนที่ไม่ต้อง DOM; ฟอนต์/Canvas/ภาพ/ใบสเปกต้องแยก renderer
- headless renderer ถ้าจำเป็นต้องรันแบบ isolate: ปิด arbitrary network/file access, จำกัด CPU/memory/time และห้าม execute user scripts
- fonts ภาษาไทยต้อง preload และ pin version ก่อน render; test metric/ภาพจริง ไม่ใช้ screenshot placeholder แทนผล export
- ตรวจหน่วย mm, PDF page size/layers, DXF coordinates, SVG dimensions และรูป/ฟอนต์ครบ; CMYK/ICC/มาตรฐานโรงพิมพ์เป็นงานตรวจต่างหาก

### 12.3 ขอบเขต paywall

browser ยังมี geometry และ preview จึงไม่ใช่ DRM ป้องกันการคัดลอกทั้งหมด การบังคับสิทธิ์ไฟล์ส่งออกอย่างเป็นทางการต้องอยู่ server แต่ไม่อ้างว่าผู้ใช้ดึงเส้นจากหน้าเว็บไม่ได้

ก่อนเปิดขาย export ต้องตัดสินใจเรื่อง direct browser SVG/PDF/DXF และ portable .genpkg.json ที่ยังให้ข้อมูลครบ หากยังเปิดอยู่ให้สื่อสารโมเดลมูลค่าบริการตามจริง ไม่อ้างว่าปุ่มที่ซ่อนป้องกันการสร้างไฟล์เองได้

ไม่สร้าง `.genpkg.json` paywall โดยพลการใน Phase 1 เพราะเป็นทางสำรองข้อมูลของผู้ใช้

## 13. Phase 5 — Team และ Operations

- เพิ่ม invite, accept, revoke, role change โดย invitation token เก็บเป็น hash และมี expiry/single-use
- owner/editor/viewer permissions เป็น matrix ในโค้ดและ tests; ห้ามลบ last owner โดยไม่ได้โอนเจ้าของ
- workspace billing และ AI quota policy ต้องยืนยันก่อนเปิด team seats; 50 seats เป็นค่าจากข้อเสนอ ไม่ใช่ hardcoded ใน schema
- ถอน membership แล้ว API ห้ามเข้าถึงทันที; signed URL ที่ออกไปก่อนยังอยู่ตาม TTL จึงใช้ TTL สั้นและบันทึกข้อจำกัดนี้
- dashboard operator แยกสิทธิ์จากลูกค้า; ห้ามใช้ user_metadata ที่ผู้ใช้แก้เองเป็น admin flag
- audit events ที่ควรเก็บ: role changes, billing changes, export grants, deletion actions และ admin actions โดยลด PII
- backups/restore, alerting และ security tests ขั้นพื้นฐานต้องเริ่มก่อน public pilot ไม่เลื่อนไปจน Phase 5; เฟสนี้ทำให้ครบด้านปฏิบัติการและทีม

## 14. Runtime, environment, routing และ deployment

### 14.1 Env ที่เสนอ

| ชื่อ | อยู่ที่ไหน | หมายเหตุ |
| --- | --- | --- |
| `VITE_APP_MODE` | browser | local/cloud; ไม่ใช่ security control |
| `VITE_API_BASE_URL` | browser | default /api/v1; เปลี่ยน backend host ในอนาคตได้ |
| `VITE_SUPABASE_URL` | browser | public project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | browser | public key เท่านั้น; adapter ระบุรองรับ legacy anon key หากจำเป็น |
| `SUPABASE_URL` | server | project URL ที่ตรวจ allowlist/config แล้ว |
| `SUPABASE_SECRET_KEY` | server only | privileged server credential ที่ SDK รองรับ; legacy service-role key ใช้ชื่อแยกและเลือกเพียงแบบเดียว |
| `APP_ENV` | server | development/test/staging/production |
| `APP_ALLOWED_ORIGINS` | server | explicit origins; ไม่ใช้ wildcard ใน production |
| `AI_ENABLED`, `BOX_SPEC_BACKEND`, `BOX_SPEC_MODEL` | server | explicit provider mode/model; production ไม่ silent mock |
| `ANTHROPIC_API_KEY` | server only | ไม่ใช้ prefix VITE_ |
| `DATABASE_URL` | tooling only ใน Phase 1 | CLI/migration/local test; ไม่จำเป็นต้องส่งให้ API ที่ใช้ RPC |

- ให้ runtime Node อยู่ในรุ่นที่ hosting รองรับขณะ implement; build script เดิม target node18 เป็นข้อมูลปัจจุบันของ repo ไม่ใช่คำแนะนำให้อยู่รุ่นนั้นตลอด
- แยก local/staging/prod resources และ OAuth callback; preview deployment ห้ามชี้ production DB/paid AI โดย default
- `.env.example` ใส่ placeholders และขั้นตอนตั้งค่า; `.gitignore` เดิมมี `.env*` ต้องตรวจว่า example ถูก track/allowlist โดยไม่เปิดให้ secret files เข้า Git
- ถ้า config cloud ไม่ครบ validate ตอน startup/request และแสดง error ที่เหมาะสม; log ชื่อ key ที่ขาดได้แต่ไม่ log ค่า
- SQL migration apply ใช้สิทธิ์ tooling แยก runtime API และต้องตรวจ target project ก่อนเสมอ

### 14.2 Routing parity

- Vite dev/preview และ Vercel entrypoint เรียก router/application services เดียวกัน
- แนะนำ bundle `server/entrypoints/vercel.ts` เป็น generated `api/backend.js` แล้วตั้ง route/rewrite สำหรับ `/api/v1/*`; implementation ต้องทดสอบ path/query/method/body mapping จริงบน Vercel preview
- ไม่สมมติว่าเพิ่มไฟล์ TypeScript ใน server แล้ว Vercel จะเจอ route เอง; คง build approach ที่พิสูจน์แล้วและเพิ่ม mapping ที่ explicit
- API rewrite มาก่อน SPA fallback; route ที่ไม่รู้จักคืน JSON 404 ไม่คืน index.html
- `/api/box-spec` ชั่วคราวต้องผ่าน security service เดียวกัน ไม่เหลือ generated bundle เก่าที่ bypass
- `scripts/build-api.mjs` ต้องสร้างทุก entry ที่ใช้จริง; commit generated artifacts ตาม convention เดิมเมื่อผู้ใช้สั่ง commit
- HTTP body limit ต้องครอบคลุม platform-parsed object/string และ stream ไม่ใช่เฉพาะ stream branch
- webhook เฟสหลังแยก raw-body path จาก JSON parser และต้องมี deployment-level signature test
- CORS/origin เป็น defense-in-depth ไม่ใช่ auth; non-browser caller ปลอม Origin/Host ได้
- bearer design ไม่ใช้ cookie authentication ที่ API ใน Phase 1; หากเปลี่ยนเป็น cookie ต้องเพิ่ม CSRF design ไม่ถือว่า CORS พอ

Functions มีข้อจำกัดเวลา/payload/memory จึงแยกไฟล์ upload ออกจาก JSON API และวัดงาน renderer ก่อนตัดสินใจรันบน Functions ([Vercel Functions limits](https://vercel.com/docs/functions/limitations))

### 14.3 Setup guide ที่ Sol ต้องส่งมอบ

1. Node/npm และ version ที่ทดสอบจริง; `npm ci` จาก lockfile
2. Supabase CLI + local container runtime ที่ใช้ได้บนเครื่อง; Docker/WSL prerequisite สำหรับ Windows
3. ขั้นตอน start local stack, apply migrations, seed fixture และรัน tests โดยไม่แตะ remote
4. ขั้นตอนสร้าง staging ด้วยมือ/ตามสิทธิ์ที่ได้รับ ตั้ง Google provider/redirect และ private buckets
5. ตั้ง env ใน `.env.local`/deployment secret settings โดยไม่ใส่ secret ใน docs
6. health/login/create-save-open-upload smoke test บน staging
7. ขั้นตอน backup/rollback และสิ่งที่ยังไม่รองรับ

อย่าใช้ `supabase db reset` กับ remote หรือ database ที่มีข้อมูลจริง; ทุกคำสั่ง destructive ต้องระบุ local target และผลกระทบ

## 15. Verification matrix และ Definition of Done

### 15.1 ระดับทดสอบ

| ระดับ | สิ่งที่ต้องตรวจ |
| --- | --- |
| Unit (Vitest) | strict schemas, codec, hashing, domain rules, save state machine, error mapping |
| DB integration / pgTAP | migrations, grants, RLS enabled, RPC execution permissions, FK/uniques, concurrent CAS, idempotency |
| API integration | verified Actor, scoped reads/writes, validation, body limit, legacy route guard, service errors |
| Frontend integration | session change, queue/draft, late response, asset hydrate, import warnings |
| Browser E2E | login test fixtures, create/edit/reload, two tabs, account switch, offline/reconnect, file roundtrip |
| Staging manual | Google OAuth จริง, storage upload/download/CORS, Vercel route parity, production-like env |

pgTAP และ Supabase local tests ใช้ตรวจ ACL/RLS/constraints ได้ แต่ mock repository tests ไม่ทดแทนการทดสอบ DB จริง ([Supabase testing](https://supabase.com/docs/guides/local-development/testing/overview))

### 15.2 Test cases บังคับก่อนส่ง Phase 1

Auth/tenant:

- [ ] forged/expired/wrong-project token ไม่ผ่าน; ไม่มี token เป็น 401
- [ ] anonymous และ authenticated browser เรียก Data API table/RPC ที่สงวนให้ server ไม่ได้
- [ ] A list/get/save/delete/download/complete asset ของ B ไม่ได้ ทั้ง HTTP และ privileged RPC ที่ส่ง actor=A
- [ ] ปลอม owner/workspace/role/status fields ไม่เพิ่มสิทธิ์
- [ ] bootstrap พร้อมกันคืน identity/workspace เดียว ไม่มี orphan
- [ ] logout/login อีกบัญชีไม่เห็นงาน/รูป/draft เดิม และ response ที่ค้างไม่กลับมาแก้บัญชีใหม่

Data/concurrency:

- [ ] สอง requests ใช้ expectedRevision เดียวกันและคนละ operationId สำเร็จเพียงหนึ่ง อีกอัน conflict
- [ ] retry หลัง commit แต่ response หายคืน receipt เดิม ไม่เพิ่ม revision/สร้าง project ซ้ำ
- [ ] commit สำเร็จแต่ response หายแล้วปิดหน้า/เปิดใหม่ ยัง replay mutation ID เดิม ไม่สร้างงานหรือ revision เพิ่ม
- [ ] operationId เดิมต่าง payload ถูก 409 และไม่เกิด side effect
- [ ] create/import พร้อมกันถูก dedupe; receipt lookup ไม่เปิดข้อมูลหลังถูกถอนสิทธิ์
- [ ] failed save ไม่ล้าง dirty state; edit ระหว่าง saving ไม่หายเมื่อ ack เก่ามา
- [ ] กดเปลี่ยนโปรเจกต์ทันทีหลังแก้ ไม่เสีย state จาก debounce ที่ยังไม่ทำงาน
- [ ] offline/reconnect เก็บ draft และพบ conflict อย่างชัดเจน ไม่ last-write-win เงียบ ๆ
- [ ] offline new/import/delete/upload แสดงข้อจำกัดอย่างชัดเจน; delete ไม่ถูก late autosave resurrect
- [ ] ข้อมูลผิด/ใหญ่เกิน/unknown schema ถูกปฏิเสธโดยไม่ repair เงียบ

Assets/compatibility:

- [ ] MIME ปลอม, oversized bytes/pixels, malformed image, external SVG references ถูกปฏิเสธ
- [ ] ready object overwrite ไม่ได้; upload-ticket replay ไม่เปลี่ยน canonical asset
- [ ] resume หลัง ticket expiry ใช้ logical asset เดิม; declare 1 byte แล้วอัปโหลดถึง bucket cap ไม่เลี่ยง reservation
- [ ] validator attempt เก่า finalize ไม่ได้หลัง lease ถูก claim ใหม่
- [ ] asset cross-workspace/not-ready อ้างใน save ไม่ได้
- [ ] upload validation/DB failure retry ได้ ไม่มี ready row ชี้ไฟล์ที่ไม่ครบ
- [ ] portable v6 roundtrip ครบ image/text/shape/nutrition/path/background และ vessel/pouch options
- [ ] เพิ่มและเปลี่ยนสี SVG preset ที่มีใน editor → autosave → reload ยังถูกต้อง ไม่ใช่ทดสอบแค่ import SVG เก่า
- [ ] แก้ข้อความในงานที่มีรูปแล้ว save ไม่สร้าง upload intents เพิ่มสำหรับรูปเดิม
- [ ] migration raw backup อยู่ครบ; แสดง skipped/repair items; retry ไม่สร้างงานซ้ำ
- [ ] SVG conversion แสดงผลกระทบและไม่อ้างว่าย้ายครบเมื่อยังมีไฟล์ไม่รองรับ
- [ ] hydrate failure ไม่ทำให้ save ทับด้วยงานที่รูปหาย

Build/runtime:

- [ ] unit tests เดิมของ geometry/export ผ่าน ไม่แก้ numerical output โดยไม่เกี่ยวกับงาน
- [ ] `npm run build`, typecheck และ new tests ผ่านตาม scripts จริง
- [ ] built frontend ไม่มี server credential, Node server code หรือ provider private module
- [ ] dev/preview/deployed route ตอบเหมือนกัน รวม 401/404/413; unknown API route ไม่คืน HTML
- [ ] import SQL migrations ลง empty local database ใหม่ได้; ตรวจ ACL ของ object ทุกชนิดหลัง migrate
- [ ] ทดสอบ restore DB + sample objects และเปิดงานได้ก่อน public pilot

### 15.3 เฟสหลังต้องเพิ่ม

- AI: quota race, duplicate invocation, timeout=unknown, lease fencing, usage settlement และ feature disabled
- Billing: invalid raw signature, duplicate/out-of-order webhook, crash/replay, client price spoof, cancel/refund policy
- Export: immutable snapshot, engine/font version, grant หลัง subscription expiry, download authorization, worker retries
- Team: invite replay/expiry, role matrix, last-owner protection, revoked member และข้อมูล billing

ไม่ต้องรัน app tests เพียงเพื่อแก้เอกสารนี้ แต่เมื่อเริ่ม implement ต้องรายงานผลจริง; test ที่ไม่ได้รันเพราะไม่มี Docker/credentials ต้องแยกเป็น NOT RUN ไม่ใช่ PASS

## 16. Milestones สำหรับลงมือทำทีละชุด

### Phase 0 — Baseline และ foundations

| ID | งาน | เกณฑ์ส่งมอบ |
| --- | --- | --- |
| P0.1 | ตรวจ branch/status, instructions, baseline build/tests | บันทึกผลจริงและปัญหาเดิม ไม่ทับงานผู้ใช้ |
| P0.2 | shared contracts, env validation, router/error skeleton, local/cloud mode | typecheck + unit tests; ยังไม่มี secret/remote mutation |
| P0.3 | local Supabase setup + migrations/test harness | rebuild local DB จาก migrations ได้; backend-setup.md |

### Phase 1 — Personal accounts + cloud projects

| ID | งาน | ขึ้นกับ | เกณฑ์ส่งมอบ |
| --- | --- | --- | --- |
| P1.1 | app users/identity/personal workspace และ ACL | P0 | concurrent bootstrap + deny direct API tests |
| P1.2 | real auth + session hydration + old AI endpoint guard | P1.1 | account switch isolation; cloud ไม่ fallback mock auth |
| P1.3 | project RPC/repository/API และ atomic save | P1.1 | tenant/CAS/idempotency tests ครบ |
| P1.4 | image asset lifecycle + upload/download adapters | P1.1 | immutable validated assets + limits; SVG decision documented |
| P1.5 | cloud/editor codec และ file compatibility | P1.3–4 | fixtures roundtrip ไม่มี field/ภาพหาย |
| P1.6 | project controller/save queue/IndexedDB drafts | P1.2–5 | two tabs/offline/late-response/switch-project tests |
| P1.7 | resumable legacy migration UI | P1.5–6 | raw backup + consent + dedupe + verify cloud |
| P1.8 | local/staging end-to-end, setup/restore checklist | ทั้งหมด | acceptance checklist พร้อม evidence และ known gaps |

แยก controller ออกจาก App ทีละ behavior ไม่ rewrite App ทั้งไฟล์ใน commit เดียว และไม่แก้หน้าตา/geometry ที่ไม่เกี่ยวข้อง

### Phase 2 — AI

P2.1 provider adapter/validated contract → P2.2 atomic quota/idempotency → P2.3 usage/cost/unknown recovery → P2.4 UI errors/limits + abuse tests → เปิด paid AI หลัง gates ผ่าน

### Phase 3 — Billing (sandbox ก่อน)

P3.1 ยืนยัน business rules/provider → P3.2 schema/checkout adapter → P3.3 raw webhook/inbox/reconciliation → P3.4 entitlement tests + sandbox E2E; ยังไม่เปิดเงินจริงจน Phase 4 พร้อม

### Phase 4 — Official export

P4.1 extract pure generation + export options → P4.2 renderer/snapshot/job queue → P4.3 immutable artifacts/download grants → P4.4 numerical/visual/โรงพิมพ์ validation → P4.5 ทบทวน paywall แล้วจึงเปิด commercial flow

### Phase 5 — Team/operations

P5.1 role/invite/seat policy → P5.2 team billing/quota → P5.3 operator dashboard/audit → P5.4 load/restore drills และ runbooks

## 17. Observability, backup และ cleanup

- structured logs: requestId, route, status, duration, operationId, non-sensitive actor/workspace identifiers และ stable error code
- metrics: API error/latency, save conflicts, upload failures, cloud migration completion, AI token/cost, webhook lag, export queue age
- alerts ต้องระบุ threshold/owner ตอน deploy; อย่าเพิ่ม automation ภายนอกเองจากเอกสารนี้
- DB backup ไม่รวมเนื้อไฟล์ Storage ต้องสำรอง objects แยกและตรวจ restore links/checksums ([Supabase backups](https://supabase.com/docs/guides/platform/backups))
- เก็บ migration scripts + database data + asset manifest/checksums; อย่าสมมติว่า CLI dump default รวม app_private/auth/storage ทุกอย่าง ตรวจรายการ schema จริง
- Auth backup/migration เป็นงานของ provider โดยเฉพาะ; app_user mapping อย่างเดียวไม่ได้ย้าย session/password/OAuth configuration
- Cleanup เริ่มจาก dry-run report; actual deletion ต้องมี retention ที่ยืนยันและสิทธิ์ดำเนินการ
- ห้ามลบ pending asset ก่อน ticket expiry + grace period, ห้ามลบ ready asset ที่ project/export/grant ยังอ้างอยู่
- Asset quota reservation ต้องรวม pending uploads และ reserve atomically กันยิงพร้อมกันเกิน limit; finalize/reject/reap ต้อง release/settle เพียงครั้งเดียว
- Cleanup ใช้ mark deleting + recheck references/lock เพื่อไม่แข่งกับ save; service ห้ามเพิ่ม reference ไป asset ที่ deleting
- soft-delete project ไม่เท่ากับ user request ให้ลบไฟล์ที่ซื้อถาวร; retention/account-deletion rules ต้องชัดก่อน commercial launch

## 18. เส้นทางย้าย NestJS + PostgreSQL + Object Storage

### Stage A — เพิ่ม NestJS โดยไม่ย้ายข้อมูล

1. นำ HTTP contract เดิมไปสร้าง controllers/guards/modules
2. นำ application services/domain ไปใช้โดยเปลี่ยน composition root ไม่ rewrite business rules ทุกโมดูล
3. ใช้ Supabase Auth verifier, RPC repositories และ Storage adapter เดิม
4. รัน contract/security tests ชุดเดียวกับ Node เดิม แล้วสลับ API base/proxy แบบควบคุม
5. มี rollback กลับ backend เดิมได้โดย schema backward-compatible

NestJS module boundaries ใช้เป็น deployment/framework organization ไม่ใช่เหตุผลให้แตก microservices ([NestJS modules](https://docs.nestjs.com/modules))

### Stage B — ย้าย PostgreSQL hosting

- ย้าย schema/data ของแอปที่ใช้จริง ไม่ dump `auth`/`storage` แล้วคาดว่าบริการ Supabase ทั้งหมดจะย้ายตาม
- เปลี่ยน repository adapter ไป PostgreSQL driver/ORM ที่เลือกตอนนั้น; SQL transaction functions แบบมาตรฐานคงไว้ได้
- เปลี่ยน roles/grants ของ Supabase เป็น limited runtime role ใหม่ และทดสอบทุก transaction boundary
- ซ้อม backup/restore และ verification: row counts, identity links, FK, revision, operation receipts และ asset manifests
- เลือก maintenance write-freeze หรือ replication/catch-up ตาม downtime ที่ยอมรับได้ ห้ามใช้ dual-write แบบไม่มี reconciliation
- สลับระบบเมื่อ consistency ผ่านและ rollback boundary ชัด; หลังเริ่มเขียนที่ใหม่ rollback ต้อง sync writes กลับ ไม่ใช่เปลี่ยน connection string ย้อนเฉย ๆ

### Stage C — ย้าย Object Storage

- copy immutable objects พร้อม checksums; object metadata เปลี่ยน provider/key ผ่าน manifest mapping
- คง asset IDs และ business references เดิม; ห้าม rewrite project ทุกชิ้นเพื่อเปลี่ยน URL
- ทดสอบ CORS/content types/download headers และ private access ของ provider ใหม่
- ระหว่างเปลี่ยนใช้ read-old/write-new หรือ dual-read แบบมี cutover policy ชัด; ไม่ลบเก่าจน verify ครบและพ้นช่วง rollback

### Stage D — ย้าย Auth ถ้าจำเป็นจริง

- เปลี่ยน AuthService/browser login และ server verifier โดยคง internal app_user_id
- secure identity linking/migration ต้องพิสูจน์ว่าบัญชีใหม่เป็นเจ้าของเดิม ไม่ map ด้วย email อย่างเดียว
- กำหนดช่วงยอมรับ old/new issuer, session expiry/re-login และวิธี rollback; deny unknown issuer
- ย้าย Google/OAuth configuration และ credentials ตาม provider ไม่ฝังค่าไว้ใน business tables
- ประเมินว่าคง Supabase Auth ต่อจะคุ้มกว่าการย้ายหรือไม่ ไม่มีข้อกำหนดให้ต้องย้ายทุกส่วน

## 19. สิ่งที่ไม่ควรทำและเงื่อนไขหยุดถาม

ไม่ควรทำ:

- ไม่เริ่ม NestJS หรือ rewrite frontend ตอนทำ Phase 1
- ไม่กระจาย `.from()`/`.rpc()` ใน React และไม่เปิด direct table writes เพื่อแก้ permission error แบบเร็ว ๆ
- ไม่บันทึก `isPremium` ที่ browser แก้เอง แล้วใช้เป็นสิทธิ์จริง
- ไม่ใส่ base64 images ทั้งหมดลง JSONB หรือส่งทั้ง project collection ทุก autosave
- ไม่ใช้อีเมลเป็นตัวเชื่อมสิทธิ์ และไม่ assume `auth.uid()` ได้ end-user เมื่อใช้ privileged server credential
- ไม่ย้ายงานด้วย parser ที่สร้าง random project ID ทุก retry
- ไม่เปลี่ยน schema/geometry/ราคา/นโยบายเก็บข้อมูลโดยไม่มีเหตุผลและหลักฐาน
- ไม่แอบเปิด AI จริงหรือ paid services ระหว่าง smoke tests

ต้องหยุดถามเมื่อ:

- ต้องมี cloud account/project/Google OAuth configuration ที่ยังไม่ได้ระบุ หรือขอสิทธิ์ remote mutation
- ต้อง convert ภาพเดิมแบบเสียคุณภาพหรือมีข้อมูลที่ schema ใหม่เก็บไม่ได้
- ต้องลบข้อมูลเก่า ใช้ production migration หรือมี conflict กับ uncommitted changes ของผู้ใช้
- ถึงขั้นตัดสินใจราคา/payment/fair use/refund/retention ที่ยังไม่ยืนยัน

ระหว่างรอคำตอบสามารถทำ local tests/contracts/fixtures ที่ไม่พึ่งการตัดสินใจนั้นต่อได้ แต่ห้ามรายงานว่าขั้นตอนที่ยังขาดเสร็จแล้ว

## 20. รูปแบบส่งงานของผู้ลงมือพัฒนา

เมื่อจบแต่ละ milestone ให้รายงาน:

1. ทำ milestone ใด และมี behavior เปลี่ยนอะไร
2. ไฟล์/migrations/contracts ที่เพิ่มหรือแก้
3. คำสั่ง tests/build ที่รันจริงพร้อมผล และ test cases สำคัญ
4. สิ่งที่ทดสอบบน mock/local DB/staging จริง แยกกันชัดเจน
5. สิ่งที่ยังไม่ผ่าน/ยังไม่ได้รัน/credentials ที่ผู้ใช้ต้องตั้ง (ระบุชื่อ env ไม่ใช่ขอค่าลับในแชต)
6. Data migration/rollback impact และสิ่งที่ต้องทำก่อนเปิด public
7. milestone ถัดไป โดยไม่ถือว่าอนุญาตให้ deploy/commit/push อัตโนมัติ

เอกสารนี้เป็น blueprint ไม่ใช่ generated implementation: source code และผลทดสอบจริงเป็นหลักฐานรับมอบสุดท้าย
