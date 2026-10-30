# ความคืบหน้าคน B

อัปเดต 31 ตุลาคม 2026: ส่งมอบ audit/contract และ matrix ฝั่ง B พร้อม fixtures แล้ว **Phase 0 ร่วมยังไม่ผ่าน และยังไม่เริ่ม implementation Phase 1** เพราะยังไม่มี route/UX artifact และผล review จาก A ตาม gate ที่ผู้ใช้ให้ยึด

## บริบทการทำงาน

- ผู้ทำ/AI session: Codex รับบท B ตามคำสั่งผู้ใช้
- Branch: codex/marketplace-b-phase-1
- Base commit ที่ตรวจ: fb55f36897aa47b235afdcf219c995a50a7c64e8
- Contract revision ที่เตรียมให้ A: **b-phase0-r1**
- หลัง fetch ตรวจ origin/main ยังเป็น fb55f36 และไม่พบ remote branch Marketplace หรือ artifact/review ใหม่ของ A ใน refs ที่เข้าถึงได้
- Peer progress ที่ได้รับจริง: PROGRESS-A.md ใน checkout และ origin/main ยังเป็นสถานะตั้งต้น TODO ไม่ถือว่านี่พิสูจน์ว่า A ยังไม่ได้ทำงานในเครื่องของตน
- ช่องทางส่ง review: branch codex/marketplace-b-phase-1 ให้ A รับ commit ของชุด b-phase0-r1 เข้าสู่ branch ของตนตาม workflow ทีม แล้วบันทึกผลใน PROGRESS-A.md การเผยแพร่เอกสารไม่ทำให้ 0-J1/0-J2 ผ่านอัตโนมัติ

## ผลงานที่รับผิดชอบ

| รหัส | สถานะ | หลักฐาน/สิ่งที่เหลือ |
|---|---|---|
| 0-B1 | DONE | [API contract](API-CONTRACT-PHASE-1.md): endpoints/DTO/errors/pagination/thumbnail/create-save-delete ตรวจจาก implementation; baseline tests ผ่าน |
| 0-B2 | DONE | [Permission matrix](PERMISSIONS-PHASE-1.md): owner/editor/viewer/outsider และ actor/workspace/draft boundaries; แยก source audit จาก SQL runtime |
| 0-B3 | READY_FOR_REVIEW | [Fixtures/environment](FIXTURES-PHASE-1.md), 31 synthetic scenarios และตัวตรวจ schema ผ่าน; real local Auth accounts/SQL ยัง NOT_RUN เพราะยังไม่มี PackIt local stack และพอร์ต 54322 เป็นของอีกโปรเจกต์ |
| 0-J1 ส่วน review ของ B | WAITING | B เสนอ b-phase0-r1 แล้ว รอ routes/UX และความเห็นของ A ต่อ pagination, save/exit, callback และ context |
| 0-J2 ส่วน review ของ B | WAITING | B ตรวจขอบเขต/เจ้าภาพ/acceptance P1-01..P1-12 ตามแผนแล้ว รอ A review artifact revision เดียวกันและเจ้าภาพไฟล์ร่วม |
| 1-B1 | WAITING | รอ Gate Phase 0; audit API เดิมพร้อมใช้ต่อ ไม่ได้สร้าง API ซ้ำ |
| 1-B2 | WAITING | รอ Gate Phase 0; unit baseline ของ save queue/validation ผ่าน แต่ real concurrency/DB ไม่ได้รัน |
| 1-B3 | WAITING | รอ route/callback จาก A และ Gate Phase 0 ก่อนแก้ config; preview integration รอ router build/environment อีกขั้น |
| 1-B4 | WAITING | มี baseline/test catalog แล้ว แต่ยังไม่ถือว่าผ่าน regression ของ implementation ที่ยังไม่ได้สร้างหรือ integration กับ A |

DONE ของ 0-B1/0-B2 หมายถึงงาน audit/เอกสารฝั่ง B ไม่ใช่การรับรอง live API/production หรือการผ่าน review ของ A

