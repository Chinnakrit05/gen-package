# ความคืบหน้าคน A

สถานะเริ่มต้น 30 ตุลาคม 2026: มีเอกสารแผนแล้ว ยังไม่ได้เริ่ม implementation ตามแผนนี้ คน A แก้ไฟล์นี้ คน B อ่านเพื่อรับส่งงาน

อัปเดตล่าสุด 3 พฤศจิกายน 2026: gate Phase 0 ผ่าน (B รับ `A0-r2` ใน `b-review-a0-r2-r1`, B `a14ad48`) → A implement 1-A1..1-A6 แล้ว **ตรวจด้วย fixture harness + unit tests เท่านั้น** — API/Auth จริง, OAuth และ preview ยังไม่ได้ตรวจ (รอ environment ร่วมกับ B) จึงยังไม่ใช่ DONE ของ acceptance

## บริบทการทำงาน

- ผู้ทำ/AI session: คน A ผ่าน Claude Code (Opus 5.5) บนเครื่อง Windows ของ A
- Branch และ base commit ที่ตรวจจริง: Phase 0 อยู่บน `main` (`d73a686` → `b6cb708`); Phase 1 ทำบน base `main` @ `a14ad48` (รวม B phase 1 แล้ว) และส่งเป็น branch `codex/marketplace-a-phase-1` — **ยังไม่ merge เข้า `main`** เพราะ `main` deploy อัตโนมัติ และ OAuth/API จริงของ router ใหม่ยังไม่ได้ตรวจบน preview
- Contract revision ที่ใช้: **`b-phase0-r1`** + `b-review-a0-r1-r1` + `b-review-a0-r2-r1` — ไม่มีการเปลี่ยน API/DTO/schema
- Peer progress/commit ที่ได้รับจาก B จริง: `PROGRESS-B.md` ที่ `a14ad48` — 0-J1/0-J2 DONE (ฝั่ง B), 1-B1..1-B4 มีผล local integration ของ B (`B-PHASE-1-RESULTS.md`), SPA rewrite ใน `vercel.json`

## งานที่รับผิดชอบ

| รหัส | สถานะ | หลักฐาน/สิ่งที่เหลือ |
|---|---|---|
| 0-A1 / 0-A2 / 0-A3 | DONE | `ROUTES-PHASE-1.md` `A0-r2`; B รับใน `REVIEW-A0-r2-B.md` |
| 0-J1 / 0-J2 | DONE | A รับ `b-phase0-r1` (§0 ของ `A0-r2`) และ B รับ `A0-r2` — หลักฐานสองฝ่ายต่อชุดเดียวกัน |
| 1-A1 | READY_FOR_REVIEW | `react-router` 7.18.4 (data router, `useBlocker`) + `@tanstack/react-query` 5.104.5 (exact pin, ติดตั้งด้วย npm 11; lockfile มีแต่บรรทัดเพิ่ม); routes `/`, `/login`, `/app/projects`, `/editor/new`, `/editor/:id`, `*` ใน `src/CloudRoot.tsx`; session/workspace context `src/app/cloudSession.ts` |
| 1-A2 | READY_FOR_REVIEW | ถอด preload ทั้ง `LocalDemoRoot` และ `CloudRoot`; หน้า lazy ด้วย `React.lazy` ใน element (route `lazy` ของ router โหลดก่อน guard — แก้แล้ว); CSS แยก `src/shell.css` (entry) / `src/app.css` (Editor chunk); ฟอนต์ออกแบบย้ายไป `src/editorFonts.ts` — ตัวเลขด้านล่าง |
| 1-A3 | READY_FOR_REVIEW | `src/app/ProjectsPage.tsx` + `projectList.ts` (merge/dedupe ตาม R1) — fixture PASS; API จริงยังไม่ได้ต่อ |
| 1-A4 | READY_FOR_REVIEW | `/editor/:id` เปิด id ตรง URL, 404/ไม่มีสิทธิ์ = หน้าแจ้ง (ไม่สร้าง/เปิดงานอื่น), id รูปแบบผิดไม่เรียก API; `/editor/new` = create intent (`src/services/drafts/createIntentStore.ts`, `src/services/projects/createIntent.ts`) — fixture PASS |
| 1-A5 | READY_FOR_REVIEW | `leaveEditor` (`src/app/leaveEditor.ts`) + blocker/modal (`src/app/EditorRoute.tsx`) + beforeunload/pagehide/unmount capture ใน `CloudWorkspace`; App เปิด `registerFlush`; local V1/V2 smoke ผ่าน; ลบงานที่เปิดอยู่ → กลับหน้ารายการ; งานถูกลบจากอีกแท็บ → หน้าแจ้ง |
| 1-A6 | READY_FOR_REVIEW | returnTo (`src/app/returnTo.ts`), token provider ผูก Supabase subject (`boundTokenProvider`), QueryClient/state ใหม่ต่อ appUserId, workspace จาก `/me` เท่านั้น — OAuth จริง/สองบัญชีในเบราว์เซอร์ยังไม่ได้ตรวจ |

