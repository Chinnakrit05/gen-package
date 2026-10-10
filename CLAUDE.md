# gen-package

Web app สร้างบรรจุภัณฑ์แบบ parametric: ผู้ใช้เลือกวัสดุ+ขนาด (หรือพิมพ์ prompt ให้ AI ตั้งค่าให้) → ระบบ gen dieline (blueprint การพับ, SVG หน่วย mm สเกล 1:1) พร้อมพับเป็น 3D ให้ดู UI เป็นภาษาไทย

## คำสั่ง

- ผู้ใช้ใหม่เริ่มที่ `README.md`: Node 24/npm 11, `npm ci` แล้ว `npm run dev:local` โดยไม่ต้องมี env/Docker; local-demo mode ไม่อ่าน env เดิมและใช้ mock AI หากไม่ได้กรอกคีย์ใน UI
- `npm run setup:cloud` — สร้าง `.env.local` จาก `.env.cloud.example` เฉพาะเมื่อยังไม่มีไฟล์ ไม่ทับหรือพิมพ์คีย์
- `npm run dev` — dev server ที่ port 5173 (strict)
- `npm run build:local` / `npm run preview:local` — build/preview โหมด local แบบไม่ใช้ env Cloud (preview port 5173)
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
- `src/core/templates/tuckEnd.ts` / `mailer.ts` / `sleeve.ts` / `bottleCarrier.ts` / `tray.ts` / `gable.ts` — generators: รับ W/D/H "ด้านใน" แปลงเป็นระยะ score +2t ต่อแกน, ระยะหลบ flap สเกลตาม t, ผลิตทั้ง segments (SVG มี Q curve) และ panels (3D, polygonized) จาก geometry เดียวกัน; mailer/tray/gable ใช้ tilt หมุนโมเดลให้ฐานลงพื้นตามจังหวะพับ (tray = ถาดเปิดบนผนังทบ roll end — `rollEndLayout(…, { lid: false })` โครงเดียวกับ FEFCO 0427 ไม่มีฝา; gable = กล่องหูหิ้ว carry box ตาม dieline มาตรฐาน: ท่อทากาวข้าง (กาว|หน้า|ข้าง|หลัง|ข้าง) + ก้น snap-lock + ฝาแบนผ่าร่องกลาง + หูหิ้วสองชั้น + แผงปิดบนสองซีกจากผนังข้างพับทับฝา (zOffset −layer) ลิ้นปลายงอรอก่อน (stage 4) แล้วลงร่องกลาง — เส้นตัด/รอยพับสร้างจากแผงด้วย `autoSegments` (shared.ts))
- `src/core/fold.ts` — fold engine: panel หมุนรอบ crease ในพิกัดแผ่นคลี่ คูณ matrix แม่เป็นลูกโซ่; ด้านในกล่อง = +z; stage 0-3 (ลำตัว→ลิ้นกันฝุ่น→ฝาเสียบ→ลิ้น); zOffset ดันชั้นวัสดุที่ซ้อนกันกัน z-fighting
- `src/components/Viewer3D.tsx` — R3F viewer + FitCamera (วัดจากส่วนแผ่นที่ยื่นไกลสุดจากแผงหน้า ไม่ใช่ครึ่งแผ่น)
- `src/components/DielineSVG.tsx` — blueprint preview + เส้นบอกขนาด (toggle ได้) + ลาก/หมุน/ลบ artwork; การลากมี snap; ซูม/แพน (Ctrl+ล้อ), กริด, ไม้บรรทัด, เส้นไกด์ลากเอง (state ใน component; guideLines ≠ prop `guides` ที่เป็น bleed/safe); เส้นไกด์เข้า snapTargets ตอนลาก
- `src/core/softProof.ts` + `src/components/useSoftProof.ts` — soft-proof CMYK บน blueprint (ปุ่ม "ดูสีแบบพิมพ์" ท้ายแถบเครื่องมือซ้ายบน ผ่าน prop `toolsExtra`, state ไม่จำข้ามรอบโดยเจตนา): ส่ง "สำเนา" ลาย/สีพื้น/รูปที่แปลงสีแล้วเข้า DielineSVG เท่านั้น — callback ของ blueprint อ้าง id/ค่าตัวเลข จึงแก้ไขระหว่างพรีวิวได้โดยสีจำลองไม่หลุดลงงาน/ไฟล์ส่งออก; รูปแปลงผ่าน canvas แบบ async + แคช. ใช้ 3D LUT 17³ ใน `src/core/cmykProofLut.ts` = **ไฟล์ที่ถูก generate** โดย `scripts/build-cmyk-lut.py` (Pillow/LittleCMS: sRGB→CMYK→sRGB relative+BPC แล้วแก้ gray balance ให้เทา/ขาว/ดำคงเดิม) — อย่าแก้ตรง ๆ; เปลี่ยน profile โรงพิมพ์ได้ด้วย `python scripts/build-cmyk-lut.py path.icc` (ค่าเริ่มต้น RSWOP.icm ของ Windows). สูตร RGB→CMYK ตรง ๆ ใน pdf.ts ใช้จำลองไม่ได้เพราะแปลงกลับได้ค่าเดิมเป๊ะ
- `src/core/imageDpi.ts` + `src/components/useImageDpi.ts` — เตือนรูปความละเอียดต่ำ: dpi = พิกเซลจริงของรูป ÷ ขนาดที่วาดจริง (สูตรเดียวกับ `drawImageFit`: cover×cropZoom/contain/stretch; รูปพื้นใช้ `fillImageRect`) — <150 dpi = ป้ายแดงบนรูปใน blueprint (`LowResBadge` สูงคงที่ ~11px บนจอ, ไม่ไปถึงไฟล์ส่งออก) + สรุปในแท็บส่งออก; รูปที่เลือกโชว์ dpi ในแผง (เขียว ≥300 / เหลือง / แดง); ข้าม SVG (เวกเตอร์) และลายจากไลบรารี (preset)
- `src/core/stickerContour.ts` + `stickerPreflight.ts` (pure) — สติกเกอร์ 'ไดคัทตามรูป' + ตรวจไฟล์ตามข้อจำกัดผลิต
  (อิงเงื่อนไขโรงพิมพ์สติกเกอร์ไดคัท เช่น Lalapix: `STICKER_RULES` ห่างเส้นตัด/เผื่อสี ≥1 มม., ระหว่างเส้นตัด ≥2, ช่องเจาะ ≥2, รัศมีโค้ง ≥0.5):
  alpha ของลาย (`renderArtworkAlpha`, ไม่รวมสีพื้น) → อุดรู → ขยาย (มีขอบขาว) หรือหดเข้าเนื้อ 1 มม. (ไม่มีขอบขาว = สีเลยเส้นตัดเอง)
  → closing/opening ลบมุม → อุดรูอีกรอบ (ลบมุมเชื่อมช่องแคบปิดเป็นโพรง) → เบลอแล้วเดินเส้นที่ 0.5 (marching squares) → ลดจุด + Chaikin; ห้ามเดินเส้นบน mask ขาวดำตรง ๆ
  (ได้ขั้นบันไดพิกเซลที่ตัวตรวจเองจับเป็นมุมหักศอก — เทสต์ `contour ที่ N px/มม. ผ่านกติกามุมโค้ง` กันไว้)
  คำนวณใน Web Worker (`stickerContour.worker.ts` ผ่าน `useStickerContour`) เพราะ distance transform หนักหลายร้อย ms;
  ตั้งค่า `Project.stickerCut` เก็บเฉพาะเมื่อ ≠ ค่าเริ่มต้น (`storedStickerCut`; thread แบบเดียวกับ `vents`, PROJECT_FILE_VERSION 9)
