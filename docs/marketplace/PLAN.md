# แผนพัฒนา PackIt Marketplace และ Admin

บันทึกวันที่ 30 ตุลาคม 2026 แผนนี้ต่อยอดจาก Editor V1/V2 และระบบ Cloud เดิม ใช้แบ่งงานผู้พัฒนาสองคน โดยเริ่มตรวจและแยก Editor ก่อนสร้างระบบธุรกรรมใหม่ รายการในแผนยังไม่ใช่ implementation ที่เสร็จแล้ว

## ขอบเขตผลิตภัณฑ์

ผู้ใช้สร้างแพ็กเกจ → โพสต์ขอราคา → โรงงานหรือร้านปริ้นที่เกี่ยวข้องส่งข้อเสนอ → เปรียบเทียบและแชต → ผู้ซื้อเลือกข้อเสนอ → โรงงานยืนยันรับงาน → ติดตามการผลิตในเว็บ คู่ค้าชำระเงินกันเอง

- หนึ่งคำขอเลือกผู้รับผลิตหนึ่งแห่งในรุ่นแรก
- สเปกที่เผยแพร่และราคาที่ส่งแล้วเก็บเป็นฉบับ แก้ไขโดยสร้างฉบับใหม่
- หนึ่งคำขอกับหนึ่งร้านมีห้องสนทนาเดียว และใช้ห้องเดิมต่อกับคำสั่งผลิต
- ผู้ซื้อเลือกข้อเสนอแล้วยังรอโรงงานยืนยัน จึงปิดรับและแจ้งร้านอื่นเมื่อยืนยันสำเร็จ
- อนุมัติแบบ การแจ้งโอน การรับรองเงิน และสถานะผลิตเป็นข้อมูลแยกกัน
- เริ่มผลิตตามเงื่อนไขที่ตกลง เช่น อนุมัติแบบฉบับล่าสุดและโรงงานรับรองมัดจำแล้ว
- Figma เป็นแหล่งอ้างอิงแบบอ่านอย่างเดียว ห้ามแก้ไข

ระบบแบ่งล็อตหลายโรงงาน การรับเงินผ่าน PackIt การเชื่อมขนส่งอัตโนมัติ และรายงานธุรกิจขั้นสูงอยู่นอกขอบเขตรุ่นแรก

## ฐานโค้ดที่ต้องรักษา

ฐานที่ใช้ตรวจตั้งต้นคือ commit 1f111e1 ซึ่งมี Editor V1/V2 ผู้ลงมือแต่ละคนต้องตรวจ branch/commit และสภาพไฟล์อีกครั้ง

| ส่วน | มีอยู่แล้ว | งานที่จะเพิ่ม |
|---|---|---|
| หน้าเว็บ | React 19.2.7, TypeScript 5.7.3, Vite 6.4.3, CSS, Lucide, Fontsource | React Router, TanStack Query และหน้า Marketplace/Admin |
| Editor | Three.js, React Three Fiber, Drei, SVG/Canvas, PDF/DXF/export ที่เขียนเอง | แยกจุดโหลดและทางเข้า โดยคงเครื่องมือเดิม |
| Backend | Node.js 24.x, TypeScript, custom router, Zod, esbuild | โมดูลตามธุรกิจและ API Admin |
| ข้อมูล | Supabase Auth, PostgreSQL, Storage, SQL migrations/RPC | ตารางธุรกรรมและสิทธิ์คู่ค้า |
| บันทึกในเครื่อง | IndexedDB draft/save queue/thumbnail cache และ localStorage บางส่วน | เชื่อม lifecycle กับ routes และการเปลี่ยนบริบท |
| แชต | ยังไม่มีห้องสนทนา Marketplace | ข้อความถาวรและ private Supabase Realtime |
| AI | Anthropic SDK, งานสเปก/ลวดลาย และ Sharp สำหรับภาพ | ใช้ระบบเดิมตามขอบเขต Editor |
| ทดสอบ | Vitest, Playwright Core, pgTAP, Supabase CLI | เพิ่มกรณีที่เกี่ยวกับ routes สิทธิ์ และธุรกรรม |
| Deploy | มี Vercel configuration และ adapters | SPA deep-link routing และตรวจบน preview ที่ได้รับอนุญาต |