## Artifact ที่เตรียมให้ A

1. [API-CONTRACT-PHASE-1.md](API-CONTRACT-PHASE-1.md) — ใช้ API เดิมพร้อม field/error semantics และข้อเสนอที่รอ review
2. [PERMISSIONS-PHASE-1.md](PERMISSIONS-PHASE-1.md) — สิทธิ์จริงและขอบเขต session/workspace/cache
3. [FIXTURES-PHASE-1.md](FIXTURES-PHASE-1.md) — catalog, environment และวิธีตรวจซ้ำ
4. [fixtures/phase-1.json](fixtures/phase-1.json) — 31 scenarios, summaries แบบ 24+1, ภาพ JPEG/version เปลี่ยน, retry/conflict/auth errors
5. [fixtures/verify.mjs](fixtures/verify.mjs) — ตรวจจาก Zod schemas ปัจจุบัน ไม่เรียก network/Auth/DB
6. [evidence/B-PHASE-0.json](evidence/B-PHASE-0.json) — ผลตรวจที่ส่งต่อได้และ test file list

ไม่มี secrets หรือข้อมูลผู้ใช้จริงใน artifacts Fixture ใช้พัฒนา/test harness ไม่ใช่ Cloud login หรือการให้สิทธิ์จำลอง

## ข้อค้นพบที่ A ต้องใช้

- API ที่ต้องใช้มีอยู่แล้ว ไม่ต้องเพิ่ม summary endpoint จากผล audit นี้
- HTTP list limit 1–100, default 50; B เสนอ UI หน้าละ 24 โดยยังรอ A review
- Thumbnail request สูงสุด 24 IDs ไม่ซ้ำ ผลอาจขาดรายการที่ไม่มีภาพ ใช้ projectId จับคู่และมี placeholder
- ไม่มีสิทธิ์ workspace หรือ viewer เขียนตอบ 404 NOT_FOUND ไม่ใช่ 403 FORBIDDEN
- ไม่มี Authorization header ตอบ AUTH_REQUIRED; Bearer รูปแบบผิดตอบ SESSION_INVALID
- Cloud documentSchemaVersion เป็น 1 ต่างจาก schema ของไฟล์ .genpkg.json
- Retry ใช้ operationId และ payload เดิม ถ้าเปลี่ยน payload ภายใต้ key เดิมได้ IDEMPOTENCY_KEY_REUSED
- operationId scoped ต่อ actor/workspace ไม่ใช่ global authorization token อีกบัญชีที่เป็น editor ของทีมเดียวกันอาจมีสิทธิ์เขียน จึงห้าม replay คิวของบัญชีเก่าด้วย token บัญชีใหม่
- OAuth ฝั่ง browser ใช้ PKCE อยู่แล้ว รอ A ระบุ callback/return path ไม่ต้องย้าย auth protocol เพื่อแยก routes

## หลักฐานที่ตรวจจริง

| การตรวจ | ผล | ขอบเขต |
|---|---|---|
| Node runtime ที่เรียกทดสอบ | v24.10.0 | ใช้ Homebrew executable ระบุโดยตรง; shell default ยัง Node 22/npm 10 |
| TypeScript noEmit | PASS | โค้ด base ปัจจุบัน ไม่มี application changes ในรอบนี้ |
| Vitest selected baseline | PASS: 208 tests / 24 files, 0 failed, 0 skipped | server/http, project validation, Supabase adapters, client API/auth/project services; dependencies จำลองใน unit tests |
| Fixture verifier | PASS: 31 scenarios | Project schemas, cursor, retry equality, thumbnail version และ JPEG decode |
| pgTAP / real DB concurrency | NOT_RUN | เปิด Docker สำเร็จ แต่พอร์ต 54322 เป็นของ supabase_db_jasper; ไม่มี stack gen-package จึงไม่รันกับฐานข้อมูลนั้นหรือ remote DB |
| Real Auth/Storage | NOT_RUN | ยังไม่มี local environment ที่ยืนยันและบัญชี test จริงในรอบนี้ |
| Browser integration / cold-load check | NOT_RUN | รอ A และโค้ด router/Editor ที่ถึงเฟส |
| Preview OAuth/deep links | NOT_RUN | รอ callback contract/router และ environment ที่ตรวจร่วมได้ |
| Build ของ implementation ใหม่ | NOT_RUN | Phase 1 ยังไม่เริ่ม; typecheck baseline ไม่ใช่ build/integration acceptance |

