# ส่งต่องานให้คน A — หน้าเว็บและ Editor

เอกสารนี้เป็น runbook สำหรับ AI ที่ช่วยคน A ทำ Phase 0–1 ของ PackIt Marketplace เท่านั้น การบันทึกเอกสารชุดนี้ยังไม่ใช่การลงมือแก้แอป ให้เริ่มแก้โค้ดเมื่อผู้ใช้ส่งคำสั่งเริ่มงาน เช่น prompt ท้ายไฟล์นี้

## เป้าหมายและขอบเขต

แยก Editor ออกจากโครงเว็บและหน้ารายการงาน โดยรักษาการเปิดโครงการ การบันทึก draft/cloud และการสลับ V1/V2 เดิม ใช้ API ที่มีอยู่และสัญญาที่ตกลงกับ B หน้าโรงงาน ขอราคา เสนอราคา แชต คำสั่งผลิต และ Admin เต็มระบบเป็นแผนระยะถัดไป ไม่ใช่สิ่งที่ต้องสร้างให้ครบใน Phase 1

การจ่ายเงินของ marketplace ในแผนเป็นการจ่ายกันเองระหว่างคู่ค้า ห้ามเปลี่ยนขอบเขตเป็นระบบรับชำระเงินของ PackIt ห้ามแก้ไข Figma

## อ่านตามลำดับก่อนทำงานทุกครั้ง

1. `AGENTS.md` ที่ root และคำสั่งเฉพาะโฟลเดอร์ที่เกี่ยวข้อง; อ่าน `CLAUDE.md` ถ้ามี
2. `docs/marketplace/README.md`
3. `docs/marketplace/PLAN.md`
4. `docs/marketplace/PHASE-0-1.md`
5. ไฟล์ `HANDOFF-A.md` นี้
6. `docs/marketplace/PROGRESS-A.md` ของตน และ `PROGRESS-B.md` แบบอ่านอย่างเดียว
7. อ่าน `CONTEXT.md` เมื่อต้องตรวจคำศัพท์ และเปิดไฟล์โค้ดจริงที่กำลังจะเปลี่ยน

`PHASE-0-1.md` เป็นนิยามงานและเกณฑ์รับงานหลัก เอกสารนี้ใช้แบ่งความรับผิดชอบ หากเอกสารที่จำเป็นยังไม่มีหรือขัดกัน ให้บันทึกชื่อไฟล์/หัวข้อที่ขาดและทำงานตรวจสอบที่ไม่ขึ้นกับส่วนนั้นต่อ ห้ามสร้างหลักฐานว่าคู่ทีมตกลงแล้วแทนเขา

## พื้นที่ที่ A รับผิดชอบ

- หน้าเว็บ: `src/main.tsx`, `src/App.tsx`, `src/CloudRoot.tsx`, `src/features/projects/CloudWorkspace.tsx`
- route, layout, provider และ guard ฝั่งหน้าเว็บใน `src/app/`
- หน้ารายการงาน, components ที่เกี่ยวข้อง, styles และขอบเขตการโหลด CSS/fonts
- API client ฝั่ง browser ใน `src/services/api/` ตาม contract ที่ตกลงกับ B
- Query/cache ฝั่งหน้าเว็บและการตรวจพฤติกรรมผ่าน browser รวมถึง frontend tests ที่เกี่ยวข้อง
- บันทึกผลและ dependency ใน `docs/marketplace/PROGRESS-A.md` ของตน

B เป็นเจ้าภาพ `shared/contracts/`, `server/`, `supabase/tests/` และ `vercel.json` อย่าแก้ไฟล์เหล่านี้เองเพื่อทำให้ UI ผ่าน หากต้องเปลี่ยน contract ให้ส่งข้อเสนอพร้อมเหตุผลและตัวอย่าง request/response ไปให้ B

ไฟล์ร่วม เช่น `package.json`, lockfile, test/config หรือ utility ที่ยังไม่ถูกจัดเจ้าภาพ ต้องระบุผู้แก้และขอบเขตในข้อตกลง Phase 0 ก่อนเปลี่ยนพร้อมกัน ไม่ควรสร้างโครง API หรือ type ซ้ำขึ้นมาเพื่อหลีกเลี่ยงไฟล์ของ B

ห้ามย้ายหรือเปลี่ยนกติกาเครื่องยนต์ออกแบบใน `src/core/`, geometry, fold, renderer, export, project schema หรือ billing เพื่อทำการแยก routes ให้ใช้ wrapper รอบ Editor เดิมก่อน