### ข้อจำกัดที่รู้และงานที่ยังไม่ครบ (ไม่นับเป็น PASS)

- **viewer**: หน้ารายการปิดปุ่มสร้าง และ Editor ขึ้นแถบ "ดูได้อย่างเดียว" แต่ปุ่มแก้ใน Editor ยังกดได้ — การบันทึกได้ 404 จาก server (server ตัดสินถูก) แสดงเป็น "บันทึกไม่สำเร็จ"; UI read-only เต็มรูปแบบยังไม่ทำ (P1-08 ส่วน UI)
- แกลเลอรีใน header ของ Editor แสดงงานหน้าแรก ≤ 100 รายการ (เลิกวนโหลดทุกหน้า) — รายการเต็มอยู่ `/app/projects`
- สลับงานจากแกลเลอรีใน Editor = นำทางไป `/editor/:id` (mount ใหม่ตาม URL) แทนการสลับในที่เดิม
- ปิดแท็บ/กดยืนยันออกใน dialog ภายในไม่กี่ ms หลังแก้ อาจเสียการแก้ ≤ 300 ms ล่าสุด (ระบุไว้ใน `A0-r2` §7 R5) — กรณี refresh ปกติตรวจแล้วไม่หาย
- เปลี่ยน workspace ทำได้จากหน้ารายการเท่านั้น (Editor ไม่มีตัวเลือก)
- local-demo ยังไม่มีหน้ารายการ/route ใหม่ — แยกโหมดเดิม (path ไม่มีผลใน local)

## สิ่งที่ต้องรับจาก B

| สิ่งที่ต้องรับ | สถานะ | หลักฐานเมื่อได้รับ |
|---|---|---|
| API contract / permissions / fixtures | DONE | `b-phase0-r1` |
| Review `A0-r2` | DONE | `REVIEW-A0-r2-B.md` `b-review-a0-r2-r1` |
| SPA fallback ใน `vercel.json` | DONE (config) | B `a14ad48` + routing test 35 cases (A รันซ้ำ PASS) — preview จริงยังไม่ตรวจ |
| Preview ของ branch A พร้อม Supabase/OAuth ที่ทดสอบได้ | WAITING | เจ้าของ B (environment/remote config) — ใช้ปิด P1-10 และ OAuth return |
| API/Auth จริงสำหรับ browser integration (สองบัญชี, viewer, conflict) | WAITING | เจ้าของ B — local stack ของ B อยู่เครื่อง B; ต้องมี environment ที่ A เปิดได้ หรือ B รัน `scripts/marketplace/cloud-fixture.mjs` แบบชี้ API จริงในรอบถัดไป |

## หลักฐานตรวจรับ

Phase 1 (3 พ.ย. 2026) บน working tree ฐาน `main` @ `a14ad48`, Windows 11, Node 22.20 (`npm` 11 ผ่าน `npx npm@11` ตอนติดตั้ง), Chrome ผ่าน `playwright-core` — ผลดิบอยู่ใต้ `tmp/` (ignored)

