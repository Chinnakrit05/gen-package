# PackIt

เว็บออกแบบบรรจุภัณฑ์: กำหนดขนาดและวัสดุ ดูภาพพับ 3D ออกแบบลาย และส่งออกแบบผลิต

## เริ่มใช้งานในเครื่อง — ไม่ต้องมีคีย์หรือ Docker

ต้องมี **Node.js 24.x และ npm 11.x** (รุ่นที่ใช้ทดสอบโปรเจกต์; มี `.nvmrc` / `.node-version` ให้เครื่องมือจัดการเวอร์ชัน)

จากโฟลเดอร์โปรเจกต์ที่ clone/pull มา:

```sh
npm ci
npm run dev:local
```

เปิด [http://127.0.0.1:5173](http://127.0.0.1:5173) แล้วกด **เริ่มใช้งานบนเครื่องนี้**

- ไม่ต้องสร้าง `.env.local`, login Google, ติดตั้ง Supabase CLI เพิ่ม หรือเปิด Docker
- ออกแบบ 3D, จัด artwork, บันทึกงานในเบราว์เซอร์ และ export/import ไฟล์งานได้
- `dev:local` ข้ามไฟล์ env และไม่ใช้ Supabase/AI keys ที่ค้างอยู่ใน shell จึงไม่แตะข้อมูล Cloud ของทีม
- แถบ AI ใช้ตัวจำลองเมื่อไม่ได้กรอกคีย์ หากกรอก Anthropic API key ใน UI แล้วกดสร้าง จะเรียก API จริงและอาจมีค่าใช้จ่าย; คีย์อยู่ใน memory ของแท็บ ไม่บันทึกลงไฟล์งาน
- งานอยู่ในเบราว์เซอร์และ origin นี้เท่านั้น ไม่ sync ข้ามเครื่อง ควร export เป็น `.genpkg.json` ก่อนล้างข้อมูลเบราว์เซอร์หรือย้ายเครื่อง
- ใช้ `127.0.0.1:5173` ให้เหมือนเดิมเสมอ: `localhost:5173` และ URL/port อื่นมีพื้นที่เก็บงานแยกกัน

โหมดนี้แยกจาก Cloud โดยตั้งใจ ไม่ใช่การจำลองสิทธิ์เข้าถึงข้อมูล Cloud

## หลัง pull เวอร์ชันใหม่

เมื่อ branch นี้รวมเข้า `main` แล้ว และไม่มีงานในเครื่องค้างอยู่:

```sh
git switch main
git pull --ff-only
npm ci
npm run dev:local
```

หยุด dev server เก่าก่อนรันใหม่ หาก Git แจ้งงานค้างหรือ merge conflict ให้จัดเก็บ/แก้งานนั้นก่อน **อย่าใช้ reset --hard เพื่อล้างปัญหา** ไฟล์ `.env.local` ไม่ถูก track และคำสั่งข้างต้นไม่เขียนทับมัน

ถ้าเคยตั้ง Cloud ไว้แล้ว ให้ใช้ `npm run dev` แทน `dev:local` เพื่อใช้ config เดิม ไม่ต้องตั้ง Google OAuth ใหม่ทุกครั้งที่ pull

## ใช้งาน Cloud ของทีม (เลือกทำ)

ต้องได้รับสิทธิ์จากผู้ดูแลโปรเจกต์ก่อน ไม่จำเป็นต้องสร้าง Supabase หรือ Google OAuth client ใหม่สำหรับทุกคน

```sh
npm run setup:cloud
```

คำสั่งสร้าง `.env.local` จาก `.env.cloud.example` **เฉพาะเมื่อยังไม่มีไฟล์** ถ้ามีอยู่แล้วจะไม่ทับ ไม่เติมค่า และไม่แสดงคีย์ ให้เทียบสองไฟล์ด้วยตัวเอง

ให้ผู้ดูแลส่งค่าผ่านช่องทางปลอดภัย แล้วเติม 4 ช่องใน `.env.local`:

| ตัวแปร | ค่า |
| --- | --- |
| `VITE_SUPABASE_URL` | URL ของ Supabase development/staging |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | publishable/anon key ของโปรเจกต์เดียวกัน (เปิดเผยใน browser ได้) |
| `SUPABASE_URL` | URL เดียวกับฝั่ง browser |
| `SUPABASE_SECRET_KEY` | secret/service-role key สำหรับ server เท่านั้น |

จากนั้นรัน:

```sh
npm run dev
```

เปิด `http://127.0.0.1:5173` แล้วเข้าสู่ระบบ Google จริง ผู้ดูแลต้องเตรียม migrations, private buckets, Google provider, redirect URL และเพิ่มบัญชีเป็น test user ถ้า OAuth app ยังเป็น Testing ดู [คู่มือ backend](docs/backend-setup.md)

**ห้ามใส่ secret/service-role key ในตัวแปร `VITE_*`, commit env จริง หรือส่งคีย์ใน issue/PR** คีย์ server มีสิทธิ์สูง ผู้ที่ไม่ได้รับสิทธิ์ควรใช้ local demo หรือขอ Supabase development แยก ไม่ใช้ production credentials

การ pull/build/dev ไม่ push migration และไม่แก้ remote project อัตโนมัติ ถ้าต้องทดสอบ backend แบบแยกในเครื่องจริง ๆ จึงค่อยใช้ Docker ตามคู่มือ backend; `db:reset` ล้างข้อมูล local database ไม่ใช่คำสั่งติดตั้งแอปทั่วไป

## ทดสอบและดู production build แบบ Local

```sh
npm test
npm run build:local
npm run preview:local
```

หยุด dev server ก่อน preview เพราะใช้ port 5173 เหมือนกัน `build:local` ไม่ใช้ค่า Cloud ส่วน `npm run build` และ `npm run preview` ปกติยังอ่าน env ตาม mode เพื่อรองรับ Cloud/Vercel **อย่า deploy `build:local` เป็น Cloud app**

Browser regression ของตัวโหลด: รัน `npm run dev:local` เปิด `/tests/browser/loading-continuity.html` แล้วกด Run (เป็นชุดทดสอบแยก ไม่รวมใน `npm test`)

## ปัญหาที่พบบ่อย

- ไม่รู้จัก `node`/`npm`: ติดตั้ง Node.js 24 แล้วเปิด terminal ใหม่ บน PowerShell ถ้า `npm.ps1` ถูกบล็อก ให้ใช้ `npm.cmd` แทน ไม่ต้องลดนโยบายความปลอดภัยของเครื่อง
- `EBADENGINE`: ตรวจ `node --version` / `npm --version` ให้ตรงรุ่นที่ระบุ แล้วรัน `npm ci` ใหม่
- Port 5173 ถูกใช้: หยุด dev/preview เก่าหรือโปรแกรมที่ยึด port ก่อน อย่าเปลี่ยน port โดยไม่ตั้ง OAuth redirect ใหม่ถ้าใช้ Cloud
- หน้า “ตั้งค่าแอปไม่ครบ”: `npm run dev` กำลังใช้ Cloud config ที่ยังไม่ครบ ถ้าต้องการออกแบบในเครื่องให้รัน `npm run dev:local`
- Google login ไม่ผ่าน/บัญชีทดสอบเข้าไม่ได้: ตรวจสิทธิ์ test user และ URL ใน Supabase/Google กับผู้ดูแล ไม่ต้องแจก Google client secret ให้ผู้ใช้
- เปลี่ยน env แล้วไม่เห็นผล: หยุดแล้วเปิด server ใหม่; ค่า frontend ของ build ต้อง build ใหม่
- `sharp`/native module ติดตั้งไม่ครบ: ใช้ Node รุ่นที่ระบุและ `npm ci` บนเครื่องนั้น ไม่คัดลอก `node_modules` ข้าม Windows/macOS/Linux หรือปิด optional dependencies
- ไม่เห็นงานเดิม: ตรวจว่าเป็น local/Cloud โหมดเดิม, บัญชีเดิม และ URL เดิม ห้ามล้าง storage ก่อนตรวจหรือสำรองงาน

## เอกสารสำหรับผู้ดูแล

- [รายการเตรียมรวมเข้า main และส่งต่อให้ทีม](docs/main-handoff.md)
- [Backend / Supabase / OAuth setup](docs/backend-setup.md)
- [ผลทดสอบและสิ่งที่ยังไม่ผ่าน staging](docs/backend-acceptance-phase1.md)
- [โครงสร้างและข้อควรระวังในการพัฒนา](CLAUDE.md)