## งาน Phase 0 ของ A

| ID | ผลที่ต้องส่งมอบ |
|---|---|
| `0-A1` | แผน routes/navigation รวมการสร้างงานใหม่ การเปิดลิงก์ตรง และเส้นทางกลับหลังล็อกอิน |
| `0-A2` | พฤติกรรม loading/error/no access/not found รวมการออกจาก Editor เมื่อมีงานยังบันทึกไม่เสร็จ |
| `0-A3` | แผนที่ dependency ของ Editor และ baseline ที่ตรวจจากโค้ด/การใช้งานจริง |
| `0-J1` | ตกลงกับ B เรื่องข้อมูลที่ UI ต้องใช้ pagination และสัญญาการสร้าง/บันทึก/ลองใหม่ |
| `0-J2` | ตรึงขอบเขต เจ้าภาพไฟล์ และ acceptance scenarios ร่วมกัน |

แยกให้ชัดว่าอะไรมีอยู่แล้ว อะไรเป็นข้อเสนอ และอะไรทดลองแล้ว ห้ามถือการมี interface ในโค้ดเป็นหลักฐานว่า endpoint คืนข้อมูลนั้นจริง

## งาน Phase 1 ของ A

เริ่ม implementation เฟสนี้เมื่อ 0-J1 และ 0-J2 ผ่านจากหลักฐานการตรวจของทั้ง A และ B (ผู้พัฒนาหรือ AI ของแต่ละคน) การตรวจร่วมนี้ไม่ใช่ขั้นขออนุญาตผู้ใช้เพิ่ม ระหว่างรอ gate ให้ทำงาน Phase 0 ที่เป็นอิสระต่อ หลังผ่าน gate แล้วจึงเดินแต่ละงาน Phase 1 ตาม dependency โดยไม่ต้องรอให้อีกฝ่ายทำทั้งเฟสเสร็จ

ทำจากงานแรกของตนที่ยังไม่เสร็จ โดยยึด dependency และเกณฑ์ใน `PHASE-0-1.md`

| ID | งาน |
|---|---|
| `1-A1` | Router และ Query shell ที่เบา โดยใช้ contract และ package ownership ที่ตกลงแล้ว |
| `1-A2` | Editor lazy boundary; แก้การ preload ที่ดึง Editor ทุกหน้า; แยกขอบเขต CSS/fonts |
| `1-A3` | รายการโครงการแบบแบ่งหน้า ใช้ summary และ thumbnail ตาม API จริง |
| `1-A4` | เปิดโครงการตาม ID ใน route อย่างถูกต้อง และสร้างงานใหม่จากภายใน Editor ตามข้อตกลง |
| `1-A5` | รักษา draft/save/retry/leave behavior และ V1/V2 |
| `1-A6` | Login return, session, cache และบริบทผู้ใช้/workspace ที่ไม่ปะปนกัน |

### สิ่งที่ต้องรอจาก B

รายการรอด้านล่างผูกเฉพาะงานที่ต้องใช้ข้อมูลนั้น ผล preview/deep links ของ 1-B3 เป็นเกณฑ์ปิด integration ไม่ใช่เงื่อนไขเริ่ม router, Editor isolation หรือ API client หลัง gate ของ Phase 0 ผ่านแล้ว จึงไม่ต้องรอให้ B ทำ Phase 1 ทั้งหมดก่อนเริ่ม

- รูปแบบ session/membership และ error ที่ยืนยันจาก API จริง ก่อนผูก guard และตัวเลือก workspace
- สัญญา project summary/thumbnail/pagination ก่อนเชื่อมรายการงานจริง
- สัญญา create/save/revision/retry ก่อนผูกการสร้างและบันทึกงานตาม route
- หลักฐาน deep-link/API rewrite และสภาพแวดล้อมทดสอบ ก่อนอ้างว่าการเปิดลิงก์ production-like ผ่านแล้ว

ระหว่างรอทำ layout, loading/error states, dependency map, CSS boundary และ tests ที่เป็นอิสระได้ ใช้ fixture ตาม contract ที่ตกลงแล้วเฉพาะสำหรับพัฒนา/ทดสอบ ระบุให้ชัดว่าเป็น fixture และอย่านำ mock มาแทน cloud authorization หรือรายงานว่าการเชื่อม API ผ่านแล้ว

## ข้อจำกัดที่ต้องรักษา

