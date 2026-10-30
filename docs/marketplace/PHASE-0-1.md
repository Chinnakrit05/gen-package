# Checklist Phase 0–1: แยก Editor และวางโครงเว็บ PackIt

สถานะเริ่มต้น: **แผนงาน — ยังไม่เริ่ม implementation และยังไม่มีรายการใดผ่าน acceptance** เอกสารนี้ไม่ใช่รายงานผลทดสอบ การบันทึกแผนไม่ได้สร้าง routes, API, ตาราง หรือสิทธิ์ใหม่

อ่านร่วมกับ [แผนรวม](PLAN.md), [งานคน A](HANDOFF-A.md), [งานคน B](HANDOFF-B.md), [ความคืบหน้าคน A](PROGRESS-A.md) และ [ความคืบหน้าคน B](PROGRESS-B.md) รวมถึง [README ของโครงการ](../../README.md) และ [ข้อกำหนดการพัฒนา](../../CLAUDE.md)

คน A รับผิดชอบ frontend, router, Editor และพฤติกรรมในเบราว์เซอร์ คน B รับผิดชอบ API, session, authorization, ข้อมูลทดสอบ และการตั้งค่าเส้นทางฝั่ง deployment การเปลี่ยน shared contracts ต้องตรวจร่วมกันก่อนนำไปใช้ทั้งสองฝั่ง

กรอบเวลาเริ่มต้นสำหรับสองคนทำงานเต็มเวลา: **Phase 0 ประมาณ 2–3 วันทำงาน; Phase 1 ประมาณ 5–8 วันทำงานของทีม** งาน A/B ทำคู่ขนานกัน ตัวเลขนี้เป็นประมาณการ ต้องปรับจากสิ่งที่พบจริง โดยเฉพาะการแยก Editor และการเชื่อม environment

## ขอบเขตและสิ่งที่มีอยู่แล้ว

Phase 0 ตกลง routes, รูปแบบข้อมูล, สิทธิ์, สถานะหน้า และเกณฑ์ตรวจงาน Phase 1 ทำให้ login → รายการงาน → Editor → กลับรายการ ใช้ระบบเดิมได้อย่างถูกต้อง โดยหน้าเบาไม่โหลดเครื่องมือออกแบบตามมาด้วย

- ใช้ React, TypeScript, Vite และ backend/Supabase เดิม เพิ่ม router และ query cache ตามแผนเมื่อเริ่ม implementation
- คง Editor V1/V2, แบบงาน, ระบบบันทึก/กู้ draft, billing/export authorization และพฤติกรรม cloud/local-demo เดิม
- แยกทางเข้า Editor ก่อน โดยครอบโค้ดเดิมไว้ ไม่ย้ายหรือเขียนเครื่องมือออกแบบทั้งหมดใหม่
- Phase 1 ไม่เพิ่ม schema/migrations ของ supplier, RFQ, quotation, chat, production order หรือ Admin และไม่สร้างฟีเจอร์เหล่านั้นก่อนกำหนด หน้าเมนูหรือ placeholder ต้องไม่ถูกนับเป็นฟีเจอร์เสร็จ
- Phase 0 บันทึกกติกา marketplace สำหรับระยะต่อไป: หนึ่งคำขอเลือกหนึ่งโรงงานใน MVP; สเปกและข้อเสนอมี revision; ผู้ซื้อเลือกแล้วรอโรงงานยืนยัน; การจ่ายเงินเกิดนอก PackIt; สิทธิ์งานผลิตแยกจากสิทธิ์แก้แบบ
- Figma เป็นแหล่งอ้างอิงแบบอ่านอย่างเดียว ห้ามแก้ Figma
- เอกสารนี้ไม่ได้ให้อำนาจ commit, push, deploy, เปลี่ยน remote configuration หรือรัน migration อัตโนมัติ งานเหล่านั้นต้องอยู่ในคำสั่งที่ได้รับสำหรับรอบ implementation นั้น

API ต่อไปนี้มีในโครงการแล้ว ให้ตรวจและใช้ต่อก่อนเสนอ endpoint ใหม่:

