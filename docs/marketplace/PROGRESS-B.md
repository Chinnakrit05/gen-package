# ความคืบหน้าคน B

## เฟส 2 วันที่ 7 พฤศจิกายน 2026

เริ่มบน branch `codex/marketplace-phase-2` จาก `main` ที่ `b1562f7` เพิ่ม migration `20261107001000_marketplace_suppliers.sql`, สัญญา `shared/contracts/marketplace.ts` และ API สำหรับสมัครผู้รับผลิต อ่านและแก้โปรไฟล์ ส่งตรวจ และจัดการสถานะโดยเจ้าหน้าที่ สร้างพื้นที่ทีมและบทบาท Marketplace `manager` ในธุรกรรมเดียวกับฉบับร่าง การส่งซ้ำด้วย operation ID เดิมใช้กิจการเดิม ส่วนการแก้และการตรวจใช้ revision ป้องกันทับข้อมูลฉบับใหม่

API ตรวจบทบาท Marketplace ควบคู่กับสมาชิกพื้นที่ทำงาน เจ้าหน้าที่ใช้สิทธิ์ `supplier_reviewer` แยกจากบทบาทในทีมและต้องมี session ที่ผ่าน TOTP โปรไฟล์สาธารณะอ่านได้เมื่ออนุมัติแล้วโดยส่งเฉพาะข้อมูลสำหรับเผยแพร่ การเปลี่ยนสถานะบันทึกประวัติและรายการรอแจ้งเตือนในธุรกรรมเดียวกัน เมื่อแก้ข้อมูลที่เผยแพร่แล้ว โปรไฟล์กลับเป็นฉบับร่างเพื่อส่งตรวจใหม่

API ผู้รับผลิตเปิดเมื่อ runtime ตั้ง `VITE_MARKETPLACE_SUPPLIERS_ENABLED=true` ตัวแปรเดียวกันใช้ตอน build หน้าเว็บ ก่อนเปิดบน staging ต้องตรวจและลง migration `20261107001000` และเตรียมบัญชีเจ้าหน้าที่ทดสอบที่มี TOTP จากนั้นจึงตั้งตัวแปรและ deploy สำหรับตรวจรับ

- pgTAP ผ่าน 426 ข้อจาก 10 ไฟล์ รวม 67 ข้อใหม่ ใช้ Supabase local ที่แยกพอร์ต API 55421 และ DB 55422 คำสั่ง `supabase test db --local --workdir tmp/marketplace-phase2-local` ชุด integration เดิมผ่าน 25 เทสต์จาก 8 ไฟล์บน instance เดียวกัน
- `node scripts/marketplace/suppliers-local.mjs tmp/marketplace-phase2-local` ผ่านบน Auth, HTTP และ PostgreSQL จริงในเครื่อง ตรวจสมัครพร้อมกันและส่งซ้ำ การถอนสมาชิก การกันสิทธิ์เจ้าหน้าที่ที่ยังไม่ยืนยัน TOTP การปฏิเสธ revision เก่า การเผยแพร่และพักโปรไฟล์ และ audit/outbox ใช้บัญชีสังเคราะห์และเปิด TOTP เฉพาะ config ของ instance ทดสอบ
- ส่วนที่เหลือของเฟส 2 คือการเชิญและจัดการสมาชิกในหน้าเว็บ เอกสารประกอบการตรวจที่เก็บแยกจากไฟล์ Editor และการส่งแจ้งเตือนจาก outbox การทดสอบออนไลน์รอ migration และบัญชีเจ้าหน้าที่ทดสอบสำหรับ environment ที่ได้รับอนุญาต

## เฟส 1