- `src/core/stickerSheet.ts` (pure) — แผ่นสติกเกอร์หลายดวง A6/A5/A4/A3/กำหนดเอง (`stickerCut.sheet` + `sheetW/sheetH`, ขอบแผ่น `sheetMargin` ค่าเริ่มต้น 5; `resolveStickerSheet` — memo ใน App เพราะแผ่นกำหนดเองสร้าง object ใหม่ทุกครั้ง): ออกแบบดวงเดียว แล้ว
  `layoutStickerSheet` เรียงซ้ำจากกรอบเส้นตัด (`cutBox`, ไม่ใช่แผ่นออกแบบ) เว้น 2 มม./ขอบ 5 มม. หมุน 90° ถ้าได้มากกว่า;
  `placePoint`/`placePath`/`placementSVG` = transform ชุดเดียวกันทุกที่ (พรีวิว/SVG/PDF/DXF) → `sheetDieline` ใช้ส่งออก;
  ลายต่อดวงคลิป `artClipBox` (กรอบเส้นตัด + ครึ่งระยะห่าง = เผื่อสี 1 มม.); blueprint ยังแก้ไขดวงเดียว
  โหมดกำหนดจำนวน (`stickerCut.perSheet`): `fitScaleForCount` binary search ตัวคูณขนาดใหญ่สุดที่ได้ ≥ n ดวง
  (ลาย×k + 2·ขอบขาว — ขอบขาวไม่ย่อตาม; ตามรูปเผื่อ 0.6 มม. เพราะ trace เส้นใหม่คลาดได้) แล้ว `scaleDecos` + ตั้ง W/H
  (ล็อกช่อง W/H); แก้ลายทีหลังไม่ย่อเองอัตโนมัติ — โชว์ "ได้ X จาก N" + ปุ่มจัดขนาดใหม่. สติกเกอร์เล็กสุด 10 มม.
  (`parseSpec` clamp ตาม template) — กล่องยัง 30