เวอร์ชันข้างต้นอ้าง repository ณ วันที่บันทึก ไม่ใช่ผลตรวจ production ระบบ billing เดิมเกี่ยวกับแพ็กเกจ/สิทธิ์/เครดิต AI และแยกจากคำสั่งผลิต ยังไม่มี payment gateway จริงในโค้ดที่ตรวจ

## โครงสร้างและการโหลด

- ใช้ repository, API และฐานข้อมูลกลางร่วมกัน แยก frontend modules และสิทธิ์ตามพื้นที่
- app ดูแล router/providers/layouts/guards ที่เบา
- features แบ่งเป็น editor, projects, requests, quotations, conversations, production-orders, suppliers, notifications และ admin
- หน้าผู้ใช้กับโรงงานมีเมนูและรายการต่างกัน ส่วนรายละเอียดคำขอ แชต และคำสั่งผลิตใช้ฟีเจอร์ร่วมกันตามสิทธิ์
- หน้ารายการใช้ข้อมูลสรุปและภาพตัวอย่าง ไม่ import Editor หรือสร้างภาพด้วย 3D ทุกการ์ด
- เก็บเครื่องมือ Editor และ font/style เฉพาะไว้ในขอบเขตที่โหลดเมื่อเข้าใช้งาน
- หน้าใดเปิดอยู่จึงโหลดข้อมูลที่ต้องใช้ รายการและข้อความเก่าโหลดเป็นหน้า Cache ผูกบัญชีและ workspace

## Routes เป้าหมาย

| พื้นที่ | Routes |
|---|---|
| บัญชี | /login, /auth/callback |
| ผู้ใช้ | /app/projects, /app/requests, /app/requests/new?projectId=…, /app/orders |
| Editor | /editor/:projectId; ทางสร้างงานใหม่ใน Editor ให้ตรึงรายละเอียดในเฟส 0 |
| โรงงาน | /factory/onboarding, /factory/:supplierId/jobs, /factory/:supplierId/quotes, /factory/:supplierId/orders, /factory/:supplierId/profile |
| รายละเอียดร่วม | /requests/:requestId, /chat, /chat/:conversationId, /orders/:orderId |
| สาธารณะ | /suppliers/:slug |
| Admin | /admin, /admin/users, /admin/suppliers, /admin/requests, /admin/orders, /admin/support, /admin/audit-log |

เฟส 1 เปิดใช้เฉพาะเส้นทางบัญชี รายการงาน และ Editor ส่วนที่เหลือเป็นเป้าหมายระยะถัดไป เส้นทางใหม่ต้องรองรับการเปิดตรง refresh และกลับจาก login โดยไม่กลืน API หรือ static assets

## โครงสร้างข้อมูลเป้าหมาย

ชื่อด้านล่างเป็นแบบจำลองสำหรับเฟสธุรกิจ ต้องออกแบบ constraints และ API ก่อนสร้าง migration ไม่สร้างตารางทั้งหมดระหว่างแยก Editor

| กลุ่ม | ตาราง/ความสัมพันธ์ |
|---|---|
| บัญชีเดิม | app_users, auth_identities, workspaces, workspace_members |
| กิจการ | supplier_profiles ผูก workspace แบบหนึ่งต่อหนึ่ง และ supplier_capabilities |
| สิทธิ์ธุรกิจ | workspace_marketplace_members แยกจากสิทธิ์แก้งานออกแบบ |
| คำขอ | requests, request_revisions, request_supplier_access |
| ข้อเสนอ | quotations หนึ่งรายการหลักต่อคำขอ–ร้าน; quotation_revisions อ้าง request_revision_id |
| สนทนา | conversations หนึ่งห้องต่อคำขอ–ร้าน, messages, conversation_reads |
| งานผลิต | production_orders อ้าง accepted_quote_revision_id พร้อม snapshot ข้อตกลงและคู่สัญญา |
| ไฟล์ | marketplace_files, ตารางเชื่อมไฟล์ที่มี foreign keys และ file_grants |
| หลังยืนยัน | order_proofs และ payment_reports |
| ประวัติ/แจ้งเตือน | activity_events, notifications, notification_outbox |
| เจ้าหน้าที่ PackIt | platform_staff และประวัติการเข้าถึง/จัดการของ Admin |

