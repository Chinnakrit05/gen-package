# ข้อมูลตัวอย่างและสภาพแวดล้อมสำหรับ A และ B

รุ่น **b-phase0-r1** เป็นผลส่งมอบ 0-B3 ใช้ร่วมกับ [API contract](API-CONTRACT-PHASE-1.md) และ [permission matrix](PERMISSIONS-PHASE-1.md) เพื่อพัฒนาหน้ารายการ/Editor ระหว่างเตรียม integration

## ชุดข้อมูล

[fixtures/phase-1.json](fixtures/phase-1.json) มี 31 scenarios แยกจากกัน ใช้ UUID สังเคราะห์ทั้งหมด ไม่มี token, password, service key หรือข้อมูลผู้ใช้จริง ไม่ใช่ DB seed หรือระบบ login จำลองของ Cloud

| กลุ่ม | Cases / การใช้งาน |
|---|---|
| เริ่ม session | bootstrap.owner — personal workspace |
| บัญชี/สมาชิก | me.owner, me.editor, me.viewer, me.outsider |
| รายการงาน | projects.page1 จำนวน 24, projects.page2 จำนวน 1, projects.empty |
| งาน | projects.detail, projects.create, projects.create-retry |
| บันทึก/ลบ | projects.save, projects.save-retry, projects.delete |
| ภาพ | thumbnails.batch, thumbnails.empty, thumbnails.put |
| ภาพเปลี่ยน version | projects.page-thumbnail-updated, thumbnails.batch-new-version — ใช้ตรวจ invalidation ของ cache ภาพเก่า |
| Session errors | errors.no-auth, errors.session-invalid, errors.invalid-bearer, errors.user-inactive |
| สิทธิ์/งานหาย | errors.project-not-found, errors.outsider-project, errors.outsider-workspace, errors.viewer-write |
| ขัดแย้ง/ข้อมูลผิด | errors.revision-conflict, errors.idempotency-reused, errors.invalid-query |
| บริการไม่พร้อม | errors.dependency-unavailable |

แต่ละ case มี request, status และ response ที่ใช้ envelope จริง เมื่อใช้แทน fetch ให้คืน response ทั้ง object แต่ถ้าใช้แทน API client ที่ unwrap data แล้วให้ใช้ response.data อย่า unwrap ซ้ำ

Case เป็นภาพสถานการณ์แยกกัน ไม่ใช่ฐานข้อมูลที่เปลี่ยนตามลำดับ เช่น projects.delete ไม่ได้ลบรายการจาก case page1 อัตโนมัติ การทดสอบ stateful/concurrency ต้องใช้ API/ฐานข้อมูลจริง

## ตัวละครและขอบเขต

- Owner มี personal workspace และเป็น owner ของ team workspace
- Editor และ Viewer มี personal workspace ของตน และเป็นสมาชิก team เดียวกับ Owner
- Outsider มีพื้นที่ของตน ไม่มีสมาชิกใน team
- Inactive เป็นตัวอย่างบัญชีไม่ active สำหรับ error scenario
- 25 project summaries อยู่ใน team เรียงเวลาแบบ descending; cursor ของ page1 อ้างรายการสุดท้ายที่แสดง
- ภาพ JPEG 1×1 pixel เป็นภาพจริงสำหรับตรวจการ decode และ placeholder/cache ไม่ใช่ภาพตัวอย่างผลิต
- me.viewer ต้องใช้ role viewer เฉพาะใน team; personal workspace ของบุคคลนั้นยังเป็น owner ไม่ควรตีความว่าเป็น viewer ทุกพื้นที่
- fields identities/memberships เป็นคำอธิบาย fixture เท่านั้น ห้ามส่งเป็นคำสั่งให้ API ยอมรับ actor หรือเปลี่ยน role

## วิธีใช้ของ A

1. ใช้ใน test harness หรือโหมดพัฒนาที่ระบุชัดว่าเป็น fixture; คง local-demo กับ Cloud แยกกัน
2. ตรวจ loading/empty/error/ไม่มีภาพด้วย case ที่เกี่ยวข้อง และตรวจว่า limit/cursor กับ batch ตรง contract
3. จำลอง slow response/abort และ network failure ใน harness ของ A เพิ่มเอง NETWORK_ERROR ไม่ใช่ response HTTP ใน JSON ชุดนี้
4. ตรวจ 409 โดยคงร่างไว้ และใช้ currentRevision เพื่อแสดงสถานะ ไม่เขียนทับเอกสารของ server
5. เชื่อม API จริงทันทีเมื่อ prerequisite พร้อม และบันทึกผล fixture กับผล integration คนละรายการ

ตรวจ schema ของ fixture แบบไม่ใช้ฐานข้อมูลได้จาก root:

    node docs/marketplace/fixtures/verify.mjs

ใช้ Node 24 และ dependencies ของ repository ตัวตรวจใช้ Zod schemas ปัจจุบัน, cursor decoder, retry payload/receipt และ decoder ภาพจริง ไม่ mint session หรือเรียก network/auth/database

## สภาพแวดล้อมและหลักฐานในรอบ B นี้

