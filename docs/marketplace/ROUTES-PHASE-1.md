# Routes, สถานะหน้า และ dependency ของ Editor — Phase 0 ฝั่ง A

**Artifact revision: `A0-r2`** (1 พ.ย. 2026) — ใช้เลขนี้อ้างอิงตอน review 0-J1/0-J2; แก้เนื้อหาแล้วต้องขึ้น revision ใหม่และ review ซ้ำ
ตรวจกับ checkout `main` ที่ merge B `acac249` แล้ว (โค้ดแอป/server/shared ยังเท่ากับ `fb55f36` — merge มีแต่เอกสาร) ผู้ทำ: AI ของคน A (Claude Code)

| Revision | สิ่งที่เปลี่ยน |
|---|---|
| `A0-r1` (31 ต.ค., `d73a686`) | ฉบับแรก: routes, UI states, dependency/baseline, ข้อเสนอ 0-J1/0-J2 — ยังไม่ได้รับ artifact ของ B |
| `A0-r2` (1 พ.ย.) | A review `b-phase0-r1` + `b-review-a0-r1-r1` (§0); ตอบ R1–R5 (§7) และแก้ §2.4, §3.2 ให้ตรงคำตอบ; ปรับ §5 จาก "ข้อเสนอรอ B" เป็น "ข้อตกลงที่ทั้งสองฝ่ายรับแล้ว" เฉพาะข้อที่ B ตอบรับ |

## 0. ผล review ของ A ต่อ artifact ของ B

ตรวจ [API-CONTRACT-PHASE-1.md](API-CONTRACT-PHASE-1.md), [PERMISSIONS-PHASE-1.md](PERMISSIONS-PHASE-1.md), [FIXTURES-PHASE-1.md](FIXTURES-PHASE-1.md) รุ่น `b-phase0-r1` (B `2398c4d`) และ [REVIEW-A0-r1-B.md](REVIEW-A0-r1-B.md) รุ่น `b-review-a0-r1-r1` (B `acac249`) เทียบโค้ดจริง

| ข้ออ้างของ B | วิธีตรวจของ A | ผล |
|---|---|---|
| list `limit` 1–100 ค่าเริ่ม 50, cursor ≤ 1,000 ตัวอักษร | `server/modules/projects/validation.ts:302-303` | ตรง |
| DELETE ใช้ `X-Expected-Revision` + `Idempotency-Key` ไม่มี body | `server/http/router.ts:817-822` | ตรง |
| viewer เขียน/คนนอก → `PROJECT_NOT_FOUND` → 404 | `assert_workspace_access` (`20260918000300_projects.sql` ราว 110–119: `p_write and role not in ('owner','editor')`) + `projectRepository.ts:52` | ตรง |
| create journal ลบ record เมื่อได้ผล ไม่มี mapping history entry → projectId | `src/services/projects/durableProjectMutations.ts` (`store.delete` หลัง `sendCreate`) | ตรง — เป็นเหตุผลของ R2 |
| `capture` await `store.put` และ `flush` เก็บ error ใน status | `durableSaveQueue.ts:123-160` | ตรง — เป็นเหตุผลของ R4 |
| fixtures 31 scenarios ผ่านตัวตรวจ | `node docs/marketplace/fixtures/verify.mjs` บนเครื่อง A (Windows, Node 24) | **PASS 31** (ผลรันเองของ A) |

**ผล:** A รับ `b-phase0-r1` ทั้งสามฉบับโดยไม่ขอแก้ — page 24, cursor opaque/keyset ไม่ใช่ snapshot, thumbnail batch ≤ 24 จับคู่ด้วย projectId, 404 รวมกรณีไม่มีสิทธิ์, `documentSchemaVersion: 1`, operationId scoped ต่อ actor/workspace, error table และ permission matrix (owner/editor ลบได้) — และรับคำตอบ 5 ข้อใน `b-review-a0-r1-r1` ตามที่ B ตอบ ข้อสังเกตเพิ่ม (ไม่ต้องแก้ contract):
1. `createFromEditor` เดิม dehydrate รูปขึ้น asset ก่อน `POST /projects` → การสร้างงานที่มีรูปอัปโหลดต้องออนไลน์ เป็นเหตุให้ §7 R3 "ตรึง payload ตอนออนไลน์" ไม่ใช่ตอนกดสร้าง
2. contract บอก `nextCursor` อาจไม่ null แม้หน้าถัดไปว่าง → UI รับหน้าเปล่าเป็น "หมดแล้ว" ไม่ถือเป็น error

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