| API เดิม | ใช้ใน Phase 1 | สิ่งที่ต้องยืนยัน |
| --- | --- | --- |
| POST /api/v1/session/bootstrap | เริ่ม session และพื้นที่ส่วนตัว | เรียกซ้ำได้อย่างถูกต้อง ไม่โหลดเอกสารงาน |
| GET /api/v1/me | บัญชีและ workspaces ที่เป็นสมาชิก | บริบทที่เลือกต้องอยู่ในสิทธิ์จริง |
| GET /api/v1/projects?workspaceId=…&cursor=…&limit=… | หน้ารายการงาน | ProjectSummary, nextCursor, การตรวจ workspace |
| GET /api/v1/projects/:id | เปิดงานใน Editor | เปิด ID ตาม URL และตรวจสิทธิ์ฝั่ง server |
| POST /api/v1/projects | สร้างงานจาก Editor | operationId, workspace, รูปแบบ document และ receipt ตาม contract เดิม |
| POST /api/v1/projects/thumbnails | ขอภาพย่อเป็นชุด | ใช้ workspaceId/projectIds และ batch ไม่เกิน 24 ตาม contract ปัจจุบัน |
| PUT /api/v1/projects/:id/thumbnail | บันทึกภาพย่อที่ Editor สร้าง | สิทธิ์และ version ของภาพยังสอดคล้องกับงาน |

การบันทึกและลบงานให้ใช้ endpoint/receipt เดิมที่ B ตรวจใน 0-B1 อย่าเปลี่ยนวิธี retry หรือ revision เพียงเพื่อให้ router ใหม่เรียกง่ายขึ้น

ข้อเท็จจริงตั้งต้นที่ต้องตรวจซ้ำกับ checkout เมื่อเริ่มทำ:

- [CloudRoot](../../src/CloudRoot.tsx) เรียก preload พื้นที่ Editor ตั้งแต่ root mount
- [CloudWorkspace](../../src/features/projects/CloudWorkspace.tsx) import App โดยตรง และ refreshItems วนดึงรายการทุกหน้าจนครบ
- [main.tsx](../../src/main.tsx) import CSS และฟอนต์ของงานออกแบบจาก entry point; การ import CSS ฟอนต์ไม่ได้แปลว่าไฟล์ฟอนต์ทุกตัวถูกดาวน์โหลดแล้ว ต้องวัดเส้นทางโหลดจริง
- [ProjectSummary](../../shared/contracts/projects.ts) มีข้อมูลรายการและ thumbnail metadata อยู่แล้ว ไม่ได้ส่ง document/history/assets ทั้งก้อน
- [vercel.json](../../vercel.json) มี rewrite ของ API แต่ยังต้องวาง SPA fallback สำหรับ routes ใหม่
- OAuth เดิมกลับ root; ต้องรักษาเส้นทางปลายทางหลัง login โดยไม่เปิดให้ redirect ออกนอกเว็บ

## Phase 0 — ปิดข้อตกลงก่อนเชื่อมระบบ

### คน A

#### 0-A1 — Routes และ navigation รวมการสร้างงานใหม่

- [ ] ระบุ routes ของ Phase 1: login/callback, /app/projects, /editor/new, /editor/:projectId และสถานะ not-found/access denied
- [ ] ระบุหน้าเริ่มต้นหลัง login, การกลับหน้าที่เปิดก่อน login, back/forward และปุ่มกลับจาก Editor
- [ ] ตกลงว่า /editor/:projectId เปิดงานนั้นเท่านั้น ไม่เปิดงานล่าสุดหรือสร้างงานใหม่แทนเมื่อ ID ผิด/ไม่มีสิทธิ์
- [ ] วาง /editor/new ให้โหลดเครื่องมือสร้างเอกสารภายใน Editor ก่อน แล้วใช้ API เดิมสร้างงานและเปลี่ยน URL เป็น ID จริง; หน้ารายการไม่ import freshProject/template engine เพื่อสร้างงานเอง
- [ ] ระบุวิธีให้ cloud กับ local-demo ใช้บริบทข้อมูลแยกกัน และวิธีแยก ID ในแต่ละโหมด
- [ ] เตรียมข้อเสนอ routes/layout/lazy boundaries ใน ROUTES-PHASE-1.md เมื่อเริ่มงานนี้

**ส่งมอบ:** แผนเส้นทางและ flow ที่ B อ่านแล้วระบุ session/data ที่ต้องใช้ได้ เอกสาร ROUTES-PHASE-1.md เป็น artifact ที่วางแผนให้ A สร้างภายหลัง ไม่ใช่ไฟล์ที่มีผลตรวจแล้วในตอนบันทึก checklist นี้

#### 0-A2 — สถานะ UI, ข้อผิดพลาด และการออกจากงานที่ยังบันทึกไม่เสร็จ

