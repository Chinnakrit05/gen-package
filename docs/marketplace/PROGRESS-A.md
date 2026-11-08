# ความคืบหน้าคน A

## เฟส 3 วันที่ 8 พฤศจิกายน 2026

เพิ่มทางเข้า **สร้างฉบับร่างคำขอราคา** จากการ์ดงาน Cloud ในหน้ารวมงานสำหรับเจ้าของพื้นที่ หน้า `/app/requests/new?projectId=…` โหลดสเปกจากงานที่บันทึกไว้ ให้ระบุชื่อ จำนวน และรายละเอียด แล้วเปิดฉบับร่างที่ `/app/requests/:id` กลับไปดูร่างได้จาก `/app/requests`

Playwright กับ Supabase ในเครื่องผ่านการสร้างจากหน้ารวมงาน การโหลดสเปกใหม่เมื่อ revision เปลี่ยน การลองบันทึกซ้ำหลังคำตอบหายโดยได้ร่างเดียว การเปิดร่างหลังแก้งานต้นทาง และการแบ่งหน้ากับปฏิเสธบัญชีที่ไม่มีสิทธิ์ หน้าเหล่านี้โหลดแยกจาก Editor ผลอยู่ใน `tmp/marketplace-quote-drafts-local/browser.log`

วันที่ 8 พฤศจิกายน 2026 Playwright บน `packit-design.vercel.app` ที่ `5a2e74c` ผ่านการสร้างฉบับร่างจากการ์ดงาน Cloud และเปิดซ้ำจากรายการ หลังแก้ความกว้างของงานต้นทาง ร่างยังแสดงความกว้างกับเลขฉบับเดิม การเข้าแจ้งเตือนของผู้ตรวจถูกปฏิเสธก่อนยืนยัน TOTP หลังตั้งค่าและยืนยันผ่าน Supabase Auth จริง ผู้ตรวจเห็นแจ้งเตือนส่งตรวจ ทำเครื่องหมายว่าอ่าน และเปิดคิวเพื่ออนุมัติ ผู้จัดการเห็นแจ้งเตือนผลอนุมัติและสถานะอ่านยังอยู่เมื่อเปิดใหม่ สองเส้นทางไม่โหลด Editor ผลอยู่ใน `tmp/marketplace-013-014-staging/browser.log`

บน branch `codex/marketplace-quote-publication` เพิ่มขั้นเลือกผู้รับผลิตที่อนุมัติแล้ว 1–5 รายใน `/app/requests/:id` ผู้ซื้อเห็นข้อมูลที่จะส่งและตรวจรายชื่อก่อนยืนยัน หลังส่งแสดงรายชื่อผู้รับจริง ร้านเข้าจากโปรไฟล์ไปที่ `/factory/:supplierId/jobs` และเปิดสเปกเบื้องต้นจาก `/factory/:supplierId/jobs/:requestId` หน้าผู้ซื้อและร้านโหลดแยกจาก Editor

`node tmp/marketplace-publication-local/browser.mjs` ผ่านกับ Chromium, HTTP และ Supabase ในเครื่อง ตรวจเลือกข้ามหน้า จำกัดห้าราย ร้านหมดสิทธิ์ก่อนยืนยัน การลองส่งซ้ำเมื่อคำตอบขาดหาย การเปิดใบยืนยันหลังรีเฟรช และการกลับมาที่ลิงก์คำขอหลังเข้าสู่ระบบ ร้านที่ไม่ได้รับเลือก บัญชีภายนอก และร้านที่ถูกพักเปิดรายละเอียดไม่ได้ ผลอยู่ใน `tmp/marketplace-publication-local/browser.log` Cloud build และ `npm test -- --maxWorkers=4` ผ่าน 1,521 รายการ โดยข้าม 6 รายการตามชุดทดสอบ

## เฟส 2 วันที่ 7 พฤศจิกายน 2026