แก้ใน `A0-r2` ตาม R2/R3 — ~~operationId ต่อ history entry ใน sessionStorage~~ ไม่พอ (ไม่ผูกบัญชี/payload/ผลลัพธ์) รายละเอียดเต็มอยู่ §7 R2–R3:
- ทุก `/editor/new` มี **create intent** หนึ่งรายการใน IndexedDB ของ A (ผูก mode/appUserId/workspaceId/history entry) เก็บร่างล่าสุด, payload ที่ตรึงแล้ว + operationId และ projectId เมื่อได้ผล — ลบเมื่อ URL เป็น `/editor/:id` และร่างย้ายเข้า save queue ของ id จริงแล้วเท่านั้น
- `replace` เป็น `/editor/<id>` หลังบันทึก projectId ลง intent แล้ว; ออฟไลน์อยู่ที่ `/editor/new` พร้อมป้าย "สร้างไว้ในเครื่อง รอส่ง"
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

แก้ใน `A0-r2` ตาม R4/R5 — ลำดับเต็มอยู่ §7 R4 สรุป: **ทุกการออก** (ปุ่มกลับ, browser back/forward, logout, เปลี่ยน workspace) ผ่าน `leaveEditor()` ตัวเดียว: flush debounce 300 ms ของ App → `await capture` สำเร็จ (ล้ม = ห้ามออกอัตโนมัติ) → อ่าน generation จาก status ใหม่ → ค่อยตัดสินตามตาราง (ใช้ผลหลัง capture ไม่ใช่สถานะก่อนกด)

| สถานะหลัง capture | ความหมายจริง | กดกลับรายการ |
|---|---|---|
| synced (`state === 'clean'` และ `savedGeneration ≥ generation ที่เพิ่ง capture`) | server ยืนยันร่างล่าสุดแล้ว | ออกทันที |
| `dirty` / `saving` | ร่างอยู่ใน IndexedDB แล้ว ยังไม่ซิงก์ | `flush()` รอสูงสุด ~3 วิ แล้ว **อ่าน status ซ้ำ** (resolve ≠ synced): synced → ออก; ยังไม่ → ออกพร้อมข้อความ "บันทึกในเครื่องแล้ว จะส่งเมื่อเปิดงานนี้อีกครั้ง" |
| `offline` | ร่างในเครื่อง รอเน็ต | ออกได้ทันที + ป้าย "รอส่ง" บนการ์ดงานนั้น |
| `conflict` | server มี revision ใหม่กว่า | ถามก่อนออก: "โหลดเวอร์ชันล่าสุด" / "บันทึกเป็นงานใหม่" / "ออกโดยเก็บร่างไว้" — ไม่เขียนทับเงียบ |
| `error` จากการส่ง (ร่างอยู่ในเครื่องแล้ว) | ส่งล้มเกิน retry | ปุ่มลองใหม่ หรือออกพร้อมเก็บร่าง |
| **capture ล้ม** (`DraftPersistenceError` เช่น พื้นที่เต็ม/IndexedDB ถูกบล็อก) | ร่างล่าสุด **ไม่ได้** อยู่ในเครื่อง | ไม่ออกอัตโนมัติ และไม่พูดว่าเก็บแล้ว: "เก็บงานในเครื่องไม่สำเร็จ" + ลองอีกครั้ง / ส่งออก `.genpkg.json` (ทางสำรองเดิม ไม่ผ่าน paywall) / "ออกและทิ้งการแก้ที่ยังไม่ได้เก็บ" (ยืนยันสองชั้น) |

