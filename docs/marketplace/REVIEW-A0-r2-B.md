# B รับผลแก้ A0-r2 และปิด Gate Phase 0

Review revision **b-review-a0-r2-r1** — 2 พฤศจิกายน 2026

ตรวจ `ROUTES-PHASE-1.md` รุ่น **A0-r2** และ `PROGRESS-A.md` ที่ commit **b6cb70876f396381a06c04f547011504eca9457b** หลังรับเข้า branch B ด้วย fast-forward โดยไม่มี conflict ชุดนี้รวม B contract **b-phase0-r1** (`2398c4d`) และ review **b-review-a0-r1-r1** (`acac249`) แล้ว

## ผลตรวจหลังแก้

| ข้อ | หลักฐานใน A0-r2 | ผล B |
|---|---|---|
| R1 | §7 R1: cursor ไม่ใช่ snapshot, dedupe/update ตาม projectId, reset หน้าแรกตาม mutation/กลับ Editor/refresh และไม่วนทุกหน้า | รับ |
| R2 | §2.4 / §7 R2: intent ผูก account/workspace/history entry เก็บ frozen payload + operationId ก่อน POST และเก็บ result ก่อน replace URL; มี recovery ทั้ง response หายและก่อน replace | รับ |
| R3 | §7 R3: เก็บ latest draft ก่อนมี server ID, freeze เมื่อออนไลน์, ย้ายการแก้หลัง freeze เข้า queue ของ ID จริงและ await persistence ก่อนลบ intent | รับ |
| R4 | §3.2 / §7 R4: flush state ล่าสุด, await capture, capture ล้มไม่ออกอัตโนมัติ, ตรวจ status/generation หลัง capture และหลัง flush | รับ |
| R5 | §7 R5: blocker ครอบ back/forward/logout/workspace, token provider ผูกเจ้าของ + context epoch, ไม่ส่งคิวเก่าด้วย token บัญชีใหม่ และระบุข้อจำกัด native unload ตรง ๆ | รับเป็น lifecycle contract; ต้องพิสูจน์ behavior ใน Phase 1 |

A0-r2 §0 และ PROGRESS-A บันทึกว่า A รับ API/permissions/fixtures b-phase0-r1 และคำตอบ B ทั้งห้าข้อแล้ว; §5.2 และ PROGRESS-A ยืนยัน scope, task IDs, เจ้าภาพไฟล์ และผู้เก็บหลักฐาน P1-01..P1-12 ตรงกับตาราง B

**0-J1 = DONE และ 0-J2 = DONE สำหรับชุด A0-r2 + b-phase0-r1 + b-review-a0-r1-r1 + review ฉบับนี้** มีหลักฐาน A/B ต่อชุดที่จะใช้จริงแล้ว จึงเริ่ม Phase 1 ของแต่ละฝ่ายตาม dependency ได้ ไม่ต้องรอ preview/router ทั้งชุด และไม่ต้องเริ่ม Marketplace ระยะถัดไป

## ข้อที่ต้องตรวจตอน implementation

- การรับเอกสารไม่ใช่การผ่าน P1-01..P1-12; ตาราง tests ใน A0-r1 เป็น baseline ที่ A รายงาน ไม่ใช่ผล router ใหม่
- Browser ไม่รับประกันรอ async ใน beforeunload/pagehide และ native dialog อาจระงับ JavaScript ห้ามใช้การคาดว่า capture จะเสร็จระหว่าง dialog เป็นหลักฐานความทนทาน ต้องเริ่ม capture ต่อเนื่องและตรวจ refresh ภายในช่วง debounce จริง; force close/ปฏิเสธคำเตือนที่ข้อมูลยังไม่ persist เป็นข้อจำกัดที่ A ระบุ ไม่ให้นับเป็น recovery PASS
- การย้ายร่างจาก intent ไป project ID จริงต้องแก้ project.id/sidecar scope ให้ตรงและไม่ทับ generation ใหม่เมื่อ remount/recovery ทำซ้ำ; เป็นงาน A ตาม contract ไม่เพิ่ม API ใหม่
- แยก auth subject ของ Supabase จาก internal appUserId เมื่อทำ token provider ใช้ mapping จาก bootstrap ที่ผ่านการยืนยัน ไม่เปรียบเทียบ UUID คนละชนิดโดยตรง
- Idempotency ไม่ใช่ authorization: actor อื่นที่มีสิทธิ์ใน workspace เดียวกันอาจใช้ operationId เดียวกันเป็น operation ของตนได้ตาม contractเดิม ฝั่ง client ต้องกัน replay ข้ามเจ้าของ ส่วน B ตรวจ permission ของ actor ที่ส่งจริง
- Real Auth/DB, browser สองบัญชี, preview OAuth และ routing ต้องบันทึก environment/commit ของผลใหม่แยกจาก fixture/local source checks

B ไม่แก้ ROUTES-PHASE-1.md หรือ PROGRESS-A.md แทน A ผล review นี้ไม่มีการเปลี่ยน DTO, schema, engine หรือ billing