- Route guard ช่วยเรื่องหน้าจอ แต่สิทธิ์จริงอยู่ที่ API; ห้ามส่ง workspace ID หรือ role ที่ตั้งเองแล้วถือว่าได้รับสิทธิ์
- ตัวเลือก workspace ใช้เฉพาะ membership ที่เซิร์ฟเวอร์คืนจริง ไม่สร้างโรงงาน สมาชิก หรือ role จำลองใน Phase 1
- `/editor/:projectId` ต้องเปิดงานนั้นจริง ไม่แอบเปิดงานล่าสุดหรือสร้างงานทดแทนเมื่อไม่มีสิทธิ์
- Login return ต้องเป็นเส้นทางภายในแอปที่อนุญาต ป้องกัน URL ภายนอกและ `//host` ห้ามเพิ่ม token ลง returnTo/redirect URL เอง ให้ auth SDK จัดการ callback ตาม flow ที่ใช้จริง
- Cache และผลตอบกลับที่มาช้าต้องไม่ปะปนหลังเปลี่ยนบัญชี/workspace; ล้างข้อมูลในหน่วยความจำและยกเลิกงานค้างตามขอบเขตที่เหมาะสม
- Draft ที่เก็บไว้ต้องผูกผู้ใช้/workspace เดิม บัญชีถัดไปต้องอ่านหรือส่ง draft นั้นไม่ได้ การปิดแท็บไม่ควรเป็นจังหวะเดียวที่เริ่มรักษางาน
- Local demo ต้องไม่ใช้แทนการยืนยันตัวตนของ cloud และไม่แตะข้อมูล cloud ผ่าน gate จำลอง
- หน้าใหม่ต้องไม่ import Editor/core/renderer/exporter ผ่านส่วนกลางโดยอ้อม; อย่ารักษา preload เดิมที่ทำให้ lazy boundary ไม่มีผล

## การตรวจและหลักฐาน

รัน typecheck และ tests ที่เกี่ยวข้องกับสิ่งที่เปลี่ยน ตรวจ browser กับข้อมูลทดสอบที่ได้รับอนุญาต และทำ build ตามคำสั่งใน repository ก่อนส่งงาน หาก build สร้าง generated files ให้ตรวจ diff และประสานเจ้าภาพ ห้ามแก้ generated API ด้วยมือหรือย้อนการแก้ของผู้อื่นเพื่อให้ working tree ดูสะอาด

ต้องมีหลักฐานอย่างน้อยตาม acceptance ใน `PHASE-0-1.md`: เปิดลิงก์ตรงและ refresh, เปิดงานถูก ID, เปลี่ยนบัญชีไม่เห็นข้อมูลเก่า, เปลี่ยน workspace ขณะ request ค้าง, ป้องกัน return URL ภายนอก, รักษา draft เมื่อ offline/ออกจากหน้า, V1/V2 ยังทำงาน และหน้ารายการไม่โหลด Editor

บันทึกใน `PROGRESS-A.md`: task ID, สถานะจริง, ไฟล์ที่เปลี่ยน, คำสั่ง/สภาพแวดล้อมและผลตรวจ, dependency ที่ขาด, ข้อสรุปที่ B ต้องรับรู้ และงานแรกที่ควรทำต่อ ห้ามเขียนว่า B ผ่านหรือเห็นชอบแล้วหากยังไม่มีหลักฐานจาก B

## วิธีทำงานร่วมกันและขอบเขตการอนุญาต

ใช้ checkout ปัจจุบันที่เหมาะสมก่อน ถ้าสองคนทำงานพร้อมกัน แนะนำให้แต่ละคนมี checkout ของตนและ branch เช่น `codex/marketplace-a-phase-1` / `codex/marketplace-b-phase-1` ตามการจัดสภาพแวดล้อมที่ตกลงกัน ห้ามสลับ branch ใน checkout ที่อีกฝ่ายกำลังใช้ และไม่สร้าง worktree ใหม่โดยอัตโนมัติ การจัดทำเอกสารครั้งนี้ไม่ได้สร้าง branch ใด

คำสั่งเริ่มงานท้ายไฟล์อนุญาตให้ทำ Phase 0 แล้วลงมือ Phase 1 เฉพาะของ A เมื่อผ่าน gate ที่เกี่ยวข้อง งานทั่วไปในขอบเขตนั้นทำต่อได้โดยไม่ถามยืนยันซ้ำ การ commit/push ให้ตรวจคำสั่งของผู้ใช้และขอบเขตที่ได้รับอนุญาตในแชตจริง ถ้ามีคำสั่งครอบคลุมอยู่แล้วไม่ต้องขอซ้ำ แต่ prompt นี้ไม่ได้สั่ง commit/push เอง

