# ความคืบหน้าคน A

สถานะเริ่มต้น 30 ตุลาคม 2026: มีเอกสารแผนแล้ว ยังไม่ได้เริ่ม implementation ตามแผนนี้ คน A แก้ไฟล์นี้ คน B อ่านเพื่อรับส่งงาน

อัปเดตล่าสุด 1 พฤศจิกายน 2026: A review artifact ของ B (`b-phase0-r1` + `b-review-a0-r1-r1`) แล้วรับทั้งชุด และส่ง `ROUTES-PHASE-1.md` revision `A0-r2` ตอบ R1–R5 — **Phase 1 ยังไม่เริ่ม** รอ B ตรวจ `A0-r2` เพื่อปิด 0-J1/0-J2 ร่วม

## บริบทการทำงาน

- ผู้ทำ/AI session: คน A ผ่าน Claude Code (Opus 5.5) บนเครื่อง Windows ของ A
- Branch และ base commit ที่ตรวจจริง: `main` — รอบ `A0-r1` @ `d73a686` (ฐานโค้ด `fb55f36`); รอบ `A0-r2` merge B branch `codex/marketplace-b-phase-1` @ `acac249` เข้า `main` (เอกสาร B ล้วน ไม่มีโค้ด) แล้ว commit/push ตามคำสั่งผู้ใช้ ไม่มี deploy — โค้ดแอป/server/shared ยังเท่ากับ `fb55f36`
- Contract revision ที่ใช้: **`b-phase0-r1`** (API contract / permissions / fixtures, B `2398c4d`) + review `b-review-a0-r1-r1` (B `acac249`) — A รับโดยไม่ขอแก้ (ผลตรวจใน `ROUTES-PHASE-1.md` §0)
- Peer progress/commit ที่ได้รับจาก B จริง: `PROGRESS-B.md` ที่ `acac249` — 0-B1/0-B2 DONE, 0-B3 READY_FOR_REVIEW, 0-J1 ของ B = CHANGES_REQUESTED (R1–R5), 0-J2 ของ B = B_REVIEWED

## งานที่รับผิดชอบ

| รหัส | สถานะ | หลักฐาน/สิ่งที่เหลือ |
|---|---|---|
| 0-A1 | READY_FOR_REVIEW | `A0-r2` §2 (แก้ §2.4 ตาม R2/R3) — B รับ routes/OAuth return/returnTo ใน `b-review-a0-r1-r1` แล้ว; เหลือ B ตรวจ R2/R3 ใน §7 |
| 0-A2 | READY_FOR_REVIEW | `A0-r2` §3 (แก้ §3.2 ตาม R4/R5: ตัดสินจาก status หลัง capture, capture ล้มห้ามออกอัตโนมัติ) — รอ B ตรวจ §7 R4/R5 |
| 0-A3 | READY_FOR_REVIEW | `A0-r2` §4 + §6 ไม่เปลี่ยนจาก `A0-r1`; B อ่านวิธีวัดแล้ว (ไม่ได้รันซ้ำ) ส่วน cloud save/export/viewer = NOT_RUN |
| 0-J1 ส่วน review ของ A | READY_FOR_REVIEW | A รับ `b-phase0-r1` ครบ (ตรวจข้ออ้างกับโค้ด 5 จุด + รัน fixture verifier เอง PASS 31) และรับคำตอบ 5 ข้อของ B; ตอบ R1–R5 ใน `A0-r2` §7 — รอ B ตรวจ R1–R5 แล้วปิดร่วม |
| 0-J2 ส่วน review ของ A | DONE (ฝั่ง A) | A ยืนยันชุด `b-phase0-r1` + `b-review-a0-r1-r1`: ขอบเขต, พฤติกรรมที่เปลี่ยน 3 ข้อ, เจ้าภาพไฟล์ (A: package/lockfile ฝั่งหน้าเว็บ, vite client build, `scripts/marketplace/*`; B: server/shared/DB/`vercel.json`) และผู้เก็บหลักฐาน P1-01..P1-12 ตามตารางของ B — ปิดร่วมเมื่อ B รับ `A0-r2` |
| 1-A1 | WAITING | gate Phase 1: B ต้องรับ `A0-r2` (R1–R5) ก่อน — ยังไม่ได้แก้โค้ด |
| 1-A2 | WAITING | gate เดียวกัน; ข้อมูลตั้งต้นพร้อม: preload ใน `CloudRoot`/`LocalDemoRoot` ข้าม lazy boundary, three อยู่ใน App.js |
| 1-A3 | WAITING | gate; page 24/cursor/batch ตกลงแล้ว (R1); `ProjectGallery` ใช้ในหน้าเบาไม่ได้ (113 KB ดึง `TEMPLATES`) ต้องทำการ์ดใหม่ |
| 1-A4 | WAITING | gate; create intent ตาม R2 (IndexedDB `packit-editor-intents`) |
| 1-A5 | WAITING | gate; `leaveEditor` ตาม R4 + offline new ตาม R3 |
| 1-A6 | WAITING | gate + preview routing/OAuth จาก B (1-B3); token provider/context epoch ตาม R5 |