- วัสดุสติกเกอร์ฟิล์มใส (`Material.clear`, `Material.underbase`: sticker-pp-clear / sticker-pp-clear-white):
  3D วาด texture โปร่งใส + `inkOnClearFilm` (ไม่รองขาว: ความทึบหมึกตามความเข้ม ขาว≈ใส; รองขาว: ทึบตามลาย) + แผ่นรองสีเข้มด้านหลัง;
  blueprint ลายหมากรุกใต้แผง (`clearFilm`); ไฟล์ส่งออกของรองขาวมีเลเยอร์ White (`whiteInk.ts`: trace จาก alpha ลาย
  เก็บรูในตัวอักษร หดเข้า 0.1 มม., มีสีพื้น → เต็มรูปทรงดวง) — PDF เป็นสี spot Separation ชื่อ White (`dielinePDFBytes` อาร์กิวเมนต์ white),
  SVG เป็นเลเยอร์ White fill-rule evenodd; ตรวจไฟล์เตือนลายสีอ่อนบนใสไม่รองขาว (`clear-light`, `lightRatio` จาก `renderArtworkAlpha`)
  หมายเหตุ: ข้อความ SVG (`dominant-baseline=central`) กับ canvas (`textBaseline=middle`) ต่างกัน ~0.03em —
  ชั้น White ใน SVG จึงเหลื่อมข้อความเล็กน้อย; PDF ตรงเป๊ะเพราะลายกับขาว raster จาก canvas เดียวกัน
- แผ่นแบนไม่มีรอยพับ (สติกเกอร์) ใน Viewer3D หมุน 180° รอบแกนตั้ง ให้ด้านพิมพ์หันหากล้อง (ก่อนหน้าเห็นด้านหลังเปล่า)
- `src/core/imposition.ts` — คำนวณ yield ต่อแผ่น (pure): `computeImposition` วางกริด step&repeat เทียบชิ้นตั้ง/หมุน 90° เลือกจำนวนมากสุด + `sheetsNeeded` (ปัดขึ้น) + `SHEET_PRESETS` แผ่นมาตรฐานไทย; UI อยู่แท็บ "ส่งออก" ผูกกับช่องจำนวน (state ephemeral ไม่เก็บลง project)
- `src/core/snap.ts` — logic ดูด artwork เข้าแนวขณะลาก (pure): `snapTargets` สร้างเส้นเป้าหมายจากกึ่งกลางแผ่น/ขอบ-กึ่งกลางแผง/ขอบ-กึ่งกลางชิ้นอื่น, `applySnap` ดูดขอบ-กึ่งกลางชิ้นเข้าเส้นใกล้สุดในระยะ threshold (แปลงจาก 6px ตามซูม); กด Alt ค้างระหว่างลาก = ปิด snap
- `src/components/PromptBar.tsx` + `src/core/ai.ts` — AI layer ฝั่ง client; แนบรูปอ้างอิงได้ (ย่อเป็น JPEG ≤1024px ฝั่ง client → base64; backend api ส่งเป็น image block, backend cli เขียนไฟล์ tmp ให้ Claude เปิดอ่านเองแล้วลบทิ้ง)
- `server/boxSpec.ts` — endpoint /api/box-spec (Vite middleware): Claude strict tool use → JSON spec; ไม่มี ANTHROPIC_API_KEY → โหมดจำลอง (mockSpec); export ตัวหลัก (askClaude/mockSpec/parseCurrent/parseImage) ใช้ร่วมกับ serverless
- `server/handler.ts` — ต้นทาง (source) ของ Vercel serverless `/api/box-spec` (import ตัวหลักจาก `./boxSpec`) — บน Vercel ไม่มี claude CLI จึงใช้แค่ backend api/mock; ตั้ง ANTHROPIC_API_KEY ใน Vercel env. Dev ใช้ Vite middleware, prod (Vercel) ใช้เส้นนี้ — client เรียก path `/api/box-spec` เดียวกัน
- `api/box-spec.js` — **ไฟล์ที่ถูก generate** (esbuild bundle จาก `server/handler.ts` ผ่าน `scripts/build-api.mjs`, สคริปต์ `build:api` ซึ่งอยู่ในคำสั่ง `build`) — อย่าแก้ตรง ๆ ให้แก้ที่ `server/handler.ts` แล้วรัน `npm run build:api`. ต้อง bundle เพราะ Vercel รันฟังก์ชันแบบ native ESM และไม่ bundle import ข้ามโฟลเดอร์ (`../src`, `../server`) ให้ → ถ้าปล่อยไว้จะ `ERR_MODULE_NOT_FOUND` ตอนรัน; commit ไฟล์นี้ไว้เพื่อให้ Vercel ตรวจเจอฟังก์ชัน (เนื้อหาถูก regenerate สดทุก build อยู่แล้ว)