ห้ามเผย secrets, token, ข้อมูลบัญชีจริง หรือเนื้อหาไฟล์ส่วนตัวลงเอกสาร/log การ deploy, apply migration หรือเปลี่ยน remote/provider settings ทำได้เมื่อมีการอนุญาตที่ครอบคลุมการกระทำนั้นจริงเท่านั้น ถ้าขาดเงื่อนไขให้หยุดเฉพาะงานที่พึ่งเงื่อนไขนั้นและทำงานอิสระต่อ

## Prompt สำหรับคัดลอกไปให้ AI ของคน A

```text
คุณรับบทคน A ในโปรเจกต์ PackIt Marketplace ให้ตรวจ checkout ปัจจุบันแล้วอ่านตามลำดับ:
1) AGENTS.md ที่ root และคำสั่งเฉพาะโฟลเดอร์ที่เกี่ยวข้อง; CLAUDE.md ถ้ามี
2) docs/marketplace/README.md
3) docs/marketplace/PLAN.md
4) docs/marketplace/PHASE-0-1.md
5) docs/marketplace/HANDOFF-A.md
6) docs/marketplace/PROGRESS-A.md และ PROGRESS-B.md โดยไฟล์ของ B อ่านอย่างเดียว
อ่าน CONTEXT.md เมื่อต้องตรวจคำศัพท์ แล้วตรวจโค้ดจริงก่อนสรุปสถานะ

ฉันสั่งให้เริ่มทำ Phase 0 ของ A แล้วลงมือ implement Phase 1 ของ A หลัง 0-J1 และ 0-J2 มีหลักฐานการตรวจร่วมของทั้ง A/B จากนั้นทำแต่ละงานตาม dependency โดยไม่รอผล preview/integration เพื่อเริ่ม router หรือ Editor isolation ให้เริ่มจาก task แรกที่ยังไม่เสร็จตามหลักฐานจริง ไม่เริ่มแผนใหม่ ไม่ทำงานที่เสร็จแล้วซ้ำ และหยุดขอบเขตงานที่สิ้นสุด Phase 1 ไม่สร้าง Phase 2 หรือ marketplace เต็มระบบ

คุณเป็นเจ้าภาพ frontend/Editor/routes/layouts/styles, src/app, API clients ใน src/services/api, Query/cache และการตรวจ browser ตาม HANDOFF-A ใช้ API/contract ที่ตกลงกับ B รักษา engine, draft/save, project schema, billing และ V1/V2 เดิม ไม่สร้างตาราง marketplace หรือสิทธิ์โรงงานจำลอง ห้ามแก้ไข Figma

ทำงานที่ได้รับอนุญาตและเป็นอิสระต่อได้โดยไม่ถามยืนยันซ้ำ เมื่อขาดหลักฐานจาก B ให้บันทึก dependency ที่เจาะจงใน PROGRESS-A แล้วทำงานที่ไม่ติด dependency ต่อ ห้ามทำเครื่องหมายงานร่วมหรืองาน B ว่าผ่านแทนเขา ห้ามแก้ PROGRESS-B หรือไฟล์ที่ B เป็นเจ้าภาพโดยไม่ประสาน

รักษาการแยกบัญชี/workspace, ตรวจ login return ภายในแอป, เปิดโครงการตาม route ID จริง, ป้องกัน draft สูญหาย และแยก local demo จาก cloud อัปเดต PROGRESS-A ด้วย task IDs ไฟล์ที่เปลี่ยน ผลทดสอบจริง และสิ่งที่รอ ไม่บันทึก secrets

ใช้ checkout ที่เหมาะสมอยู่แล้ว ไม่สร้าง worktree หรือสลับ branch ที่อีกคนใช้อยู่โดยอัตโนมัติ ตรวจ authorization ในแชตจริงก่อน commit/push หรือเปลี่ยน remote environment; prompt นี้ไม่ได้สั่ง publish/deploy/apply migration

เมื่อจบให้รายงานงานที่เสร็จพร้อม IDs, ผล typecheck/tests/build/browser ที่ทำจริง, สิ่งที่ยังไม่ตรวจหรือถูกบล็อก และ handoff ที่ B ต้องรู้ ถ้า Phase 1 ยังไม่ครบให้ระบุส่วนที่เหลือตรง ๆ ไม่กล่าวว่าเสร็จทั้งหมด
```