## สิ่งที่ต้องรับจาก B

| สิ่งที่ต้องรับ | สถานะ | หลักฐานเมื่อได้รับ |
|---|---|---|
| API contract และตัวอย่าง response/error | DONE | `API-CONTRACT-PHASE-1.md` `b-phase0-r1` (B `2398c4d`) — A รับแล้ว |
| สิทธิ์ owner/editor/viewer และข้อมูลทดสอบ | DONE (เอกสาร/fixture) | `PERMISSIONS-PHASE-1.md` + `FIXTURES-PHASE-1.md` + `fixtures/phase-1.json` 31 scenarios — A รัน verifier PASS; บัญชี/ฐานข้อมูลจริงยัง NOT_RUN ฝั่ง B (ไม่มี PackIt local stack) |
| ผลตรวจ create/save/retry/revision | WAITING | B มี unit baseline (208 tests) + fixture retry/conflict; real DB concurrency NOT_RUN — เจ้าของ B (1-B2 หลัง gate) |
| Preview routing/OAuth ที่พร้อมทดสอบ | WAITING | ยังไม่มี — เจ้าของ B (1-B3: SPA fallback ใน `vercel.json` ที่ไม่ครอบ `/api/*`, allowlist ถ้าเลือก `/auth/callback`) |
| Review `ROUTES-PHASE-1.md` revision `A0-r1` | DONE | `REVIEW-A0-r1-B.md` `b-review-a0-r1-r1` (B `acac249`): CHANGES_REQUESTED R1–R5 |
| Review `ROUTES-PHASE-1.md` revision `A0-r2` (คำตอบ R1–R5 §7) | WAITING | เจ้าของ B — ผ่านแล้ว gate Phase 1 เปิด |

WAITING ในตารางนี้ไม่ห้ามทำงานสำรวจ/เอกสารของ A ที่เป็นอิสระ ให้เลือกงานตาม dependency ใน PHASE-0-1.md

## หลักฐานตรวจรับ

ทั้งหมดรันบน `main` @ `fb55f36` (working tree มีแค่ไฟล์เอกสาร/สคริปต์วัดของ A), Windows 11, Node 24, Chrome ในเครื่อง ผ่าน `playwright-core` — ผลลัพธ์ดิบอยู่ใต้ `tmp/` (ignored ไม่ขึ้น Git)

