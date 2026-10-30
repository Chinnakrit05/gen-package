# ส่งต่องานให้คน B — API ข้อมูล และสิทธิ์

เอกสารนี้เป็น runbook สำหรับ AI ที่ช่วยคน B ทำ Phase 0–1 ของ PackIt Marketplace เท่านั้น การบันทึกเอกสารชุดนี้ยังไม่ใช่การลงมือแก้แอป ให้เริ่มแก้โค้ดเมื่อผู้ใช้ส่งคำสั่งเริ่มงาน เช่น prompt ท้ายไฟล์นี้

## เป้าหมายและขอบเขต

ทำให้การแยก routes และ Editor ของ A ใช้ session, workspace, project list, thumbnail, create/save/retry และ deep links ได้อย่างถูกต้อง โดยรักษา API และสิทธิ์เดิม ใช้ endpoint ที่มีอยู่ก่อน หากจำเป็นต้องปรับ ให้ทำเฉพาะช่องว่างที่พิสูจน์แล้วและตกลง contract กับ A

Phase 1 ไม่สร้างตาราง marketplace ใหม่ ไม่สร้างระบบขอราคา/เสนอราคา/แชต/คำสั่งผลิต/Admin เต็มชุด และไม่เปลี่ยน billing เดิม ระบบ marketplace ในแผนจ่ายเงินกันเองระหว่างคู่ค้า ห้ามแก้ไข Figma

## อ่านตามลำดับก่อนทำงานทุกครั้ง

1. `AGENTS.md` ที่ root และคำสั่งเฉพาะโฟลเดอร์ที่เกี่ยวข้อง; อ่าน `CLAUDE.md` ถ้ามี
2. `docs/marketplace/README.md`
3. `docs/marketplace/PLAN.md`
4. `docs/marketplace/PHASE-0-1.md`
5. ไฟล์ `HANDOFF-B.md` นี้
6. `docs/marketplace/PROGRESS-B.md` ของตน และ `PROGRESS-A.md` แบบอ่านอย่างเดียว
7. อ่าน `CONTEXT.md` เมื่อต้องตรวจคำศัพท์ และเปิดโค้ดจริงที่กำลังจะเปลี่ยน

`PHASE-0-1.md` เป็นนิยามงานและเกณฑ์รับงานหลัก เอกสารนี้ใช้แบ่งความรับผิดชอบ หากข้อมูลยังไม่มีหรือขัดกัน ให้บันทึก dependency ที่เจาะจงและทำส่วนที่ตรวจสอบได้ต่อ ห้ามถือว่าคู่ทีมอนุมัติหรือทดสอบแล้วเพียงเพราะมีชื่อ task อยู่ในเอกสาร

## พื้นที่ที่ B รับผิดชอบ

- `shared/contracts/`: สัญญาข้อมูลระหว่าง frontend และ API
- `server/`: endpoint, service, adapter, การตรวจสิทธิ์, validation และ tests ที่เกี่ยวข้อง
- `supabase/tests/`: ตรวจฐานข้อมูลเดิมเมื่อเกี่ยวข้อง โดยไม่เพิ่ม marketplace schema ใน Phase 1
- `vercel.json`: แก้ไฟล์ routing/rewrite ใน repository เท่าที่จำเป็นต่อ deep links และ API
- fixture/test environment และหลักฐาน API ที่ส่งให้ A โดยไม่รวม secrets
- บันทึกผลและ dependency ใน `docs/marketplace/PROGRESS-B.md` ของตน

A เป็นเจ้าภาพ `src/main.tsx`, `src/App.tsx`, `src/CloudRoot.tsx`, `src/features/projects/CloudWorkspace.tsx`, `src/app/`, styles, frontend components และ `src/services/api/` ส่งข้อเสนอ contract/error behavior ให้ A แทนการแก้หน้าเว็บของเขาเอง

ไฟล์ร่วม เช่น package/lockfile, config และ test utility ต้องกำหนดผู้แก้ก่อนเปลี่ยนพร้อมกัน ห้ามแก้ generated API ด้วยมือ ให้ยึด source และ build workflow ของ repository โดยประสานผลลัพธ์ generated กับอีกฝ่าย

## งาน Phase 0 ของ B