- **บันทึกในเครื่อง ≠ บันทึกบน cloud**: UI แสดง "บันทึกแล้ว" เฉพาะ `clean`; `dirty/offline` แสดง "บันทึกในเครื่องแล้ว"
- งานที่มี draft ค้างของบัญชี/workspace ปัจจุบัน (`store.list(scope)`) แสดงป้าย "รอส่ง" ในรายการ — **ตกลงแล้ว (B ตอบข้อ 3):** Phase 1 ไม่ส่ง save draft เบื้องหลังจากหน้ารายการ ส่งเมื่อเปิดงานนั้น; replay ของ create/delete journal เดิมคงไว้ตาม scope
- ปิดแท็บ/refresh ภายในช่วง debounce: ดู §7 R5 (beforeunload เฉพาะตอนมีการแก้ที่ยังไม่ capture + เริ่ม capture ทันทีที่ pagehide) — `pagehide` เป็น best-effort ไม่ใช่จุดเดียวที่รักษางาน
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

## 5. ข้อเสนอสำหรับงานร่วม

สถานะใน `A0-r2`: §5.1 (ข้อมูล/endpoint) และ §5.2 (ขอบเขต เจ้าภาพไฟล์ acceptance) B รับแล้วใน `b-review-a0-r1-r1` และ A รับคำตอบของ B แล้ว — ส่วนที่ยังรอ B ตรวจคือคำตอบ R1–R5 ใน §7 เท่านั้น

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

ประเด็นเปิด 5 ข้อนี้ B ตอบแล้วใน `b-review-a0-r1-r1` และ A รับทุกข้อ (§0): 1 = 404 รวม, 2 = ไอคอนทั่วไป ไม่เพิ่ม field, 3 = ไม่ส่ง draft เบื้องหลัง, 4 = B แก้ `vercel.json` หลัง gate (ไม่ครอบ `/api/*` และ static/missing assets), 5 = `redirectTo=origin` + returnTo ใน sessionStorage ไม่เพิ่ม `/auth/callback` — คงข้อความเดิมไว้ด้านล่างเพื่ออ้างอิง:
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

## 7. คำตอบ R1–R5 ของ B (`A0-r2`) [ข้อเสนอ — รอ B ตรวจ]

ทั้งหมดอยู่ในขอบเขต frontend ของ A ไม่ขอเพิ่ม API/DTO/schema และไม่แก้ `src/core` — ที่เก็บใหม่เป็น IndexedDB ฝั่ง browser แยก database จากของเดิม (`gen-package-cloud-v1`) เพื่อไม่ต้องขึ้น version ของ store ที่มีอยู่

### R1 — Pagination

- query key `['cloud', appUserId, workspaceId, 'projects', { limit: 24 }]` (infinite query); โหลดหน้าถัดไปเมื่อผู้ใช้เลื่อนถึง/กด "โหลดเพิ่ม" เท่านั้น **ไม่วนขอทุกหน้า**
- รวมหลายหน้าด้วย `projectId`: เจอซ้ำเก็บตัวที่ `revision` สูงกว่า (เท่ากัน → `updatedAt` ใหม่กว่า) แล้วเรียง `updatedAt DESC, id DESC` ใหม่หลังรวม
- ยอมรับว่า cursor ไม่ใช่ snapshot: งานที่ถูกแก้ระหว่างโหลดอาจย้ายขึ้นไปก่อน cursor จนไม่ปรากฏในหน้าถัดไป — **ไม่ชดเชยด้วยการโหลดทุกหน้า** แต่ reset เหลือหน้าแรกแล้ว refetch เมื่อ (ก) กลับจาก Editor (ข) create/delete ของเราสำเร็จ (ค) sync event จากอีกแท็บ (ง) ผู้ใช้กดรีเฟรช; หน้าเปล่า (มีหรือไม่มี nextCursor) = จบรายการ
- ภาพย่อ: batch ≤ 24 id ไม่ซ้ำต่อหน้า เฉพาะ version ไม่ตรงแคช จับคู่ด้วย projectId ไม่อิงลำดับ/จำนวน; ไม่มีในผล = placeholder
- เทสต์ (1-A3, P1-02): fixture `projects.page1`/`page2` + harness เลื่อนงานหนึ่งขึ้นบนสุดระหว่างโหลดหน้า 2 → ไม่มีรายการซ้ำ, ไม่มีคำขอหน้าถัดไปอัตโนมัติ, refetch แล้วงานนั้นอยู่บนสุด

