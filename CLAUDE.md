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
- `scripts/showcase/` — เครื่องมือพิสูจน์ไฟล์งาน `.genpkg.json` ผ่านแอปจริง (ใช้ตอนให้ agent ออกแบบงานเป็นไฟล์): `bundle-core.mjs` รวม core ด้วย esbuild เป็น `tmp/showcase/core.mjs` สำหรับ Node → `validate.mjs <file> [--write]` (แปลง `file:<svg>`/`preset:<id>:<#สี>` เป็น data URL แล้ว parse ด้วย `parseProjectFile` รายงาน problems/dropped) · `layout.mjs <file>` (กรอบแต่ละแผงเป็น มม. + element ที่อยู่นอกแผง) · `render.mjs <file…>` (Playwright + Chrome: ยัดงานเข้า localStorage ของ dev server โหมด local-demo ถ่าย 3D/กลางทางพับ/แผ่นคลี่ แล้วกดปุ่มส่งออก PDF/SVG จริง; env `SHOWCASE_BASE_URL` ค่าเริ่มต้น http://localhost:5175, `PACKIT_E2E_CHROME`, `SHOWCASE_OUT`); ผลลัพธ์อยู่ใต้ `tmp/` ซึ่ง ignore ไว้

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
- เอฟเฟกต์ข้อความ `TextEl.fx` (`src/core/textFx.ts`, pure): drop/background/hollow/splice/double/echo/glow/long — `textFxPlan` แปลงเป็นชั้น
  (กล่องพื้นหลัง → ชั้นใต้ตัวอักษร เยื้อง/เบลอ/ทึบ → ตัวอักษร) แล้วตัววาดทุกทางวาดตามรายการเดียว: `textInnerSVG` (artwork.ts)
  ใช้ทั้ง blueprint (DielineSVG ผ่าน innerHTML) และไฟล์ SVG; `drawText2D` (canvas → 3D/PDF/ไดคัทตามรูป/หมึกขาว) เบลอด้วยเงา canvas
  แบบวาดต้นแบบนอกภาพ (ไม่ใช้ ctx.filter) — เพิ่มเอฟเฟกต์ใหม่ = เพิ่มเคสใน `textFxPlan` เท่านั้น อย่าเขียนแยกต่อตัววาด;
  ค่าเก็บเป็น % ขนาดฟอนต์, เส้นไม่บางกว่า `MIN_PRINT_LINE_MM`; `shadow: true` เดิม parse เป็น `{ kind: 'drop' }`;
  สีของ fx ต้องผ่าน soft-proof (`proofTextFx`) และ schema cloud (`textFxSchema`); fx.color '' = อัตโนมัติจากสีตัวอักษร (`textFxAutoColor`)
  ตำแหน่งตัวอักษรมาจาก `textRuns` ชุดเดียว (ตรง = ทีละบรรทัด, เว้นระยะ `TextEl.ls` หรือโค้ง = ทีละ grapheme ผ่าน Intl.Segmenter
  ให้สระ/วรรณยุกต์ไทยไม่หลุดจากพยัญชนะ); ไล่สีตัวอักษร `TextEl.grad` = `TEXT_GRAD_PAINT` ในแผน → ตัววาดแทนเป็น gradient
  (ชั้นเบลอใช้สีแรก เพราะเงา canvas เป็นสีเดียว); อักษรโค้งมี transform ต่ออักษร → ไล่สีต่ออักษรผ่าน `runGradGeom`
  (ทั้ง SVG userSpaceOnUse และ canvas ตีความ gradient ตาม transform ของตัวที่วาด); PROJECT_FILE_VERSION 18
- งานพิมพ์พิเศษต่อชิ้น `BaseEl.finish` (`src/core/finish.ts`, pure: `FINISHES` ฟอยล์ทอง/เงิน/โรสโกลด์, Spot UV, ปั๊มนูน/จม):
  ไฟล์ส่งออกได้เพลตสี spot แยกต่อชนิด (ชื่อ `def.spot` เช่น Foil_Gold/Spot_UV) — PDF: `dielinePDFBytes` อาร์กิวเมนต์ `spots`
  (Separation + OCG ชื่อเดียวกัน + ExtGState `/GSop` overprint, อยู่เหนือลายใต้เส้นตัด), SVG: เลเยอร์ต่อชนิด; เส้นเพลต trace จาก alpha
  ของชิ้น (`renderArtworkAlpha` → `traceWhiteInk(m, 0)`, `finishPlatesForExport` ใน App, แผ่นสติกเกอร์วางซ้ำผ่าน `placePoint`);
  **ฟอยล์ไม่พิมพ์ CMYK** (`printsCmyk`) → `renderArtworkCanvas(..., 'print')` และเลเยอร์ artwork ของ SVG ข้ามชิ้นฟอยล์;
  พรีวิว: blueprint `FinishLook` (DielineSVG: ฟอยล์ = mask alpha + ไล่แสงโลหะ, UV = แถบเงา, ปั๊ม = ฟิลเตอร์ไฮไลต์/เงา —
  สี่เหลี่ยมที่มี mask ต้อง pointerEvents none เพราะ mask ไม่ตัดพื้นที่คลิก), canvas `drawDecoPreview`/`drawSilhouette`
  (ฟอยล์ = รูปทรงสีโลหะ; ใบสเปก/ภาพย่อ/texture 3D), 3D `useFinishMaps` → roughness/metalness map (G/B) + bump map
  พิกัดเดียวกับ texture ลาย (configure flipY/repeat ต้องตรงกัน) ใช้ใน Viewer3D/VesselViewer3D/PouchViewer3D ผ่าน `finishMaterialProps`;
  PROJECT_FILE_VERSION 19
- `src/core/guides.ts` — `computeGuides(dieline)`: safe = inset ต่อแผง; bleed = polyline ต่อเนื่องจาก "เส้นตัดขอบนอก" จริง (segments kind cut → ทดสอบฝั่งเนื้อวัสดุด้วย outline แผง, ร่องผ่าที่มีเนื้อสองฝั่งตกไป) ไม่ใช่ offset ทีละแผง (แบบเดิมได้เส้นซ้อนกลางแผ่น/หยุดที่รอยต่อกาว)
- `src/core/softProof.ts` + `src/components/useSoftProof.ts` — soft-proof CMYK บน blueprint (ปุ่ม "ดูสีแบบพิมพ์" ท้ายแถบเครื่องมือซ้ายบน ผ่าน prop `toolsExtra`, state ไม่จำข้ามรอบโดยเจตนา): ส่ง "สำเนา" ลาย/สีพื้น/รูปที่แปลงสีแล้วเข้า DielineSVG เท่านั้น — callback ของ blueprint อ้าง id/ค่าตัวเลข จึงแก้ไขระหว่างพรีวิวได้โดยสีจำลองไม่หลุดลงงาน/ไฟล์ส่งออก; รูปแปลงผ่าน canvas แบบ async + แคช. ใช้ 3D LUT 17³ ใน `src/core/cmykProofLut.ts` = **ไฟล์ที่ถูก generate** โดย `scripts/build-cmyk-lut.py` (Pillow/LittleCMS: sRGB→CMYK→sRGB relative+BPC แล้วแก้ gray balance ให้เทา/ขาว/ดำคงเดิม) — อย่าแก้ตรง ๆ; เปลี่ยน profile โรงพิมพ์ได้ด้วย `python scripts/build-cmyk-lut.py path.icc` (ค่าเริ่มต้น RSWOP.icm ของ Windows). สูตร RGB→CMYK ตรง ๆ ใน pdf.ts ใช้จำลองไม่ได้เพราะแปลงกลับได้ค่าเดิมเป๊ะ
- `src/core/imageDpi.ts` + `src/components/useImageDpi.ts` — เตือนรูปความละเอียดต่ำ: dpi = พิกเซลจริงของรูป ÷ ขนาดที่วาดจริง (สูตรเดียวกับ `drawImageFit`: cover×cropZoom/contain/stretch; รูปพื้นใช้ `fillImageRect`) — <150 dpi = ป้ายแดงบนรูปใน blueprint (`LowResBadge` สูงคงที่ ~11px บนจอ, ไม่ไปถึงไฟล์ส่งออก) + สรุปในแท็บส่งออก; รูปที่เลือกโชว์ dpi ในแผง (เขียว ≥300 / เหลือง / แดง); ข้าม SVG (เวกเตอร์) และลายจากไลบรารี (preset)
- รูปทรงสติกเกอร์พื้นฐาน (`StickerBasicShape`: rect มุมมน (ค่าเริ่มต้น)/square/ellipse/hexagon/star/heart) — `stickerOutline` ใน templates/sticker.ts
  พอดีกรอบ W×H (ปรับกว้าง/สูงจากช่องขนาด) มุมทุกมุมมนด้วย `fillet` ส่วนโค้งวงกลมจริง ≥1 มม. (โค้งกำลังสองที่จุดยอดได้รัศมียอดแค่ ~0.1×ระยะขา
  → ตัวตรวจไดคัทจับเป็นมุมหักศอก); ดาว/หกเหลี่ยมมนแล้วยืดกลับเต็มกรอบ; หัวใจ = สองวงพู + เส้นสัมผัสลงปลาย มนปลาย/ร่องด้วยวงแตะ
  (รัศมีเผื่อการยืดสองแกน); App เลือก `generateSticker(box, shape)` ตาม `stickerCut.shape` (contour ที่ยังไม่เสร็จ = rect); PROJECT_FILE_VERSION 15
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
- `src/core/standardSize.ts` — ขนาดมาตรฐานตามตลาด: `VESSEL_STANDARD` ต่อวัสดุ (PET 500 มล. 65×205 คอ 28 / แก้ว 750 มล. 76×300 /
  กระป๋อง 330 มล. 66×115 ฝา ⌀53 / หลอด 50 มล. 30×130) และ `POUCH_STANDARD` ต่อรูปแบบถุง (doypack 250 ก. 140×215+80, ซองแบน 100×150,
  ข้างจีบกาแฟ 250 ก. 80×210+60, ก้นแบน 125×195+65, ซองขนม 150×220, มีจุก 250 มล. 100×160+50) — ความจุเทียบด้วยสูตร capacity.ts
  ใน standardSize.test; ตั้งให้ตอนยังไม่เริ่มงาน (`isFreshWork`: ไม่มีลาย/รูปพื้น) เมื่อสลับประเภทงาน (`resetKindSize`), สลับวัสดุภาชนะ
  (`changeMaterial`) หรือสลับรูปแบบถุง (`changePouchStyle`) + ล้าง neckH/shoulderH/labelBox (`applyStdSize`); มีลายแล้วคงขนาดเดิม
  (หลอดตั้งค่ามาตรฐานเสมอ); กล่องใช้ defaults ของ template (กล่องไปรษณีย์ไทย: mailer/0427 = เบอร์ A 20×14×6, rollover = B 25×17×9,
  RSC = C 30×20×11 ซม.; นามบัตร 90×55)
- เตือนก่อนสลับประเภทงาน/รูปแบบบรรจุภัณฑ์/รูปแบบถุงเมื่อมีงานตกแต่งแล้ว (`hasDesignWork` ใน `src/core/designWork.ts` = มีลาย/รูปพื้น/สีพื้น
  แม้อย่างเดียว): `guardedSwitch` ใน App เปิด `SwitchGuardModal` (alertdialog สีอันตราย บอกรายการที่จะหาย โฟกัสเริ่มที่ยกเลิก) ยืนยัน =
  ล้าง decos/รูปพื้น/สีพื้น/แบบจาก AI แล้วค่อยสลับ — ตั้ง `freshAfterClear` ให้ `applyStdSize` ตั้งขนาดมาตรฐานได้ใน handler เดียวกัน
  (state ใน closure ยังเป็นค่าเก่า); ทั้งชุดเป็น undo ก้าวเดียว; กดรายการที่เลือกอยู่แล้ว/สลับวัสดุในประเภทเดิม/สเปกจาก AI ไม่ผ่านด่านนี้
- `src/core/imposition.ts` — คำนวณ yield ต่อแผ่น (pure): `computeImposition` วางกริด step&repeat เทียบชิ้นตั้ง/หมุน 90° เลือกจำนวนมากสุด + `sheetsNeeded` (ปัดขึ้น) + `SHEET_PRESETS` แผ่นมาตรฐานไทย; UI อยู่แท็บ "ส่งออก" ผูกกับช่องจำนวน (state ephemeral ไม่เก็บลง project)
- `src/core/snap.ts` — logic ดูด artwork เข้าแนวขณะลาก (pure): `snapTargets` สร้างเส้นเป้าหมายจากกึ่งกลางแผ่น/ขอบ-กึ่งกลางแผง/ขอบ-กึ่งกลางชิ้นอื่น, `applySnap` ดูดขอบ-กึ่งกลางชิ้นเข้าเส้นใกล้สุดในระยะ threshold (แปลงจาก 6px ตามซูม); กด Alt ค้างระหว่างลาก = ปิด snap
- `src/components/PromptBar.tsx` + `src/core/ai.ts` — AI layer ฝั่ง client; แนบรูปอ้างอิงได้ (ย่อเป็น JPEG ≤1024px ฝั่ง client → base64; backend api ส่งเป็น image block, backend cli เขียนไฟล์ tmp ให้ Claude เปิดอ่านเองแล้วลบทิ้ง)
- `server/boxSpec.ts` — endpoint /api/box-spec (Vite middleware): Claude structured outputs (`output_config.format`) → JSON spec; ไม่มี ANTHROPIC_API_KEY → โหมดจำลอง (mockSpec); export ตัวหลัก (askClaude/mockSpec/parseCurrent/parseImage) ใช้ร่วมกับ serverless
  — ห้ามกลับไปใช้ `tool_choice` แบบ tool/any (Opus 5.5 / Sonnet 5.5 ตอบ 400); ตัวเลือกตามรุ่นอยู่ `boxSpecModelOptions` (ตระกูล 5: `effort: low`, Opus/Sonnet 5.5: `fallbacks: "default"`)
  และ `stop_reason` refusal / max_tokens / ไม่มี JSON → `BoxSpecResponseError` (cloud คืนเครดิต); ช่องคำอธิบายที่ให้โมเดลกรอกชื่อ `explanation`
  แล้วแปลงกลับเป็น `reasoning` — ห้ามตั้งช่อง JSON ชื่อ reasoning/thinking (กระตุ้น refusal `reasoning_extraction` ที่คิดเงินและไม่มี fallback);
  prompt ของ claude CLI ยังเป็นข้อความเดิม (`systemPrompt(answer, why)` สร้างทั้งสองแบบ); ตัวเลือกรุ่น/ข้อแลกเปลี่ยน: docs/billing-freemium-pro.md §6
- `server/handler.ts` — ต้นทาง (source) ของ Vercel serverless `/api/box-spec` (import ตัวหลักจาก `./boxSpec`) — บน Vercel ไม่มี claude CLI จึงใช้แค่ backend api/mock; ตั้ง ANTHROPIC_API_KEY ใน Vercel env. Dev ใช้ Vite middleware, prod (Vercel) ใช้เส้นนี้ — client เรียก path `/api/box-spec` เดียวกัน
- `api/box-spec.js` — **ไฟล์ที่ถูก generate** (esbuild bundle จาก `server/handler.ts` ผ่าน `scripts/build-api.mjs`, สคริปต์ `build:api` ซึ่งอยู่ในคำสั่ง `build`) — อย่าแก้ตรง ๆ ให้แก้ที่ `server/handler.ts` แล้วรัน `npm run build:api`. ต้อง bundle เพราะ Vercel รันฟังก์ชันแบบ native ESM และไม่ bundle import ข้ามโฟลเดอร์ (`../src`, `../server`) ให้ → ถ้าปล่อยไว้จะ `ERR_MODULE_NOT_FOUND` ตอนรัน; commit ไฟล์นี้ไว้เพื่อให้ Vercel ตรวจเจอฟังก์ชัน (เนื้อหาถูก regenerate สดทุก build อยู่แล้ว)

## AI ประกอบโครงสร้างกล่อง (ภาษาแผง — ทดลอง, local dev เท่านั้น)

- `src/core/structure/` — grammar.ts (`BoxStructure` + `STRUCTURE_SCHEMA` + `parseStructure`), compile.ts (`compileStructure` → Dieline ปกติ: วางแผงตามต้นไม้ attach (fold 90/180/-90 ออกนอก/0 ต่อตรง), ลิ้นจากคลัง dust/tuck/tab, รูเจาะ hand-hole/window → `Panel.holes`, วัดช่องเปิดด้วย ray, zOffset จากคู่ที่นอนแนบกัน, **ลำดับพับเดาด้วยการจำลองพับจริง** แล้วเลื่อนจังหวะแผงที่ถูกกวาดทะลุ), validate.ts (ตัวตรวจ pure: ซ้อนทับ 2D / `checkFoldSweep` ตรรกะเดียวกับ foldOrder.test / `coverageByFace`), examples.ts — เอกสาร `docs/ai-panel-grammar.md`
- หลัก: AI เขียนแค่ "แผงอะไรต่อกับแผงไหนที่ขอบไหน ลึกเท่าไร มีลิ้นชนิดไหน" ระยะเผื่อความหนา/รูปร่างลิ้น/ลำดับพับเป็นของคอมไพเลอร์ → ผลิตได้โดยโครงสร้าง; `compile.test.ts` บังคับว่าภาษาแผงทำซ้ำ `generateTuckEndBox`/`generateSleeve` ได้ตรงทุกแผง (เครื่องหมายมุมพับ top/right + bottom/left − พิสูจน์จากเทสต์นี้ — เปลี่ยน convention ของ fold engine ต้องแก้ที่ `edgeFrame`)
- `server/boxStructure.ts` — วงรอบ `designStructure` (AI → parse → compile → ส่ง error ภาษาไทยกลับให้แก้ทั้งฉบับ ≤ 3 รอบ) + `/api/box-structure` (เปิดเฉพาะ `isLegacyAiRouteEnabled`; backend api/cli/mock เหมือน legacy); หน้าทดลอง `/tests/browser/structure.html` บน dev server; เช็คสด `PACKIT_LIVE_STRUCTURE=1 npx vitest run server/boxStructure.live.test.ts` (ใช้ claude CLI ถ้าไม่มีคีย์)
- ยังไม่ผูก Project/cloud/billing — ถ้าจะผูก ดูหัวข้อ "ขั้นถัดไป" ในเอกสาร

## AI ออกแบบหน้าตาบน template ที่มี (แผนงานศิลป์ — local dev เท่านั้น)

- หลักเดียวกับภาษาแผง: AI เขียน "เจตนา" เป็น JSON ตาม `ARTWORK_SCHEMA` (`src/core/aiArtwork.ts`) ไม่ได้วาดลงแผ่นคลี่เอง —
  ทุกชิ้นอ้าง `panel` id + x,y มม. จากมุมซ้ายบนของกรอบแผง (`panelBoxes(dieline)` + บทบาทจาก `panelRole(id)` เดาจาก convention ชื่อแผง:
  glue = ห้ามพิมพ์); `compileArtworkPlan(plan, panels, { measure, assets })` แปลงเป็น Deco จริง: วัดความกว้างข้อความ (client ส่ง `measureText`
  จริง, server ใช้ `estimateTextWidth`), ตัดบรรทัดที่ขอบคำด้วย `Intl.Segmenter` แล้วค่อยลดขนาด (`fitText`, ไม่ต่ำกว่า `ART_MIN_TEXT_MM` 2.5),
  ดันเข้ากรอบ/ย่อชิ้นที่ล้นแผง (เว้นขอบ `ART_SAFE_MM` 3 ยกเว้น shape/path ชนขอบได้), ตัดชิ้นบนปีกกาว, ตัด `curve` ออกจากข้อความไทย
- รูปของ AI มี 3 ทาง: `preset:<id>:<#สี>` (ไลบรารี), `asset:<id>` (รูปที่ผู้ใช้อัปโหลด client แทนที่เป็น data URL จริงตอน compile),
  `svg:<markup>` ที่ AI วาดเอง → `sanitizeSvg` (allowlist แท็ก/แอตทริบิวต์, ไม่มี script/style/image/use/ลิงก์ภายนอก, `url(#id)` เท่านั้น,
  ≤ 60k ตัวอักษร/รูป) → data URL เหมือน preset; `background` = SVG รูปพื้นทั้งแผ่น → `FillImage`
- `server/aiArtwork.ts` — route `/api/ai-artwork` (Vite middleware, เปิดเฉพาะ `isLegacyAiRouteEnabled`): คำขอจาก client มี prompt + panels
  (client คำนวณ) + รูปแนบ ≤ 4 ({ role: reference|logo, assetId }) → วงรอบ `designArtwork` (parse → ตรวจแผงที่ไม่มี → feedback ≤ 2 รอบ;
  ชิ้นที่ผิดถูกตัดตอน parse ถ้ายังเหลือ ≥ 4 ชิ้นไม่เสียรอบแก้) backend api/cli/mock เหมือน box-structure (cli เขียนรูปเป็นไฟล์ tmp ให้เปิดอ่าน);
  `max_tokens` 24k, API timeout 240 วิ, CLI 420 วิ — คำตอบยาวกว่า box-spec มาก จึงยังไม่ขึ้น cloud (ต้องมีงานเบื้องหลัง + เครดิต > 1)
- UI = **Copilot** (`src/components/CopilotDrawer.tsx`, แทน PromptBar popover เดิมที่ถูกลบ): ปุ่ม "สั่ง AI" บน header (`AiTrigger`,
  คง markup เครดิต/blocked เดิม) เปิดแผงด้านขวา 420px ใน `.body` (flex row ถัดจาก `main`) เป็นบทสนทนา 2 โหมดในช่องเดียว —
  `spec` (box-spec เดิม/cloud `requestAiSpec`) และ `artwork` (เฉพาะเมื่อ App ส่ง `artwork` context = ไม่ใช่ cloud) — prompt + รูปอ้างอิง ≤ 3 +
  โลโก้ 1 (ส่ง JPEG ย่อให้ AI ดู แต่วางรูปจริงจาก `loadImageFile` ผ่าน `asset:logo`) + แทนที่/เพิ่มต่อลายเดิม + ชิปสไตล์ + ปรับเร็ว;
  ผลทุกแบบ "วางลงงานทันที" (undo ก้าวเดียว) แล้วเป็นการ์ดในบทสนทนา (ช่อง `[กรอก…]` ดึงมาเตือนด้วย `placeholderFields`); ระหว่างรอ artwork
  โชว์ลำดับงานตามเวลา (โดยประมาณ — server ไม่สตรีม) + ยกเลิกด้วย AbortController; ผล artwork แต่ละรอบเก็บเป็น `ArtworkSnapshot` ใน App
  (`artSnapshots`) ให้ **เวที 3D** (`CopilotStage.tsx` โอเวอร์เลย์ z 290 ใช้ `viewer3D` JSX ชุดเดียวกับหน้าหลัก) สลับดู/เลือกแบบ (`pickArtSnapshot`);
  `src/components/refImage.ts` = ตัวย่อรูปอ้างอิง
- เทสต์: `src/core/aiArtwork.test.ts` (schema keyword ban, parse, sanitizer, compile), `server/aiArtwork.test.ts` (วงรอบด้วย ask ปลอม, mock)

## Env / AI backend

ลำดับอัตโนมัติ: มี `ANTHROPIC_API_KEY` → Claude API; ไม่มี → `claude` CLI ในเครื่อง (ใช้ login ของ Claude Code, ต้อง login แล้ว); ไม่มีทั้งคู่ → โหมดจำลอง. บังคับด้วย `BOX_SPEC_BACKEND=api|cli|mock`. `BOX_SPEC_MODEL`: backend api default claude-opus-5-5 (`DEFAULT_AI_MODEL` ใน server/config.ts; รองรับ claude-sonnet-5-5 / claude-haiku-5-5 / claude-opus-4-8 ด้วย — ดู docs/billing-freemium-pro.md §6; รุ่นตระกูล 5 ห้ามบังคับ tool_choice และปิด thinking ไม่ได้ จึงใช้ structured outputs), backend cli default โมเดลที่ตั้งใน Claude Code (ใส่ alias haiku/sonnet ได้เพื่อความเร็ว). ดู `.env.example`; เช็คสดทุกรุ่น (เสียเงินจริง): `PACKIT_LIVE_AI=1 ANTHROPIC_API_KEY=… npx vitest run server/boxSpec.live.test.ts`

หมายเหตุ CLI: server ล้าง env `ANTHROPIC_*`/`CLAUDE*` ก่อน spawn เสมอ (กัน base URL/token ของ session อื่น shadow login ปกติ) และปิด stdin ทันที — อย่าเอาออก ไม่งั้นพังเมื่อรันจากใน Claude Code

ลำดับ api/cli/mock ข้างบนใช้กับ legacy `/api/box-spec` ของ local demo เท่านั้น — Cloud (`/api/v1/ai/box-spec`) ใช้ `ANTHROPIC_API_KEY` อย่างเดียว ไม่มี CLI/mock (ดูหัวข้อแพ็กเกจ)

## แพ็กเกจ / billing

- กติกา/ตาราง/RPC/route ทั้งหมดอยู่ใน `docs/billing-freemium-pro.md` (เอกสารหลัก แทนตัวเลขเดิมใน backend-implementation-spec §10–12): Freemium (AI 0 เครดิต, ดาวน์โหลดไฟล์ผลิตไม่ได้, พรีวิวมีลายน้ำ) / ซื้อรายแบบ 149 บาท ต่อ project id (สำเนา/นำเข้าได้ id ใหม่ = ไม่ได้สิทธิ์ตาม) / Pro 399 บาท/เดือน; ยังไม่เลือก payment provider → `orders.provider = 'none'`, `checkoutUrl = null`, จำลองจ่ายได้เฉพาะ `APP_ENV` development/test ผ่าน `POST /api/v1/billing/orders/:id/dev-fulfil`
- ข้อมูลอยู่ใน `app_private` (migration `20261013000600_billing.sql`): `plan_catalog` (ราคา/เครดิต — ปรับตัวเลขที่ตารางนี้ ไม่ต้องแก้โค้ด), `orders`, `subscriptions`, `design_licenses`, `credit_balances`, `credit_ledger`, `ai_requests`; RPC `get_entitlements` / `authorize_export` / `reserve_ai_credit` / `settle_ai_request` / `create_order` / `fulfil_order` (raise รหัสคงที่ P0001 → server map เป็น HTTP) ผ่าน `server/adapters/supabase/billingRepository.ts` + `server/modules/billing/billingService.ts`
- ยังไม่เปิดขาย (ตัดสินใจ 13 ต.ค. 2026): `Entitlements.purchasesEnabled` = false บน staging/production → client ซ่อนปุ่มซื้อ/ต่ออายุทุกจุด และ `POST /billing/orders` ตอบ 503 `PURCHASE_UNAVAILABLE`; ตอนนี้ true เฉพาะ development/test (`billingFlags`/`isPurchaseEnabled` ใน `server/http/router.ts`) — มีผู้ให้บริการชำระเงินเมื่อไรให้แก้เงื่อนไขที่นั่น
- ช่วงเปิดใช้ฟรี (open access, ตัดสินใจ 15 ต.ค. 2026): `isOpenAccess` = `!isPurchaseEnabled` (`server/http/router.ts`) → staging/production ทุก workspace ได้ "รอบ Pro ฟรี" (subscriptions `order_id` null ยาวตาม catalog `pro` ต่อเองเมื่อหมด, เครดิตเติมให้ถึงโควตา `pro` ไม่บวกสะสม) ผ่าน RPC `ensure_open_access`/`authorize_open_access_export` (migration `20261015000700_open_access.sql`) — ดาวน์โหลดได้ทุกแบบ **ไม่ออก `design_licenses`**, ไม่มีลายน้ำ/ป้ายราคา, ชิป "Pro · ใช้ฟรีช่วงนี้" (`Entitlements.openAccess`); development/test ปิดไว้ให้เทสต์ paywall/E2E ยังตรวจกติกาปกติ; เปิดขายเมื่อไร open access ปิดเอง; ลายน้ำตัดสินที่ `previewWatermarked` (`src/core/watermark.ts`) — ติดเฉพาะเมื่อโหลดสิทธิ์สำเร็จแล้วรู้แน่ว่ายังไม่มีสิทธิ์ (ระหว่างโหลด/โหลดไม่ได้ไม่ติด)
- ไฟล์เวกเตอร์ SVG / AI เฉพาะ Pro (ตัดสินใจ 16 ต.ค. 2026; ซื้อรายแบบได้แค่ ใบสเปก/DXF/PDF): client ส่ง `{ format }` ไปกับ
  `POST /projects/:id/export-authorizations` (`ExportFormat`, `isProOnlyExport` ใน shared/contracts/billing.ts) → `BillingService.authorizeExport`
  ผ่านด่านสิทธิ์ปกติก่อน แล้ว plan ≠ pro → 402 `PRO_REQUIRED` (`details.price` = catalog.pro); UI ป้าย "Pro" บนปุ่ม SVG/AI, กดแล้วเปิด
  PaywallModal kind pro + `proOnly` (ไม่เสนอซื้อรายแบบ); ไฟล์ .ai = เนื้อหา PDF ชุดเดียวกับ "แบบพิมพ์ 1:1" (Illustrator เปิดแบบ PDF-compatible)
- 402 สองรหัส: `PAYMENT_REQUIRED` (`POST /projects/:id/export-authorizations` ของแบบที่ยังไม่ซื้อและไม่ใช่ Pro, `details.price`) และ `AI_CREDITS_EXHAUSTED` (AI route, `details.credits/plan`); 409 `ALREADY_LICENSED` / `AI_REQUEST_IN_PROGRESS` / `ORDER_NOT_PAYABLE`; ปุ่มดาวน์โหลดบน cloud ต้องขอ authorization จาก server ก่อนสร้างไฟล์ทุกครั้ง (server ตัดสินสิทธิ์ ไม่ใช่ client)
- AI บน cloud ใช้คีย์ของระบบ `ANTHROPIC_API_KEY` (+ `BOX_SPEC_MODEL`) ฝั่ง server เท่านั้น — client ไม่ส่งคีย์ (header BYOK `x-packit-anthropic-api-key` และ `AI_API_KEY_*` ถูกถอดแล้ว); ไม่มีคีย์ → 503 `CONFIGURATION_ERROR`; เครดิต 1 ต่อคำขอ หักตอนจอง (`reserve_ai_credit`) คืนเมื่อ provider ล้ม (`settle failed`) ผลกลับมาแล้วไม่คืน; คำขอค้าง `reserved` ต่อ workspace ได้ไม่เกิน 2 (เกิน → 429 `AI_RATE_LIMITED`); settle เก็บ model/โทเคน/แนบรูปใน `ai_requests` — ดูต้นทุนด้วย `npm run ops:ai-usage:report` (cloud ผ่าน env `PACKIT_REPORT_DATABASE_URL`, ราคาส่งเป็น flag เอง); log server เป็น JSON บรรทัดเดียวผ่าน `server/logging.ts` (ตัดคีย์/token/อีเมลเสมอ — ห้าม `console.*` ข้อมูลดิบในเส้นทาง billing/AI)
- โหมด local-demo (`dev:local`) ไม่มี paywall/ลายน้ำ (App ไม่ได้รับ prop `cloud` → `watermarkOn = false` และ `gatedDownload` ข้าม `authorizeExport`) และยังใช้ BYOK กับ legacy `/api/box-spec` ได้
- ลายน้ำ (`src/core/watermark.ts` pure) อยู่บนพรีวิวเท่านั้น: DielineSVG prop `watermark`, texture 3D ผ่าน `useArtTexture`, overlay ของ StickerSheetPreview — **ห้าม** ทำเป็น Deco เพราะ Deco ไหลเข้า snap/DPI/contour/ไฟล์ส่งออก (ไฟล์ใช้ `dielineSVGString` คนละทางจึงไม่มีลายน้ำ)
- หน้าแพ็กเกจและราคา `src/components/PricingPage.tsx` (เต็มจอ z-index 260 ใต้ modal 300): ในแอปเปิดจากชิปแพ็กเกจบน header/ลิงก์ "เปรียบเทียบแพ็กเกจทั้งหมด" ใน PaywallModal — ปุ่มซื้อเปิด PaywallModal ซ้อนด้านบน (Esc ปิด modal ก่อนผ่าน `escapeDisabled`); หน้าเข้าสู่ระบบ cloud มีลิงก์ "ดูแพ็กเกจและราคา" (โหมดผู้เยี่ยมชม: ไม่มี catalog เพราะ endpoint ต้อง login → ใช้ราคาสำรองของ PaywallModal และไม่แสดงจำนวนเครดิต) — ข้อความเปรียบเทียบ/FAQ ต้องตรงกติกาใน docs/billing-freemium-pro.md §1
- client: สิทธิ์โหลดซ้ำเมื่อกลับมาออนไลน์/focus (≥30 วินาที)/เปิดหน้าแพ็กเกจ (`entitlementsStatus` loading/ready/error, error → ชิป "ลองใหม่"); ปุ่ม AI ตอนเครดิต 0 ยังกดได้ (เปิดหน้าแพ็กเกจ) และไม่บล็อกเมื่อสิทธิ์ยังไม่ ready; ออฟไลน์ → ปุ่มดาวน์โหลดไฟล์ผลิตปิด; fetch ล้ม → `ApiClientError` `NETWORK_ERROR` (durable save queue ถือเป็น retry); เตือนก่อนลบ/ทำสำเนางานที่ซื้อแล้วผ่าน `src/core/designLicense.ts`
- ตรวจ UI ด้วยตา: `npm run dev:local` แล้วเปิด `/tests/browser/paywall.html` (mount App ด้วย fake CloudProjectBridge สลับ free / ซื้อแล้ว / Pro / Pro หมดเครดิต + ปุ่ม purchases off / offline / plan error ไม่ต้องมี Supabase); เทสต์ที่ต้องมี Docker: pgTAP `0006_billing.test.sql`, `tests/integration/billing.lifecycle.test.ts`, `test:http:local` (AI 401/503/422 + billing smoke), `test:e2e:local` (มีขั้น paywall → จำลองชำระ → ไฟล์ไม่มีลายน้ำ; บน macOS ตั้ง `PACKIT_E2E_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`) — ผ่านครบเมื่อ 14 ต.ค. 2026
- cleanup ของสคริปต์ local/เทสต์ integration ต้องลบตาราง billing ก่อน `projects` (orders/design_licenses อ้าง projects แบบ restrict; subscriptions อ้าง orders) — เพิ่มตารางใหม่ต้องเพิ่มในทุก cleanup block

## Gotchas

- three ต้อง >= 0.185 — r175 มีบั๊ก ExtrudeGeometry ไม่สร้างฝาหน้า-หลังเมื่อ bevelEnabled:false (กล่องกลายเป็น wireframe)
- เปลี่ยนเวอร์ชัน dependency แล้วต้องลบ `node_modules/.vite` แล้วรีสตาร์ท dev server ไม่งั้น pre-bundle เก่าค้าง
- พิกัดแผ่นคลี่: x ขวา y ลง หน่วย mm; แปลงเป็น 3D ที่ (x, -y, 0)
- ฟอนต์ไทย self-host ผ่าน `@fontsource/*` (import ใน main.tsx, ไม่พึ่ง Google CDN); ข้อความเลือกได้หลายฟอนต์ (registry `FONTS` ใน artwork.ts: noto/sarabun/prompt/kanit) + น้ำหนัก 400/700 — เพิ่มฟอนต์ใหม่ต้องทำ 3 จุด: import css ใน main.tsx, เพิ่มใน `FONTS`, และ `ensureThaiFont` โหลดให้; ก่อน rasterize ลง canvas (renderArtworkCanvas/ใบสเปก) ต้อง `await ensureThaiFont()` เพราะ fontsource โหลด subset ต่อน้ำหนักแบบ lazy — ถ้าไม่รอ canvas จะ fallback ทำให้ไทยในไฟล์ export เพี้ยน
- PDF (`dielinePDFBytes`) ใช้ Helvetica (ASCII เท่านั้น): ป้ายบอกขนาดภาษาไทย (ฉลาก/ถุง) ต้องส่ง `dimMasks` = ภาพ 1 บิตจาก
  `renderDimTextMasks` (src/core/pdfDimText.ts, canvas 600 dpi + Noto Sans Thai) → ImageMask + RunLengthDecode ในเลเยอร์ dims
  (ไม่ส่ง = ตัดอักษรนอก ASCII ทิ้ง ไม่ขึ้น ?); ภาพลายใน PDF เป็น JPEG ทึบ → สีพื้นต้อง bake ลง raster ด้วย
  (`renderArtworkCanvas` base.fillColor) ไม่งั้นพื้นขาวของภาพทับเลเยอร์สีพื้นเวกเตอร์จนหาย
- ขนาดตัวอักษรป้ายบอกขนาด = `dimTextSize` (ตามขนาดแผ่น 3.5–6 มม.) ใช้ร่วม blueprint/SVG/PDF — อย่าใส่ fontSize ตายตัว (แผ่นเล็กตัวเลขล้น)
- ตัวเลขบน blueprint คือระยะ score จริง (บวกเผื่อความหนาแล้ว) จึงใหญ่กว่าค่าที่ผู้ใช้ตั้งเล็กน้อย — ตั้งใจ ไม่ใช่บั๊ก
- แผนเฟสเดิม (FEFCO 0427, sleeve, export PDF/DXF, โลโก้/ข้อความ, ขวด revolve + ฉลาก) เสร็จครบแล้ว
- ชนิดงาน (packKind ใน materials.ts) แยก 3 path จากวัสดุ: `box` (foldable) / `vessel` (revolve) /
  `pouch` (form==='pouch') — App เลือก generator + viewer + label UI ตาม kind ไม่ใช่ `mat.foldable` ตรง ๆ
  แล้ว (ถุงกับภาชนะต่างเป็น !foldable ทั้งคู่); เพิ่มชนิดงานใหม่ต้องเพิ่ม kind + แตะจุดที่เช็ค kind ใน App
- วัสดุพับไม่ได้ (pet-bottle/glass/aluminum) → เส้นทางภาชนะใน `src/core/vessel.ts`:
  โปรไฟล์ revolve ต่อชนิดวัสดุ (LatheGeometry ใน VesselViewer3D) + dieline "ฉลาก" พันรอบตัว
  — ฉลากเป็น Dieline ธรรมดา ระบบ artwork/export/guides/ใบสเปกเดิมจึงใช้ได้หมด
  ความหมายขนาด: W = ⌀ตัว, D = ⌀ปาก/คอ, H = สูงรวม (template ถูกละเลย); `isVessel` = !foldable && form≠pouch
  ขวด/โหล/กระป๋อง แยกสูงตัว/คอ: `Project.neckH` (ไม่ใส่ = `defaultNeckH` สัดส่วนเดิมตามวัสดุ, clamp ด้วย `resolveNeckH`)
  ตัว = ก้นถึงปลายไหล่ (H − คอ) สัดส่วนลำตัว/ไหล่/ช่วงฉลากอิงความสูงตัว; UI โชว์ สูงตัว/สูงคอ + สูงรวม — ปรับตัวจะตรึงคอ,
  ปรับคอตัวคงเดิม (H เปลี่ยนตาม); thread แบบ labelStyle + schema cloud; หลอดครีมไม่ใช้
  ไหล่ (รอยต่อตัว→คอ): `Project.shoulderH` (มม. อยู่ในความสูงตัว ไม่เพิ่มสูงรวม; ไม่ใส่ = `defaultShoulderH`, clamp `resolveShoulderH`)
  + `shoulderStyle` round/slope/flat (`shoulderPts`: โค้ง Q / เส้นตรงกรวย / มุมมนรัศมี≈สูงไหล่แล้วบ่าแบน) — สัดส่วนต่อวัสดุใน `SHAPES`;
  ฉลากมาตรฐานขอบบนอยู่ใต้ไหล่เสมอ; `generateVessel(box, mat, labelStyle, { neckH, shoulderH, shoulderStyle, label })`
  ฉลากกำหนดเอง `Project.labelBox` {y ขอบล่างจากก้น, h สูง, w ยาวรอบตัว} (เก็บเฉพาะคีย์ที่ตั้ง; เลือกรูปแบบฉลาก = ล้าง y/h):
  clamp บนลำตัวตรง (`Vessel.labelRange`); w ≥ เส้นรอบวง = พันรอบ+ทับกาว, น้อยกว่า = ฉลากแผ่นหน้าแผงเดียวไม่มีกาว →
  `Vessel.labelArc` (มุมหุ้ม) ให้ viewer สร้าง Cylinder ส่วนโค้งกึ่งกลางด้านหน้า; `labelBox.rot` องศา (0 หน้า, 180 หลัง → `Vessel.labelRot`
  หมุน mesh ฉลาก); หลอดครีมไม่ใช้. ช่วงลำตัวตรงมาจาก `profileFor().straight` (ไม่ใช้เกณฑ์รัศมี — ขอบปากอาจกว้างเกือบเท่าตัว)
  ปากขวดทุกชนิด (PET/แก้ว/อะลูมิเนียม) มีขอบปากวงแหวน (`SHAPES.ring`, สูง `mouthLip`) → `Vessel.mouth`; ฝาขวดเลือกได้
  `Project.capStyle` none/screw/flip/pump/cork/foil/crown (crown = ฝาจีบโลหะสูง ≤9 มม. จีบ 21; เลือกแล้วปากเป็น crown finish วงแหวนเตี้ย 2.5–5 มม. ผ่าน `VesselShape.capStyle` → `mouthLip` ฝาจึงครอบลงใต้วงแหวน; foil = แคปซูลฟอยล์หุ้มหัวจุก+คอ ไม่เลยโคนคอ + ก้านจุก `inner`; จุกก๊อกเสียบในคอ ลึกไม่เลย `mouth.neckY`, สีเริ่ม `defaultCapColor`) + `capColor` — `capShape(style, mouth)` (pure) คืน lathe + ชิ้นกล่องเล็ก, ภาพ 3D เท่านั้น
  (ไม่อยู่ใน dieline), ครอบลงต่ำกว่าวงแหวน; PROJECT_FILE_VERSION 14
- หลอดครีม (tube-laminate, path ภาชนะ): W = ⌀ท่อ — ลำตัวสร้างจาก `tubeSection` (pure, vessel.ts) หน้าตัดวงรีเส้นรอบวงคงที่ πW
  (กลมที่ไหล่ → แบนกว้าง πW/2 ที่ซีล, ด้านข้างหัวกระสุน 1−v^`TUBE_BULLET`) ใช้ร่วม 3D + ความจุ (`tubeVolumeMl`); ตั้งบนฝา flip-top
  กว้างเกือบเท่าท่อ (`tubeCapR`), ซีลบน `TUBE_SEAL` มีลอนกด; พิมพ์รอบตัวทั้งท่อ (ค่ามาตรฐาน = ไหล่ถึงใต้ซีล) UV ตามความยาวผิว เริ่มกลางหลัง
  ฝาหลอด (กลุ่ม "ฝาหลอด", ใช้ `Project.capStyle`): ไม่ใช่ 'oval' = ฝาฟลิปท็อปกลม (เดิม); 'oval' = ฝาเหลี่ยม — ฝาเกลียวหน้าตัดสเตเดียม
  สูง `TUBE_OVAL_CAP_FRAC`·H (`ovalFlipCapGeometry` ใน components/tubeCapGeometry.ts: ฝาพับช่วงล่าง `TUBE_LID_FRAC` ขอบมน = รอยต่อ + ร่องงัดรูปซุ้มลึกจริงบนหน้าแบนด้านหน้า) + ลำตัวโคนวงรีแบน `tubeOvalSection` (ลึก = `TUBE_OVAL_ASPECT`×กว้าง ที่เส้นรอบวง 2πR
  → `TubeShape.oval` ให้ `tubeSection` ไล่จากหน้าตัดฝา → วงรีโคน → ซีลแบน); `capColor` ใช้กับฝาหลอดด้วย; ขวดที่ได้ 'oval' ไม่มีฝา; PROJECT_FILE_VERSION 16
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
  ยกเว้น 3D ของ gusset (แบบถุงกาแฟซิปล็อก) ใช้ `brickShape`/`brickRows`/`brickAt` (pure): หน้า-หลังกว้างเต็มถึงขอบบน (ไม่มีไหล่หลังคา)
  ก้นแบน จีบข้างเปิดเต็มที่ก้นแล้วเรียวปิดขึ้นหาปาก — ด้านข้างทรงหัวกระสุน b = 1−u^`BRICK_BULLET` (ความลึกครึ่งจีบคงที่ → รอยจีบพับเข้าเอง),
  ความสูงผนังหาโดย bisection ให้ความยาวโค้งผิวหน้า = ฟิล์ม (`samples` สะสมความยาว ใช้ทั้งแถว/`brickAt`) → ผนัง+ช่วงแบน+ก้นพับ (`baseL`) = H,
  ซีลบน = แถบซีลบน มุมมน `BRICK_CORNER_R` (แถวบนสุดหดครึ่งกว้างตาม `BrickRow.cut`); สันข้างใน viewer ใช้จุดซ้ำ (normal ไม่เฉลี่ยข้ามสันพับ)
  และจีบที่พับแบนในซีลถูกบีบเข้าแกนกลาง (`boxSectionPt` b<1.5) กัน z-fighting เป็นรอยดำที่ขอบ
  — ก้นแบนแม็พฟิล์มปลายแผงช่วง baseL อยู่กลุ่มลาย (เดิมเป็นสีพื้น → เห็นแถบขาวใต้ถุง)
  มีซิป → `BrickShape.flatL` = ช่วงคอแบนใต้ซีลบนลงถึงใต้แถบซิป (ซิปหนีบหน้า-หลังติดกัน) ผนังเรียวจบใต้ช่วงนี้; ซีลก้นยาวเกินฐาน
  (จีบแคบ) พับขึ้นแนบผนังหลังด้านนอก
  — `src/components/pouchGeometry.test.ts` ตรวจทุกจุดของ mesh ไม่พ้นทรงถุง
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
  เพิ่มฟิลด์ที่เก็บจึงขึ้น PROJECT_FILE_VERSION (ปัจจุบัน 19); ตั้งผ่าน UI หน้าออกแบบ ไม่ผ่าน AI
- รอยพับ 180° ได้สันโค้งจาก `rollBeads` ใน fold.ts (ทรงกระบอกบาง รัศมี = ครึ่งระยะสองชั้น) — ตอนนี้ไม่มี template ใช้แล้ว
- FEFCO 0427 ตามผัง dieline มาตรฐาน: ผนังข้างทบเป็นรอยพับคู่ (ผนัง → สัน กว้าง sp = 3t+0.2 = ผนัง+หู+ชั้นทบ → ชั้นทบ)
  ลิ้นปลายชั้นทบลงช่องบนฐานที่ sp − t/2; ฝาแคบกว่ากล่องข้างละ sp มีปีกข้างคางหมูพับลงด้านในชั้นทบ (stage 4 ก่อนฝาปิด 5),
  ลิ้นหน้ามุมโค้งใหญ่, หูมุมสี่เหลี่ยม, ผนังหน้าเตี้ยกว่า t. `fefco0427Layout` = ผังพับ (เทสต์เรขาคณิตใช้ผังนี้) แล้ว
  `rotateDieline90` ให้ฝาเปิดไปทางขวาแบบมาตรฐาน — template ตั้ง `spin` (−π/2) ให้ Viewer3D หมุนแผ่นกลับ (Euler z ก่อน tilt)
  ผนังหน้าจึงหันหากล้องเหมือนเดิม; เทสต์ท้าย fefco0427.test จำลอง transform ของ viewer ยืนยันว่าตำแหน่งทุกแผงตรงกัน
  โครงเดียวกันใช้ซ้ำ: `rollEndLayout(box, mat, { lid, flap })` — tray = lid:false, rollover mailer = lid:true + flap:'long'
  + front:'wide' (ปีกข้างฝายาวเกือบเต็มฝา มุมฝั่งลิ้นหน้ามน ฝั่งบานพับเฉียง, ผังไม่หมุน ฝาอยู่บน; ลิ้นหน้ากว้างเต็มแผ่น
  = ลิ้นเสียบ (tuck) ด้านในผนังหน้า + หูสองปลายเก็บด้านในปีกข้างฝา → ปิดแล้วเรียบไม่เห็นหู — ลำดับ ทบ 3 → จังหวะสุดท้าย 4:
  ฝา (`Panel.within` LID_LAG เริ่มช้ากว่าเล็กน้อย) + ปีกข้างฝาและหูลิ้นพับทบ 180° แนบในลิ้นพร้อมกัน (within EARLY) → หูกางกลับ 90°
  เข้าในผนังข้าง 5 (`Panel.refold`; ชุดจังหวะ WINDOWS_6) — ปีกต้องพับเกือบเสร็จก่อนฝาหมุนจริง ไม่งั้นมุมปีกฝั่งบานพับลงต่ำกว่าขอบผนังข้าง
  ขณะยังกางนอกกล่อง (foldOrder จับ); หูตั้งฉากระหว่างลิ้นไถลจะโผล่ทะลุฝา จึงทบแนบลิ้นไว้ก่อน (tuckAngle ใช้ within ของฝาด้วย))
  ชั้นทบทุกแบบ roll end สั้นกว่าผนังเท่าความยาวลิ้นล็อก (`rollW = Hp − tabL`) ปลายลิ้นจึงเสมอผิวล่างฐาน ไม่โผล่ใต้กล่อง
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
- หน้าต่างเวลาการพับใน `fold.ts` เลือกชุดตามจำนวน stage ที่ template ใช้ (`WINDOWS_4`/`WINDOWS_5`/`WINDOWS_6`/`WINDOWS_7`)
  (ตอนนี้ยังไม่มี template ใช้ WINDOWS_7) + `Panel.within` = พับในช่วงย่อยของหน้าต่าง stage ตัวเอง (จังหวะพร้อมกันแต่เหลื่อมกันได้)
  — เพิ่ม template ที่ต้องการจังหวะมากกว่า 7 ให้เพิ่มชุดใหม่ อย่าแก้ชุดเดิม เพราะจะไปเปลี่ยน
  จังหวะพับของ template ที่จูนไว้แล้ว