- [ ] ระบุหน้าตาของ loading, รายการว่าง, ไม่มีภาพย่อ, offline, retry, session หมดอายุ, ไม่มีสิทธิ์ และงานถูกลบ
- [ ] ระบุการออกจาก Editor ในสถานะ clean, saving, ค้างส่งเพราะ offline และ revision conflict
- [ ] ตกลงว่าเมื่อใดถือว่าบันทึกลง local draft แล้ว เมื่อใด server ยืนยัน และ UI ต้องแสดงสถานะใด ห้ามแสดงว่า cloud บันทึกสำเร็จจากการเก็บ draft เพียงอย่างเดียว
- [ ] ระบุการกู้ draft เมื่อกลับเข้า, refresh, browser back, เปลี่ยน workspace และ logout/login ใหม่ โดยไม่ล้างข้อมูลงานเงียบ ๆ
- [ ] ระบุปุ่มที่ viewer ใช้ได้และข้อความเมื่อเขียนไม่ได้ ให้ตรง permission contract ของ B

**ส่งมอบ:** ตารางสถานะ → สิ่งที่ผู้ใช้เห็น → การกระทำถัดไป → ข้อมูลที่ต้องรักษา รวมอยู่ใน artifact ของ A

#### 0-A3 — Dependency map ของ Editor และ baseline regression

- [ ] ทำแผนเส้นทาง imports จาก main/CloudRoot/CloudWorkspace ไป App, core, 3D, exporter, rasterizer, CSS และฟอนต์
- [ ] ระบุส่วนที่จะอยู่ใน lightweight shell กับส่วนที่ต้องโหลดเฉพาะ Editor รวม preload ที่ข้าม lazy boundary
- [ ] เก็บ baseline ที่ตรวจได้ของ V1/V2, ชิ้นงาน/undo, เปิดงานเดิม, save/recovery, 2D/3D และ export ตามสิทธิ์เดิม
- [ ] ตรวจว่ารายการงานและภาพย่อใช้ module ที่ไม่ดึง Editor runtime ตามมา
- [ ] บันทึกวิธีวัด cold load/build dependency และ network requests โดยยังไม่ตั้งเป้าความเร็วเป็นวินาทีหรือขนาด bundle ที่ไม่มี baseline รองรับ

**ส่งมอบ:** รายการ dependency ที่ต้องแยกและ baseline พร้อมวิธีทำซ้ำ ผลใดที่ยังไม่ได้รันให้ระบุ pending

### คน B

#### 0-B1 — ตรวจ API เดิมและรูปแบบข้อมูล

- [ ] ตรวจ session/bootstrap, me, project list/detail/create/save/delete และ thumbnails จาก implementation จริง
- [ ] ระบุ method/path, request/response, actor/workspace, pagination, operationId, expectedRevision และ error codes ที่ frontend ต้องจัดการ
- [ ] ยืนยัน ProjectSummary ไม่รวมเอกสารหรือ assets ทั้งงาน และภาพย่อใช้ metadata/version กับ batch request เดิม
- [ ] แยกสิ่งที่ใช้ต่อได้ ช่องว่างที่จำเป็นต้องแก้ใน Phase 1 และความสามารถที่จะทำระยะถัดไป
- [ ] เตรียม API-CONTRACT-PHASE-1.md เมื่อเริ่มงานนี้ พร้อมตัวอย่างข้อมูลที่ไม่ใช่ข้อมูลส่วนตัวหรือ secret

**ส่งมอบ:** contract ที่ตรวจเทียบโค้ดแล้ว ไม่ออกแบบ API ซ้ำกับของเดิม API-CONTRACT-PHASE-1.md เป็น artifact ที่วางแผนให้ B สร้างภายหลัง

#### 0-B2 — Permission matrix ของ workspace

- [ ] ระบุสิทธิ์ owner/editor/viewer สำหรับ list, read, create, save, delete, thumbnail และการเข้าถึงไฟล์ที่เกี่ยวข้อง
- [ ] ระบุกรณีไม่ล็อกอิน, session หมดอายุ, ผู้ใช้ถูกระงับ, ไม่มีสมาชิก workspace และงานที่ไม่พบ พร้อมผลตาม error contract
- [ ] ระบุว่าการเลือก workspace ใน client ไม่ใช่หลักฐานสิทธิ์ server ต้องตรวจ membership ของ actor ทุกคำขอที่เกี่ยวข้อง
- [ ] กำหนดขอบเขต cache/draft/request ตามบัญชี โหมด และ workspace เพื่อไม่ให้ข้อมูลไหลข้ามกัน
- [ ] บันทึกสิทธิ์ธุรกิจที่จะเพิ่มภายหลังแยกจาก editor/viewer เช่น ส่งใบเสนอราคา ยืนยันคำสั่งผลิต และรับรองการรับเงิน; Phase 1 ยังไม่เพิ่ม role หรือ schema สำหรับสิ่งเหล่านี้
- [ ] ระบุแนวทาง Admin สำหรับระยะถัดไปโดยไม่เปิดสิทธิ์ข้ามองค์กรจาก frontend flag หรือข้อมูลที่ผู้ใช้แก้เองได้