## Env / AI backend

ลำดับอัตโนมัติ: มี `ANTHROPIC_API_KEY` → Claude API; ไม่มี → `claude` CLI ในเครื่อง (ใช้ login ของ Claude Code, ต้อง login แล้ว); ไม่มีทั้งคู่ → โหมดจำลอง. บังคับด้วย `BOX_SPEC_BACKEND=api|cli|mock`. `BOX_SPEC_MODEL`: backend api default claude-opus-4-8, backend cli default โมเดลที่ตั้งใน Claude Code (ใส่ alias haiku/sonnet ได้เพื่อความเร็ว). ดู `.env.example`

หมายเหตุ CLI: server ล้าง env `ANTHROPIC_*`/`CLAUDE*` ก่อน spawn เสมอ (กัน base URL/token ของ session อื่น shadow login ปกติ) และปิด stdin ทันที — อย่าเอาออก ไม่งั้นพังเมื่อรันจากใน Claude Code

## Gotchas

- three ต้อง >= 0.185 — r175 มีบั๊ก ExtrudeGeometry ไม่สร้างฝาหน้า-หลังเมื่อ bevelEnabled:false (กล่องกลายเป็น wireframe)
- เปลี่ยนเวอร์ชัน dependency แล้วต้องลบ `node_modules/.vite` แล้วรีสตาร์ท dev server ไม่งั้น pre-bundle เก่าค้าง
- พิกัดแผ่นคลี่: x ขวา y ลง หน่วย mm; แปลงเป็น 3D ที่ (x, -y, 0)
- ฟอนต์ไทย self-host ผ่าน `@fontsource/*` (import ใน main.tsx, ไม่พึ่ง Google CDN); ข้อความเลือกได้หลายฟอนต์ (registry `FONTS` ใน artwork.ts: noto/sarabun/prompt/kanit) + น้ำหนัก 400/700 — เพิ่มฟอนต์ใหม่ต้องทำ 3 จุด: import css ใน main.tsx, เพิ่มใน `FONTS`, และ `ensureThaiFont` โหลดให้; ก่อน rasterize ลง canvas (renderArtworkCanvas/ใบสเปก) ต้อง `await ensureThaiFont()` เพราะ fontsource โหลด subset ต่อน้ำหนักแบบ lazy — ถ้าไม่รอ canvas จะ fallback ทำให้ไทยในไฟล์ export เพี้ยน
- ขนาดตัวอักษรป้ายบอกขนาด = `dimTextSize` (ตามขนาดแผ่น 3.5–6 มม.) ใช้ร่วม blueprint/SVG/PDF — อย่าใส่ fontSize ตายตัว (แผ่นเล็กตัวเลขล้น)
- ตัวเลขบน blueprint คือระยะ score จริง (บวกเผื่อความหนาแล้ว) จึงใหญ่กว่าค่าที่ผู้ใช้ตั้งเล็กน้อย — ตั้งใจ ไม่ใช่บั๊ก
- แผนเฟสเดิม (FEFCO 0427, sleeve, export PDF/DXF, โลโก้/ข้อความ, ขวด revolve + ฉลาก) เสร็จครบแล้ว
- ชนิดงาน (packKind ใน materials.ts) แยก 3 path จากวัสดุ: `box` (foldable) / `vessel` (revolve) /
  `pouch` (form==='pouch') — App เลือก generator + viewer + label UI ตาม kind ไม่ใช่ `mat.foldable` ตรง ๆ
  แล้ว (ถุงกับภาชนะต่างเป็น !foldable ทั้งคู่); เพิ่มชนิดงานใหม่ต้องเพิ่ม kind + แตะจุดที่เช็ค kind ใน App
