# gen-package

Web app สร้างบรรจุภัณฑ์แบบ parametric: ผู้ใช้เลือกวัสดุ+ขนาด (หรือพิมพ์ prompt ให้ AI ตั้งค่าให้) → ระบบ gen dieline (blueprint การพับ, SVG หน่วย mm สเกล 1:1) พร้อมพับเป็น 3D ให้ดู UI เป็นภาษาไทย

## คำสั่ง

- `npm run dev` — dev server ที่ port 5173 (strict)
- `npm run build` — typecheck (`tsc --noEmit`) + vite build
- `npx tsc --noEmit` — typecheck อย่างเดียว
- `npm test` — vitest (unit test ใน `src/**/*.test.ts`) — เทสต์เรขาคณิตเป็นเชิงตัวเลขล้วน:
  ไฟล์ export ตรวจ byte/โครงสร้างจริง (xref offset, เลเยอร์), การพับตรวจตำแหน่ง 3D ของแผง
  ผ่าน `computeMatrices` แทนการดูภาพ — เพิ่ม template/รูปแบบไฟล์ใหม่ให้เพิ่มเทสต์แนวเดียวกัน
  (ดู `fefco0427.test.ts` เป็นแบบ) config อยู่ `vitest.config.ts` แยกจาก vite.config.ts
  โดยเจตนา เพื่อไม่โหลด middleware /api/box-spec ตอนรันเทสต์

## โครงสร้าง