| ส่วน | ผลที่ตรวจจริง | สิ่งที่ยังขาด |
|---|---|---|
| Checkout | base fb55f36; branch codex/marketplace-b-phase-1 | A ต้องระบุ branch/artifact revision ที่ใช้ review |
| Runtime | เรียก Node v24.10.0 จาก Homebrew แบบระบุ executable | shell เริ่มต้นยังเป็น Node 22.18.0/npm 10.9.3; ก่อนรัน npm scripts ให้เลือก Node 24/npm 11 ตาม README |
| Typecheck | PASS | ไม่ใช่หลักฐาน browser หรือ Cloud |
| API/client baseline | 208 tests ผ่านใน 24 files | Dependencies ใน unit tests เป็น doubles; ไม่ใช่ real Auth/Postgres |
| Fixtures | 31 scenarios ผ่านการตรวจรูปแบบและรูปภาพ | ไม่ใช่บัญชีที่ login ใช้งาน Cloud ได้ |
| Docker/local Supabase | เปิด Docker ได้แล้ว แต่ไม่มี stack ของ gen-package; 54322 เป็นของ Supabase อีกโปรเจกต์ | ไม่เริ่ม stack ชนพอร์ต ไม่รัน SQL กับฐานข้อมูลนั้น; real Auth/SQL/Storage ยัง NOT_RUN |
| Browser/routes | NOT_RUN | รอ routes/UX และการรวมงานของ A |
| OAuth/preview | NOT_RUN | รอ callback contract และ environment ที่ตรวจร่วมได้ |

ผลสรุปที่นำไปส่งต่อได้อยู่ใน [evidence/B-PHASE-0.json](evidence/B-PHASE-0.json) ส่วน raw Vitest report อยู่ใน tmp/marketplace-b-phase0-tests.json ของเครื่อง B ไม่ใช่ไฟล์ที่เพื่อนจะได้จาก Git

## คำสั่งตรวจ baseline

หลังเลือก Node 24 ให้ตรวจรุ่นก่อน แล้วใช้ dependencies ที่ติดตั้งตาม README:

    node --version
    npm --version
    node node_modules/typescript/bin/tsc --noEmit
    node node_modules/vitest/vitest.mjs run server/http server/modules/projects server/adapters/supabase src/services/api src/services/auth src/services/projects
    node docs/marketplace/fixtures/verify.mjs

ในเครื่อง B รอบนี้ใช้ executable /opt/homebrew/opt/node@24/bin/node เรียก tsc/Vitest โดยตรง จึงไม่ใช้ Node 22 ของ shell และไม่ได้ติดตั้งหรือเปลี่ยน global runtime

## เมื่อตรวจ Real Auth และฐานข้อมูลได้

ใช้ [backend setup](../backend-setup.md) และ environment local/test ที่ทีมเตรียมไว้ การเปิด Docker/local stack ไม่ทำให้ผลเก่ากลายเป็น PASS ต้องรันและบันทึกผลใหม่

เครื่อง B เปิด Docker สำเร็จแล้ว แต่ตรวจพบ supabase_db_jasper จองพอร์ต 54322 และไม่พบ containers ของ gen-package จึงยังไม่เรียกชุด integration ที่ default ไปพอร์ตนี้ ต้องเตรียม instance ของ PackIt ที่แยกชัดเจนก่อน ไม่หยุด/รีเซ็ตฐานข้อมูลของอีกโปรเจกต์เพื่อให้ทดสอบผ่าน

- ใช้ Supabase CLI local stack ที่มี migrations ปัจจุบัน ตรวจปลายทางให้เป็น local/test ก่อนสร้าง fixture
- owner/editor/viewer/outsider ต้องเป็น app users และมี workspace membership จริง การมี UUID ใน JSON นี้ไม่ได้สร้างสมาชิก
- ใช้ SQL tests 0002/0003/0004/0008 สำหรับกติกาสมาชิก โครงการ ไฟล์ และภาพย่อ
- ชุด integration bootstrap/projects concurrency ใช้ผู้ใช้ชั่วคราวและ cleanup; อ่านปลายทาง PACKIT_TEST_DATABASE_URL ก่อนรัน อย่าใช้กับข้อมูลผู้ใช้จริง
- tests/integration/session.bootstrap.test.ts ตรวจ real Auth; projects.concurrent.test.ts ตรวจ create dedupe/CAS save; assets.lifecycle.test.ts ตรวจ Storage ตาม config ที่คู่มือตั้งไว้
- การรัน db:reset เป็นการล้าง local database ไม่ใช่ prerequisite ที่ต้องรันทุกครั้ง ถ้ามีงาน local ของทีมอยู่ให้ใช้ instance ทดสอบแยกแทน
- ไม่คัดลอก credentials ลงไฟล์นี้ ไม่เปลี่ยน provider หรือ remote schema เพื่อทำให้ baseline ผ่าน

## สิ่งที่ต้องให้ A ตอบกลับ

ส่ง artifact revision ของ route map และ UX states พร้อม review b-phase0-r1 ใน 0-J1/0-J2 โดยตอบว่า:

1. รับข้อเสนอ limit=24, cursor/batch/cache semantics หรือมีข้อเปลี่ยนใด
2. เลือก default workspace, /editor/new และ callback/return path อย่างไร
3. กรณี offline/pending/conflict/logout จะรักษาร่างและบอกผู้ใช้อย่างไร
4. ใครเป็นผู้แก้ package/lockfile และ config ที่ร่วมกันใช้
5. ยืนยันเจ้าภาพหลักฐาน P1-01..P1-12 ตามแผน หรือเสนอการปรับที่ต้อง review

เมื่อยังไม่มีผล review ของ A ให้ทำเครื่องหมาย WAITING ของงานร่วม และไม่แก้ PROGRESS-A.md แทน
