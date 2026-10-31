# Routes, สถานะหน้า และ dependency ของ Editor — Phase 0 ฝั่ง A

**Artifact revision: `A0-r1`** (31 ต.ค. 2026) — ใช้เลขนี้อ้างอิงตอน review 0-J1/0-J2; แก้เนื้อหาแล้วต้องขึ้น revision ใหม่และ review ซ้ำ
ตรวจกับ checkout `main` @ `fb55f36` (โค้ดแอปเท่ากับ `2d7aee9`; `fb55f36` เพิ่มเฉพาะเอกสาร) ผู้ทำ: AI ของคน A (Claude Code)

เอกสารนี้แยก 3 ระดับให้ชัด:
- **[มีอยู่]** ตรวจจากโค้ด/ผลรันจริงใน commit ข้างบน
- **[วัดแล้ว]** ผลจากคำสั่งที่ระบุในหัวข้อ 6 (ทำซ้ำได้)
- **[ข้อเสนอ]** ยังไม่ implement และยังไม่มีใคร review — รอ B ตรวจใน 0-J1/0-J2

---

## 1. สภาพปัจจุบันที่ตรวจแล้ว (ฐานของข้อเสนอ)

| เรื่อง | สิ่งที่พบ | ระดับ |
|---|---|---|
| Router | ไม่มี router; `main.tsx` เลือก `CloudRoot` (cloud) หรือ `LocalDemoRoot` ตาม `VITE_APP_MODE`; path ใน URL ไม่ถูกอ่านเลย | [มีอยู่] |
| Deep link | เปิด `/editor/<uuid>` บน build cloud (ไม่มี session) ได้หน้า login เหมือนเปิด `/` — path ถูกทิ้ง | [วัดแล้ว] |
| OAuth return | `signInWithOAuth({ redirectTo: window.location.origin })` + PKCE (`detectSessionInUrl: true`) → กลับ root เสมอ; allowlist local (`supabase/config.toml`) มีเฉพาะ `http://127.0.0.1:5173`, `http://localhost:5173` | [มีอยู่] |
| SPA fallback | `vercel.json` มีแค่ rewrite `/api/v1/:path*` → ยังไม่มี fallback ให้ `/app/*`, `/editor/*` (งาน B 1-B3) | [มีอยู่] |
| เปิดงานตอนเข้า | `CloudWorkspace` ดึงรายการ **ทุกหน้า** (`refreshItems` วน `limit: 100` จน `nextCursor` หมด) แล้วเปิดงาน `summaries[0]` (ล่าสุด); ไม่มีงานเลย → **สร้างงานใหม่อัตโนมัติ** (`createFromEditor(freshProject(1))`) | [มีอยู่] |
| งานถูกลบจากอีกแท็บ | ถ้า clean → เปิดงานล่าสุดแทน หรือสร้างงานใหม่ถ้ารายการว่าง (sync event `deleted`) | [มีอยู่] |
| Workspace | `CloudRoot` ใช้ `bootstrap.personalWorkspace.id` อย่างเดียว; client `getMe()` มีใน `services/api/session.ts` แต่ไม่มีใครเรียก | [มีอยู่] |
| Draft/save | ทุกการแก้ → App debounce 300 ms → `cloud.onProjectChange` → `controller.capture` เขียน draft ลง IndexedDB ทันที (`gen-package` draft store, key ผูก appUserId + workspaceId + projectId + clientId) แล้ว save queue ส่ง server (debounce 1 วิ, รอสูงสุด 5 วิ, retry 3 ครั้ง) | [มีอยู่] |
| ออกจาก Editor | `CloudWorkspace` unmount → `controller.dispose()` หยุด timer เท่านั้น; draft ที่ยังไม่ส่งค้างใน IndexedDB และ **ส่งต่อเมื่อเปิดงานนั้นอีกครั้ง** (`queue.open` → resumed) ไม่มีตัวส่งเบื้องหลังสำหรับงานที่ไม่ได้เปิด; ไม่มี `beforeunload`/`pagehide` ในแอป | [มีอยู่] |
| สร้างงาน | `executeDurableCreate` + mutation journal (IndexedDB) ใช้ `operationId` เดิม replay ได้เมื่อออนไลน์ (`replayDurableProjectMutations`) | [มีอยู่] |
| V1/V2 | สลับใน `App` ด้วย state `editorVersion` + localStorage `packit-editor-version` (ไม่ remount เอกสาร) | [มีอยู่][วัดแล้ว] |
| Local demo | gate `localStorage['packit-auth']`; งานทั้งหมดใน `localStorage['gen-package-projects-v1']`; ไม่มี session/API cloud | [มีอยู่] |