| ID | ผลที่ต้องส่งมอบ |
|---|---|
| `0-B1` | Audit API เดิม: endpoint, request/response, error, summary/thumbnail/pagination และ create/save/retry ตามโค้ดจริง |
| `0-B2` | ตารางสิทธิ์ user/workspace/project เดิม และขอบเขตการตรวจที่ server จริง |
| `0-B3` | Fixture และสภาพแวดล้อมทดสอบที่แยก local/cloud รวมบัญชี/workspace ทดสอบที่ได้รับอนุญาต |
| `0-J1` | ตกลงกับ A เรื่องข้อมูล pagination และสัญญาการสร้าง/บันทึก/ลองใหม่ |
| `0-J2` | ตรึงขอบเขต เจ้าภาพไฟล์ และ acceptance scenarios ร่วมกัน |

ต้องแยกสิ่งที่ implementation มีแล้วออกจากข้อเสนอ อย่าเพิ่ม endpoint ใหม่เพียงเพราะยังไม่ได้ค้น endpoint เดิม และอย่าใช้ interface หรือ fixture เป็นหลักฐานว่า API จริงตอบอย่างนั้น

## งาน Phase 1 ของ B

เริ่ม implementation เฟสนี้เมื่อ 0-J1 และ 0-J2 ผ่านจากหลักฐานการตรวจของทั้ง A และ B (ผู้พัฒนาหรือ AI ของแต่ละคน) การตรวจร่วมนี้ไม่ใช่ขั้นขออนุญาตผู้ใช้เพิ่ม ระหว่างรอ gate ให้ทำงาน Phase 0 ที่เป็นอิสระต่อ หลังผ่าน gate แล้วจึงเดินแต่ละงาน Phase 1 ตาม dependency โดยไม่ต้องรอให้อีกฝ่ายทำทั้งเฟสเสร็จ

ทำจากงานแรกของตนที่ยังไม่เสร็จ โดยยึด dependency และเกณฑ์ใน `PHASE-0-1.md`

| ID | งาน |
|---|---|
| `1-B1` | ยืนยัน API และ response เดิมที่ routes ใหม่ใช้ ปรับเฉพาะช่องว่างที่ตกลงกับ A |
| `1-B2` | รักษา create/save/retry/revision และการแยกข้อมูลแต่ละบัญชี/workspace |
| `1-B3` | ตรวจ OAuth return และ Vercel deep links/preview configuration; แก้ได้เฉพาะไฟล์ใน scope ไม่เปลี่ยน provider settings โดยอัตโนมัติ |
| `1-B4` | API access/regression tests และส่งมอบ test environment/หลักฐานให้ A |

### สิ่งที่ต้องรอจาก A

ผล router/browser จาก A เป็นเกณฑ์ปิด integration ร่วม ไม่ใช่เงื่อนไขเริ่มตรวจ API, สิทธิ์ หรือ revision/idempotency หลัง gate ของ Phase 0 ผ่านแล้ว ให้ส่ง contract/fixtures และตรวจงานอิสระต่อ โดยไม่รอให้หน้าเว็บทั้งหมดเสร็จ

- Route map และหน้า/ข้อมูลที่ต้องใช้ เพื่อยืนยัน contract และ deep-link behavior
- ข้อตกลง pagination/loading/error/unsaved exit เพื่อไม่ให้ backend และ UI คาดหวังต่างกัน
- หลักฐาน browser ฝั่ง A ก่อนอ้างว่า integration เส้นทางจริงผ่านแล้ว

ระหว่างรอให้ audit endpoint, authorization, revision/idempotency, test coverage และรูปแบบ fixture ต่อได้ ส่งตัวอย่าง request/response ที่ตัด secrets แล้วให้ A โดยระบุว่าเป็นผลจริงหรือ fixture อย่าเปลี่ยน contract ฝ่ายเดียวหลังตกลงเพื่อทำให้ test เฉพาะส่วนผ่าน

## ข้อจำกัดที่ต้องรักษา

