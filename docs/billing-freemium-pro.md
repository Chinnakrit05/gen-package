# แพ็กเกจ Freemium / Pro — สเปกการทำงาน

วันที่ตกลง: 13 ตุลาคม 2026
สถานะ: **ตกลงกติกาผลิตภัณฑ์แล้ว กำลังพัฒนาบน branch `claude/freemium-pro-packages-6050c9`** — ยังไม่เลือกผู้ให้บริการชำระเงิน จึงยังไม่เปิดรับเงินจริง
เอกสารต้นทาง: [backend-implementation-spec.md](backend-implementation-spec.md) §10–§12 (โควตา AI, billing, export) — สเปกนี้ทำให้เป็นรูปธรรมตามกติกาที่เจ้าของผลิตภัณฑ์ตัดสินใจ และ **แทนที่** ตัวเลขเดิมในเอกสารนั้น (390 → 399, AI ฟรี 5 ครั้ง → 0)

## 1. กติกาผลิตภัณฑ์ (ตัดสินใจแล้ว)

| เรื่อง | Freemium | ซื้อรายแบบ 149 บาท | Pro 399 บาท/เดือน |
| --- | --- | --- | --- |
| ออกแบบ (เลือกแบบ/ขนาด/วัสดุ/ลาย), ดู blueprint และ 3D | ได้ | ได้ | ได้ |
| AI สร้าง/ปรับสเปก (`สั่ง AI`, `ปรับเร็ว`) | ไม่ได้ (เครดิต 0) | ได้ตามเครดิตที่แถม | ได้ตามเครดิตรายเดือน |
| ดาวน์โหลดไฟล์ผลิต SVG / DXF / PDF 1:1 / **ใบสเปกขอราคา** | ไม่ได้ — กดแล้วแจ้ง 149 บาท | ได้เฉพาะ "แบบ" ที่จ่ายแล้ว | ได้ทุกแบบ |
| ลายน้ำบนพรีวิว (blueprint, 3D, แผ่นสติกเกอร์) | มีตลอด | หายเฉพาะแบบที่จ่ายแล้ว | ไม่มี |
| ไฟล์สำรอง `.genpkg.json` (ส่งออก/นำเข้า) | ได้ (ฟรี) | ได้ | ได้ |
| หลัง Pro หมดอายุ | — | — | แบบที่เคยได้รับอนุญาตดาวน์โหลดตอนเป็น Pro ยังดาวน์โหลดได้และไม่มีลายน้ำ; แบบใหม่กลับเป็นกติกา Freemium |

นิยามเพิ่มเติม:

- **"1 แบบ" = 1 โปรเจกต์ใน cloud (project id)** จ่ายแล้วแก้ต่อ/ดาวน์โหลดซ้ำได้ตลอด สำเนาที่ได้ id ใหม่ (เก็บเป็นสำเนา, นำเข้า `.genpkg.json`, ย้ายงานเดิม) **ไม่** ได้สิทธิ์ตามไปด้วย
- **เครดิต AI**: 1 เครดิต = 1 คำขอ AI (ทั้ง `สร้างกล่อง` และ `ปรับเร็ว`, แนบรูปไม่คิดเพิ่ม) หักตอนจองก่อนเรียก provider; provider ล้มเหลว (429/5xx/timeout) คืนเครดิต; ผลลัพธ์กลับมาแล้วไม่คืน
- **จำนวนเครดิต** เป็นค่า placeholder ใน `app_private.plan_catalog` (ซื้อรายแบบ 10, Pro 100/รอบ 30 วัน) — เจ้าของผลิตภัณฑ์จะปรับทีหลัง แก้ที่ตารางเดียวโดยไม่ต้องแก้โค้ด; Pro ต่ออายุ = เพิ่มรอบใหม่ต่อจากวันหมดเดิมและเติมเครดิตอีกรอบ; เครดิตไม่หมดอายุตาม Pro
- **โหมด local-demo** (`npm run dev:local`, ไม่มีบัญชี) = โหมดนักพัฒนา ไม่มี paywall/ลายน้ำ และยังใช้ BYOK กับ legacy `/api/box-spec` ได้เหมือนเดิม
- **AI บน cloud ใช้คีย์ของระบบ** (`ANTHROPIC_API_KEY` ฝั่ง server) ไม่รับคีย์จากผู้ใช้อีกต่อไป (BYOK header `x-packit-anthropic-api-key` ถูกถอดออก); ไม่มีคีย์ → AI route ตอบ 503 `CONFIGURATION_ERROR`
- **ข้อจำกัดที่ยอมรับ**: ไฟล์ส่งออกยังสร้างในเบราว์เซอร์ จึงกันคนเปิด devtools ไม่ได้ (ตาม backend-plan §ข้อจำกัด) — การ gate เป็นระดับ UX + server ตัดสินสิทธิ์ก่อนทุกครั้ง; ลายน้ำอยู่บนพรีวิวเท่านั้น (ผู้ใช้ฟรีไม่ได้ไฟล์ใด ๆ)