- Typecheck/build: PASS — `npx tsc --noEmit`; `npm run build` (typecheck + vite + build:api; คืน `api/*.js` ที่ generate ด้วย `git checkout` ตามกติกาเดิม); build local-demo และ cloud fixture ตาม `ROUTES-PHASE-1.md` §6
- Unit tests: PASS — `npm test` 117 ไฟล์ผ่าน / 2 skip, **1,443 tests** ผ่าน / 6 skip; ใหม่: `src/app/returnTo.test.ts`, `projectList.test.ts` (ใช้ fixture page1/page2 ของ B), `leaveEditor.test.ts`, `cloudSession.test.ts`, `src/services/projects/createIntent.test.ts` (refresh ทุกช่วงของ R2, 409, ข้ามบัญชี, put ล้ม) + เคสใหม่ใน `durableProjectMutations.test.ts`
- Routing config ของ B: PASS — `npx vitest run server/entrypoints/deploymentRouting.test.ts` 35/35 บนเครื่อง A
- Cold load (`node scripts/marketplace/cold-load.mjs`): local login JS **1,683 → 202 KB**, CSS **147 → 29 KB**; cloud login **1,967 → 566 KB**; cloud `/editor/<uuid>` ไม่มี session **1,967 → 566 KB** (ไม่โหลด Editor); local เข้า Editor 1,789 KB (เท่าเดิม); `/app/projects` (fixture) JS ≈ **586 KB** ไม่มี App/Three/exporter
- Browser fixture harness (`node scripts/marketplace/cloud-fixture.mjs http://localhost:5192/`): **26/26 PASS** — P1-01, P1-02 (limit 24, ไม่วนหน้า, โหลดเพิ่มด้วย cursor), P1-03 (batch ≤ 24, placeholder), P1-04 (exact id, refresh, 404 ไม่สร้างแทน, id ผิดรูปแบบ), P1-05 (สร้างงานเดียว, refresh ไม่ซ้ำ, response หายแล้วส่งซ้ำด้วย operationId เดิม), P1-06 (back ในแอปภายใน debounce ส่ง PUT ค่าใหม่ก่อนออก; refresh ภายใน debounce ได้ค่าที่แก้และส่งต่อ), P1-09 (เปลี่ยน workspace ขณะคำขอค้างไม่ปน), P1-10 (ลิงก์ตรงตอนไม่ login → `/login?returnTo=`, `//host` ถูกทิ้ง) — **session ปลอม + API จำลองจาก fixture ของ B ไม่ใช่ cloud integration**
- Editor regression (local demo, `scripts/marketplace/editor-smoke.mjs`): PASS — แก้/undo/redo, V1↔V2 เอกสารเดิม, canvas 3D, ปุ่มส่งออก 5, refresh คงงาน, ไม่มี page error; ภาพหน้าจอ login/Editor/รายการ ตรวจด้วยตาแล้ว CSS ไม่เพี้ยน
- API integration/identity isolation จริง: NOT_RUN
- Preview deep-link/OAuth/API: NOT_RUN
- Cloud export ตามสิทธิ์ / viewer ใน browser / conflict ข้ามแท็บกับ server จริง: NOT_RUN

## ส่งต่องาน

**ส่ง B (3 พ.ย. 2026):** branch `codex/marketplace-a-phase-1` — ขอ preview deployment ของ branch นี้ที่ต่อ Supabase/API ทดสอบ แล้วตรวจร่วม:
1. P1-10: เปิด `/app/projects`, `/editor/<id>` ตรง + refresh, OAuth กลับ origin แล้วไปปลายทางเดิม, `/api/v1/*` ยังตอบ JSON
2. P1-08: owner/editor/viewer/outsider บน UI (viewer ได้ 404 ตอนบันทึก — ตาม contract)
3. P1-09: logout → login อีกบัญชีในแท็บเดียวกัน (A ตรวจได้แค่ unit `boundTokenProvider` + fixture workspace race)
4. P1-05/P1-06 กับ server จริง (idempotent create, CAS save)

**ข้อที่ B ควรรู้:**
- client เริ่มเรียก `GET /me` (เลือก workspace) และหน้ารายการเรียก `GET /projects?limit=24` + `POST /projects/thumbnails`; Editor เรียก `GET /projects?limit=100` หน้าเดียวสำหรับแกลเลอรี
- `executeDurableCreate` มี option `matchPendingPayload: false` สำหรับ create intent (งานใหม่สองงานที่ payload เหมือนกันต้องไม่ถูกรวม) — ไม่เปลี่ยน API
- ไม่มีการแก้ `server/`, `shared/`, `supabase/`, `vercel.json`, `src/core/` engine/schema/billing

**งานถัดไปของ A:** ปิดข้อจำกัด viewer read-only ใน Editor (P1-08 UI), ตรวจบน preview ร่วมกับ B, แล้วจึงเสนอ merge branch เข้า `main`