## 2. 0-A1 — แผน routes และ navigation [ข้อเสนอ]

### 2.1 ตาราง routes (Phase 1 เท่านั้น)

| Path | ใครเข้าได้ | โหลดอะไร | หมายเหตุ |
|---|---|---|---|
| `/` | ทุกคน | shell เบา | มี session → `/app/projects`; ไม่มี → `/login`; รับ OAuth `?code=` (PKCE) ที่นี่เพราะ allowlist เดิมชี้ root |
| `/login` | ยังไม่ login | shell เบา + Login | `?returnTo=` (path ภายในเท่านั้น ดู 2.3) — มี session อยู่แล้ว → ไป returnTo/`/app/projects` ทันที |
| `/app/projects` | login แล้ว | shell + รายการงาน (ไม่มี Editor) | รายการแบบแบ่งหน้า + ภาพย่อ; ปุ่ม "สร้างงาน" → `/editor/new`; **ไม่สร้างงานอัตโนมัติเมื่อรายการว่าง** (ต่างจากพฤติกรรมเดิม — ให้ empty state + ปุ่มสร้าง) |
| `/editor/new` | login + สิทธิ์เขียน workspace | Editor chunk | สร้างเอกสารใน Editor แล้ว `POST /projects` → `replace` เป็น `/editor/:id` (2.4) |
| `/editor/:projectId` | login | Editor chunk | เปิด ID นั้นเท่านั้น (`GET /projects/:id`); 404/403 → หน้า "ไม่พบงาน/ไม่มีสิทธิ์" ไม่เปิดงานอื่นแทน |
| `*` | ทุกคน | shell เบา | หน้าไม่พบ + ลิงก์กลับ `/app/projects` |

- Local demo ใช้ path ชุดเดียวกัน แต่ `projectId` เป็น id ใน localStorage ของเครื่อง และ gate `packit-auth` เดิม — **ไม่ใช้ gate นี้เป็นสิทธิ์ cloud**; สองโหมดเป็นคนละ build/origin อยู่แล้ว และ query cache ใส่ `mode` เป็นส่วนแรกของ key เสมอ
- ปุ่มกลับจาก Editor → `/app/projects` (navigate ปกติ ผ่าน leave guard ข้อ 3.2); browser back จาก Editor กลับหน้ารายการ; จาก `/editor/new` ที่สร้างเสร็จแล้วใช้ `replace` เพื่อไม่ให้ back กลับมาสร้างซ้ำ
- Workspace ที่เลือก: Phase 1 ใช้ personal workspace จาก bootstrap เป็นค่าเริ่ม และให้เลือก workspace อื่นได้เฉพาะรายการที่ `GET /me` คืน (role จาก server) เก็บตัวเลือกล่าสุดใน localStorage แยกต่อ appUserId; ค่าที่เก็บไว้ไม่ตรงสมาชิกปัจจุบัน → ทิ้งกลับ personal — ไม่ใส่ workspace ใน URL รอบนี้ (ลิงก์ Editor อ้าง project id อย่างเดียว workspace มาจาก response ของ server)

### 2.2 ลำดับหลัง login

1. ก่อนกด Google: เก็บ `returnTo` ที่ผ่านการตรวจแล้วใน `sessionStorage['packit-return-to']` (ต่อแท็บ, ไม่ใส่ใน redirect URL, ไม่มี token)
2. `signInWithOAuth({ redirectTo: origin })` เหมือนเดิม → กลับ `/` พร้อม `?code=` → SDK แลก session
3. session + bootstrap พร้อม → อ่าน `packit-return-to` → ตรวจซ้ำ → ลบทิ้ง → `navigate(returnTo, { replace: true })`; ไม่มี/ไม่ผ่าน → `/app/projects`
4. เปิดลิงก์ในแท็บใหม่ขณะ login อยู่แล้ว → route ตรงไป (ไม่ผ่าน login)