- `src/core/types.ts` — Dieline, Panel (outline + hinge + stage + zOffset), Material, DimMark
- `src/core/project.ts` — โมเดล Project (งานหนึ่งชิ้น) + ตัว parse/validate ที่ localStorage และการนำเข้าไฟล์ใช้ร่วมกัน (ย้ายออกจาก App.tsx เพื่อไม่ให้ App เป็น dependency ของ projectFile)
- `src/core/projectFile.ts` — ส่งออก/นำเข้างานเป็น `.genpkg.json` (envelope: app/schemaVersion/exportedAt); นำเข้าแล้ว id ใหม่เสมอ (กันชน) + เตือนเมื่อ parse ซ่อมค่า (clamp ขนาด/ตัด history); schema ใหม่กว่า → ปฏิเสธ; เพิ่มฟิลด์ที่เก็บต้องขึ้น PROJECT_FILE_VERSION
- `src/core/materials.ts` — material registry: ความหนา t, foldable, สี — วัสดุกำหนดระยะเผื่อใน dieline ไม่ใช่แค่หน้าตา
- `src/core/templates/index.ts` — template registry (BoxTemplate: defaults, tilt, supportsHandle, foldDepth, generate) — เพิ่มแบบกล่องใหม่ที่นี่
- feature รูหิ้ว: `Panel.holes` (polygon rings → THREE.Shape.holes) + `obroundPts/obroundPath` ใน shared.ts; เพิ่ม feature ใหม่ต้องอัปเดต "ความสามารถของระบบ" ใน system prompt ของ server/boxSpec.ts ด้วย ไม่งั้น AI จะอ้างว่าทำได้ทั้งที่ engine ไม่มี
- `src/core/templates/tuckEnd.ts` / `mailer.ts` / `sleeve.ts` / `bottleCarrier.ts` / `tray.ts` / `gable.ts` — generators: รับ W/D/H "ด้านใน" แปลงเป็นระยะ score +2t ต่อแกน, ระยะหลบ flap สเกลตาม t, ผลิตทั้ง segments (SVG มี Q curve) และ panels (3D, polygonized) จาก geometry เดียวกัน; mailer/tray/gable ใช้ tilt หมุนโมเดลให้ฐานลงพื้นตามจังหวะพับ (tray = ถาดเปิดบน ผนัง 4 ด้าน + ลิ้นมุมพับเข้าล็อก เหมือน mailer แต่ไม่มีฝา; gable = ต่อยอดจาก tray โดยเพิ่มแผงจั่วบนผนังหน้า-หลังที่ foldAngle=±lean เอียงมาชนกันที่สัน เกิดหลังคา+หูหิ้วในตัว, lean=asin(Dp/2G) — foldAngle 0 ของแผงลูก = ต่อดิ่งจากผนัง ไม่ใช่ 90)
- `src/core/fold.ts` — fold engine: panel หมุนรอบ crease ในพิกัดแผ่นคลี่ คูณ matrix แม่เป็นลูกโซ่; ด้านในกล่อง = +z; stage 0-3 (ลำตัว→ลิ้นกันฝุ่น→ฝาเสียบ→ลิ้น); zOffset ดันชั้นวัสดุที่ซ้อนกันกัน z-fighting
- `src/components/Viewer3D.tsx` — R3F viewer + FitCamera (วัดจากส่วนแผ่นที่ยื่นไกลสุดจากแผงหน้า ไม่ใช่ครึ่งแผ่น)
- `src/components/DielineSVG.tsx` — blueprint preview + เส้นบอกขนาด (toggle ได้) + ลาก/หมุน/ลบ artwork; การลากมี snap; ซูม/แพน (Ctrl+ล้อ), กริด, ไม้บรรทัด, เส้นไกด์ลากเอง (state ใน component; guideLines ≠ prop `guides` ที่เป็น bleed/safe); เส้นไกด์เข้า snapTargets ตอนลาก
- `src/core/imposition.ts` — คำนวณ yield ต่อแผ่น (pure): `computeImposition` วางกริด step&repeat เทียบชิ้นตั้ง/หมุน 90° เลือกจำนวนมากสุด + `sheetsNeeded` (ปัดขึ้น) + `SHEET_PRESETS` แผ่นมาตรฐานไทย; UI อยู่แท็บ "ส่งออก" ผูกกับช่องจำนวน (state ephemeral ไม่เก็บลง project)
- `src/core/snap.ts` — logic ดูด artwork เข้าแนวขณะลาก (pure): `snapTargets` สร้างเส้นเป้าหมายจากกึ่งกลางแผ่น/ขอบ-กึ่งกลางแผง/ขอบ-กึ่งกลางชิ้นอื่น, `applySnap` ดูดขอบ-กึ่งกลางชิ้นเข้าเส้นใกล้สุดในระยะ threshold (แปลงจาก 6px ตามซูม); กด Alt ค้างระหว่างลาก = ปิด snap
- `src/components/PromptBar.tsx` + `src/core/ai.ts` — AI layer ฝั่ง client; แนบรูปอ้างอิงได้ (ย่อเป็น JPEG ≤1024px ฝั่ง client → base64; backend api ส่งเป็น image block, backend cli เขียนไฟล์ tmp ให้ Claude เปิดอ่านเองแล้วลบทิ้ง)
- `server/boxSpec.ts` — endpoint /api/box-spec (Vite middleware): Claude strict tool use → JSON spec; ไม่มี ANTHROPIC_API_KEY → โหมดจำลอง (mockSpec); export ตัวหลัก (askClaude/mockSpec/parseCurrent/parseImage) ใช้ร่วมกับ serverless
- `api/box-spec.ts` — endpoint เดียวกันเวอร์ชัน Vercel serverless (import ตัวหลักจาก server/boxSpec) — บน Vercel ไม่มี claude CLI จึงใช้แค่ backend api/mock; ตั้ง ANTHROPIC_API_KEY ใน Vercel env. Dev ใช้ Vite middleware, prod (Vercel) ใช้ไฟล์นี้ — client เรียก path `/api/box-spec` เดียวกัน

## Env / AI backend

ลำดับอัตโนมัติ: มี `ANTHROPIC_API_KEY` → Claude API; ไม่มี → `claude` CLI ในเครื่อง (ใช้ login ของ Claude Code, ต้อง login แล้ว); ไม่มีทั้งคู่ → โหมดจำลอง. บังคับด้วย `BOX_SPEC_BACKEND=api|cli|mock`. `BOX_SPEC_MODEL`: backend api default claude-opus-4-8, backend cli default โมเดลที่ตั้งใน Claude Code (ใส่ alias haiku/sonnet ได้เพื่อความเร็ว). ดู `.env.example`