## 2. โมเดลข้อมูล (migration `supabase/migrations/20261013000600_billing.sql`)

ทุกตารางอยู่ใน `app_private`, เปิด RLS, revoke จาก `public/anon/authenticated`, grant เฉพาะ `service_role` ตามแบบ migration เดิม; RPC ใน `public.*` เป็น `security invoker`, `set search_path = ''`, grant execute เฉพาะ `service_role`; raise ด้วย `errcode 'P0001'` และ message เป็นรหัสคงที่ (server map เป็น HTTP)

| ตาราง | คอลัมน์ / invariant |
| --- | --- |
| `plan_catalog` | `code` pk (`design`,`pro`), `amount_minor` int > 0, `currency` = 'THB', `credits` int ≥ 0, `period_days` int null (null สำหรับ design), `updated_at` — insert ในการ migrate: `('design', 14900, 'THB', 10, null)`, `('pro', 39900, 'THB', 100, 30)` |
| `subscriptions` | `id` pk, `workspace_id` → workspaces restrict, `plan_code` = 'pro', `status` in (`active`,`canceled`), `period_start`, `period_end` (> start), `order_id` → orders null, timestamps; index (`workspace_id`, `period_end` desc). Pro "กำลังใช้งาน" = มีแถว `active` ที่ `period_end > now()` (คำนวณตอนอ่าน ไม่มี cron) |
| `credit_balances` | `workspace_id` pk → workspaces, `balance` int ≥ 0, `updated_at` — ตัวนับที่ lock `for update` |
| `credit_ledger` | `id` pk, `workspace_id`, `delta` int ≠ 0, `reason` in (`design_purchase`,`pro_period`,`ai_request`,`ai_refund`,`admin`), `ref_id` uuid null, `created_at`; index (`workspace_id`, `created_at` desc) — audit อย่างเดียว |
| `ai_requests` | `id` pk, `workspace_id`, `actor_user_id`, `operation_id` uuid, `state` in (`reserved`,`succeeded`,`failed`), `reserved_units` int = 1, `created_at`, `settled_at` (null ↔ reserved); unique (`workspace_id`,`actor_user_id`,`operation_id`) |
| `orders` | `id` pk, `workspace_id`, `purchaser_user_id`, `operation_id` uuid, `kind` in (`design`,`pro`), `project_id` uuid null, `amount_minor`, `currency`, `credits` (snapshot จาก catalog ตอนสั่ง), `status` in (`pending`,`paid`,`canceled`), `provider` text (`none` = ยังไม่เลือก, `dev`, `manual`, ชื่อ provider ในอนาคต), `provider_ref` text null, `created_at`, `paid_at`; unique (`workspace_id`,`purchaser_user_id`,`operation_id`); check `(kind = 'design') = (project_id is not null)`; FK (`project_id`,`workspace_id`) → projects(id, workspace_id) restrict |
| `design_licenses` | `project_id` pk, `workspace_id`, `source` in (`purchase`,`pro`,`admin`), `order_id` null → orders, `granted_by` → app_users, `granted_at`; FK (`project_id`,`workspace_id`) → projects restrict — ไม่ลบตาม project (soft delete อยู่แล้ว) |

RPC (`public.*`, พารามิเตอร์ตัวแรกเป็น `p_actor_user_id` เสมอ ยกเว้น `fulfil_order` ที่รับ null ได้สำหรับ webhook ในอนาคต):