Projects ปัจจุบันเก็บเอกสารล่าสุดและเลข revision จึงต้องคัดลอกสเปก/preview จริงเมื่อเผยแพร่คำขอ การอ้างเลข revision อย่างเดียวไม่เก็บเนื้อหาเก่าไว้ ส่วน asset เดิมเป็นภาพใน workspace จึงต้องเพิ่มขอบเขตไฟล์แนบและการแชร์คู่ค้าในเฟสที่เกี่ยวข้อง

## สิทธิ์และกติกาธุรกรรม

- ตรวจทั้งสิทธิ์บุคคลใน workspace และความสัมพันธ์ของ workspace กับรายการนั้น
- ผู้รับผลิตไม่ถูกเพิ่มเป็นสมาชิก workspace ของผู้ซื้อเพื่อให้เห็นงาน
- ผู้ซื้อเห็นข้อเสนอที่ส่งแล้ว ร้านเห็นร่างและข้อเสนอของตัวเองเท่านั้น ไม่คืนราคาคู่แข่งผ่านรายการ นับจำนวน ประวัติ หรือการค้นหา
- ให้สิทธิ์ดูคำขอผ่านการจับคู่/เชิญอย่างชัดเจน การได้รับ notification ไม่ใช่หลักฐานสิทธิ์
- ข้อมูลสาธารณะเพื่อเสนอราคาแยกจากที่อยู่เต็ม ข้อมูลการเงิน และไฟล์ต้นฉบับ
- ไฟล์ผลิต สลิป และไฟล์ภายในมีสิทธิ์ตามบริบท ตรวจสิทธิ์ก่อนออกลิงก์ดาวน์โหลด
- API ธุรกิจเดิมใช้ server service role และต้องตรวจ actor/workspace เอง RLS อย่างเดียวไม่ครอบคลุมเส้นทางนั้น
- บันทึกข้อความก่อนแจ้งผ่าน Realtime ใช้ private channel และตรวจสิทธิ์อ่านจริงที่ API การถอนสมาชิกต้องจัดการคำขอค้าง cache และการเชื่อมต่อด้วย
- บทบาท Marketplace รุ่นแรกคือ manager/staff/viewer โดยสิทธิ์ส่งข้อเสนอผูกพัน ยืนยันงาน อนุมัติแบบ และเงินอยู่กับผู้รับผิดชอบที่ได้รับมอบหมาย
- เจ้าของโรงงานไม่เป็น Platform Admin โดยอัตโนมัติ Admin เข้าด้วยสิทธิ์เฉพาะและ MFA ตามนโยบายที่จะสร้าง

สถานะหลัก: request draft → open → selection_pending → awarded; order เริ่ม pending_supplier_confirmation แล้ว confirmed เมื่อร้านยืนยัน หากปฏิเสธหรือหมดเวลาให้ปิดรายการรอยืนยันและพิจารณาเปิดคำขอต่อเมื่อยังอยู่ในช่วงรับราคา

การเลือกและยืนยันต้องตรวจฉบับสเปก/ราคา อายุข้อเสนอ การถอน และสิทธิ์ภายใน transaction พร้อมป้องกันคำสั่งซ้ำ หนึ่งคำขอมีคำสั่งที่รอยืนยันหรือดำเนินการอยู่ได้ไม่เกินหนึ่งรายการตามขอบเขตรุ่นแรก ข้อตกลงที่ยืนยันแล้วไม่ถูกแก้ทับเงียบ ๆ

## Admin

แยก /admin และ API กลุ่ม admin แต่ใช้ข้อมูลกลางเดิม ให้สิทธิ์ตามหน้าที่และบันทึกเหตุผล/ประวัติเมื่อเปลี่ยนสถานะหรือเข้าถึงข้อมูลละเอียด

การระงับบุคคล การถอดสมาชิกทีม และการพักรับงานของโรงงานเป็นคนละคำสั่ง การพักโรงงานไม่ยกเลิกคำสั่งผลิตเก่าอัตโนมัติ ฝ่าย Support ไม่ได้อ่านแชต/ไฟล์ผลิต/สลิปทุกงานเป็นค่าเริ่มต้น การดูข้อมูลละเอียดต้องเกี่ยวกับเคสและสิทธิ์ที่ได้รับ

สิทธิ์แอดมินและเครื่องมืออนุมัติ/ระงับร้านขั้นต่ำต้องพร้อมก่อนเริ่มทดลองขอราคาจริง ส่วน dashboard/รายงาน/เครื่องมือช่วยเหลือฉบับเต็มตามมาหลังธุรกรรมลงตัว

