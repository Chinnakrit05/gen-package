# ความคืบหน้าคน A

สถานะเริ่มต้น 30 ตุลาคม 2026: มีเอกสารแผนแล้ว ยังไม่ได้เริ่ม implementation ตามแผนนี้ คน A แก้ไฟล์นี้ คน B อ่านเพื่อรับส่งงาน

อัปเดตล่าสุด 31 ตุลาคม 2026: Phase 0 ส่วนของ A ส่ง review แล้ว (`ROUTES-PHASE-1.md` revision `A0-r1`) — **Phase 1 ยังไม่เริ่ม** เพราะ 0-J1/0-J2 ยังไม่มีหลักฐาน review จาก B

## บริบทการทำงาน

- ผู้ทำ/AI session: คน A ผ่าน Claude Code (Opus 5.5) บนเครื่อง Windows ของ A
- Branch และ base commit ที่ตรวจจริง: `main` @ `fb55f36` (โค้ดแอปเท่ากับ `2d7aee9`) — งานรอบนี้ commit/push เข้า `main` ตามคำสั่งผู้ใช้ (31 ต.ค. 2026; ไม่มี deploy): `docs/marketplace/ROUTES-PHASE-1.md`, `docs/marketplace/PROGRESS-A.md`, `scripts/marketplace/*` — ไม่มีไฟล์โค้ดแอปเปลี่ยน
- Contract revision ที่ใช้: ยังไม่ยืนยัน — A อ่าน `shared/contracts/*` ของ `fb55f36` เป็นฐานข้อเสนอ แต่ B ยังไม่ออก revision ของ 0-B1
- Peer progress/commit ที่ได้รับจาก B จริง: ไม่มี — `PROGRESS-B.md` ที่ `fb55f36` ยังเป็น TODO ทุกข้อ

## งานที่รับผิดชอบ

| รหัส | สถานะ | หลักฐาน/สิ่งที่เหลือ |
|---|---|---|
| 0-A1 | READY_FOR_REVIEW | `ROUTES-PHASE-1.md` §2: ตาราง routes, ลำดับหลัง login (returnTo ใน sessionStorage + `redirectTo=origin` ไม่ต้องแก้ allowlist), กติกา returnTo, `/editor/new` + operationId ต่อ history entry — รอ B review |
| 0-A2 | READY_FOR_REVIEW | `ROUTES-PHASE-1.md` §3: สถานะหน้า (loading/empty/error/offline/session หมดอายุ/ไม่มีสิทธิ์/ถูกลบ/viewer) + ตารางออกจาก Editor ตาม `ProjectSaveState` จริง 6 สถานะ — รอ B review |
| 0-A3 | READY_FOR_REVIEW | `ROUTES-PHASE-1.md` §4 + §6: chunk graph จาก manifest, import closure, cold-load 4 สถานการณ์, smoke Editor ผ่าน; ส่วน cloud save/export/viewer = NOT_RUN (ไม่มี environment) |
| 0-J1 ส่วน review ของ A | WAITING | รอ B: API contract + ตัวอย่าง response/error (0-B1) และคำตอบ 5 ข้อใน `ROUTES-PHASE-1.md` §5.1 — ข้อเสนอฝั่ง A เขียนไว้แล้ว (page 24, cursor, thumbnail batch, operationId, expectedRevision/409) |
| 0-J2 ส่วน review ของ A | WAITING | รอ B: permission matrix (0-B2), fixture/environment (0-B3) และความเห็นต่อการแบ่งไฟล์ร่วม (`package.json`/lockfile) + ผู้เก็บหลักฐาน P1-01..P1-12 ใน §5.2 |
| 1-A1 | WAITING | gate Phase 1 (0-J1/0-J2 ยังไม่มี review ของ B) — ยังไม่ได้แก้โค้ด |
| 1-A2 | WAITING | gate เดียวกัน; ข้อมูลตั้งต้นพร้อม: preload ใน `CloudRoot`/`LocalDemoRoot` ข้าม lazy boundary, three อยู่ใน App.js |
| 1-A3 | WAITING | gate + คำตอบ page size/cursor จาก B; `ProjectGallery` ใช้ในหน้าเบาไม่ได้ (113 KB ดึง `TEMPLATES`) ต้องทำการ์ดใหม่ |
| 1-A4 | WAITING | gate + ยืนยัน idempotency create (0-B1/1-B2) และรหัส 404/403 |
| 1-A5 | WAITING | gate; ช่องว่างที่ต้องแก้: debounce 300 ms ก่อน capture ตอนออก, auto-create/open-latest เดิม |
| 1-A6 | WAITING | gate + preview routing/OAuth จาก B (1-B3) |

## สิ่งที่ต้องรับจาก B