อัปเดต 5 พฤศจิกายน 2026 — รับโค้ด router/Editor ของ A ที่รวมบน `main` แล้ว ตรวจร่วมบน branch `codex/marketplace-phase-1-integration` ฐาน `a85de8b` ใช้สัญญา `b-phase0-r1` ต่อ ดู [ผลตรวจร่วม A/B](B-PHASE-1-RESULTS.md#ตรวจรับร่วม-ab-5-พฤศจิกายน-2026)

| งาน | ผลรอบนี้ |
|---|---|
| 1-B1 / 1-B2 | ตรวจ API และฐานข้อมูลจริงในเครื่องซ้ำ ผ่านรายการแบบแบ่งหน้า สิทธิ์ตาม workspace, create/save retry และ revision conflict |
| 1-B3 | ผ่าน `P1-10` บน Preview ของ `66a3fb2` เชื่อม Supabase staging, Google callback กลับ Editor ของงานเดิมและรีเฟรชได้ ตรวจ API health และคำขอ list/detail/bootstrap จาก deployment เดียวกัน |
| 1-B4 | ตรวจสิทธิ์ร่วมกับ browser ฝั่ง A ด้วยบัญชี owner/editor/viewer/outsider ใน Supabase แยก รวมชุดทดสอบ Cloud regression และขั้นตอนรันซ้ำ |

ลง migration `20261024000800_project_thumbnails.sql` ใน Supabase staging วันที่ 6 พฤศจิกายน 2026 แล้ว ตรวจพบ API บันทึกและดึงภาพตอบ `200` รูปของงานทดสอบอยู่ในฐานและแสดงบนหน้ารวมงานหลังรีเฟรช `P1-03` ผ่านสำหรับการบันทึกและอ่านภาพบน staging ส่วนการตรวจสิทธิ์แยกบทบาทของ `P1-08` ใช้หลักฐานจากชุด integration ในเครื่อง [ผลตรวจภาพย่อ](B-PHASE-1-RESULTS.md#ตรวจภาพย่อบน-staging-6-พฤศจิกายน-2026)

ผลและสถานะด้านล่างเป็นประวัติการส่งงานวันที่ 2 พฤศจิกายน ก่อนรับ router ของ A

## บริบทการทำงาน

- ผู้ทำ/AI session: Codex รับบท B ตามคำสั่งผู้ใช้
- Branch: codex/marketplace-b-phase-1
- Base commit ของ contract Phase 0: fb55f36897aa47b235afdcf219c995a50a7c64e8; ฐานทดสอบ Phase 1: b6cb70876f396381a06c04f547011504eca9457b พร้อม working-tree changes ตาม evidence/B-PHASE-1.json
- Contract revision ที่เตรียมให้ A: **b-phase0-r1**
- รอบตรวจ Git และ review ต่อเนื่องคืน 31 ตุลาคม–1 พฤศจิกายน 2026 ด้วย fetch --prune และ ls-remote: origin/main = d73a68605a1a1bed6c67cd4b7a6abe9be3584a7c ส่วน origin/codex/marketplace-b-phase-1 = 2398c4d พบเพียงสอง branches นี้
- ตรวจ PR ทุกสถานะผ่าน GitHub CLI: ไม่มี open PR; งาน A ส่งตรง main เป็น commit d73a686 ไม่ได้อยู่ใน PR
- Peer progress ล่าสุดที่ได้รับจริง: PROGRESS-A.md / ROUTES-PHASE-1.md รุ่น A0-r2 ที่ main b6cb708; A merge B acac249 แล้วรับ contract/permissions/fixtures และ ownership/acceptance ชุดเดียวกัน มีผลตรวจของ A ใน §0/§7 และ B ใน REVIEW-A0-r2-B.md ไม่แก้ PROGRESS-A แทน A
- Source ล่าสุดที่ดึง: main b6cb708 และ B remote acac249 ณรอบ fetch วันที่ 2 พฤศจิกายน; checkout B fast-forward ถึง b6cb708 โดยไม่มี conflict ผู้ใช้สั่ง commit/push ชุดผล review และงาน Phase 1 ฝั่ง B ในรอบนี้ ตรวจรุ่นส่งมอบจาก Git history ของไฟล์

## ผลงานที่รับผิดชอบ

| รหัส | สถานะ | หลักฐาน/สิ่งที่เหลือ |
|---|---|---|
| 0-B1 | DONE | [API contract](API-CONTRACT-PHASE-1.md): endpoints/DTO/errors/pagination/thumbnail/create-save-delete ตรวจจาก implementation; baseline tests ผ่าน |
| 0-B2 | DONE | [Permission matrix](PERMISSIONS-PHASE-1.md): owner/editor/viewer/outsider และ actor/workspace/draft boundaries; แยก source audit จาก SQL runtime |
| 0-B3 | DONE (local/fixtures) | A review/รัน verifier PASS 31 แล้ว; B เตรียม instance packit-marketplace-b แยกพอร์ตและรัน real local Auth/SQL/Storage ผ่าน ไม่ใช่ staging หรือบัญชี browser ที่ค้างไว้ |
| 0-J1 | DONE | A0-r2 รับ b-phase0-r1 และตอบ R1–R5; B รับผลหลังแก้ใน REVIEW-A0-r2-B.md รุ่น b-review-a0-r2-r1 |
| 0-J2 | DONE | A0-r2 / PROGRESS-A รับ scope/ownership/acceptance ตาม B review แล้ว B ยืนยันชุดเดียวกันใน REVIEW-A0-r2-B.md |
| 1-B1 | API_VERIFIED (local) | HTTP จริงตรวจ bootstrap/me/list 24+1/detail/create/thumbs และ summary ไม่มี document/assets ผ่าน ไม่เพิ่ม API/DTO; รอ A เชื่อม UI |
| 1-B2 | SERVER_VERIFIED (local) | Real HTTP/RPC ตรวจ retry/payload reuse/CAS/ถอน membership/editor delete ผ่าน; actor ที่มีสิทธิ์อีกคนยังใช้ operationId เดียวกันเป็น operation ของตนได้ รอ A กัน replay ข้ามบัญชีที่ client |
| 1-B3 | PARTIAL | vercel.json + path matrix 35 cases + official route compiler ผ่าน และ build สองโหมดผ่าน; รอ A router/login-return และ preview OAuth/deep-link/API จริง |
| 1-B4 | PARTIAL | Unit 252/27 files, integration 25/8 files, pgTAP 359/9 files, typecheck/build ผ่าน; ส่งผล/วิธีรันใน B-PHASE-1-RESULTS.md ยังไม่ปิด browser/joint acceptance |

DONE ของ 0-B1/0-B2 หมายถึงงาน audit/เอกสารฝั่ง B ไม่ใช่การรับรอง live API/production หรือการผ่าน review ของ A

## Artifact ที่เตรียมให้ A

1. [API-CONTRACT-PHASE-1.md](API-CONTRACT-PHASE-1.md) — ใช้ API เดิมพร้อม field/error semantics และข้อเสนอที่รอ review
2. [PERMISSIONS-PHASE-1.md](PERMISSIONS-PHASE-1.md) — สิทธิ์จริงและขอบเขต session/workspace/cache
3. [FIXTURES-PHASE-1.md](FIXTURES-PHASE-1.md) — catalog, environment และวิธีตรวจซ้ำ
4. [fixtures/phase-1.json](fixtures/phase-1.json) — 31 scenarios, summaries แบบ 24+1, ภาพ JPEG/version เปลี่ยน, retry/conflict/auth errors
5. [fixtures/verify.mjs](fixtures/verify.mjs) — ตรวจจาก Zod schemas ปัจจุบัน ไม่เรียก network/Auth/DB
6. [evidence/B-PHASE-0.json](evidence/B-PHASE-0.json) — ผลตรวจที่ส่งต่อได้และ test file list
7. [REVIEW-A0-r1-B.md](REVIEW-A0-r1-B.md) — คำตอบและข้อแก้ไขจาก source review ต่อ A0-r1 ไม่ใช่ implementation หรือผล integration
8. [REVIEW-A0-r2-B.md](REVIEW-A0-r2-B.md) — B รับผลหลังแก้และปิด Gate Phase 0
9. [B-PHASE-1-RESULTS.md](B-PHASE-1-RESULTS.md) และ [evidence/B-PHASE-1.json](evidence/B-PHASE-1.json) — ผล Phase 1 ที่รันจริงและข้อจำกัด

ไม่มี secrets หรือข้อมูลผู้ใช้จริงใน artifacts Fixture ใช้พัฒนา/test harness ไม่ใช่ Cloud login หรือการให้สิทธิ์จำลอง

## ข้อค้นพบที่ A ต้องใช้

- API ที่ต้องใช้มีอยู่แล้ว ไม่ต้องเพิ่ม summary endpoint จากผล audit นี้
- HTTP list limit 1–100, default 50; A0-r2 รับ UI หน้าละ 24 และ cursor ไม่ใช่ snapshot แล้ว ไม่เปลี่ยน API
- Thumbnail request สูงสุด 24 IDs ไม่ซ้ำ ผลอาจขาดรายการที่ไม่มีภาพ ใช้ projectId จับคู่และมี placeholder
- ไม่มีสิทธิ์ workspace หรือ viewer เขียนตอบ 404 NOT_FOUND ไม่ใช่ 403 FORBIDDEN
- ไม่มี Authorization header ตอบ AUTH_REQUIRED; Bearer รูปแบบผิดตอบ SESSION_INVALID
- Cloud documentSchemaVersion เป็น 1 ต่างจาก schema ของไฟล์ .genpkg.json
- Retry ใช้ operationId และ payload เดิม ถ้าเปลี่ยน payload ภายใต้ key เดิมได้ IDEMPOTENCY_KEY_REUSED
- operationId scoped ต่อ actor/workspace ไม่ใช่ global authorization token อีกบัญชีที่เป็น editor ของทีมเดียวกันอาจมีสิทธิ์เขียน จึงห้าม replay คิวของบัญชีเก่าด้วย token บัญชีใหม่
- OAuth กลับ origin เดิมและ safe returnTo ใน sessionStorage ตาม A0-r2 ที่ทั้งคู่รับแล้ว ไม่เพิ่ม /auth/callback หรือเปลี่ยน provider settings; browser/preview ยังต้องตรวจใน Phase 1

## หลักฐาน Phase 0 (31 ตุลาคม–1 พฤศจิกายน; เก็บประวัติ)

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

รอบ review A0-r1 (1 พฤศจิกายน): รัน fixture verifier ซ้ำ **PASS 31 synthetic scenarios** และ git diff --check ผ่าน; ตรวจ diff fb55f36..d73a686 แล้วไม่มีการแก้ src/server/shared/supabase/vercel/package/vite config ผล typecheck/Vitest 208 tests ข้างบนเป็น baseline รอบก่อน ไม่ได้รันซ้ำในงานเอกสารนี้ ไม่มีผล Auth/DB/browser/preview ใหม่

การเผยแพร่: ผู้ใช้สั่ง commit/push เฉพาะ REVIEW-A0-r1-B.md กับ PROGRESS-B.md บน branch codex/marketplace-b-phase-1 เพื่อให้ A รับไปแก้และยืนยันกลับมา ไม่รวมการ merge เข้า main, deploy หรือเปลี่ยน remote configuration; ตรวจ commit และสถานะการส่งจริงจาก Git

## หลักฐาน Phase 1 ล่าสุด (2 พฤศจิกายน)

- Gate: [A0-r2 review](REVIEW-A0-r2-B.md) — A/B รับชุดเดียวกันแล้ว ไม่ถือว่า acceptance ของ implementation ผ่านจากการรับเอกสาร
- Real local stack: project packit-marketplace-b, API 55321 / DB 55322, PostgreSQL 17.6, migrations 9 ไฟล์ แยกจาก Jasper; fixture cleanup เหลือ app_users/projects/auth.users = 0 แล้วหยุดเฉพาะ instance นี้โดยเก็บ local data ไว้ ไม่มี remote mutation/deploy
- Unit **252 tests / 27 files**, integration **25 tests / 8 files** (รวม Editor HTTP API ใหม่ 6 tests), pgTAP **359 assertions / 9 files**, ไม่ fail/skip
- Typecheck, build:local และ cloud fixture build ผ่าน; fixture verifier **31 scenarios** ผ่าน ค่า Cloud fixture เป็นค่าปลอม ไม่ใช่ live Cloud login
- Config: Vercel routing-utils 6.6.1 transform ได้ ไม่มี validation error; test matrix 35 cases ไม่ใช่ผลจาก CDN/preview จริง
- Browser router ใหม่, cold-load หลังแยก Editor และ preview OAuth/deep links = NOT_RUN รอ A/environment
- รอบนี้ไม่แก้ source API/DTO/migrations หรือ frontend; build regenerate API snapshots เพื่อทดสอบแล้วเก็บสำเนาใต้ tmp และคืน tracked snapshots ที่ build เปลี่ยนเองให้ตรงฐาน ไม่มีงานค้างเดิมในสองไฟล์นั้น
- Commands/ขอบเขต/ไฟล์ source hashes อยู่ [ผลตรวจ](B-PHASE-1-RESULTS.md) และ [evidence](evidence/B-PHASE-1.json) การเผยแพร่รอบนี้ได้รับคำสั่ง commit/push บน branch codex/marketplace-b-phase-1 ไม่รวมการ merge เข้า main หรือเปลี่ยน remote configuration

## สิ่งที่รอ ณ 2 พฤศจิกายน

| สิ่งที่ต้องรับ | เจ้าของ | เหตุผล/จุดที่ปลดล็อก |
|---|---|---|
| คำตอบ R1–R5 / review contract / scope-ownership-acceptance | A ส่งแล้ว main b6cb708; B รับแล้ว | ปิด 0-J1/0-J2 ไม่รอรายการนี้อีก |
| Router/gallery/Editor intent-draft-token lifecycle และ browser evidence 1-A1..1-A6 | A | ปิด client/server integration, P1-01..P1-09/P1-11/P1-12 ตามเจ้าภาพ |
| Router/browser build และ environment preview | A + B ใน Phase 1 | เกณฑ์ปิด integration ไม่ใช่เงื่อนไขเริ่มตรวจ API หลัง Gate Phase 0 ผ่าน |
| Preview OAuth/deep links/API content type | Environment + A/B | ยังไม่ deploy หรือเปลี่ยน remote config ในรอบนี้ ต้องมี URL/commit ของ router + config ที่ตรวจจริง |
| Local environment ของ A สำหรับ browser roles | A/B ประสานเมื่อเชื่อม UI | Instance B เป็น local ข้ามเครื่องไม่ได้ บัญชีใน integration เป็นชั่วคราวและ cleanup แล้ว ไม่แจก credentials หรือเรียก fixture ว่า live login |

งานอิสระ Phase 1 ของ B ที่ทำได้ในเครื่องผ่านตามหลักฐานแล้ว ไม่ทำ router/client แทน A และไม่เริ่ม Phase 2 งานถัดไปคือรับ frontend commit ของ A แล้วตรวจ integration/preview ของชุดเดียวกันเพื่อปิด 1-B3/1-B4 และ acceptance ที่ยัง pending

## ข้อความส่งให้ A review

B รับ A0-r2 และปิด 0-J1/0-J2 ใน REVIEW-A0-r2-B.md แล้ว เมื่อได้รับชุดเอกสารใหม่นี้ให้ A เริ่ม 1-A1/1-A2 และงานตาม dependency ได้ ใช้ contract b-phase0-r1 เดิม อ่าน B-PHASE-1-RESULTS.md สำหรับ API/config/tests ที่พร้อมและข้อจำกัด แล้วส่ง frontend commit/browser evidence กลับมาเพื่อตรวจร่วม ไม่ถือว่า browser/preview ผ่านจากผล local B
