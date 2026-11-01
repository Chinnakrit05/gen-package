# ผล review A0-r1 โดย B

Review revision **b-review-a0-r1-r1** — 1 พฤศจิกายน 2026 (artifact A ลงวันที่ 31 ตุลาคม)

ตรวจ [ROUTES-PHASE-1.md รุ่น A0-r1](https://github.com/Chinnakrit05/gen-package/blob/d73a68605a1a1bed6c67cd4b7a6abe9be3584a7c/docs/marketplace/ROUTES-PHASE-1.md) และ PROGRESS-A จาก `origin/main` commit `d73a68605a1a1bed6c67cd4b7a6abe9be3584a7c` เทียบกับ implementation และ [API contract](API-CONTRACT-PHASE-1.md), [permissions](PERMISSIONS-PHASE-1.md), [fixtures](FIXTURES-PHASE-1.md) รุ่น **b-phase0-r1** จาก B commit `2398c4d02d925e8b62a671a583272e28b1e07350`

**ผล: B รับแนวทางหลักของ A แต่ยังมีข้อแก้ไขให้ A รับรองก่อนปิด 0-J1/0-J2** A0-r1 ระบุชัดว่ายังไม่ได้รับ contract/review ของ B จึงยังไม่มีผลตรวจของทั้งสองฝ่ายต่อชุดข้อตกลงเดียวกัน Phase 1 ยังไม่เริ่ม เอกสารนี้ไม่แก้ A0-r1 หรือ PROGRESS-A แทน A และไม่เปลี่ยน shared DTO/API

## 0-J1 — คำตอบประเด็นเปิดของ A §5.1

| ประเด็น | คำตอบ/ข้อเสนอที่ B รับรอง |
|---|---|
| 1. GET detail ไม่มีงาน/ไม่มีสิทธิ์ | คง **404 NOT_FOUND** ทั้งไม่มีงาน ถูกลบ และไม่มีสิทธิ์ workspace; `PROJECT_NOT_FOUND` เป็นข้อความภายใน RPC ไม่ใช่ HTTP error code ส่วนบัญชี inactive เป็น 403 USER_NOT_ACTIVE แยกกัน |
| 2. ไม่มี thumbnail kind/label | ใช้ไอคอนทั่วไปกับชื่อ project ได้ ไม่เพิ่ม summary fields และไม่เรียก detail/creation engine เพื่อเดาชนิดงาน; metadata อาจไม่มีแม้ project ยังใช้งานได้ |
| 3. ส่ง draft เบื้องหลังจาก gallery | Phase 1 **ยังไม่เพิ่มตัวส่ง save drafts เบื้องหลัง** คงส่งเมื่อกลับเปิดงานนั้น แสดงป้ายรอส่งตาม scope เดิม; แยกจาก durable create/delete journal ที่มีอยู่และต้องรักษาพฤติกรรม replay เดิมโดยไม่ส่งข้าม actor/workspace |
| 4. SPA fallback | B เป็นเจ้าภาพ vercel.json หลัง gate ผ่าน รองรับ `/login`, `/app/*`, `/editor/*` และ unknown UI routes โดยรักษา `/api/*`, serverless endpoints และ static assets รวม missing assets ให้ไม่กลายเป็น HTML; ต้องตรวจ config/local และ preview แยกกัน สคริปต์ static server ของ A ไม่ใช่หลักฐาน Vercel routing |
| 5. OAuth return | รับข้อเสนอ **redirectTo=origin + PKCE เดิม + returnTo ใน sessionStorage** ตาม A §2.2/2.3 ไม่เพิ่ม `/auth/callback` ใน Phase 1 และไม่เปลี่ยน remote allowlist; local config รองรับ origin ตามที่ A ระบุ ส่วน preview/remote provider readiness ยังต้องตรวจจริง |

รับ page size **24**, thumbnail batch สูงสุด **24 IDs ไม่ซ้ำ**, จับคู่ผลด้วย projectId และเทียบ version; ใช้ placeholder เมื่อไม่มีภาพ/metadata ห้ามถือว่าลำดับหรือจำนวนภาพตรง input ค่าเริ่มต้น workspace เป็น personal และ workspace อื่นต้องมาจาก `/me`; exact project URL ใช้ workspace จาก detail ที่ server อนุญาต ไม่ย้ายงานให้ตรง workspace ที่ client เลือก

## ข้อที่ A ต้องแก้/ยืนยันใน route/UX revision ถัดไป

| ID | ข้อที่ต้องระบุให้ตรง implementation | เกณฑ์ตรวจรับที่เกี่ยวข้อง |
|---|---|---|
| R1 — Pagination | Cursor เป็น opaque keyset `(updated_at, id)` ไม่ใช่ snapshot และ **ไม่รับประกันเห็นรายการคงเดิม/ครบทุกงานเมื่อมี concurrent updates** ตัวที่ย้ายขึ้นก่อน cursor อาจไม่ปรากฏในหน้าถัดไป ให้ dedupe/update ด้วย projectId และเริ่มหน้าแรกใหม่เมื่อ refresh/invalidate หลัง mutation; ไม่สัญญาว่า cursor รักษารายการเดิมไว้ทั้งหมด | P1-02: หลายหน้าและมีงานเปลี่ยนลำดับระหว่างโหลด ไม่วนขอทุกหน้าเพื่อชดเชย |
| R2 — Create intent | operationId ต่อ history entry อย่างเดียวไม่พอ ต้องผูก **mode/account/workspace/history entry + payload เดิม + ผล projectId** ให้กู้หลัง refresh ได้ ห้ามสร้าง fresh payload คนละชุดภายใต้ key เดิม และห้ามสร้าง key ใหม่เพื่อหลบ 409; ต้องครอบคลุมช่วง server สร้างแล้วแต่ response หาย และช่วงรับ response แล้วก่อน replace URL เสร็จ | P1-05/P1-09: refresh ในทั้งสองช่วงไม่สร้างซ้ำ; เปลี่ยนบัญชี/บริบทแล้วไม่ replay intent เก่าด้วย token ใหม่ |
| R3 — Offline new | ระบุที่เก็บร่างของ `/editor/new` ก่อนมี server ID และวิธีย้ายไป ID จริงเมื่อ replay สำเร็จ โดยรักษาการแก้ล่าสุดที่เกิดหลัง initial create payload; mutation journal เก็บ payload ของ create แต่ไม่ได้เป็น save draft สำหรับการแก้ต่อทั้งหมดโดยอัตโนมัติ | P1-05/P1-06: สร้าง offline → แก้ต่อ → refresh/ออนไลน์แล้วได้งานเดียวและการแก้ยังอยู่ |
| R4 — Leave/durability | flush state ล่าสุดแล้ว **await capture ลง IndexedDB สำเร็จ** ก่อนออก; ประเมิน save state ใหม่หลัง capture แม้ก่อนกดกลับจะเป็น clean ถ้า capture ล้ม เช่น storage เต็ม ห้ามแสดงว่าเก็บ draft แล้วหรือออกอัตโนมัติตามกติกา error ที่สมมติว่ามี draft; `queue.flush()` resolve ไม่ได้แปลว่า synced เพราะเก็บ error ใน status และอาจยังมี generation ใหม่ค้างอยู่ | P1-06/P1-11: แก้แล้วออกภายใน 300 ms, capture failure, in-flight save และแก้เพิ่มระหว่างส่ง |
| R5 — Refresh/logout/context | leave guard ใช้กับ browser back และเปลี่ยน workspace/logout ด้วย; pagehide async เป็น best-effort จึงต้องมีแนวทาง capture ต่อเนื่องเพื่อปิดช่อง debounce 300 ms และตรวจ refresh ภายในช่วงนั้น แยก refresh token ของ actor เดิมจากเปลี่ยนบัญชี; abort/ignore ผลเก่าก่อน render/replay และอย่าอาศัย operationId เป็นกลไกตรวจเจ้าของ | P1-06/P1-09: refresh/back/logout ก่อน debounce, token refresh ของคนเดิม และอีกบัญชีที่เป็น editor ใน team เดียวกัน |

ที่มาจากโค้ด: `supabase/migrations/20260918000300_projects.sql` (list_projects ใช้ tuple `<` และเรียง DESC), `server/adapters/supabase/projectRepository.ts` (error mapping/limit+1), `src/services/projects/durableProjectMutations.ts` (persist payload แล้วลบ journal เมื่อได้ผล; ไม่มี durable history-entry → receipt mapping), `src/services/projects/durableSaveQueue.ts` (await store.put ใน capture และ flush จัด error ผ่าน status), `src/App.tsx` (debounce state 300 ms) และ `src/features/projects/CloudWorkspace.tsx` (onProjectChange → controller.capture)

R2–R5 เป็นข้อกำหนดให้ A ออกแบบ lifecycle ในขอบเขต frontend ไม่ใช่คำสั่งให้ B แก้ client หรือเพิ่ม API/schema Phase 1 การรับรองจาก B เป็น source review ยังไม่ใช่ผล browser/DB integration

## 0-J2 — ความเห็น B ต่อขอบเขตและเจ้าภาพ

B รับขอบเขตและ task IDs ตาม PHASE-0-1.md รวมพฤติกรรมที่ A เสนอเปลี่ยนทั้งสามข้อ: รายการว่างไม่ auto-create, งานถูกลบไม่เปิดงานอื่นแทน และ gallery ไม่ดึงทุกหน้าล่วงหน้า คง engine/document schema/billing/export เดิม ไม่มี Marketplace/Admin implementation ใน Phase 1

รับเจ้าภาพไฟล์ตาม A §5.2: A แก้ package.json/package-lock.json เฉพาะ frontend dependencies และ vite.config.ts เฉพาะ client build เมื่อจำเป็น รวม scripts/marketplace/*; B แก้ server/shared contracts/DB checks/vercel.json ไม่แก้ package/lockfile ชนกัน หากจำเป็นต้องเปลี่ยนส่วนร่วมเพิ่ม ให้ประสานก่อน

| Acceptance | หลักฐานที่ A เก็บ | หลักฐานที่ B เก็บ |
|---|---|---|
| P1-01 / P1-07 / P1-11 | Network/dependency, Editor regression, UX states | Review จุดที่ข้าม contract เมื่อเกี่ยวข้อง |
| P1-02 / P1-03 / P1-04 / P1-05 / P1-06 / P1-09 | Browser requests/navigation/recovery/context isolation | API fields, authorization, retry/revision และ server checks ตาม scenario |
| P1-08 | Read-only/ไม่มีสิทธิ์จาก UI | Permission API/DB integration |
| P1-10 | Direct-link/refresh/login return ใน browser | API response type และ routing/config; preview ตรวจเมื่อมี environment |
| P1-12 | Client build/typecheck/tests, local/cloud UI แยกกัน | Server/contract tests/build ที่กระทบ; ทั้งคู่ระบุ environment และ pending ตามจริง |

B รับตารางนี้เป็นส่วนของตน รอ A ยืนยันต่อ review revision นี้กับ b-phase0-r1 ก่อนถือว่า 0-J2 ผ่านร่วมกัน

## หลักฐานและสถานะการส่งต่อ

- Git: fetch --prune แล้ว origin/main = d73a686, origin/codex/marketplace-b-phase-1 = 2398c4d; มีสอง remote heads และไม่มี open PR จากผล GitHub CLI รอบนี้
- A0-r1/PROGRESS-A ระบุฐาน fb55f36 และยังไม่ได้รับ b-phase0-r1; การมี artifact ของทั้งคู่บนคนละ branch ไม่ถือว่า review กันแล้ว
- App/server/shared/config ของ A commit ไม่เปลี่ยนจาก fb55f36 ตรวจด้วย git diff; source review ใช้โค้ดฐานเดียวกับ contract B ได้
- ผลวัด Windows/Chrome และ smoke ใน A0-r1 เป็น **ผลที่ A รายงาน** B อ่านวิธีวัดแล้วแต่ไม่ได้รันซ้ำหรือรับรอง cloud integration; A ระบุ cloud/preview pending ถูกต้อง
- Fixture verifier ของ B รันซ้ำเพื่อประกอบ review: `node docs/marketplace/fixtures/verify.mjs` ด้วย Node 24; ผลจริงบันทึกใน PROGRESS-B ไม่มีการเรียก Auth/DB
- 0-J1 = **CHANGES_REQUESTED / รอ A review กลับ**; 0-J2 = **B_REVIEWED / รอ A ยืนยันชุดเดียวกัน**; ยังไม่ปิดงานร่วมและยังไม่เริ่ม 1-B1..1-B4

ขั้นถัดไปของ A: รับ B commit 2398c4d และเอกสาร review นี้เข้า branch ตนตาม workflow ทีม อ่าน contract/permissions/fixtures b-phase0-r1 ตอบ R1–R5 ใน route/UX รุ่นถัดไป (A0-r2 ตามกติกา revision ของ A) และบันทึก review ทั้ง 0-J1/0-J2 ใน PROGRESS-A แล้วส่ง commit SHA กลับให้ B ตรวจปิด ไม่ต้องรอ real preview เพื่อ review ข้อตกลง Phase 0