### R2 — Create intent

**ที่เก็บ:** IndexedDB `packit-editor-intents` store `create-intents`, key = `cloud:<appUserId>:<workspaceId>:<intentId>`; `intentId` = UUID ที่สร้างตอนเข้า `/editor/new` แล้วเขียนลง `history.state.packitNewIntent` ด้วย `replaceState` (refresh/back-forward ได้ entry เดิม; แท็บใหม่/ลิงก์ใหม่ไม่มี → intent ใหม่)

```
CreateIntent {
  key, mode: 'cloud', appUserId, workspaceId, intentId,
  status: 'local' | 'sending' | 'created' | 'failed',
  latest: { generation, project, sidecar }   // ร่างล่าสุดของ /editor/new (R3)
  frozen: { generation, operationId, payload: CreateProjectInput } | null
  result: { projectId, revision } | null,
  error: { code } | null, createdAt, updatedAt
}
```

**ลำดับ:**
1. เข้า `/editor/new` ครั้งแรก → สร้างร่าง (`freshProject`) แล้ว **await put** intent `status: 'local'` ก่อนให้แก้ได้
2. ออนไลน์และพร้อมส่ง → ถ้า `frozen` ยังว่าง: dehydrate `latest` (อัปโหลดรูปตาม flow เดิม) → สร้าง `operationId` **ครั้งเดียว** → put `frozen` + `status: 'sending'` **ก่อน** ยิง POST
3. ส่ง `POST /projects` ด้วย `frozen.operationId` + `frozen.payload` เท่านั้น ผ่าน `executeDurableCreate` เดิม (journal create ยังทำงานและ replay ตอนเปิดแอปได้เหมือนเดิม — ถ้า replay ส่งไปก่อน การส่งของ intent ได้งานเดิมเพราะ idempotent)
4. ได้ `CloudProject` (ตรวจ workspaceId/payload ตามที่ `sendCreate` ทำอยู่แล้ว) → put `result` + `status: 'created'` → ย้ายร่าง (R3 ข้อ 3) → `navigate('/editor/<id>', { replace: true })` → ลบ intent
5. ห้ามสร้าง payload ใหม่ภายใต้ `frozen.operationId` และห้ามสร้าง operationId ใหม่หลบ 409: `IDEMPOTENCY_KEY_REUSED` → `status: 'failed'` เก็บร่างไว้ แสดง "สร้างงานไม่สำเร็จ" + "ส่งออก .genpkg.json"/"ทิ้งงานนี้"; network error/429/503 → retry ด้วย operationId+payload เดิม

**refresh แต่ละช่วง:**

| ช่วงที่ refresh | intent ที่อ่านได้ | ทำต่อ | ผล |
|---|---|---|---|
| ก่อน freeze | `local` | ร่างเดิม แก้ต่อ | ไม่มี POST |
| หลัง freeze ก่อน/ระหว่าง POST | `sending` | ส่ง operationId+payload เดิม | ไม่ซ้ำ (server idempotent) |
| **server สร้างแล้ว response หาย** | `sending` | ส่งซ้ำ → server คืนงานเดิม | งานเดียว |
| **ได้ response แล้ว ก่อน replace URL** | `created` | ข้าม POST ทำข้อ 4 ส่วนที่เหลือ (ย้ายร่างทำซ้ำได้ — เขียนทับ key เดียวกัน) | งานเดียว ไม่ยิง POST ใหม่ |
| หลัง replace | ไม่มี intent (URL เป็น `/editor/:id`) | เปิด id ตามปกติ | — |