| RPC | พฤติกรรม |
| --- | --- |
| `get_entitlements(p_actor_user_id, p_workspace_id) → jsonb` | `assert_workspace_access(read)` แล้วคืน `{workspaceId, plan: 'free'\|'pro', proUntil, credits, licensedProjectIds: uuid[] (เฉพาะ project ที่ยังไม่ถูกลบ), catalog: {design:{kind,amountMinor,currency,credits,periodDays}, pro:{…}}}` |
| `authorize_export(p_actor_user_id, p_project_id) → jsonb` | หา project (ไม่ถูกลบ) → `assert_workspace_access(read)` → มี license อยู่แล้ว → คืน `{projectId, source, entitlements}`; ไม่มีแต่ Pro กำลังใช้งาน → insert license `source='pro'` (granted_by = actor) แล้วคืน; ไม่งั้น raise `EXPORT_PAYMENT_REQUIRED` |
| `reserve_ai_credit(p_actor_user_id, p_workspace_id, p_operation_id) → jsonb` | `assert_workspace_access(write)` → advisory lock ต่อ workspace → upsert `credit_balances` → คืนเครดิตคำขอของ workspace ที่ค้าง `reserved` เกิน 15 นาที (ตั้ง `failed` + ledger `ai_refund`; ไม่มี cron) → ถ้ามี request เดิมด้วย operation_id: `reserved` → raise `AI_REQUEST_IN_PROGRESS`, อื่น ๆ → raise `IDEMPOTENCY_KEY_REUSED` → lock `credit_balances` `for update` → `balance < 1` → raise `AI_CREDITS_EXHAUSTED` → หัก 1, ledger `ai_request` (ref = request id), insert `ai_requests` reserved → คืน `{requestId, credits}` |
| `settle_ai_request(p_actor_user_id, p_request_id, p_outcome 'succeeded'\|'failed') → jsonb` | lock request; ต้องเป็นของ actor และ state `reserved` (ไม่งั้น raise `AI_REQUEST_NOT_RESERVED`); `failed` → คืน 1 เครดิต + ledger `ai_refund`; ตั้ง state/settled_at → คืน `{credits}` |
| `create_order(p_actor_user_id, p_workspace_id, p_operation_id, p_kind, p_project_id) → jsonb` | `assert_workspace_access(write)` → ซ้ำ operation_id เดิม: kind/project ตรง → คืน order เดิม ไม่ตรง → `IDEMPOTENCY_KEY_REUSED` → `design`: project ต้องอยู่ใน workspace และไม่ถูกลบ (`PROJECT_NOT_FOUND`), มี license แล้ว → `ALREADY_LICENSED` → อ่านราคา/เครดิตจาก catalog → insert `pending`, provider `none` → คืน order json |
| `fulfil_order(p_actor_user_id uuid null, p_order_id, p_provider, p_provider_ref) → jsonb` | lock order (`ORDER_NOT_FOUND`); ถ้า actor ไม่ null ต้องเป็น purchaser (ไม่งั้น `ORDER_NOT_FOUND`); `paid` แล้ว → คืนเดิม (idempotent); `canceled` → `ORDER_NOT_PAYABLE`; ตั้ง paid/provider/provider_ref/paid_at; `design` → insert license `purchase` (on conflict do nothing); `pro` → insert subscription รอบใหม่ `period_start = greatest(now(), pro_until ปัจจุบัน)`, `period_end = start + period_days`; เติมเครดิต `orders.credits` + ledger (`design_purchase`/`pro_period`, ref = order id) → คืน order json |

order json: `{id, workspaceId, kind, projectId, amountMinor, currency, credits, status, provider, providerRef, createdAt, paidAt}`

## 3. HTTP API (`server/http/router.ts`, bearer ทุกเส้น)

| เส้นทาง | ผล |
| --- | --- |
| `GET /api/v1/billing/entitlements?workspaceId=` | 200 `Entitlements` (`devFulfilAvailable` = `appEnv ∈ {development,test}`) |
| `POST /api/v1/projects/:id/export-authorizations` (body `{}` หรือไม่มี) | 200 `ExportAuthorization`; 402 `PAYMENT_REQUIRED` พร้อม `details: { projectId, price: CatalogItem }`; 404 `NOT_FOUND` |
| `POST /api/v1/billing/orders` body `CreateOrderInput` | 201 `Order` (`checkoutUrl: null` จนกว่าจะมี provider); 409 `ALREADY_LICENSED` / `IDEMPOTENCY_KEY_REUSED`; 404 `NOT_FOUND` |
| `POST /api/v1/billing/orders/:id/dev-fulfil` | เฉพาะ `appEnv ∈ {development,test}`; อื่น ๆ 404 `NOT_FOUND` เหมือนไม่มีเส้นทางนี้ → 200 `Order` (paid) หลัง `fulfil_order(actor, id, 'dev', requestId)`; 409 `ORDER_NOT_PAYABLE` |
| `POST /api/v1/ai/box-spec` body `{ workspaceId, operationId, prompt, current?, image? }` | ไม่มี `config.ai` → 503 `CONFIGURATION_ERROR`; ลำดับ: authenticate → validate body → `reserve_ai_credit` → เรียก provider ด้วยคีย์ server → `settle succeeded` → 200 `{ …BoxSpecResult, credits }`; ผล provider กลับมาแล้วแต่ `settle succeeded` ล้ม → ยังตอบ 200 พร้อมยอดจากตอนจอง (ไม่คืนเครดิต ไม่ทิ้งผล); provider ล้ม (timeout 50 วินาที ไม่ retry — สั้นกว่า `maxDuration` 60 ของ `api/backend.js` ใน vercel.json) → `settle failed` (best-effort, log เมื่อล้ม) แล้ว 429 `AI_RATE_LIMITED` / 502 `AI_PROVIDER_UNAVAILABLE` / คีย์ server ผิด → 503 `CONFIGURATION_ERROR`; เครดิตหมด → 402 `AI_CREDITS_EXHAUSTED` พร้อม `details: { credits: 0, plan }`; ซ้ำ operation → 409 |