## Roadmap และเจ้าภาพ

สมมติทีมสองคนเต็มเวลาและคุ้น stack เดิม กรอบเริ่มต้น 10–14 สัปดาห์รวม integration และทดลองใช้ ประเมินใหม่หลังแยก Editor และคำขอแรกทำงานจริง

| เฟส | คน A | คน B | ผลส่งมอบ |
|---|---|---|---|
| 0 ข้อตกลง 2–3 วัน | Routes, UX states, baseline Editor | API contracts, สิทธิ์, ข้อมูลทดสอบ | สัญญาและชุดตรวจรับที่ทั้งคู่ตรวจตรงกัน |
| 1 แยก Editor 1–1.5 สัปดาห์ | Shell/router/Query, gallery, lazy Editor, draft lifecycle | ตรวจ API/session เดิม, authorization, deep links และ regression | รายการงาน ↔ Editor ใช้จริง ไม่เสียข้อมูล |
| 2 โรงงานและสิทธิ์ 1–1.5 สัปดาห์ | สมัครร้าน/profile/context, Admin ขั้นต่ำ | สมาชิก/profile/capabilities, สิทธิ์/ไฟล์/audit/outbox | อนุมัติและพักร้านได้ ข้อมูลไม่ข้ามองค์กร |
| 3 ขอราคาและข้อเสนอ 2–2.5 สัปดาห์ | Wizard, รายการ, quote form, compare | Snapshot/revision/access/matching/pricing | โพสต์และเปรียบเทียบหลายร้านได้ตามสิทธิ์ |
| 4 แชต 1–1.5 สัปดาห์ | Inbox/thread/files/read state/retry | Persistence/private Realtime/pagination/dedupe/outbox | สนทนาและกลับมาอ่านข้อความครบได้ |
| 5 คำสั่งผลิต 1.5–2 สัปดาห์ | เลือกร้าน รอยืนยัน รายละเอียด proof/payment/status | Transactions/version guards/idempotency/proof/payment records | ยืนยันสองฝ่ายได้งานเดียว เงื่อนไขเริ่มผลิตถูกต้อง |
| 6 Admin 1–1.5 สัปดาห์ | Dashboard/search/support/audit UI | Admin API/scopes/search indexes/exception handling | ดูแลระบบและเคสจริงตามสิทธิ์ได้ |
| 7 ทดลองครบระบบ 1–2 สัปดาห์ | Browser/device checks และ UX | Permission/concurrency/restore/operational checks | กลุ่มทดลองเดิน flow ครบและจัดการรายการค้างได้ |

ช่วงเวลาเป็นประมาณการของงานที่ A/B ทำขนานกัน ไม่ใช่บวกจำนวนวันของทั้งสองคน และอาจซ้อนบางงานตรวจสอบได้ ลำดับที่ห้ามข้ามคือบัญชี/สิทธิ์ → สเปกที่ตรึงฉบับ → ข้อเสนอที่อ้างฉบับ → การยืนยันคำสั่งผลิต

## วิธีร่วมงาน

- A เป็นเจ้าภาพ src/app, frontend features/components/styles, main/CloudRoot/App/CloudWorkspace, client API และ browser checks
- B เป็นเจ้าภาพ server, shared/contracts, supabase checks/migrations ที่ถึงเฟสแล้ว และ vercel.json
- เปลี่ยน contract โดย B รวมและ A review ก่อนนำไปใช้ ไม่แก้สัญญาทั้งสอง branch คนละแบบ
- A ใช้ fixture ตาม contract ระหว่างรอได้ แต่ปิดงาน integration ด้วย API จริงและ commit ที่ระบุ
- ไม่เขียนทับงานคนอื่น ไม่ย้าย Editor engine ทั้งก้อนเพียงเพื่อให้ตรง folder tree และไม่สร้าง backend ที่มีอยู่แล้วซ้ำ
- รายละเอียดงานเฟส 0/1 และ gates อยู่ใน [PHASE-0-1.md](PHASE-0-1.md)
- รายงานผลจริงใน [PROGRESS-A.md](PROGRESS-A.md) และ [PROGRESS-B.md](PROGRESS-B.md) ไม่เปลี่ยนสถานะอีกฝ่ายจากการคาดเดา