**บริบท/บัญชี:** อ่าน intent หลัง session ผ่าน bootstrap แล้วและ `appUserId`/`workspaceId` ตรง key เท่านั้น; ไม่ตรง (เช่น refresh หลังเปลี่ยนบัญชี) → ไม่อ่าน ไม่ส่ง ไม่ลบ (เจ้าของเดิมกลับมาจะเจอ) แล้วเริ่ม intent ใหม่ของบัญชีปัจจุบัน; token ที่ใช้ส่งมาจาก token provider ที่ผูก appUserId (R5) — operationId ไม่ใช่กลไกตรวจเจ้าของ

### R3 — `/editor/new` แบบออฟไลน์

1. ระหว่างยังไม่มี server ID การแก้ทั้งหมด capture ลง `intent.latest` (generation เพิ่มทีละ 1) — **ไม่ใช้** save queue เดิม เพราะ queue ต้องมี projectId + baseRevision
2. ตรึง payload (`frozen`) **ตอนออนไลน์และพร้อมส่ง** ไม่ใช่ตอนกดสร้าง (รูปต้อง dehydrate ผ่านเน็ต — §0 ข้อสังเกต 1); การแก้หลัง freeze ยังเข้า `latest` ต่อ
3. ได้ projectId (`created`): เปิด `DurableProjectSaveQueue` ของ id นั้นด้วย `baseRevision = result.revision` → ถ้า `latest.generation > frozen.generation` → `capture(latest)` (await put ลง `gen-package-cloud-v1`) ให้ queue ส่ง `PUT` ตามปกติด้วย operationId ใหม่ + `expectedRevision = result.revision` → **ลบ intent หลัง capture ลง draft store ของ id จริงสำเร็จแล้วเท่านั้น**
4. ป้าย: `local`/`sending` ขณะออฟไลน์ = "สร้างไว้ในเครื่อง รอส่ง"; หน้ารายการแสดง intent ของ scope ปัจจุบันเป็นการ์ด "งานใหม่ (รอส่ง)" กดแล้วกลับไป `/editor/new` ของ intent นั้น — ไม่ส่งเบื้องหลัง (ตรงคำตอบ B ข้อ 3)
5. เทสต์ (P1-05/P1-06): offline → เข้า `/editor/new` → แก้ → refresh → ร่างยังอยู่; online → ได้งานเดียว; แก้ต่อหลัง freeze แล้วตัดเน็ตระหว่าง POST → refresh → online → งานเดียวที่มีการแก้ล่าสุด (เทียบ document จาก `GET /projects/:id`)

### R4 — ออกจาก Editor

`leaveEditor(reason)` ใช้ร่วมทุกทางออก (R5) ลำดับตายตัว:
1. **flush debounce ของ App**: App เปิด `flushPendingProject()` ที่ยกเลิก timer 300 ms (`App.tsx` ราวบรรทัด 2084/2169) แล้วเขียน state ล่าสุดเข้า `projects` ทันที
2. `generation = await cloud.onProjectChange(latest)` — ต้อง resolve (capture → `store.put` สำเร็จ); reject → สถานะ "capture ล้ม" (§3.2) **หยุด** ไม่ออกอัตโนมัติ (bridge ต้องคืน generation/throw แทนการกลืน error แบบ `.catch(() => {})` ปัจจุบัน)
3. อ่าน `queue.getStatus()` **หลัง** capture (แม้ก่อนกดจะเป็น `clean` การแก้ใน 300 ms ล่าสุดอาจเพิ่งเป็น generation ใหม่)
4. ไม่ synced → `await Promise.race([queue.flush(), timeout(3000)])` แล้วอ่าน status **อีกครั้ง**: synced เมื่อ `state === 'clean'` และ `savedGeneration ≥ generation` เท่านั้น (`ProjectSaveStatus` ไม่มีฟิลด์ inFlight — คำขอค้างคือ `saving`) — `flush()` resolve เฉย ๆ ไม่นับ เพราะ error ถูกเก็บใน status และอาจมี generation ใหม่ค้าง
5. ตัดสินตามตาราง §3.2 → `dispose()` (คงร่างใน IndexedDB) → navigate
- เทสต์ (P1-06/P1-11): แก้แล้วกดกลับภายใน 300 ms → เปิดงานเดิมได้ค่าใหม่; draft store ที่ `put` throw → ไม่ออก + ข้อความถูก; PUT ค้าง (harness หน่วง) แล้วแก้เพิ่มระหว่างส่ง → ออก → เปิดใหม่ → generation ล่าสุด resume และส่งต่อ