- วัสดุพับไม่ได้ (pet-bottle/glass/aluminum) → เส้นทางภาชนะใน `src/core/vessel.ts`:
  โปรไฟล์ revolve ต่อชนิดวัสดุ (LatheGeometry ใน VesselViewer3D) + dieline "ฉลาก" พันรอบตัว
  — ฉลากเป็น Dieline ธรรมดา ระบบ artwork/export/guides/ใบสเปกเดิมจึงใช้ได้หมด
  ความหมายขนาด: W = ⌀ตัว, D = ⌀ปาก/คอ, H = สูง (template ถูกละเลย); `isVessel` = !foldable && form≠pouch
- หลอดครีม (tube-laminate, path ภาชนะ): W = ⌀ท่อ — ลำตัวสร้างจาก `tubeSection` (pure, vessel.ts) หน้าตัดวงรีเส้นรอบวงคงที่ πW
  (กลมที่ไหล่ → แบนกว้าง πW/2 ที่ซีล, ด้านข้างหัวกระสุน 1−v^`TUBE_BULLET`) ใช้ร่วม 3D + ความจุ (`tubeVolumeMl`); ตั้งบนฝา flip-top
  กว้างเกือบเท่าท่อ (`tubeCapR`), ซีลบน `TUBE_SEAL` มีลอนกด; พิมพ์รอบตัวทั้งท่อ (ค่ามาตรฐาน = ไหล่ถึงใต้ซีล) UV ตามความยาวผิว เริ่มกลางหลัง