| สิ่งที่ต้องรับ | สถานะ | หลักฐานเมื่อได้รับ |
|---|---|---|
| API contract และตัวอย่าง response/error | WAITING | ยังไม่มีผล review ของ B — เจ้าของ B (0-B1); A ทำต่อได้: ข้อเสนอ §5.1 |
| สิทธิ์ owner/editor/viewer และข้อมูลทดสอบ | WAITING | ยังไม่มี — เจ้าของ B (0-B2/0-B3); A ใช้ตาราง UI ใน §3.1 เป็นร่างไปก่อน |
| ผลตรวจ create/save/retry/revision | WAITING | ยังไม่มี — เจ้าของ B; A ยืนยันจากโค้ดเดิมแล้วว่า client ใช้ operationId/expectedRevision อยู่ |
| Preview routing/OAuth ที่พร้อมทดสอบ | WAITING | ยังไม่มี — เจ้าของ B (1-B3: SPA fallback ใน `vercel.json` ที่ไม่ครอบ `/api/*`, allowlist ถ้าเลือก `/auth/callback`) |
| Review `ROUTES-PHASE-1.md` revision `A0-r1` | WAITING | เจ้าของ B — บันทึกผลใน PROGRESS-B พร้อมอ้าง revision |

WAITING ในตารางนี้ไม่ห้ามทำงานสำรวจ/เอกสารของ A ที่เป็นอิสระ ให้เลือกงานตาม dependency ใน PHASE-0-1.md

## หลักฐานตรวจรับ

ทั้งหมดรันบน `main` @ `fb55f36` (working tree มีแค่ไฟล์เอกสาร/สคริปต์วัดของ A), Windows 11, Node 24, Chrome ในเครื่อง ผ่าน `playwright-core` — ผลลัพธ์ดิบอยู่ใต้ `tmp/` (ignored ไม่ขึ้น Git)

- Typecheck/build: ผ่าน — `npx tsc --noEmit` ไม่มี error; `npx vite build --mode local-demo --manifest` และ build cloud fixture (คำสั่งใน `ROUTES-PHASE-1.md` §6) สำเร็จ
- Tests ที่เกี่ยวข้อง: ผ่าน — `npm test`: 111 ไฟล์ผ่าน / 2 skip, 1,379 tests ผ่าน / 6 skip
- Cold-load network/dependency inspection: ผ่าน (เป็น baseline) — `node scripts/marketplace/cold-load.mjs http://localhost:5191/ http://localhost:5192/`: หน้า login local โหลด JS 1,683 KB (รวม App.js 1,448 KB), cloud fixture 1,967 KB, deep link `/editor/<uuid>` ได้หน้า login (path ถูกทิ้ง); `node scripts/marketplace/import-closure.mjs` — ตัวเลขเต็มใน §4
- API integration/identity isolation: NOT_RUN — ไม่มี cloud environment/fixture จาก B; cloud fixture ใช้ URL/คีย์ปลอม จึงไม่ใช่หลักฐาน integration
- V1/V2, draft recovery, 3D/export, local demo: ผ่านบางส่วน — `node scripts/marketplace/editor-smoke.mjs http://localhost:5191/` (local demo): แก้/undo/redo, V1↔V2 เอกสารเดิม, canvas 3D, ปุ่มส่งออก 5 รายการ, refresh แล้วงานคงอยู่, ไม่มี page error; draft recovery บน cloud และ export ตามสิทธิ์ = NOT_RUN
- Preview deep-link/OAuth/API: NOT_RUN — ยังไม่มี preview ที่มี SPA fallback (1-B3)

แต่ละผลต้องระบุ command/scenario, commit, environment, ผลจริง และตำแหน่งหลักฐาน โดยไม่มี secrets หรือข้อมูลผู้ใช้จริง

## ส่งต่องาน

**ส่ง B (31 ต.ค. 2026):** review `docs/marketplace/ROUTES-PHASE-1.md` revision `A0-r1` — โดยเฉพาะ §5.1 (ประเด็นเปิด 5 ข้อ: 404/403 ของ `GET /projects/:id`, kind/label ของงานที่ไม่มีภาพย่อ, ส่ง draft ค้างเบื้องหลัง, SPA fallback, รูปแบบ OAuth return) และ §5.2 (ไฟล์ร่วม `package.json`/lockfile ที่ A ขอแก้, พฤติกรรมเดิมที่ A เสนอเปลี่ยน 3 ข้อ, ผู้เก็บหลักฐาน P1-01..P1-12)

**ข้อที่ B ควรรู้จากการสำรวจ:**
- `vercel.json` ไม่มี SPA fallback → `/app/*`, `/editor/*` บน preview จะ 404 จนกว่า 1-B3 เสร็จ
- allowlist OAuth local มีแค่ origin ตรง ๆ; ข้อเสนอ A ไม่ต้องแก้ allowlist ใน Phase 1
- client ไม่เคยเรียก `GET /me` — Phase 1 A จะเริ่มใช้เพื่อเลือก workspace
- `PROJECT_NOT_FOUND` ตอนนี้ครอบทั้งไม่มีงานและไม่มีสิทธิ์ — A เสนอให้คงไว้
- Git Bash แปลง env ที่ขึ้นต้น `/` (เช่น `VITE_API_BASE_URL=/api/v1`) เป็น path Windows — build ต้องตั้ง `MSYS_NO_PATHCONV=1`

**งานถัดไปของ A เมื่อ gate ผ่าน:** 1-A1 (router/query/shell + returnTo) → 1-A2 (ถอด preload, lazy Editor) → 1-A3/1-A4 → 1-A5 → 1-A6 ตาม PHASE-0-1.md; ถ้า B ขอแก้ข้อเสนอ ให้ขึ้น `A0-r2` แล้ว review ซ้ำก่อน