### R5 — Refresh / back / logout / เปลี่ยน workspace / token

| ทางออก | กลไก |
|---|---|
| ปุ่มในแอป, browser back/forward | router blocker (data router `useBlocker`) → `leaveEditor` → `proceed()`/`reset()` |
| logout | ปุ่ม logout เรียก `leaveEditor('logout')` ก่อน `signOut()`; capture ล้ม → ถามยืนยันก่อน signOut |
| เปลี่ยน workspace | `leaveEditor('workspace')` ก่อนเปลี่ยน context แล้วไป `/app/projects` ของ workspace ใหม่ |
| refresh/ปิดแท็บ | `beforeunload` เรียก `preventDefault()` **เฉพาะ** ตอนมีการแก้ที่ยังไม่ capture หรือ capture กำลังเขียน (ระหว่าง dialog ค้าง capture ทำงานจบ); `pagehide`/`visibilitychange: hidden` เรียก `flushPendingProject()` ทันที (best-effort: เริ่ม IndexedDB transaction ก่อนหน้าถูกเก็บ); ร่างที่ capture แล้วไม่เตือน เพราะอยู่ใน IndexedDB แล้ว |
| ข้อจำกัดที่บอกตรง ๆ | ถ้าผู้ใช้กด "ออก" ใน dialog ภายในไม่กี่ ms หลังแก้ การแก้ ≤ 300 ms ล่าสุดอาจหาย (เบราว์เซอร์ไม่รอ async) — บันทึกเป็นกรณีที่รู้ ไม่ใช่ PASS |

**token กับบัญชี:**
- `onAuthStateChange`: `TOKEN_REFRESHED`/`SIGNED_IN` ของ `user.id` **เดิม** = อัปเดต token อย่างเดียว ไม่ล้างร่าง/คิว/cache
- `SIGNED_OUT` หรือผู้ใช้เปลี่ยน = **context epoch +1**: abort ทุก `AbortController` ของ epoch เก่า, dispose queue/controller (ร่างคงอยู่), ล้าง query cache ของ appUserId เก่า, ไม่ render ข้อมูลเก่าระหว่าง loading
- token provider ผูก `appUserId`: คืน token เฉพาะเมื่อ session ปัจจุบันเป็นเจ้าของ scope นั้น ไม่ใช่ → ไม่ส่งคำขอ (queue/intent ของบัญชีเก่าจึง retry ด้วย token บัญชีใหม่ไม่ได้ แม้อีกบัญชีเป็น editor ใน team เดียวกัน)
- ผลที่กลับมาหลัง epoch เปลี่ยน → ทิ้งก่อนเขียน cache/state; ตอนนี้ `CloudWorkspace` key ด้วย `appUserId` แล้ว แต่ `tokenRef.current = props.accessToken` อัปเดตก่อน unmount ได้ — Phase 1 ต้องย้ายเป็น token provider ข้างบน
- เทสต์ (P1-06/P1-09): refresh ภายใน 300 ms (Playwright รับ dialog), back ภายใน 300 ms, logout ก่อน debounce, token refresh ของคนเดิมระหว่าง save (ไม่ล้างร่าง), เปลี่ยนเป็นบัญชี editor อื่นใน team เดียวกันขณะมีร่าง/intent ค้าง → ไม่มี request ของ scope เก่าถูกส่ง (ตรวจ network log)