**ส่งมอบ:** matrix ที่ A ใช้แสดงปุ่มและ B ใช้ทดสอบ API ได้ โดยการซ่อนปุ่มไม่ถูกนับเป็นการบังคับสิทธิ์

#### 0-B3 — Fixtures และ environment ทดสอบ

- [ ] เตรียมข้อมูลทดสอบ owner, editor, viewer, คนนอก workspace และงานในคนละ workspace โดยไม่ใช้ข้อมูลผู้ใช้จริง
- [ ] เตรียมงานหลายหน้า, ภาพย่อที่ไม่มี/ต่าง version, งานถูกลบ และ revision conflict
- [ ] ระบุวิธีรัน local-demo สำหรับ frontend และ environment ที่แยกไว้สำหรับ cloud integration; ไม่แจกหรือบันทึก secret ลงเอกสาร
- [ ] ระบุคำสั่งทดสอบและเงื่อนไขที่ต้องมี เช่น local Supabase/Docker เฉพาะชุด database tests ตาม README
- [ ] ส่งตัวอย่าง responses ที่ตรง contract ให้ A ใช้ทำงานได้ระหว่างที่ API/environment ยังไม่พร้อม

**ส่งมอบ:** fixture catalog และวิธีเข้าถึง environment ที่ไม่เปิดเผย credentials พร้อมแยกว่า fixture, local API และ cloud integration คือหลักฐานคนละระดับ

### ทำร่วมกัน

#### 0-J1 — ตกลงสัญญาข้อมูล, pagination และ save

- [ ] A/B review routes กับ API contract ให้ครบหนึ่งรอบการใช้งานตั้งแต่ login ถึงกลับรายการ
- [ ] ตกลงขนาด page ที่ UI ขอ, วิธีใช้ nextCursor, thumbnail batch/cache/version และ fallback เมื่อไม่มีภาพ
- [ ] ตกลง operationId, การสร้างงานสำเร็จแล้วเปลี่ยน URL, retry ที่ไม่สร้างซ้ำ, expectedRevision และ conflict ที่ไม่เขียนทับเงียบ ๆ
- [ ] ตกลงการเลือก workspace, login return path และการยกเลิกผลตอบกลับเก่าเมื่อเปลี่ยนบัญชี/บริบท
- [ ] บันทึกข้อตกลงและประเด็นที่ยังไม่จบพร้อมเจ้าของงานใน progress ของแต่ละคน

#### 0-J2 — ตรึงขอบเขตและ acceptance ของ Phase 1

- [ ] ยืนยันขอบเขต Phase 1 และรายการที่จะย้ายไป Phase 2 ตามส่วนต้นของเอกสาร
- [ ] ยืนยันความหมาย task IDs ในเอกสารนี้ ไม่ย้ายงานไปใช้ ID อื่นระหว่างทำโดยไม่บันทึกเหตุผล
- [ ] ตรวจ acceptance P1-01 ถึง P1-12 ด้านล่างและระบุว่าใครเก็บหลักฐานแต่ละรายการ
- [ ] บันทึก evidence review ของทั้ง A และ B (คนหรือ AI ที่รับบทบาทนั้น) ต่อ artifact revision เดียวกันของ 0-J1/0-J2 พร้อมข้อแก้ไขและผลหลังแก้ ไม่ถือว่าการส่ง artifact หรือไม่มีคำตอบเท่ากับผ่าน review

**Gate Phase 0:** เริ่ม implementation ของ Phase 1 เมื่อ **ทั้ง 0-J1 และ 0-J2 มีหลักฐาน review ของ A และ B ต่อ artifact revision ที่จะใช้จริง** แล้วเท่านั้น ผู้ review เป็นคนหรือ AI ที่รับบทบาทนั้นได้ นี่เป็นเกณฑ์คุณภาพภายในทีม ไม่ใช่การขออนุญาตผู้ใช้ซ้ำ ก่อน gate ผ่าน A ทำ routes/UI states/dependency map/baseline และ B ทำ API audit/permission matrix/fixtures ของ Phase 0 คู่ขนานกันได้โดยไม่รออีกฝ่ายส่งงานทั้งหมด เมื่อ gate ผ่านแล้ว แต่ละงาน Phase 1 เดินหน้าตาม prerequisite ของตัวเอง ไม่รอให้อีกบทบาททำทั้งช่วงเสร็จ การบันทึกเอกสารชุดนี้ยังไม่ใช่หลักฐานว่า gate ผ่าน และ fixture ไม่ใช่ผล integration จริง

## Phase 1 — แยก Editor และเชื่อมโครงเว็บกับระบบเดิม

### คน A

#### 1-A1 — Router และ Query shell