เริ่มบน branch `codex/marketplace-phase-2` จาก `main` ที่ `b1562f7` เพิ่มทางเข้าพื้นที่ผู้รับผลิตจากหน้ารวมงาน หน้า `/factory/onboarding` สำหรับสมัครโรงงานหรือร้านปริ้น หน้า `/factory/:supplierId/profile` สำหรับแก้และส่งตรวจ หน้า `/admin/suppliers` สำหรับเจ้าหน้าที่ และหน้า `/suppliers/:slug` สำหรับโปรไฟล์ที่อนุมัติแล้ว หน้าเหล่านี้โหลดแยกจาก Editor และหน้ารวมงานโหลดข้อมูลกิจการเมื่อเข้าพื้นที่ผู้รับผลิต

หน้าแอดมินอ่านสิทธิ์จาก API และให้เจ้าหน้าที่ใช้ TOTP ที่ผูกไว้แล้วก่อนตรวจรายการ การแก้โปรไฟล์สาธารณะมีข้อความอธิบายว่าต้องส่งตรวจใหม่ ผู้จัดการบันทึกและส่งตรวจได้ สมาชิกที่มีสิทธิ์อ่านเปิดรายละเอียดของกิจการที่เข้าถึงได้

เมนูและเส้นทางผู้รับผลิตเปิดเมื่อ build ตั้ง `VITE_MARKETPLACE_SUPPLIERS_ENABLED=true` เพื่อให้ deploy จาก `main` ได้ระหว่างเตรียมฐานข้อมูล staging Chromium ตรวจ build ที่ปิดฟีเจอร์แล้ว ลิงก์ตรงแสดงหน้าไม่พบและหน้ารวมงานเปิดได้ ส่วน build ที่เปิดฟีเจอร์ผ่านขั้นตอนสมัครและอนุมัติกับ Supabase ในเครื่องอีกครั้ง

Chromium กับ Supabase ในเครื่องผ่านเปิดลิงก์ตรงและกลับจาก login ด้วย session ที่ Auth ออกให้จริง สมัครและส่งตรวจ ยืนยัน TOTP จริงจากหน้าเว็บ อนุมัติ และเปิดโปรไฟล์สาธารณะโดยไม่ส่งโทเคน ตรวจการแยกปุ่มแอดมินตามสิทธิ์และการโหลด Editor แล้ว ผลอยู่ใน `tmp/marketplace-phase2-ui/browser-real.log` TypeScript และ Vite build ทั้ง Cloud และ local demo ผ่าน ส่วนหน้าจอเชิญสมาชิกและเอกสารประกอบการตรวจอยู่ในงานถัดไปของเฟส 2

บน branch `codex/marketplace-reviewer-totp` เพิ่มการผูกแอป TOTP ครั้งแรกให้เจ้าหน้าที่ที่ได้รับสิทธิ์ตรวจผู้รับผลิต เจ้าหน้าที่เริ่มตั้งค่าเอง สแกน QR หรือเปิดรหัสตั้งค่าด้วยตนเอง แล้วกรอกรหัสหกหลัก ระบบแจ้งผลต่อเซสชันอื่นก่อนเริ่ม เก็บ QR และรหัสตั้งค่าในหน่วยความจำของหน้า และรองรับกลับมายืนยันการตั้งค่าที่เคยสแกนแล้ว

Chromium กับ Supabase local ผ่านสร้างและยกเลิก factor ที่ยังไม่ยืนยัน กรอกรหัสผิดแล้วลองใหม่ รีเฟรชและกลับมายืนยันการตั้งค่าที่ค้าง ตรวจว่าคีย์ตั้งค่าอยู่เฉพาะหน้า และเข้าคิวอนุมัติหลังยืนยันแล้ว บัญชีทั่วไปไม่มีหน้าตั้งค่านี้ การยืนยันด้วย TOTP ที่ผูกไว้แล้วผ่านซ้ำด้วยบัญชีสังเคราะห์คนละบัญชี ผลอยู่ใน `tmp/marketplace-phase2-ui/reviewer-totp-browser.log` และ `tmp/marketplace-phase2-ui/reviewer-existing-browser.log` เทสต์แอปผ่าน 1,509 รายการและ Cloud build ผ่าน