- วัสดุถุงฟิล์ม (pouch-foil/pouch-kraft/pouch-clear, form==='pouch') → `src/core/pouch.ts`:
  ถุงฟิล์ม — (1) dieline แผ่นฟิล์มแบน (ข้างจีบ/ก้นแบน: [หน้า][หลัง][ลิ้นกาว]; pillow: [ครีบ][หลังซ้าย][หน้า][หลังขวา][ครีบ];
  ซองแบน 3 ด้าน: แผงหน้า+หลังแยก ซีล ⊔ (ซ้าย-ล่าง-ขวา `FLAT_SEAL` 3 มม.; มีรูแขวน → ซีลบนเป็นหัวซอง `FLAT_HANG_HEADER`) ปากบนเปิดไว้บรรจุ — 3D `flatZ`/`flatAt` ซีลแบนรอบ 4 ด้าน กลางพองบาง,
  ความจุซองแบนใช้สูตรปริมาตรซองแบนตอนบรรจุเต็ม (ไม่ใช่ความหนาที่แสดงใน 3D);
  doypack: แผงหน้า+หลังแยก ดูด้านล่าง) เป็น
  Dieline ปกติ ไหลผ่าน artwork/export/CMYK/ใบสเปกได้เลย (2) ทรง 3D ใน PouchViewer3D = พื้นผิว loft
  หน้าตัดวงรีเปลี่ยนตามความสูง (`pouchWidthFactor`/`pouchDepthFactor` เป็น pure ทดสอบได้: ก้นแบนตั้งได้
  พุงกลางป่อง ปากซีลแบน) + UV แม็พ frontRect/backRect ให้ลายอ่านไม่กลับด้านเมื่อมองจาก +Z (texture flipY=false)
  ความหมายขนาด: W = กว้างถุง, D = ลึกก้น (clamp ≤ W, ≥10; ซองแบนไม่ใช้ D), H = สูงลำตัว (template ถูกละเลย)
  รูปแบบถุง `pouchStyle` (`POUCH_STYLES`) 6 แบบ: 'stand' doypack ก้นตั้ง / 'flat' ซองแบน 3 ด้าน (ไม่ใช้ D) /
  'gusset' ซองข้างจีบ brick (front+จีบ+back+จีบ, ทรงแท่ง) / 'box' ก้นแบนตั้งเหลี่ยม (จีบข้าง+ก้น gusset, ตั้งได้) /
  'pillow' ซองหลังกลาง (ไม่ใช้ D, fin seal กลางหลัง, พองนุ่ม) / 'spout' ถุงมีจุก (ก้นตั้งเหมือน stand + จุก 3D + marker บน dieline)
  — dieline คุมด้วย sideGusset (gusset/box) + bottomGusset (stand/box/spout) + sb (flat/gusset/pillow);
  โปรไฟล์ 3D ผ่าน `pouchDepthFactor(v, style)` + `pouchWidthFactor(v, style)` + `pouchSection(θ, style)`
  (gusset/box ใช้ superellipse = ทรงเหลี่ยม) + `Pouch.depth3D`/`stands`/`spout`; `generatePouch(box, mat, { style, zipper })`
  ยกเว้น 3D ของ gusset (แบบถุงกาแฟ) ใช้ `brickShape`/`brickRows`/`brickAt` (pure): ลำตัวก้นแบน → ไหล่ (จีบพับเข้าเป็น
  สามเหลี่ยม ความยาวครึ่งจีบคงที่) → ครีบซีลตั้งตรงกว้างเต็มหน้า; ผิวหน้า ลำตัว+ไหล่ ยาว = H และครีบ = แถบซีลบน
  → UV ตรง dieline; ซิป/วาล์ว/tin-tie ของ gusset วางตามระยะบน dieline ผ่าน `brickAt` (ไม่ใช่ v×H)
  ถุงตั้ง/มีจุก (stand/spout) = doypack แบบงานพิมพ์จริง: dieline เป็นแผงหน้า [0,W] + หลัง [W,2W] แยกด้วยเส้นตัด แต่ละแผงมี
  ซีลข้าง `DOYPACK_SEAL` 3 มม. สองด้านตลอดความสูง + ซีลบน `DOYPACK_TOP_SEAL` 5 มม. (มีรูแขวน → หัวถุง 12) + ครึ่งก้น D/2 (ถุงมีจุกยังใช้ซีล 6/10 เพราะมุมมนต้องตัดในเนื้อซีล; `Pouch.sideSeal` บอกค่าที่ใช้จริง) ใต้ลำตัวที่ซีลโค้ง (`DOYPACK_BOTTOM_SAG`, Q curve)
  ไม่มีลิ้นกาว/รอยต่อหลัง (`backSeam` ใช้กับ pillow เท่านั้น); รูแขวน/รอยบากเจาะทั้งสองแผง
  3D ใช้ `doypackRows`/`doypackAt`/`doypackZ` (pure): แต่ละแผงแม็พทั้งแผงของ dieline (รวมซีล) ซีลข้าง/ซีลบนแบนที่ ±`DOYPACK_FIN`,
  ช่วงพองหน้าตัดเลนส์ `lensZ`; ด้านข้างทรงหัวกระสุน 1−v^`DOYPACK_BULLET` (หนาสุดที่ก้น) จากพื้นถึงปลายแหลมใต้ปีกซิป (ซิปหนีบปากแบน)
  ซีลข้างตรงเกือบดิ่ง (ดึงเข้าแค่ `DOYPACK_PULL`) + มุมก้นมน `doypackCorner` — ห้ามหดความกว้างตามความยาวโค้งเต็มที่ (ทำแล้วถุงเรียวผิดทรง);
  ขอบซีล (หนา 2·FIN) + ฐานเลนส์ = material 1; ซิป/วาล์ว/tin-tie/จุกวางผ่าน `doypackAt`
  ถุงมีจุก (spout) ต่อยอด doypack: แผงไดคัทมุมมน `SPOUT_CORNER_R` (≤ ซีลข้าง) ตัดแยกสองชิ้น + แนวเชื่อม "เรือ" จุกกลางขอบบนทั้งสองแผง
  (`spoutMarker` r/bw/bh ใช้ร่วม dieline/3D/ตรวจซิป); 3D ใช้ `spoutRows`: ปากไม่บีบแบนเพราะเรือค้ำ — ช่วงไหล่ `SPOUT_SHOULDER` รวบเข้าหาเรือ
  (ฟิล์มเหลือเป็นแผ่นแบน `flat` + หน้าตัดขอบลาด `sectionZ`), ซีลข้างแยกเป็น Λ เหนือก้น gusset (`e`, ขอบข้างเป็นร่อง V),
  มุมมนตัดฟิล์มในแถวบน/ล่าง (`cut`, UV 1:1 ไม่บีบลาย), ลอนเกลียวเรือใต้ฟิล์ม (`rib`); ฝา = คอ+เกลียว+ปีกรอง+ฝาหยัก
  ซองหลังกลาง (pillow): ลิ้นครีบ `POUCH_FIN_SEAL` สองปลายแผ่นประกบกันเป็นครีบกลางหลัง; 3D ใช้ `pillowRows` (pure) หน้าตัดวงรีที่
  เส้นรอบรูป = 2W (ฟิล์มไม่ยืด → ข้างเว้าเข้าตรงที่พอง เหมือนซองขนม), ด้านข้างแหลมหาซีล 1−|2v−1|^`PILLOW_BULLET`, ซีลบน/ล่างแบน,
  ครีบซีลเป็นแถบแนบหลัง (UV = ลิ้นครีบขวา) — สันข้างเป็นรอยพับมน ไม่ใช่ซีล
  ซองข้างจีบใช้ `BRICK_SEAL` 20 มม. ทั้งบน/ล่าง; ครีบบนตั้งตรง ส่วนซีลล่างพับเป็นชั้นบางไปด้านหลังใต้ฐาน
  และแม็พ UV ไปยังแถบซีลล่างเต็มความยาว. รูปแบบถุงอื่นยังใช้ `POUCH_TOP_SEAL` 10 มม.
  ออปชันเสริม `PouchAddons` = { hangHole (รูแขวน euro-hole, ตัดจริง), valve (วาล์วกาแฟ marker+จาน 3D),
  tinTie (ที่รัดปาก แถบ 3D) } — ตำแหน่งใช้ค่าคงที่ร่วม dieline/3D (`VALVE_V`/`TINTIE_INSET`/`valveR`)
  ตำแหน่งซิป/รอยบาก: `pouchAddons.zipAt`/`tearAt` (มม. จากขอบบน, ไม่ใส่ = ซิป 18 มม. ใต้ซีล + รอยบากอัตโนมัติเหนือซิป `TEAR_GAP`)
  ผ่าน `pouchZipLayout` ชุดเดียวทั้ง dieline/3D; หลักผลิตตรวจใน `pouchPreflight.ts` (รอยบากพ้นซีล → เหนือซิป → ซิปไม่ทับวาล์ว/จุก/ก้นจีบ)
  — schema cloud (`server/modules/projects/validation.ts`) เป็น strict: เพิ่มฟิลด์ที่เก็บต้องเพิ่มที่นั่นด้วย ไม่งั้นบันทึกขึ้น cloud ไม่ผ่าน
  ออปชันระดับ Project ของถุง (`pouchStyle`, `zipper`, `pouchAddons`) thread แบบเดียวกับ `labelStyle` ทุกจุด
  (snapshot/sameSnap/sync/openProject/parseProject/projectFile) — เก็บเฉพาะเมื่อ ≠ ค่าเริ่มต้น (addons เก็บเฉพาะคีย์ true);
  เพิ่มฟิลด์ที่เก็บจึงขึ้น PROJECT_FILE_VERSION (ปัจจุบัน 10); ตั้งผ่าน UI หน้าออกแบบ ไม่ผ่าน AI