- [ ] เพิ่ม router/query infrastructure ตาม contract ที่ตกลง โดย providers ส่วนกลางมีเฉพาะ session, workspace, cache และการนำทางที่จำเป็น
- [ ] วาง lightweight shell กับ Editor เป็นคนละ route boundary; shell และ shared UI ไม่ import App/core/render/export runtime ทางตรงหรือทางอ้อม
- [ ] ทำ route loading/error/not-found ให้การเปลี่ยนหน้าไม่ค้างจอว่าง
- [ ] ผูก query keys กับ account/mode/workspace ที่ถูกต้อง ไม่ใช้ global project list ข้ามบริบท

**หลักฐาน:** route map และ cold-load dependency/network ของหน้ารายการ โดยระบุ mode ที่ทดสอบ

#### 1-A2 — Lazy boundary, preload, CSS และฟอนต์ของ Editor

- [ ] โหลด CloudWorkspace/App เฉพาะการเข้า Editor; แก้ unconditional preload ที่ทำให้หน้ารายการดาวน์โหลด Editor แม้มี lazy route
- [ ] ครอบ implementation เดิมก่อน และคง lazy 3D เดิม ไม่ย้ายทุก component/core พร้อมกัน
- [ ] แยก CSS ที่มีผลกับ header/aside/main ของ Editor ไม่ให้เปลี่ยนหน้าธุรกิจ
- [ ] คงฟอนต์หลักของแอป และโหลดฟอนต์งานออกแบบในขอบเขตที่จำเป็น โดย export/measurement เดิมยังรอ font พร้อมอย่างถูกต้อง
- [ ] ตรวจ dependency หลัง build จริง ไม่สรุปจากชื่อไฟล์หรือการวาง lazy เพียงอย่างเดียว

**หลักฐาน:** network/build dependency เปรียบเทียบการเปิดรายการกับการเปิด Editor และ regression ที่เกี่ยวกับหน้าตา/ฟอนต์

#### 1-A3 — รายการแบบแบ่งหน้าและภาพย่อ

- [ ] ใช้ ProjectSummary API เดิม; เปิดหน้ารายการแล้วไม่ fetch document ของทุก project
- [ ] ขอทีละ page และโหลดเพิ่มตามการใช้งาน ไม่ยก refreshItems ที่วนจนหมดทุกรายการมาใช้ในหน้าใหม่
- [ ] ขอ thumbnail เฉพาะรายการที่ต้องแสดงและ cache version ไม่ตรง; แต่ละ batch ไม่เกิน contract
- [ ] ใช้ placeholder เมื่อไม่มีภาพ และไม่ mount 3D เพื่อถ่ายภาพให้ทุกการ์ด
- [ ] รองรับ empty/error/retry และอัปเดตรายการที่เกี่ยวข้องหลังสร้าง/บันทึก โดยไม่ refetch ทุก workspace

**หลักฐาน:** requests ของหน้าแรก/โหลดเพิ่ม, response ไม่มี document/history และกรณี cache hit/miss/ภาพหาย

#### 1-A4 — เปิด exact ID และสร้างงานภายใน Editor

- [ ] ให้ /editor/:projectId ส่ง ID ไปตัวเปิดงานโดยตรง และใช้ workspace จากข้อมูลที่ผ่าน authorization แล้ว
- [ ] งานไม่พบ/ไม่มีสิทธิ์แสดงผลตาม contract ไม่ auto-create หรือเปิดงานอื่นแทน
- [ ] ให้ /editor/new โหลด creation engine หลังเข้า Editor เท่านั้น จากนั้นเรียก API เดิมด้วย operationId ที่เหมาะสม
- [ ] เมื่อสร้างสำเร็จเปลี่ยน URL เป็น ID ที่ server คืน และ refresh แล้วไม่สร้างเพิ่ม
- [ ] การ retry/กดซ้ำ/ผลตอบกลับช้าต้องไม่สร้างซ้ำหรือเปลี่ยนไปผิดงาน
- [ ] local-demo เปิดและสร้างงานในพื้นที่ local ของตน โดยไม่ใช้ fake login เป็นสิทธิ์ cloud

**หลักฐาน:** direct link/refresh, ID ที่ไม่พบ/ไม่มีสิทธิ์, สร้างแล้ว refresh และ retry create

#### 1-A5 — Draft, save, leave/back/logout และ V1/V2