Error code ใหม่ใน `shared/contracts/errors.ts`: `PAYMENT_REQUIRED`, `AI_CREDITS_EXHAUSTED`, `AI_REQUEST_IN_PROGRESS`, `ALREADY_LICENSED`, `ORDER_NOT_FOUND`, `ORDER_NOT_PAYABLE`; ถอด `AI_API_KEY_REQUIRED`/`AI_API_KEY_INVALID` ออกจาก union (`server/modules/ai/requestApiKey.ts` ยังอยู่เพราะ legacy `/api/box-spec` ของ local-demo ใช้อ่าน BYOK header และไม่ได้ใช้ union นี้)

`ServerConfig.ai: null | { anthropicApiKey, model }` อ่านจาก `ANTHROPIC_API_KEY` + `BOX_SPEC_MODEL` (default `claude-opus-4-8`); `createApiRouter` รับ `billingService` เพิ่มแบบ DI เหมือน service อื่น (`server/modules/billing/billingService.ts` + adapter `server/adapters/supabase/billingRepository.ts`)

## 4. ฝั่ง client (cloud mode เท่านั้น)

- `src/services/api/billing.ts`: `getEntitlements`, `authorizeExport`, `createOrder`, `devFulfilOrder`; `src/services/api/ai.ts` ส่ง `{workspaceId, operationId, prompt, current, image}` ไม่มี header คีย์ และคืน `AiBoxSpec & { credits }`
- `CloudWorkspace` โหลด entitlements ก่อนตั้ง workspace `ready` (ล้มเหลว → `null` = ปฏิบัติเหมือน Freemium แต่เปิดงานได้) และเพิ่มใน `CloudProjectBridge`: `entitlements`, `refreshEntitlements()`, `authorizeExport(projectId)`, `createOrder(kind, projectId?)`, `devFulfilOrder(orderId)`; `requestAiSpec(prompt, current?, imageBase64?)` อัปเดต `entitlements.credits` จาก response
- `App`:
  - `entitlements = cloud?.entitlements ?? null` → `gatePlan` (`'free'` เมื่อ null) / `gateCredits` / `licensed` (Set ของ `licensedProjectIds`) / `watermarkOn = cloud !== undefined && gatePlan !== 'pro' && !licensed.has(activeId)` — ไม่มี `cloud` (local) = ไม่มี paywall/ลายน้ำ
  - ปุ่มดาวน์โหลด 4 ปุ่มผ่าน `gatedDownload`: local → ทำทันที; cloud → `authorizeExport` ก่อนเสมอ (server ตัดสิน) → อนุญาตแล้วค่อยสร้างไฟล์; `PAYMENT_REQUIRED` → เปิด `PaywallModal` แบบ `design`; ปุ่มมีป้าย `149 ฿` เมื่อยังไม่มีสิทธิ์; `.genpkg.json` ไม่ gate
  - `PaywallModal` (`src/components/PaywallModal.tsx`): สองโหมด `design` (149 → ดาวน์โหลดแบบนี้ + แถม N เครดิต) และ `pro` (399/เดือน → ทุกแบบ + N เครดิต/เดือน) อ่านราคา/เครดิตจาก `entitlements.catalog`; ปุ่มชำระ → `createOrder` → แสดง "ระบบชำระเงินยังไม่เปิดให้บริการ" (provider ยังไม่เลือก) และถ้า `devFulfilAvailable` มีปุ่ม "จำลองการชำระ (dev)" → `devFulfilOrder` → `refreshEntitlements` → ทำ action ที่ค้าง (ดาวน์โหลด) ต่อ
  - แถบ header: ชิปแพ็กเกจ (`Freemium` / `Pro ถึง d/m/y`) + `เครดิต AI: n` + ปุ่ม `อัปเกรด Pro` (เปิด modal `pro`)
  - `PromptBar`: ถอด prop `apiKeyRequired`; เพิ่ม `allowApiKey` (true เฉพาะ local = โชว์ช่องคีย์เดิม), `credits?: number | null` (โชว์ในหัวแถบ), `onError?(code)`; cloud ที่ `credits === 0` → `disabledReason` = ข้อความให้ซื้อแบบ/Pro และ App เปิด `PaywallModal` เมื่อได้ `AI_CREDITS_EXHAUSTED`
  - `ProjectGallery` รับ `licensedIds?: ReadonlySet<string>` → ป้าย "ซื้อแล้ว" บนการ์ด
  - ข้อความใหม่ใน App ผ่าน `t(th, en)`