- รอยพับ 180° ได้สันโค้งจาก `rollBeads` ใน fold.ts (ทรงกระบอกบาง รัศมี = ครึ่งระยะสองชั้น) — ตอนนี้ไม่มี template ใช้แล้ว
- FEFCO 0427 ตามผัง dieline มาตรฐาน: ผนังข้างทบเป็นรอยพับคู่ (ผนัง → สัน กว้าง sp = 3t+0.2 = ผนัง+หู+ชั้นทบ → ชั้นทบ)
  ลิ้นปลายชั้นทบลงช่องบนฐานที่ sp − t/2; ฝาแคบกว่ากล่องข้างละ sp มีปีกข้างคางหมูพับลงด้านในชั้นทบ (stage 4 ก่อนฝาปิด 5),
  ลิ้นหน้ามุมโค้งใหญ่, หูมุมสี่เหลี่ยม, ผนังหน้าเตี้ยกว่า t. `fefco0427Layout` = ผังพับ (เทสต์เรขาคณิตใช้ผังนี้) แล้ว
  `rotateDieline90` ให้ฝาเปิดไปทางขวาแบบมาตรฐาน — template ตั้ง `spin` (−π/2) ให้ Viewer3D หมุนแผ่นกลับ (Euler z ก่อน tilt)
  ผนังหน้าจึงหันหากล้องเหมือนเดิม; เทสต์ท้าย fefco0427.test จำลอง transform ของ viewer ยืนยันว่าตำแหน่งทุกแผงตรงกัน
  โครงเดียวกันใช้ซ้ำ: `rollEndLayout(box, mat, { lid, flap })` — tray = lid:false, rollover mailer = lid:true + flap:'long'
  + front:'over' (ปีกข้างฝายาวเกือบเต็มฝา มุมฝั่งลิ้นหน้ามน ฝั่งบานพับเฉียง, ผังไม่หมุน ฝาอยู่บน; แผงหน้าฝากว้างเต็มแผ่น
  คลุมด้านนอกผนังหน้า ~0.9 ความสูง + หูสองปลายอ้อมมุมแนบนอกผนังข้าง — ลำดับ ปีกข้าง 3 → แผงหน้า+หู 4 → ฝาปิด 5)