- Typecheck/build: ผ่าน — `npx tsc --noEmit` ไม่มี error; `npx vite build --mode local-demo --manifest` และ build cloud fixture (คำสั่งใน `ROUTES-PHASE-1.md` §6) สำเร็จ
- Tests ที่เกี่ยวข้อง: ผ่าน — `npm test`: 111 ไฟล์ผ่าน / 2 skip, 1,379 tests ผ่าน / 6 skip (รอบ `A0-r1`)
- Fixture ของ B: ผ่าน — `node docs/marketplace/fixtures/verify.mjs` บนเครื่อง A (1 พ.ย., Windows, Node 24): `PASS: 31 synthetic scenarios`; ไม่เรียก Auth/DB/network
- Cold-load network/dependency inspection: ผ่าน (เป็น baseline) — `node scripts/marketplace/cold-load.mjs http://localhost:5191/ http://localhost:5192/`: หน้า login local โหลด JS 1,683 KB (รวม App.js 1,448 KB), cloud fixture 1,967 KB, deep link `/editor/<uuid>` ได้หน้า login (path ถูกทิ้ง); `node scripts/marketplace/import-closure.mjs` — ตัวเลขเต็มใน §4
- API integration/identity isolation: NOT_RUN — ไม่มี cloud environment/fixture จาก B; cloud fixture ใช้ URL/คีย์ปลอม จึงไม่ใช่หลักฐาน integration
- V1/V2, draft recovery, 3D/export, local demo: ผ่านบางส่วน — `node scripts/marketplace/editor-smoke.mjs http://localhost:5191/` (local demo): แก้/undo/redo, V1↔V2 เอกสารเดิม, canvas 3D, ปุ่มส่งออก 5 รายการ, refresh แล้วงานคงอยู่, ไม่มี page error; draft recovery บน cloud และ export ตามสิทธิ์ = NOT_RUN
- Preview deep-link/OAuth/API: NOT_RUN — ยังไม่มี preview ที่มี SPA fallback (1-B3)

แต่ละผลต้องระบุ command/scenario, commit, environment, ผลจริง และตำแหน่งหลักฐาน โดยไม่มี secrets หรือข้อมูลผู้ใช้จริง

## ส่งต่องาน

**ส่ง B (1 พ.ย. 2026, `A0-r2`):** ตรวจ `docs/marketplace/ROUTES-PHASE-1.md` §7 (คำตอบ R1–R5) และ §0 (ผล review ของ A ต่อ `b-phase0-r1`) — ส่วนอื่นที่แก้คือ §2.4/§3.2 ให้ตรง §7; §4/§6 ไม่เปลี่ยน
- R1: infinite query หน้าละ 24, dedupe ด้วย projectId, reset หน้าแรกเมื่อกลับจาก Editor/mutation/sync/รีเฟรช ไม่โหลดทุกหน้าชดเชย
- R2: create intent ใน IndexedDB `packit-editor-intents` ผูก mode/appUserId/workspaceId/history entry เก็บ payload ที่ตรึง + operationId + result จนกว่า replace URL เสร็จ
- R3: `/editor/new` ออฟไลน์ capture ลง intent; ตรึง payload ตอนออนไลน์; การแก้หลังตรึงย้ายเข้า save queue ของ id จริงเป็น PUT ก่อนลบ intent
- R4: `leaveEditor` = flush debounce → await capture (ล้ม = ไม่ออก) → อ่าน status ใหม่ → flush ≤ 3 วิ → อ่านซ้ำ; synced = `clean` + `savedGeneration ≥ generation`
- R5: blocker ครอบ back/forward, logout, เปลี่ยน workspace; beforeunload เฉพาะตอนยังไม่ capture; token provider ผูก appUserId + context epoch; ระบุข้อจำกัด ≤ 300 ms เมื่อผู้ใช้บังคับปิดตรง ๆ

**ข้อที่ B ควรรู้จากการสำรวจ:**
- `vercel.json` ไม่มี SPA fallback → `/app/*`, `/editor/*` บน preview จะ 404 จนกว่า 1-B3 เสร็จ
- client ไม่เคยเรียก `GET /me` — Phase 1 A จะเริ่มใช้เพื่อเลือก workspace
- `createFromEditor` dehydrate รูปก่อน POST → สร้างงานที่มีรูปต้องออนไลน์ (เหตุผลของ R3)
- Git Bash แปลง env ที่ขึ้นต้น `/` (เช่น `VITE_API_BASE_URL=/api/v1`) เป็น path Windows — build ต้องตั้ง `MSYS_NO_PATHCONV=1`

**งานถัดไปของ A เมื่อ B รับ `A0-r2`:** 1-A1 (router/query/shell + returnTo) → 1-A2 (ถอด preload, lazy Editor) → 1-A3/1-A4 → 1-A5 → 1-A6 ตาม PHASE-0-1.md; ถ้า B ขอแก้อีก ให้ขึ้น `A0-r3` แล้ว review ซ้ำก่อน