- **ลายน้ำ** (`src/core/watermark.ts` pure + test): `watermarkTiles(w, h)` คืนตำแหน่ง/มุม/ขนาดตัวอักษรของข้อความซ้ำเฉียง −30° ให้เห็น ~3–5 แถวบนแผ่น (ขนาดตัวอักษร ≈ clamp(min(w,h)/10, 6, 40) มม., ระยะแถว ≈ 2.2×ขนาด) ใช้ร่วม 3 พื้นผิว: (a) `DielineSVG` prop `watermark?: string` → `<g className="watermark" pointerEvents="none">` วาดหลังสุดใน rotor (ไม่ไปถึงไฟล์ส่งออกเพราะไฟล์ใช้ `dielineSVGString` คนละทาง), (b) `useArtTexture` option `watermark?: string | null` → `drawWatermark(ctx, sheetW, sheetH, s, text)` หลัง `draw` ทุก viewer (Viewer3D/PouchViewer3D/VesselViewer3D ส่งผ่าน prop; Viewer3D ต้อง `enabled` เมื่อมีลายน้ำแม้กล่องเปล่า), (c) `StickerSheetPreview` overlay ด้วย helper เดียวกัน; ข้อความ `PackIt · ตัวอย่าง` / `PackIt · PREVIEW`; opacity 0.18, ตัวอักษรเข้ม stroke ขาวบาง ๆ; **ห้าม** ทำเป็น Deco (Deco ไหลเข้า snap/DPI/contour/ไฟล์)
- fixture ตรวจด้วยตา `tests/browser/paywall.html` + `.tsx` (แบบเดียวกับ `loading-continuity`): mount `App` ด้วย fake `CloudProjectBridge` สลับสถานะ free / licensed / pro / pro-หมดเครดิต โดยไม่ต้องมี Supabase

## 5. เทสต์และสคริปต์ที่ต้องตามแก้

- `server/http/router.test.ts`: AI route ใหม่ (ไม่มี BYOK, 503 ไม่มีคีย์, 402 เครดิตหมด, settle failed เมื่อ provider ล้ม, response มี `credits`), billing routes กับ fake `BillingService`, dev-fulfil 404 บน staging/production
- pgTAP `supabase/tests/database/0006_billing.test.sql` (ตาราง/RLS/grant/catalog, order idempotent, fulfil ให้ license+เครดิต ครั้งเดียวแม้เรียกซ้ำ, authorize_export ปฏิเสธ→อนุญาต, Pro สร้าง license `pro`, reserve หัก/exhausted/refund)
- `tests/integration/billing.lifecycle.test.ts` (ต้องมี Supabase local — รอบนี้รันไม่ได้)
- รายการลบตารางใน `scripts/e2e-local-cloud.mjs`, `scripts/verify-local-http.mjs`, `scripts/cleanup-local-test-fixtures.mjs`, `scripts/report-local-cleanup.mjs`, `tests/integration/*.test.ts` ต้องเพิ่ม `design_licenses`, `orders`, `subscriptions`, `ai_requests`, `credit_ledger`, `credit_balances` (ลบก่อน `projects`/`workspace_members`); `verify-local-http.mjs` เปลี่ยนความคาดหวัง AI route (ไม่มี bearer → 401; มี bearer แต่ server ไม่มีคีย์ → 503)
- `npm run build:api` หลังแก้ server แล้ว commit `api/backend.js`
- env: `.env.example`/`.env.cloud.example`/README อธิบาย `ANTHROPIC_API_KEY` สำหรับ AI บน cloud