คำสั่งที่รันจริงใช้ /opt/homebrew/opt/node@24/bin/node นำหน้า:

    node_modules/typescript/bin/tsc --noEmit
    node_modules/vitest/vitest.mjs run server/http server/modules/projects server/adapters/supabase src/services/api src/services/auth src/services/projects --reporter=json --outputFile=tmp/marketplace-b-phase0-tests.json
    docs/marketplace/fixtures/verify.mjs

Raw report ใน tmp อยู่เฉพาะเครื่อง B ใช้ evidence JSON ที่แนบแทนเมื่อส่งต่อ ผล unit tests ไม่ได้พิสูจน์จริงบน Auth/Postgres หรือผ่าน browser integration

## สิ่งที่รอและการเดินงานต่อ

| สิ่งที่ต้องรับ | เจ้าของ | เหตุผล/จุดที่ปลดล็อก |
|---|---|---|
| ROUTES-PHASE-1.md หรือ artifact เทียบเท่าของ 0-A1 พร้อม revision | A | ยืนยัน default route, /editor/new, callback และ safe return path ใน 0-J1 |
| UX states/save-exit/offline/conflict/logout ของ 0-A2 และ baseline 0-A3 | A | ตรงกันเรื่องสิ่งที่ UI ต้องรักษากับ receipt/error ของ server |
| Review b-phase0-r1 และ scope/ownership/acceptance ใน 0-J1/0-J2 | A แล้วทั้งคู่ตรวจร่วม | Gate เปิด implementation Phase 1; ไม่ทำเครื่องหมายผ่านแทนกัน |
| Router/browser build และ environment preview | A + B ใน Phase 1 | เกณฑ์ปิด integration ไม่ใช่เงื่อนไขเริ่มตรวจ API หลัง Gate Phase 0 ผ่าน |
| PackIt local Supabase ที่แยกจากโปรเจกต์อื่น | Environment ฝั่ง B | Docker พร้อมแล้ว แต่ default 54322 ถูกใช้โดยอีกโปรเจกต์ ต้องมี instance ที่ยืนยันเจ้าของก่อนรัน Auth/SQL/Storage; ไม่ใช่รายการรอ A |

งานอิสระของ B รอบนี้ได้ตรวจ API/สิทธิ์ เตรียม fixture และรัน baseline แล้ว เมื่อรับ route/UX artifact ให้เริ่ม review 0-J1/0-J2 ต่อ b-phase0-r1 ก่อน จากนั้นเดิน 1-B1/1-B2 และเตรียม 1-B3/1-B4 ตาม prerequisite

## ข้อความส่งให้ A review

อ่าน API-CONTRACT-PHASE-1.md, PERMISSIONS-PHASE-1.md และ FIXTURES-PHASE-1.md รุ่น b-phase0-r1 แล้วส่ง route/UX artifact ของ 0-A1..0-A3 พร้อม revision กลับมา โปรดยืนยัน/เสนอแก้ limit=24, /editor/new, default workspace, callback/return path, draft/save-exit behavior, เจ้าภาพ package/lockfile และ acceptance P1-01..P1-12 บันทึกผล review ใน PROGRESS-A.md ของตน เมื่อทั้งคู่ตรวจ artifact revision เดียวกันตรงแล้วจึงผ่าน 0-J1/0-J2