- [ ] รักษาการบันทึก draft และ durable save queue เมื่อ Editor unmount ตามข้อตกลง 0-A2/0-J1
- [ ] แสดงสถานะ local draft, pending sync, saved และ conflict ตามข้อมูลจริง
- [ ] ตรวจการกลับจากรายการ/refresh/browser back ขณะ saving หรือ offline โดยไม่สูญเสียการแก้ล่าสุด
- [ ] ป้องกันคำขอค้างจากงานหรือ workspace เดิมไปบันทึกทับงานที่เพิ่งเปิด
- [ ] logout ไม่ล้างงานผู้ใช้เพื่อแก้ปัญหา และบัญชีอื่นต้องไม่เห็น draft/cache ของบัญชีก่อน
- [ ] สลับ V1/V2 โดยใช้ชิ้นงานและประวัติชุดเดียวกัน ไม่ remount แล้วทำให้เอกสารหรือ undo สูญหาย
- [ ] รักษา export authorization, watermark/entitlements และ local-demo behavior เดิม

**หลักฐาน:** ขั้นตอนกู้ draft และผล cloud save ที่ตรวจแยกกัน รวม V1/V2 และ conflict scenario

#### 1-A6 — Session, login return, cache และ context isolation

- [ ] เชื่อม bootstrap/me จริงโดยไม่ต้องโหลด Editor เพื่อรู้บัญชีหรือ workspace
- [ ] กลับไปหน้าปลายทางหลัง OAuth/login ได้อย่างปลอดภัย และจัดการ session หมดอายุโดยไม่เปิดข้อมูลจาก cache เก่า
- [ ] ตรวจ refresh/back/forward และกรณี login อยู่แล้วเปิดลิงก์ในแท็บใหม่
- [ ] เมื่อเปลี่ยน account/workspace ให้ยกเลิกหรือเพิกเฉย response เก่าและสลับ cache scope ก่อน render ข้อมูล
- [ ] ตรวจ viewer/คนนอก workspace กับ UI และ API จริงร่วมกับ B
- [ ] เก็บหลักฐาน acceptance ร่วมด้านล่าง; fixture-only ให้ระบุว่ายังรอ integration

**หลักฐาน:** session/navigation matrix และการทดสอบสองบัญชี/ต่าง workspace

### คน B

#### 1-B1 — ยืนยัน API เดิมและส่ง fixtures ให้ frontend

- [ ] ตรวจ session/bootstrap, me, list/detail/create และ thumbnails ตาม contract ที่ review แล้ว
- [ ] ใช้ summaries/pagination/thumbnail APIs เดิม และแก้เฉพาะช่องว่างที่จำเป็นต่อ Phase 1
- [ ] ยืนยัน response ไม่เปิดเผย document/assets ใน list และไม่รับ workspace ที่ actor ไม่มีสิทธิ์
- [ ] ส่ง fixture และตัวอย่างผลสำเร็จ/ผิดพลาดที่ตรง implementation ให้ A เชื่อมได้ตั้งแต่ต้น
- [ ] บันทึกความต่างของ contract/implementation พร้อมผลกระทบ และ review กับ A ก่อนเปลี่ยนรูปแบบที่ใช้อยู่

**หลักฐาน:** contract เทียบกับผลเรียก API และรายชื่อ fixture/environment ที่พร้อมใช้

#### 1-B2 — Create/save retry, revision และ draft authorization

- [ ] ตรวจ idempotency ของ create และ save: operation เดิม retry แล้วไม่สร้างงานหรือบันทึกซ้ำผิดความหมาย
- [ ] ตรวจ expectedRevision/conflict เมื่อสองแท็บหรือสองสมาชิกแก้งานเดียวกัน
- [ ] ตรวจว่างานที่มาจากการกู้ draft ยังต้องผ่าน actor/workspace authorization และ schema validation เดิม
- [ ] ตรวจว่า operation จากบัญชี/บริบทเก่าใช้ token ของอีกบัญชีแล้วผ่านไม่ได้
- [ ] ยืนยัน receipt/error ที่ A ใช้แสดง saved/pending/conflict ตรงกับผลจริงของ server

**หลักฐาน:** integration tests ของ retry/conflict/unauthorized write พร้อมขั้นตอนที่ A ใช้ตรวจใน browser ได้

#### 1-B3 — Deep links, OAuth และ Vercel configuration

- [ ] ประสาน callback กับ A ให้รักษาเส้นทางปลายทางภายในเว็บ ไม่รับ arbitrary external return URL
- [ ] เตรียม SPA fallback ใน config ให้ /app/projects, /editor/new และ /editor/:id เปิดตรงหรือ refresh ได้
- [ ] รักษา API routing และ static assets ให้ตอบชนิดข้อมูลเดิม ไม่ส่ง index.html แทน API error/response
- [ ] ตรวจ local build/preview ก่อน; เมื่อมี preview environment ที่ได้รับสิทธิ์ใช้งานแล้วจึงเก็บหลักฐานบน URL นั้น
- [ ] หากยังไม่มีสิทธิ์หรือ environment สำหรับ OAuth/remote preview ให้บันทึกเฉพาะรายการนั้นว่า pending และทำส่วน local/config ที่ตรวจได้ต่อ ห้ามอ้างว่า live integration ผ่านจากการอ่าน config