ข้อดี: ไม่ต้องแก้ allowlist ของ Supabase (local/remote) ใน Phase 1 — ถ้า B ต้องการ `/auth/callback` ต้องเพิ่ม URL นั้นใน allowlist ทุก environment ก่อน (เป็นงาน remote config ของ B)

### 2.3 กติกา returnTo (ป้องกัน open redirect)

ผ่านเมื่อ **ทุกข้อ** จริง: เป็น string; ขึ้นต้น `/` ตัวเดียว (ไม่ใช่ `//` หรือ `/\`); ไม่มีอักขระควบคุม/backslash; `new URL(value, origin).origin === origin`; path ขึ้นต้น `/app/` หรือ `/editor/` เท่านั้น (ไม่รับ `/login`, `/` เพื่อไม่วนลูป); ยาวไม่เกิน 512 ตัวอักษร — นอกนั้นใช้ `/app/projects` (ทำเป็นฟังก์ชัน pure พร้อมเทสต์ใน 1-A6)

### 2.4 `/editor/new` และ id

- `operationId` สร้างครั้งเดียวต่อ history entry ของ `/editor/new` และเก็บใน `sessionStorage` ผูก `history.state.key` → refresh ก่อนสร้างเสร็จใช้ operationId เดิม (server idempotent ตาม contract เดิม — B ยืนยันใน 0-B1/1-B2) แล้ว `replace` เป็น `/editor/<id ที่ server คืน>`
- ออฟไลน์: ใช้ mutation journal เดิม (`executeDurableCreate`) → แสดง "สร้างไว้ในเครื่อง รอส่ง" และคงอยู่ที่ `/editor/new` จนกว่า replay สำเร็จ แล้วจึง `replace`
- creation engine (`freshProject`, templates) โหลดหลังเข้า Editor chunk เท่านั้น — หน้ารายการไม่ import

## 3. 0-A2 — สถานะ UI และการออกจากงาน [ข้อเสนอ]

### 3.1 สถานะหน้า

| สถานะ | ผู้ใช้เห็น | ทางต่อ | ข้อมูลที่ต้องรักษา |
|---|---|---|---|
| ตรวจ session/bootstrap | `LoadingStage` เดิม (login/folding) | รอ | — |
| รายการกำลังโหลด | skeleton การ์ด (ไม่ใช่จอว่าง) | — | ข้อมูล page เดิมถ้ามี (stale-while-revalidate) |
| รายการว่าง | "ยังไม่มีงาน" + ปุ่มสร้างงาน | `/editor/new` | — |
| การ์ดไม่มีภาพย่อ | ไอคอนตามชนิด (kind/label จาก meta) หรือไอคอนทั่วไป | — | — |
| โหลดรายการล้ม (เครือข่าย/5xx) | ข้อความ + ปุ่มลองใหม่ | retry query | page ที่โหลดแล้ว |
| ออฟไลน์ | แถบ "ออฟไลน์" + รายการจาก cache ของบัญชี/ workspace เดียวกันเท่านั้น + งานที่มี draft ในเครื่อง | รอออนไลน์ | draft |
| session หมดอายุ (401 หลัง refresh token ไม่ได้) | หน้า login พร้อม returnTo = path ปัจจุบัน; **ไม่แสดงข้อมูล cache เก่าต่อ** | login ใหม่ | draft ใน IndexedDB (ผูก appUserId) |
| ไม่มีสิทธิ์ workspace/งาน (403/404 ตาม contract B) | "ไม่พบงานนี้ หรือคุณไม่มีสิทธิ์" — ไม่บอกว่ามีอยู่จริงหรือไม่ | กลับรายการ | — |
| งานถูกลบ (เปิดอยู่) | ถ้า clean: "งานนี้ถูกลบแล้ว" + กลับรายการ (**ไม่เปิดงานอื่นแทน** ต่างจากเดิม); ถ้ามีแก้ค้าง: conflict + "บันทึกเป็นงานใหม่" | กลับรายการ / สำเนา | draft |
| viewer | Editor อ่านอย่างเดียว ซ่อน/ปิดปุ่มเขียน + ข้อความ "ดูได้อย่างเดียว" (ตาม matrix B; server ยังเป็นผู้ตัดสิน) | — | — |

### 3.2 ออกจาก Editor ตาม `ProjectSaveState` (ค่าจริงใน `durableSaveQueue.ts`)

ก่อนออกทุกครั้ง: เรียก flush ของ App (state ล่าสุดใน debounce 300 ms) → `await cloud.onProjectChange` (capture ลง IndexedDB) **แล้วจึง** unmount — ช่องว่างนี้มีอยู่จริงในโค้ดตอนนี้ ถ้า unmount ทันทีหลังแก้ อาจเสียการแก้ ≤ 300 ms ล่าสุด

| สถานะ | ความหมายจริง | กดกลับรายการ |
|---|---|---|
| `clean` | server ยืนยัน revision ล่าสุดแล้ว | ออกทันที |
| `dirty` | draft อยู่ใน IndexedDB แล้ว ยังไม่ส่ง | `flush()` รอสูงสุด ~3 วิ แสดง "กำลังบันทึก…"; สำเร็จ → ออก; ไม่ทัน/ล้ม → ออกได้พร้อมข้อความ "บันทึกในเครื่องแล้ว จะส่งเมื่อเปิดงานนี้อีกครั้ง" |
| `saving` | มีคำขอค้าง (inFlight เก็บใน IndexedDB) | เหมือน `dirty` |
| `offline` | draft ในเครื่อง รอเน็ต | ออกได้ทันที + ป้าย "รอส่ง" บนการ์ดงานนั้น |
| `conflict` | server มี revision ใหม่กว่า | ถามก่อนออก: "โหลดเวอร์ชันล่าสุด" / "บันทึกเป็นงานใหม่" / "ออกโดยเก็บ draft ไว้" — ไม่เขียนทับเงียบ |
| `error` | ส่งล้มเกิน retry | ปุ่มลองใหม่ หรือออกพร้อมเก็บ draft |

- **บันทึกในเครื่อง ≠ บันทึกบน cloud**: UI แสดง "บันทึกแล้ว" เฉพาะ `clean`; `dirty/offline` แสดง "บันทึกในเครื่องแล้ว"
- งานที่มี draft ค้างของบัญชี/workspace ปัจจุบัน (`store.list(scope)`) แสดงป้าย "รอส่ง" ในรายการ — **ประเด็นเปิด (A/B):** จะส่ง draft ค้างเบื้องหลังจากหน้ารายการด้วยหรือไม่ (ตอนนี้ส่งเมื่อเปิดงานนั้นเท่านั้น)
- ปิดแท็บ/refresh: เพิ่ม `pagehide` flush แบบ best-effort ได้ แต่ห้ามเป็นจุดเดียวที่รักษางาน — draft ต้องอยู่ใน IndexedDB ตั้งแต่ capture อยู่แล้ว
- เปลี่ยน workspace/logout ขณะมี draft: draft ยังผูก scope เดิม ไม่ลบ; บัญชีอื่นไม่เห็น (key มี appUserId) — กลับมาบัญชีเดิม/workspace เดิมแล้วเปิดงาน → resume

## 4. 0-A3 — Dependency map และ baseline

### 4.1 Chunk graph จาก build จริง [วัดแล้ว] (`vite build --manifest`, local-demo และ cloud fixture ให้ผลชุดเดียวกัน)

```
index.html → index.js (≈202 KB) + index.css (≈131 KB, รวม app.css + @font-face ฟอนต์ทั้ง 12 ตระกูล)
 ├─ ~dyn CloudRoot.js (≈228 KB: supabase-js + Login/bootstrap) ── static → PricingPage.js (≈34 KB)
 │     └─ ~dyn CloudWorkspace.js (≈56 KB) ── static → App.js (≈1,448 KB) + App.css (≈16 KB)
 │                                                     ├─ Three.js core (`WebGLRenderer`) และตัวสร้าง PDF อยู่ "ใน" App.js
 │                                                     └─ ~dyn Viewer3D / VesselViewer3D / PouchViewer3D (11–18 KB) + SceneLighting (≈93 KB, drei)
 └─ ~dyn App.js (local demo)
```

ข้อสังเกตที่กระทบ 1-A1/1-A2:
1. **preload ข้าม lazy boundary**: `CloudRoot` เรียก `loadWorkspace()` ใน `useEffect` ตอน mount; `LocalDemoRoot` เรียก `loadApp()` หลัง 200 ms ตอนยังไม่ login → หน้า login ดาวน์โหลด App ทั้งก้อน
2. **Three.js ไม่ได้ lazy จริง**: มีแค่ component viewer ที่ lazy แต่ `three` ถูก import ตรงจาก App/โมดูล core (เช่น `fold.ts`, `panelFaces.ts`, `useArtTexture`) จึงอยู่ใน App.js — ถ้าต้องให้ "เปิด Editor แต่ยังไม่โหลด 3D" ต้องแยกเพิ่ม (นอกขอบเขต 1-A2 ที่ให้ครอบ Editor เดิมก่อน — บันทึกไว้เป็นข้อมูล)
3. `CloudWorkspace` import `App` แบบ static → การ lazy `CloudWorkspace` = lazy Editor ทั้งก้อน (ใช้เป็น boundary ได้เลย)
4. CSS ทั้งแอป (`app.css` 131 KB) และ `@font-face` ทุกฟอนต์ออกแบบ อยู่ใน entry CSS → หน้าเบาได้ CSS ของ Editor ไปด้วย (ไฟล์ฟอนต์จริงดาวน์โหลดเฉพาะที่ถูกใช้ — วัดได้ 5–8 ไฟล์ตอนหน้า login)

### 4.2 Static import closure ต่อโมดูล [วัดแล้ว] (`scripts/marketplace/import-closure.mjs`, esbuild minify, ไม่รวม CSS)

| โมดูล | ขนาด | ดึง three / templates | ใช้ในหน้าเบาได้ไหม |
|---|---:|---|---|
| `services/api/projects` | 2.4 KB | – / – | ได้ |
| `services/api/session` | 1.3 KB | – / – | ได้ |
| `services/thumbnails/thumbnailCache` | 3.8 KB | – / – | ได้ (IndexedDB cache ภาพย่อเดิม) |
| `components/Login` | 5.0 KB | – / – | ได้ |
| `core/materials` | 26.2 KB | – / – | เลี่ยง (ใช้แค่สีการ์ด) |
| `core/templates/index` (`TEMPLATES`) | 56.2 KB | – / ✓ | **ไม่** |
| `core/project` (`freshProject`/parse) | 104.7 KB | – / ✓ | **ไม่** (creation engine อยู่ใน Editor) |
| `components/ProjectGallery` (การ์ดเดิมใน header App) | 113.2 KB | – / ✓ | **ไม่** — ต้องทำการ์ดใหม่ที่ใช้ kind/label จาก `ProjectSummary.thumbnail` แทน `TEMPLATES`/`getMaterial` |

### 4.3 Cold load baseline [วัดแล้ว] (`scripts/marketplace/cold-load.mjs`, Chrome headless, context ใหม่ไม่มี cache, static server ไม่มี API)

| สถานการณ์ | JS ที่โหลด | CSS | ฟอนต์ |
|---|---:|---:|---:|
| local-demo: หน้า login (ยังไม่กด) | 1,683 KB (index + PricingPage + **App**) | 147 KB | 5 ไฟล์ 59 KB |
| local-demo: เข้า Editor | 1,788 KB (+Viewer3D +SceneLighting) | 147 KB | 10 ไฟล์ 107 KB |
| cloud fixture: หน้า login ไม่มี session | 1,967 KB (index + PricingPage + CloudRoot + CloudWorkspace + **App**) | 147 KB | 8 ไฟล์ 88 KB |
| cloud fixture: `/editor/<uuid>` ไม่มี session | เท่ากับบรรทัดบน (path ถูกทิ้ง ได้หน้า login) | 147 KB | 8 ไฟล์ |

cloud fixture = build ที่ตั้ง `VITE_APP_MODE=cloud` + Supabase URL/คีย์**ปลอม** (`http://127.0.0.1:59999`, `fixture-not-a-real-key`) ใช้วัดเส้นทางโหลดของหน้า login เท่านั้น — ไม่ใช่หลักฐาน cloud integration; ยังวัดหน้ารายการ/Editor บน cloud จริงไม่ได้จนกว่า B ส่ง environment (0-B3)

### 4.4 Regression baseline ของ Editor [วัดแล้ว]

| รายการ | ผล | วิธี |
|---|---|---|
| `npx tsc --noEmit` | ผ่าน | — |
| `npm test` | 111 ไฟล์ผ่าน / 2 skip; 1,379 tests ผ่าน / 6 skip | — |
| Editor smoke (local-demo build) | ผ่าน: แก้สีพื้น → undo กลับ → redo; สลับ V2 (`.editor-v2` ขึ้น) → V1 เอกสารเดิม id/ค่าเดิม; มี canvas 3D; แท็บส่งออกมี 5 ปุ่ม; refresh แล้วงาน/ค่าคงอยู่; ไม่มี page error | `scripts/marketplace/editor-smoke.mjs` |
| Cloud save/recovery, export ตามสิทธิ์ cloud, viewer | **pending** — ต้องใช้ environment cloud จาก B | — |

## 5. ข้อเสนอสำหรับงานร่วม (รอ B review — ยังไม่ใช่ข้อตกลง)

### 5.1 0-J1 — ข้อมูลที่ UI ต้องใช้ (ทั้งหมดอ้าง contract ที่มีอยู่ใน `shared/contracts/*`)

| Flow | Endpoint เดิม | สิ่งที่ A ใช้ / ต้องการให้ B ยืนยัน |
|---|---|---|
| session | `POST /session/bootstrap` → `SessionBootstrapData` | เรียกซ้ำได้ (idempotent) และไม่โหลดเอกสาร |
| บริบท | `GET /me` → `MeData { user, workspaces[{id, kind, name, role}] }` | role ที่ server คืนคือข้อมูลเดียวที่ UI ใช้ซ่อนปุ่ม |
| รายการ | `GET /projects?workspaceId&cursor&limit` → `ProjectPage { items: ProjectSummary[], nextCursor }` | **ขนาด page ที่ UI จะขอ = 24** (ตรงกับ `THUMBNAIL_BATCH_MAX` ให้ 1 page = ภาพย่อ 1 batch); limit สูงสุดฝั่ง server = 100 (`projectListQuerySchema`); ยืนยันว่า cursor คงที่เมื่อมีงานแก้ระหว่างเลื่อน (เรียง `updated_at desc, id desc`) |
| ภาพย่อ | `ProjectSummary.thumbnail {version, kind, label}` + `POST /projects/thumbnails {workspaceId, projectIds ≤ 24}` | ขอเฉพาะ version ไม่ตรงแคช (`thumbNeedsFetch` เดิม); meta ล้ม = รายการปกติไม่มีภาพ |
| เปิดงาน | `GET /projects/:id` → `CloudProject` | error code ของ 404/403/ไม่มีสมาชิก workspace — UI แสดงข้อความเดียวกัน |
| สร้าง | `POST /projects {workspaceId, operationId, name, documentSchemaVersion: 1, document}` | retry ด้วย operationId เดิมได้งานเดิม; ส่ง operationId เดิมกับ body ต่าง → 409 `IDEMPOTENCY_KEY_REUSED` |
| บันทึก | `PUT /projects/:id {operationId, expectedRevision, …}` → `SaveReceipt` | 409 `REVISION_CONFLICT` + `details.currentRevision` = conflict (ไม่ retry อัตโนมัติ) |

ประเด็นเปิดที่ต้องการคำตอบจาก B (ระบุเจ้าของ = B ทั้งหมด):
1. 404 กับ 403 ของ `GET /projects/:id` แยกกันหรือรวม (ตอนนี้ RPC คืน `PROJECT_NOT_FOUND` ทั้งกรณีไม่มีงานและไม่มีสิทธิ์ — A เสนอให้คงไว้แบบนี้เพื่อไม่บอกว่างานมีอยู่)
2. รายการที่ไม่มีภาพย่อไม่มี `kind/label` (การ์ดไม่รู้ชนิดงาน) — Phase 1 ยอมรับได้ (ไอคอนทั่วไป) หรือต้องเพิ่มใน summary
3. ส่ง draft ค้างเบื้องหลังจากหน้ารายการหรือไม่ (ข้อ 3.2)
4. SPA fallback ใน `vercel.json` ที่ไม่ครอบ `/api/*` และ static assets (1-B3)
5. ยืนยัน OAuth return แบบ 2.2 (ไม่แก้ allowlist) หรือเลือก `/auth/callback` (ต้องแก้ allowlist ทุก env)

### 5.2 0-J2 — ขอบเขต เจ้าภาพไฟล์ และ acceptance

- ขอบเขตตาม PHASE-0-1.md: ไม่มี schema/migration marketplace, ไม่มี role ธุรกิจ, ไม่มี Admin; placeholder ไม่นับเป็นฟีเจอร์
- **ไฟล์ร่วมที่ A ขอเป็นผู้แก้:** `package.json` + `package-lock.json` เฉพาะ dependency ฝั่งหน้าเว็บ (`react-router` / `@tanstack/react-query` — เลือกรุ่นตอนเริ่ม 1-A1); `vite.config.ts` เฉพาะส่วน build ฝั่ง client ถ้าจำเป็น; `scripts/marketplace/*` (เครื่องมือวัดของ A, เพิ่มใน revision นี้)
- **ไม่แตะ:** `shared/contracts/*`, `server/*`, `supabase/*`, `vercel.json` (ของ B); `src/core/*` และ engine/export/billing
- พฤติกรรมที่เปลี่ยนจากเดิมโดยตั้งใจ (ต้องการความเห็น B): ไม่สร้างงานอัตโนมัติเมื่อรายการว่าง; งานถูกลบจากอีกแท็บไม่เปิดงานอื่นแทน; ไม่ดึงรายการทุกหน้า
- ผู้เก็บหลักฐาน acceptance (เสนอ): P1-01, P1-07, P1-11 = A; P1-02, P1-03, P1-04, P1-05, P1-06, P1-09 = A (browser) + B (API/server); P1-08, P1-10 = B (API/config) + A (UI); P1-12 = ทั้งคู่

## 6. วิธีทำซ้ำการวัด

```bash
# build สองโหมดลง tmp/ (ignored) — cloud fixture ใช้ค่าปลอม และปิด path conversion ของ Git Bash
npx vite build --mode local-demo --manifest --outDir tmp/a0-build-local --emptyOutDir
MSYS_NO_PATHCONV=1 VITE_APP_MODE=cloud VITE_SUPABASE_URL=http://127.0.0.1:59999 VITE_SUPABASE_PUBLISHABLE_KEY=fixture-not-a-real-key VITE_API_BASE_URL=/api/v1 npx vite build --manifest --outDir tmp/a0-build-cloud --emptyOutDir
node scripts/marketplace/serve-build.mjs tmp/a0-build-local 5191   # แท็บ/terminal แยก
node scripts/marketplace/serve-build.mjs tmp/a0-build-cloud 5192
node scripts/marketplace/cold-load.mjs http://localhost:5191/ http://localhost:5192/
node scripts/marketplace/editor-smoke.mjs http://localhost:5191/
node scripts/marketplace/import-closure.mjs
```

ต้องมี Chrome (ตั้ง `PACKIT_E2E_CHROME` ถ้าไม่ได้อยู่ path ค่าเริ่มต้นของ Windows) และ `playwright-core` จาก devDependencies เดิม
