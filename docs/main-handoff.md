# เตรียมรวม backend branch เข้า main

สถานะ 23 กันยายน 2026: เตรียม workflow สำหรับผู้ดึงโค้ดแล้ว และผู้ใช้อนุมัติให้ commit/push พร้อมรวม feature branch เข้า `main` หลังตรวจสอบ ขอบเขตนี้ไม่รวมการเปลี่ยน Vercel/Supabase config หรือการรับรองผล deploy

## สิ่งที่ผู้ดึง main ต้องทำหลัง merge

1. ใช้ Node.js 24.x / npm 11.x
2. pull โค้ดล่าสุดโดยเก็บงานค้างของตัวเองก่อน แล้วรัน `npm ci`
3. รัน `npm run dev:local` และเปิด `http://127.0.0.1:5173` ได้ทันที ไม่มี env/Docker/Cloud login ที่บังคับ
4. หากต้องการงาน Cloud ใช้ `npm run setup:cloud`, รับค่าจากผู้ดูแลอย่างปลอดภัย, กรอก `.env.local` แล้วรัน `npm run dev` ตาม README

ไม่แจก `.env.local` ของผู้พัฒนา, ไม่ใส่คีย์ staging/production ลง Git, ไม่ reset database หรือย้ายงานเก่าอัตโนมัติ

## ก่อนอนุมัติ merge

- [x] fetch แล้ว `origin/main` ที่ `8e0eea9` เป็น ancestor ของ branch นี้; ต้องตรวจซ้ำเมื่อจะ merge จริง
- [x] `npm ci`, `npm test` (46 files/460 tests), `npm run build:local` ผ่านใน clean source snapshot บน Windows ที่ไม่มี `.env.local` หรือ `node_modules` เดิม
- [x] Local UI ชัดเจนว่าเก็บงานในเครื่อง ไม่แสดง Google login ปลอม; เข้าถึง editor/3D, หน้า export และ reload งานได้ทั้ง dev/preview
- [ ] ตรวจการรับไฟล์ export จริงจาก browser อีกครั้ง: export unit tests ผ่าน แต่การรอ download event ใน browser รอบนี้ timeout จึงยังไม่นับ download เป็น PASS
- [x] `dev:local` ไม่อ่าน env Cloud เดิม; `setup:cloud` ไม่ทับไฟล์ env ที่มีอยู่
- [x] `npm run build` สำหรับ Cloud ผ่านด้วย config จำลอง; พบ public sentinel แต่ไม่พบ server-secret sentinel ใน frontend bundle (ไม่ใช่ live Cloud smoke)
- [ ] อ่านรายการ staging ที่ยัง NOT RUN ใน acceptance matrix; local onboarding ผ่านไม่ได้หมายความว่า production พร้อมแล้ว
- [ ] ให้เจ้าของทุก Vercel project ที่ติดตาม `main` ตรวจผลกระทบก่อน merge โดยเฉพาะ `gen-package.vercel.app` ซึ่งผู้ใช้ไม่ได้เป็นเจ้าของ

รายการสุดท้ายสำคัญ: การ push `main` อาจ trigger deploy ของโปรเจกต์อื่นที่เชื่อม repo นี้ ตัวแอป Cloud ต้องมี env/provider/schema พร้อม และ legacy `/api/box-spec` ไม่เปิดใน production ถ้าเจ้าของเว็บเดิมยังไม่พร้อม ต้องตกลงแผน deploy ก่อน ไม่อนุมานว่าสามารถเปลี่ยนการตั้งค่าแทนเขาได้

## หลัง merge (เมื่อได้รับอนุมัติแล้วเท่านั้น)

1. ให้ทีมใช้ README เป็นขั้นตอนติดตั้ง ไม่คัดลอก `node_modules` หรือ env จริงข้ามเครื่อง
2. หากจะให้ `packit-design.vercel.app` ติดตาม `main` ผู้ดูแลต้องเปลี่ยน Branch Tracking ของ Vercel staging project แยกต่างหาก การ merge ไม่เปลี่ยนค่านี้เอง
3. คง Supabase staging, `APP_ENV=staging` และโดเมนเดิมไว้ ไม่เปลี่ยนเป็น production data โดยปริยาย
4. ตรวจ deploy, Google callback, เปิด/บันทึกงาน และ upload/download ใหม่ พร้อมทำรายการ staging ที่ยังค้างก่อน public pilot

## กลไกที่เพิ่มสำหรับ onboarding

- `.nvmrc`, `.node-version` และ `package.json#engines` ระบุ runtime ที่ใช้กับทีม
- `dev:local` / `build:local` / `preview:local` เลือก Vite mode `local-demo` ที่ปิดการอ่าน env files และ public env จาก shell พร้อมให้ server ใช้ mock AI
- ค่า Cloud เดิมยังใช้ผ่าน `dev` / `build` ปกติ จึงไม่เปลี่ยน Vercel config หรือ credentials ที่มีอยู่
- `setup:cloud` ใช้ exclusive file copy: สร้าง template ได้แต่เขียนทับ `.env.local` ไม่ได้ แม้รันซ้ำ
- unit tests ตรวจ env isolation, template copy/no-overwrite/no-key-output และข้อความ local/Cloud บนหน้าเริ่มต้น

ผลทดสอบ clean source snapshot บันทึกที่ [backend-progress.md](backend-progress.md) รันบน Windows/Node 24.19.0/npm 11.17.0 เท่านั้น ยังไม่ได้ทดสอบ macOS/Linux จริง