ตรวจ staging จาก `main` ที่ `7c71ed4` ผ่าน Safari ด้วยบัญชี Google ทดสอบเดิม เปิด `/admin/suppliers` แล้วเห็นหน้าตั้งค่าแอปยืนยันตัวตนก่อนเข้าคิวตรวจ เจ้าของบัญชีผูกและยืนยัน TOTP ครั้งแรกใน Safari จากนั้นคิวแสดงร้านทดสอบสถานะรอตรวจสอบ เมื่อกรอกเหตุผลและบันทึกการอนุมัติ หน้าแอดมินแสดง `อนุมัติแล้ว` และร้านออกจากคิวรอตรวจ

เพิ่มหน้า `/factory/:supplierId/team` สำหรับผู้จัดการ สร้างและคัดลอกลิงก์เชิญ ดูคำเชิญที่รอตอบรับ ยกเลิกคำเชิญ เปลี่ยนบทบาท และนำสมาชิกออก เปิดจากโปรไฟล์ผู้รับผลิต หน้า `/factory/invitations/accept` ให้ผู้รับล็อกอินด้วยอีเมลที่ได้รับเชิญและกดตอบรับเอง เก็บโทเคนในแท็บระหว่างเข้าสู่ระบบและส่งให้ API ตอนตอบรับ ทางเข้าหลังล็อกอินเก็บเฉพาะเส้นทาง หน้าใหม่โหลดเมื่อเปิดใช้งาน

Playwright ผ่านบน Supabase ในเครื่องกับบัญชีสังเคราะห์ ครอบคลุมคัดลอกลิงก์ บัญชีผิด ลิงก์หมดอายุหรือถูกยกเลิก การตอบรับด้วยปุ่ม การกันพนักงานจากหน้าจัดการทีม เปลี่ยนบทบาทและถอดสมาชิก รวมถึงกรณีสร้างคำเชิญสำเร็จแต่คำตอบหายแล้วโหลดรายการค้างได้ ตรวจว่าโทเคนไม่ไปกับ URL ของคำขอหรือ `Referer` การทดสอบ OAuth จำลองการส่งกลับจาก Google แล้วใช้ callback ของแอปและเซสชันจาก Supabase จริง ผลอยู่ใน `tmp/marketplace-supplier-team-local/suppliers-team-browser.log` Cloud build ผ่านและแยกหน้าทีมกับหน้าตอบรับจาก Editor

วันที่ 8 พฤศจิกายน 2026 Playwright ผ่านบน `packit-design.vercel.app` ที่ commit `8636dc2` โดยใช้บัญชีสังเคราะห์และ API staging จริง ผู้จัดการสร้างและคัดลอกลิงก์ หลังผู้รับกดตอบรับ ผู้จัดการเปลี่ยนบทบาทจากพนักงานเป็นดูอย่างเดียวแล้วถอดสมาชิก บัญชีเดิมเปิดโปรไฟล์ไม่ได้หลังถูกถอด ตรวจการปฏิเสธบัญชีผิด พนักงานที่เปิดหน้าจัดการทีม และลิงก์ที่ถูกยกเลิก โทเคนอยู่เฉพาะ body ของคำขอตอบรับ ขั้นตอนกลับจาก Google จำลอง redirect เข้า callback จริงของแอป ผลอยู่ใน `tmp/marketplace-supplier-team-staging/browser.log`

เพิ่มเอกสารประกอบในหน้าโปรไฟล์ผู้รับผลิตและคิวตรวจเดิม ผู้จัดการแนบหรือนำไฟล์ออกเมื่อเป็นฉบับร่าง ผู้ตรวจที่ผ่าน TOTP เปิดรายการของกิจการที่รอตรวจแล้วดาวน์โหลดทีละไฟล์ Playwright กับ Supabase ในเครื่องผ่านตรวจ PDF ดาวน์โหลดตรงกับต้นฉบับ แนบซ้ำหลังคำตอบหายโดยไม่เกิดรายการซ้ำ ปิดรายการแล้วยกเลิกคำขอที่ค้าง และแยกสิทธิ์ผู้จัดการ พนักงาน และผู้ตรวจ ผลอยู่ใน `tmp/marketplace-supplier-review-documents-local/browser.log`