หมายเหตุ CLI: server ล้าง env `ANTHROPIC_*`/`CLAUDE*` ก่อน spawn เสมอ (กัน base URL/token ของ session อื่น shadow login ปกติ) และปิด stdin ทันที — อย่าเอาออก ไม่งั้นพังเมื่อรันจากใน Claude Code

## Gotchas

- three ต้อง >= 0.185 — r175 มีบั๊ก ExtrudeGeometry ไม่สร้างฝาหน้า-หลังเมื่อ bevelEnabled:false (กล่องกลายเป็น wireframe)
- เปลี่ยนเวอร์ชัน dependency แล้วต้องลบ `node_modules/.vite` แล้วรีสตาร์ท dev server ไม่งั้น pre-bundle เก่าค้าง
- พิกัดแผ่นคลี่: x ขวา y ลง หน่วย mm; แปลงเป็น 3D ที่ (x, -y, 0)
- ฟอนต์ไทย self-host ผ่าน `@fontsource/*` (import ใน main.tsx, ไม่พึ่ง Google CDN); ข้อความเลือกได้หลายฟอนต์ (registry `FONTS` ใน artwork.ts: noto/sarabun/prompt/kanit) + น้ำหนัก 400/700 — เพิ่มฟอนต์ใหม่ต้องทำ 3 จุด: import css ใน main.tsx, เพิ่มใน `FONTS`, และ `ensureThaiFont` โหลดให้; ก่อน rasterize ลง canvas (renderArtworkCanvas/ใบสเปก) ต้อง `await ensureThaiFont()` เพราะ fontsource โหลด subset ต่อน้ำหนักแบบ lazy — ถ้าไม่รอ canvas จะ fallback ทำให้ไทยในไฟล์ export เพี้ยน
- ตัวเลขบน blueprint คือระยะ score จริง (บวกเผื่อความหนาแล้ว) จึงใหญ่กว่าค่าที่ผู้ใช้ตั้งเล็กน้อย — ตั้งใจ ไม่ใช่บั๊ก
- แผนเฟสเดิม (FEFCO 0427, sleeve, export PDF/DXF, โลโก้/ข้อความ, ขวด revolve + ฉลาก) เสร็จครบแล้ว
- วัสดุพับไม่ได้ (pet-bottle/glass/aluminum) → เส้นทางภาชนะใน `src/core/vessel.ts`:
  โปรไฟล์ revolve ต่อชนิดวัสดุ (LatheGeometry ใน VesselViewer3D) + dieline "ฉลาก" พันรอบตัว
  — ฉลากเป็น Dieline ธรรมดา ระบบ artwork/export/guides/ใบสเปกเดิมจึงใช้ได้หมด
  ความหมายขนาด: W = ⌀ตัว, D = ⌀ปาก/คอ, H = สูง (template ถูกละเลย)
- รอยพับ 180° (แผ่นม้วน FEFCO 0427) ได้สันโค้งจาก `rollBeads` ใน fold.ts — ทรงกระบอกบาง
  รัศมี = ครึ่งของระยะสองชั้น เรนเดอร์เป็น `Bead` ใน Viewer3D โตตามการพับเอง; fold อื่นที่ใช้
  foldAngle ±180 จะได้สันนี้อัตโนมัติ (ปัจจุบันมีแค่ roll)
- หน้าต่างเวลาการพับใน `fold.ts` เลือกชุดตามจำนวน stage ที่ template ใช้ (`WINDOWS_4`/`WINDOWS_5`)
  — เพิ่ม template ที่ต้องการจังหวะมากกว่า 5 ให้เพิ่มชุดใหม่ อย่าแก้ชุดเดิม เพราะจะไปเปลี่ยน
  จังหวะพับของ template ที่จูนไว้แล้ว