- ตรวจ identity, membership และสิทธิ์โครงการที่ API ตามข้อมูลจริง การซ่อนเมนูหรือส่ง `workspaceId` จาก client ไม่ใช่ authorization
- สมาชิก workspace มีเพียงสิทธิ์ที่ระบบจริงคืนมา Phase 1 ไม่สร้าง supplier membership/role/admin จำลองเพื่อให้หน้าใหม่เข้าได้
- ตารางส่วนตัวเดิมใช้ API ฝั่ง server; อย่าเปิดให้ browser อ่านโดยตรงเพียงเพื่อให้งาน frontend ง่ายขึ้น และอย่าส่ง service-role secret ไป frontend
- ตรวจ user/workspace/project ให้สอดคล้องกันทั้งอ่านรายการ อ่านงาน สร้าง บันทึก thumbnail และไฟล์ที่เกี่ยวข้อง ไม่ตรวจเฉพาะ endpoint รายละเอียด
- Retry ต้องไม่สร้างงานซ้ำ และ revision conflict ต้องคงพฤติกรรมที่ตกลงไว้ ไม่เปลี่ยนเป็นเขียนทับข้อมูลใหม่โดยเงียบ ๆ
- เส้นทาง cloud ต้องยืนยันตัวตนจริง ไม่รับ local demo flag หรือ mock เป็นหลักฐานสิทธิ์
- Deep-link fallback ต้องไม่กลืน `/api/*`, asset paths หรือทำให้ API error กลายเป็น HTML ของหน้าเว็บ
- OAuth return ต้องจำกัดปลายทางภายในแอปที่อนุญาต ห้ามเพิ่ม token ลง returnTo/redirect URL เอง ให้ auth SDK จัดการ callback ตาม flow ที่ใช้จริง; การเปลี่ยน allowed redirect/provider settings เป็น remote action แยกจากการแก้ `vercel.json`
- ห้ามย้ายหรือเปลี่ยน engine/geometry/export/project schema/billing เพื่อรองรับการแยก routes

## การตรวจและหลักฐาน

ใช้ typecheck และ tests ที่เกี่ยวข้องกับ endpoint/contract ที่เปลี่ยน รวม access/regression tests ที่จำเป็น ตรวจ build ตาม workflow ของ repository และประสาน generated artifacts กับ A ไม่ย้อนการแก้ของอีกฝ่ายเพื่อทำให้ diff สะอาด

ต้องมีหลักฐานตาม acceptance ใน `PHASE-0-1.md`: บัญชีที่ไม่มีสิทธิ์เปิด project ID ไม่ได้, workspace ปลอมไม่ให้สิทธิ์, viewer ทำสิ่งที่ต้องใช้สิทธิ์แก้ไขไม่ได้, retry/create/save ไม่ทำข้อมูลซ้ำหรือข้ามบัญชี, revision conflict ถูกจัดการ, local demo ไม่ผ่าน cloud auth, deep-link refresh ใช้ได้ และ API rewrite/404 ยังเป็น API ตามเดิม

หากยังไม่มีสภาพแวดล้อม cloud ที่ได้รับอนุญาต ให้แยกผล unit/fixture/local tests ออกจาก cloud integration และระบุว่าการตรวจส่วนใดยังรออยู่ ห้ามรายงานว่า cloud ผ่านจากการรัน fixture เท่านั้น ไม่สร้างบัญชีจริง เปลี่ยน provider หรือ apply migration remote เพื่อเติมหลักฐานโดยไม่มีคำสั่งที่ครอบคลุม

บันทึกใน `PROGRESS-B.md`: task ID, สถานะจริง, ไฟล์ที่เปลี่ยน, contract ที่ยืนยัน/เปลี่ยน, คำสั่งและผลตรวจ, dependency ที่ขาด, สิ่งที่ A ต้องปรับ และงานแรกที่ควรทำต่อ ห้ามแก้ `PROGRESS-A.md` หรือรับรอง browser tests ของ A แทนเขา

## วิธีทำงานร่วมกันและขอบเขตการอนุญาต

ใช้ checkout ปัจจุบันที่เหมาะสมก่อน ถ้าสองคนทำงานพร้อมกัน แนะนำให้แต่ละคนมี checkout ของตนและ branch เช่น `codex/marketplace-a-phase-1` / `codex/marketplace-b-phase-1` ตามการจัดสภาพแวดล้อมที่ตกลงกัน ห้ามสลับ branch ใน checkout ที่อีกฝ่ายกำลังใช้ และไม่สร้าง worktree ใหม่โดยอัตโนมัติ การจัดทำเอกสารครั้งนี้ไม่ได้สร้าง branch ใด

คำสั่งเริ่มงานท้ายไฟล์อนุญาตให้ทำ Phase 0 แล้วลงมือ Phase 1 เฉพาะของ B เมื่อผ่าน gate ที่เกี่ยวข้อง งานทั่วไปในขอบเขตนั้นทำต่อได้โดยไม่ถามยืนยันซ้ำ การ commit/push ให้ตรวจคำสั่งของผู้ใช้และขอบเขตที่ได้รับอนุญาตในแชตจริง ถ้ามีคำสั่งครอบคลุมอยู่แล้วไม่ต้องขอซ้ำ แต่ prompt นี้ไม่ได้สั่ง commit/push เอง