วันที่ 8 พฤศจิกายน 2026 Playwright ผ่านบน `packit-design.vercel.app` ที่ commit `a8be94b` ผู้จัดการสังเคราะห์แนบ PDF ชื่อไทย ดาวน์โหลดแล้วเทียบไบต์ตรงกับต้นฉบับ และส่งโปรไฟล์เข้าคิว ผู้ตรวจสังเคราะห์ถูกปฏิเสธก่อนยืนยัน TOTP จากนั้นผูกและยืนยันผ่านหน้าเว็บกับ Supabase Auth จริง เปิดรายการจากคิวและดาวน์โหลด PDF ไบต์เดิมได้ ผลอยู่ใน `tmp/marketplace-supplier-review-documents-staging/browser.log`

เพิ่มกล่องแจ้งเตือนในพื้นที่ผู้รับผลิตและคิวเจ้าหน้าที่ ผู้ใช้เปิดดู ทำเครื่องหมายว่าอ่านแล้ว และไปยังโปรไฟล์หรือคิวรอตรวจได้ Playwright บน Supabase ในเครื่องผ่านการแบ่งหน้าจริง 24+1 สถานะอ่านแยกตามบัญชี ซ่อนผลเก่าเมื่อสิทธิ์ถูกปฏิเสธ และเปิดคิวจากแจ้งเตือนหลังผ่าน TOTP ผลอยู่ใน `tmp/marketplace-supplier-notifications-local/browser.log`

## เฟส 1

สถานะเริ่มต้น 30 ตุลาคม 2026: มีเอกสารแผนแล้ว ยังไม่ได้เริ่ม implementation ตามแผนนี้ คน A แก้ไฟล์นี้ คน B อ่านเพื่อรับส่งงาน

อัปเดต 5 พฤศจิกายน 2026 — ผู้ใช้มอบหมาย A และ B ให้ตรวจรับ Phase 1 ร่วมกัน โค้ด A รุ่น `b6f43f1` เข้า `main` ผ่าน `6dbb30b` แล้ว รอบแก้และตรวจร่วมอยู่บน branch `codex/marketplace-phase-1-integration` ฐาน `a85de8b` ดูสถานะของโค้ดชุดนี้และหลักฐานใน [ผลตรวจร่วม A/B](B-PHASE-1-RESULTS.md#ตรวจรับร่วม-ab-5-พฤศจิกายน-2026)

## สถานะรอบตรวจร่วม

| งาน | ผลรอบนี้ |
|---|---|
| 1-A1 / 1-A2 | Router และ lazy boundary ผ่าน browser fixture กับ build ล่าสุด หน้ารายการไม่โหลด Editor, Three.js หรือ exporter |
| 1-A3 / 1-A4 | ตรวจแบ่งหน้าและภาพย่อกับ fixture และ API จริง ตรวจเปิด ID เดิมและ retry สร้างงานกับเบราว์เซอร์และ Auth จริงในเครื่อง |
| 1-A5 | ตรวจร่างออฟไลน์ กู้ร่างจากหน้ารายการ ลองบันทึกใหม่ conflict ข้ามแท็บ และ V1/V2 ปรับทางย้ายงานเดิมให้ใช้ได้จากหน้ารายการส่วนตัว |
| 1-A6 | ตรวจ owner/editor/viewer/outsider และเปลี่ยนบัญชีในแท็บเดิมกับ Auth จริงในเครื่อง เพิ่มการอ่านสิทธิ์ซ้ำเมื่อ API ปฏิเสธการเขียน และแยกร่าง/ภาพย่อตามบัญชีกับพื้นที่งาน |
| P1-10 | ผ่านบน Preview ของ `66a3fb2` ด้วย Google จริงใน Safari ส่วนตัว เปิดลิงก์ตรงก่อนเข้าสู่ระบบแล้วกลับเข้า Editor ของงานเดิม รีเฟรช Editor และหน้ารวมงานได้ |

ผลและสถานะด้านล่างเป็นประวัติการส่งงานวันที่ 3 พฤศจิกายน

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

**งานที่ส่งต่อ ณ 3 พฤศจิกายน:** ปิดข้อจำกัด viewer read-only ใน Editor (P1-08 UI) และตรวจบน preview ร่วมกับ B