**หลักฐาน:** direct URL/refresh/login-return และ API content type ใน environment ที่ระบุชัด ผล preview/browser ของ 1-B3 เป็นเกณฑ์ปิด integration ของ Phase 1 ไม่ใช่ prerequisite ให้เริ่ม router หรือ API หลัง Gate Phase 0 ผ่าน

#### 1-B4 — API access, regression tests และ environment handoff

- [ ] ตรวจ unauthenticated, owner/editor/viewer, outsider และต่าง workspace สำหรับ list/detail/create/save/delete/thumbnails/ไฟล์ที่กระทบ
- [ ] ใช้ error contract เดียวกันใน client/server และไม่คืนข้อมูลลับผ่าน error หรือ logs
- [ ] รัน tests ที่เกี่ยวกับ API/auth/projects/assets และชุด regression ที่ได้รับผลกระทบ; รายงาน skip/fail ตามจริง
- [ ] ส่งวิธีตั้งค่าและรัน integration ให้ A โดยไม่แนบ secret; ไม่ต้องให้ทุกคนสร้าง Supabase/OAuth ใหม่
- [ ] ตรวจผล build ที่ generate API artifacts โดยใช้ source เป็นจุดแก้ไข ไม่แก้ generated bundle ด้วยมือหรือทิ้ง diff ของคนอื่น
- [ ] review acceptance ร่วมกับ A และบันทึกรายการ pending ที่ยังต้องใช้ environment/การตรวจจากอีกฝ่าย

**หลักฐาน:** คำสั่ง/ผลทดสอบ, permission matrix ที่ตรวจแล้ว และ environment handoff ที่ทำซ้ำได้

## ลำดับพึ่งพาและงานที่ทำคู่ขนานได้

~~~text
0-A1/A2/A3 ─┐
            ├─ 0-J1: routes + API + save contract
0-B1/B2/B3 ─┘             │
                          └─ 0-J2: scope + acceptance
                                   │
                 ┌─────────────────┴────────────────┐
                 │                                  │
       A: 1-A1/A2 โครงและ boundary       B: 1-B1/B2 API/fixtures/retry
                 │                                  │
                 └────── 1-A3/A4/A5 เชื่อมจริง ──────┘
                                   │
                      A: 1-A6 + B: 1-B3/B4
                                   │
                         Gate Phase 1 พร้อมหลักฐาน
~~~

- ก่อน Gate Phase 0: A ทำ routes, dependency map, baseline และ UI states; B ทำ API audit, permission matrix และ fixtures ส่ง artifact ของตนเพื่อ review ได้โดยไม่รออีกฝ่ายทำเสร็จทั้งหมด
- หลัง Gate Phase 0: A ทำ router/lazy boundary และ B ทำ API/retry/permission tests คู่ขนานได้ตาม dependency ของแต่ละงาน ไม่รอ UI หรือ API ทั้งชุดเสร็จ
- A เชื่อม list และ Editor กับ API เดิมเมื่อ prerequisite ของงานพร้อมหลัง gate ผ่าน ไม่รอ supplier schema หรือ Admin
- Login-return ต้องใช้ข้อตกลงจากทั้งคู่; การตรวจ deep link บน preview ต้องมีทั้ง frontend router และ server rewrite
- เมื่อเจ้าของอีกฝ่ายไม่พร้อม ให้บันทึก dependency ที่รอพร้อมชื่องาน เดินหน้าส่วนอิสระ และไม่แก้ contract เงียบ ๆ เพื่อให้ fixture ผ่าน

## Acceptance ร่วมและหลักฐานปิด Phase 1

ทุกช่องเริ่มเป็น pending การติ๊กผ่านต้องแนบหลักฐานใน PROGRESS-A.md หรือ PROGRESS-B.md และให้ peer reviewer ตรวจจุดที่ข้ามขอบเขตเจ้าของงาน