การแก้ `vercel.json` ใน checkout ไม่ใช่การอนุญาตให้ deploy หรือแก้ Vercel/Supabase/OAuth provider ผ่าน remote console การกระทำ remote, migrations และ deploy ต้องมี authorization ที่ครอบคลุมจริง ถ้าไม่มีให้บันทึกการตั้งค่าที่ต้องการโดยไม่เปิดเผย secrets และหยุดเฉพาะส่วนที่ติดเงื่อนไข

## Prompt สำหรับคัดลอกไปให้ AI ของคน B

```text
คุณรับบทคน B ในโปรเจกต์ PackIt Marketplace ให้ตรวจ checkout ปัจจุบันแล้วอ่านตามลำดับ:
1) AGENTS.md ที่ root และคำสั่งเฉพาะโฟลเดอร์ที่เกี่ยวข้อง; CLAUDE.md ถ้ามี
2) docs/marketplace/README.md
3) docs/marketplace/PLAN.md
4) docs/marketplace/PHASE-0-1.md
5) docs/marketplace/HANDOFF-B.md
6) docs/marketplace/PROGRESS-B.md และ PROGRESS-A.md โดยไฟล์ของ A อ่านอย่างเดียว
อ่าน CONTEXT.md เมื่อต้องตรวจคำศัพท์ แล้วตรวจโค้ดจริงก่อนสรุปสถานะ

ฉันสั่งให้เริ่มทำ Phase 0 ของ B แล้วลงมือ implement Phase 1 ของ B หลัง 0-J1 และ 0-J2 มีหลักฐานการตรวจร่วมของทั้ง A/B จากนั้นทำแต่ละงานตาม dependency โดยไม่รอผล router/browser เพื่อเริ่มตรวจ API และสิทธิ์ ให้เริ่มจาก task แรกที่ยังไม่เสร็จตามหลักฐานจริง ไม่เริ่มแผนใหม่ ไม่ทำงานที่เสร็จแล้วซ้ำ และหยุดขอบเขตงานที่สิ้นสุด Phase 1 ไม่สร้าง Phase 2 หรือ marketplace เต็มระบบ

คุณเป็นเจ้าภาพ shared/contracts, server/API/auth/access tests, supabase/tests และไฟล์ vercel.json ตาม HANDOFF-B ใช้ endpoint เดิมก่อน ปรับเฉพาะช่องว่างที่ตรวจพบและตกลงกับ A รักษา engine, project schema, billing และ semantics ของ create/save/retry/revision เดิม ไม่เพิ่มตาราง marketplace หรือสิทธิ์โรงงานจำลอง ห้ามแก้ไข Figma

ทำงานที่ได้รับอนุญาตและเป็นอิสระต่อได้โดยไม่ถามยืนยันซ้ำ เมื่อขาดหลักฐานจาก A ให้บันทึก dependency ที่เจาะจงใน PROGRESS-B แล้วทำงานที่ไม่ติด dependency ต่อ ห้ามทำเครื่องหมายงานร่วมหรืองาน A ว่าผ่านแทนเขา ห้ามแก้ PROGRESS-A หรือไฟล์ที่ A เป็นเจ้าภาพโดยไม่ประสาน

ตรวจสิทธิ์ที่ API จาก identity/membership จริง อย่าเปิดตารางส่วนตัวให้ browser หรือใช้ local demo เป็น cloud authorization ตรวจ deep-link fallback โดยรักษา API/assets และแยกผล local/fixture tests จาก cloud integration อัปเดต PROGRESS-B ด้วย task IDs ผลตรวจจริง contract ที่ตกลง และสิ่งที่รอ ไม่บันทึก secrets

ใช้ checkout ที่เหมาะสมอยู่แล้ว ไม่สร้าง worktree หรือสลับ branch ที่อีกคนใช้อยู่โดยอัตโนมัติ ตรวจ authorization ในแชตจริงก่อน commit/push หรือเปลี่ยน remote environment; prompt นี้อนุญาตการแก้ไฟล์ vercel.json ใน scope แต่ไม่ได้สั่ง publish/deploy/apply migration หรือเปลี่ยน Vercel/Supabase/OAuth provider settings

เมื่อจบให้รายงานงานที่เสร็จพร้อม IDs, ผล typecheck/tests/build/API integration ที่ทำจริง, สิ่งที่ยังไม่ตรวจหรือถูกบล็อก และ handoff ที่ A ต้องรู้ ถ้า Phase 1 ยังไม่ครบให้ระบุส่วนที่เหลือตรง ๆ ไม่กล่าวว่าเสร็จทั้งหมด
```