- กล่องฝาครอบ FEFCO 0300 (`lidBox.ts`): ถาดฐาน + ถาดฝาลึกเท่ากัน (ฝากว้าง/ยาวกว่า = ด้านนอกฐาน + `LID_CLEAR`) ลิ้นมุม
  สี่เหลี่ยมเต็ม (`buildTrayPiece` opts `squareCorners`, มีร่องหลบ) — 3D พลิกฝา 180° มาวางครอบฐาน: `l-base` เป็นลูกของ `b-base`
  แกนหมุนกึ่งกลางระหว่างศูนย์กลางสองชิ้น + zOffset ยกขึ้นจนขอบฝาวางบนขอบฐาน (stage 4) แล้ว `Panel.slide` สวมลงจนมิดฐาน (stage 5;
  พลิกต้องเสร็จก่อนสวม ไม่งั้นผนังฝากวาดทะลุผนังฐาน), `Panel.assemble` = ประกอบชิ้น ไม่ใช่รอยพับ (rollBeads ข้าม)
- ลิ้นเสียบที่ต่อจากฝา (tuck-end/0215/mailer/rollover/0427) ตั้ง `Panel.tuck: true` — มุมพับของลิ้น
  ผูกกับมุมฝาใน `tuckAngle` (fold.ts) ให้ลิ้นงอเข้าระหว่างฝาลงแล้วไถลตามผนังด้านใน; ถ้าใช้จังหวะ stage
  ธรรมดา (ฝาปิดก่อนแล้วค่อยพับลิ้น 90°) ปลายลิ้นจะกวาดทะลุผนังหน้า ~ความยาวลิ้น. template ใหม่ที่มีฝา+ลิ้น
  ให้ตั้ง tuck แล้วเพิ่มเคสใน `src/core/tuck.test.ts`
- ลำดับ stage ต้องเป็นแบบพับจริง: แผงที่จบลง "ใน" ผนังอื่น (ลิ้นกันฝุ่น/ลิ้นมุม/หูมุม) ต้องพับเสร็จก่อนผนังนั้นตั้ง
  (เช่น mailer/trayPiece: ผนังข้าง 0 → ลิ้นมุม 1 → ผนังหน้า-หลัง 2; tray/0427: ผนังหน้า-หลัง 0 → หูมุม 1 → ผนังข้าง 2 → ทบ 3) และ zOffset: พับก่อน = ลึกกว่า (ค่ามากกว่า)
  ไม่งั้นลิ้นกวาดอยู่นอกผนังที่ตั้งแล้วทะลุเข้าไปตอนท้าย — `src/core/foldOrder.test.ts` ไล่ตรวจทุก template อัตโนมัติ
- FEFCO 0217 (กล่องหูหิ้วทรงจั่ว): ฝาหน้า-หลังพับแบนที่ปาก หูหิ้วสองชั้นตั้งกลาง แล้วหน้าจั่วเอนเข้า (stage สุดท้าย)
  ให้หูมนที่ปลายหูหิ้วโผล่ทะลุร่องหน้าจั่ว — ขอบร่องบากฝั่งแผงหูหิ้วเอียงตามมุมเอนของหน้าจั่ว;
  การสอดผ่านร่องตรวจใน `fefco0217.test.ts` (หูหิ้วข้ามเนื้อหน้าจั่วได้เฉพาะในรู ทุกจังหวะพับ)
- หน้าต่างเวลาการพับใน `fold.ts` เลือกชุดตามจำนวน stage ที่ template ใช้ (`WINDOWS_4`/`WINDOWS_5`/`WINDOWS_6`)
  — เพิ่ม template ที่ต้องการจังหวะมากกว่า 5 ให้เพิ่มชุดใหม่ อย่าแก้ชุดเดิม เพราะจะไปเปลี่ยน
  จังหวะพับของ template ที่จูนไว้แล้ว