| ID | เกณฑ์ผ่านที่ตรวจได้ | หลักฐานขั้นต่ำ / เจ้าของหลัก |
| --- | --- | --- |
| P1-01 | เปิด /app/projects แบบ cold load แล้วไม่โหลด Editor/Three.js/export runtime | Network และ dependency/build output ของหน้ารายการเทียบ Editor; A |
| P1-02 | หน้าแรกขอเพียง page ที่ UI กำหนด ไม่วนดึงจนหมด และไม่เรียก detail ทุกการ์ด | รายการ requests/response fields และการกดโหลดเพิ่ม; A/B |
| P1-03 | ภาพย่อใช้ batch/cache/version มี placeholder และไม่ mount 3D เพื่อถ่ายทุกการ์ด | cache hit/miss/ไม่มีภาพ และ batch limit; A/B |
| P1-04 | /editor/:id เปิด ID ตรง URL; refresh/back ไม่เปิดงานอื่น; ID ผิด/ไม่มีสิทธิ์ไม่สร้างงานแทน | browser steps และ API ผลกรณีถูก/ผิด/ต่าง workspace; A/B |
| P1-05 | /editor/new สร้างภายใน Editor สำเร็จแล้วใช้ ID จริง; retry/refresh ไม่สร้างซ้ำ | operation/receipt และจำนวนงานก่อน–หลัง; A/B |
| P1-06 | saving/offline/failed request แล้วออก–กลับเข้า/refresh ยังรักษางานล่าสุดหรือ draft ได้ และไม่แสดง cloud saved ผิดจริง | browser recovery + server revision/draft ที่ตรวจแยกกัน; A/B |
| P1-07 | V1/V2 ใช้เอกสาร/undo ชุดเดียวกัน; เปิดงานเดิม 2D/3D/save/export ตามสิทธิ์เดิมยังทำงาน | regression tests และ browser smoke ของรูปแบบที่กระทบ; A |
| P1-08 | owner/editor/viewer และ outsider ทำได้เฉพาะสิทธิ์ที่ตกลง ทั้ง list/detail/write/thumbnail | permission integration tests และ UI check; B/A |
| P1-09 | logout/login อีกบัญชีหรือเปลี่ยน workspace ไม่แสดง cache/draft/thumbnail ข้ามบริบท และ response เก่าไม่ทับหน้าใหม่ | browser สองบัญชี/ต่าง workspace และ request cancellation/race test; A/B |
| P1-10 | direct link/refresh/login-return ใช้ได้ใน environment ที่ตรวจจริง; API ยังตอบ JSON ตาม contract | local/preview URL, ขั้นตอน OAuth และ response type; B/A |
| P1-11 | loading/empty/error/session expired/offline/conflict มีทางออกหรือ retry ที่ตรงสถานะจริง | UI matrix พร้อมขั้นตอนทำซ้ำ; A |
| P1-12 | local-demo/cloud ยังแยกกัน และ typecheck/build/tests ที่เกี่ยวข้องผ่าน ไม่มีการเปลี่ยนข้อมูลผู้ใช้เพื่อทำให้เทสต์ผ่าน | คำสั่ง ผลลัพธ์ mode และรายการ tests ที่ skip/pending; A/B |

รูปแบบหลักฐานแต่ละรายการ:

- task/acceptance ID และสิ่งที่เปลี่ยน
- environment, mode, วันที่ตรวจ และ revision/ชุด diff ที่ตรวจได้โดยไม่เปิดเผย secret
- คำสั่งหรือขั้นตอนทำซ้ำ พร้อม expected/actual result
- ลิงก์ภาพ/log/report ที่ทีมเข้าถึงได้ และผล passed/failed/pending/skip พร้อมเหตุผล
- ผู้ทำและผู้ review รวมข้อแก้ไขที่เหลือ

ใช้ typecheck, tests และ build ตาม [README](../../README.md) และชุดที่สัมพันธ์กับการเปลี่ยนแปลง ไม่จำเป็นต้องรัน live AI ที่เสียค่าใช้จ่ายเพื่อพิสูจน์การแยก routes ถ้า build สร้าง API artifacts ให้ตรวจ diff และประสานเจ้าของไฟล์ก่อนจัดการ ห้าม reset งานหรือข้อมูลของผู้อื่นเพื่อให้ผลตรวจสะอาด

**Gate Phase 1:** acceptance ที่จำเป็นต่อ flow จริงผ่านและมี peer review; รายการที่ยังรอ cloud/OAuth/preview ต้องระบุ pending อย่างชัดเจน และยังห้ามอ้างว่า Phase 1 integration เสร็จครบจาก fixture หรือ local-demo เพียงอย่างเดียว การ review/gate ไม่ใช่การขออนุญาตผู้ใช้ซ้ำสำหรับทุกการแก้ไขที่อยู่ในงานที่ได้รับมอบหมาย

เมื่อพบช่องว่างนอก scope ให้บันทึกผลกระทบกับงานที่ยังทำต่อได้ ไม่เพิ่ม migration, role ธุรกิจ, Admin หรือฟีเจอร์ marketplace เข้า Phase 1 เอง และไม่ถือว่าช่วงนี้ผ่านเพียงเพราะหน้าเว็บแสดงผลได้
