# แพ็กเกจ Freemium / Pro — สเปกการทำงาน

วันที่ตกลง: 13 ตุลาคม 2026
สถานะ: **merge เข้า main แล้ว (14 ต.ค. 2026)** — ยังไม่เลือกผู้ให้บริการชำระเงิน จึงยังไม่เปิดรับเงินจริง; เจ้าของผลิตภัณฑ์ตัดสินใจ (13 ต.ค. 2026) ให้ **ซ่อนการซื้อทั้งหมดจนกว่าจะมีผู้ให้บริการ** (ไม่ขายแบบโอนแล้วเปิดสิทธิ์ด้วยมือ) และ (15 ต.ค. 2026) ให้ **ทุกบัญชีบน production ใช้งานได้เหมือน Pro ไปก่อน ไม่ติดลายน้ำใด ๆ** (open access — ดู §1)
เอกสารต้นทาง: [backend-implementation-spec.md](backend-implementation-spec.md) §10–§12 (โควตา AI, billing, export) — สเปกนี้ทำให้เป็นรูปธรรมตามกติกาที่เจ้าของผลิตภัณฑ์ตัดสินใจ และ **แทนที่** ตัวเลขเดิมในเอกสารนั้น (390 → 399, AI ฟรี 5 ครั้ง → 0)

## 1. กติกาผลิตภัณฑ์ (ตัดสินใจแล้ว)

| เรื่อง | Freemium | ซื้อรายแบบ 149 บาท | Pro 399 บาท/เดือน |
| --- | --- | --- | --- |
| ออกแบบ (เลือกแบบ/ขนาด/วัสดุ/ลาย), ดู blueprint และ 3D | ได้ | ได้ | ได้ |
| AI สร้าง/ปรับสเปก (`สั่ง AI`, `ปรับเร็ว`) | ไม่ได้ (เครดิต 0) | ได้ตามเครดิตที่แถม | ได้ตามเครดิตรายเดือน |
| ดาวน์โหลดไฟล์ผลิต DXF / PDF 1:1 / **ใบสเปกขอราคา** | ไม่ได้ — กดแล้วแจ้ง 149 บาท | ได้เฉพาะ "แบบ" ที่จ่ายแล้ว | ได้ทุกแบบ |
| ไฟล์เวกเตอร์แก้ต่อได้ **SVG / AI** (Illustrator, ตัดสินใจ 16 ต.ค. 2026) | ไม่ได้ | ไม่ได้ — ต้องเป็น Pro (กดแล้วเปิดหน้าสมัคร Pro) | ได้ทุกแบบ ขณะ Pro ยังใช้งาน |
| ลายน้ำบนพรีวิว (blueprint, 3D, แผ่นสติกเกอร์) | มีตลอด | หายเฉพาะแบบที่จ่ายแล้ว | ไม่มี |
| ไฟล์สำรอง `.genpkg.json` (ส่งออก/นำเข้า) | ได้ (ฟรี) | ได้ | ได้ |
| หลัง Pro หมดอายุ | — | — | แบบที่เคยได้รับอนุญาตดาวน์โหลดตอนเป็น Pro ยังดาวน์โหลดได้และไม่มีลายน้ำ; แบบใหม่กลับเป็นกติกา Freemium |

นิยามเพิ่มเติม:

- **"1 แบบ" = 1 โปรเจกต์ใน cloud (project id)** จ่ายแล้วแก้ต่อ/ดาวน์โหลดซ้ำได้ตลอด สำเนาที่ได้ id ใหม่ (เก็บเป็นสำเนา, นำเข้า `.genpkg.json`, ย้ายงานเดิม) **ไม่** ได้สิทธิ์ตามไปด้วย
- **เครดิต AI**: 1 เครดิต = 1 คำขอ AI (ทั้ง `สร้างกล่อง` และ `ปรับเร็ว`, แนบรูปไม่คิดเพิ่ม) หักตอนจองก่อนเรียก provider; provider ล้มเหลว (429/5xx/timeout) คืนเครดิต; ผลลัพธ์กลับมาแล้วไม่คืน — ข้อยกเว้นเดียว: ถ้าผลกลับมาแต่บันทึก settle ไม่สำเร็จ คำขอค้าง `reserved` แล้วถูกคืนเครดิตเองเมื่อเกิน 15 นาที (คำขอนั้นกลายเป็นฟรี) ซึ่งยอมรับได้เพราะเกิดได้ยากและไม่เป็นโทษกับผู้ใช้
- **ยังไม่เปิดขาย**: `Entitlements.purchasesEnabled` = false บน staging/production (ตอนนี้ true เฉพาะ `APP_ENV` development/test ที่จำลองการชำระได้) → client ซ่อนปุ่มซื้อ/ต่ออายุทุกจุดและแสดง "ยังไม่เปิดขาย" ส่วน server ปฏิเสธ `POST /billing/orders` ด้วย 503 `PURCHASE_UNAVAILABLE`; เมื่อมีผู้ให้บริการ ให้เปลี่ยนเงื่อนไขเป็น "ตั้งค่า provider แล้ว" ที่ `isPurchaseEnabled` ใน `server/http/router.ts`
- **จำนวนเครดิต** เป็นค่า placeholder ใน `app_private.plan_catalog` (ซื้อรายแบบ 10, Pro 100/รอบ 30 วัน) — เจ้าของผลิตภัณฑ์จะปรับทีหลัง แก้ที่ตารางเดียวโดยไม่ต้องแก้โค้ด; Pro ต่ออายุ = เพิ่มรอบใหม่ต่อจากวันหมดเดิมและเติมเครดิตอีกรอบ; เครดิตไม่หมดอายุตาม Pro
- **ช่วงเปิดใช้ฟรี (open access, ตัดสินใจ 15 ต.ค. 2026)**: ระหว่างยังไม่เปิดขาย (`isOpenAccess` = `!isPurchaseEnabled` ใน `server/http/router.ts` → staging/production เปิด, development/test ปิดให้เทสต์ paywall ยังตรวจกติกาปกติ) ทุก workspace ได้ **รอบ Pro ฟรี** อัตโนมัติ: แถว `subscriptions` ที่ `order_id` เป็น null ยาว `period_days` ของ catalog `pro` เริ่มเมื่อโหลดสิทธิ์/ขอดาวน์โหลด/จองเครดิต AI ครั้งแรกที่ไม่มี Pro ที่ใช้งานอยู่ และต่อรอบใหม่เองเมื่อหมด; ต้นรอบเติมเครดิตให้ **ถึง** โควตาของ catalog `pro` (ไม่บวกสะสม — คุมค่า AI ของคีย์ระบบ); ดาวน์โหลดไฟล์ผลิตได้ทุกแบบ **โดยไม่ออก `design_licenses`** (ปิด open access แล้วแบบที่ไม่ได้ซื้อกลับไปใช้กติกาปกติ — ถ้าภายหลังอยากให้แบบเก่าโหลดได้ต่อ ค่อยออก license `admin` ให้); ไม่มีลายน้ำ/ป้ายราคาใด ๆ; การขายยังปิด (`purchasesEnabled` false) — เปิดขายเมื่อไร open access ปิดเอง รอบ Pro ฟรีที่ค้างอยู่หมดเองภายใน `period_days` (ปิดทันทีได้ด้วย `update app_private.subscriptions set status = 'canceled' where order_id is null and status = 'active'`)
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
| `ai_requests` | `id` pk, `workspace_id`, `actor_user_id`, `operation_id` uuid, `state` in (`reserved`,`succeeded`,`failed`), `reserved_units` int = 1, `created_at`, `settled_at` (null ↔ reserved); การใช้งานจริง: `model` (1–200 ตัวอักษร), `input_tokens`/`output_tokens`/`cache_read_tokens`/`cache_creation_tokens` ≥ 0 (เก็บเฉพาะ `succeeded`), `has_image`; unique (`workspace_id`,`actor_user_id`,`operation_id`); partial index (`workspace_id`,`created_at`) where `reserved` สำหรับ sweep/นับ cap |
| `orders` | `id` pk, `workspace_id`, `purchaser_user_id`, `operation_id` uuid, `kind` in (`design`,`pro`), `project_id` uuid null, `amount_minor`, `currency`, `credits` (snapshot จาก catalog ตอนสั่ง), `status` in (`pending`,`paid`,`canceled`), `provider` text (`none` = ยังไม่เลือก, `dev`, `manual`, ชื่อ provider ในอนาคต), `provider_ref` text null, `created_at`, `paid_at`; unique (`workspace_id`,`purchaser_user_id`,`operation_id`); check `(kind = 'design') = (project_id is not null)`; FK (`project_id`,`workspace_id`) → projects(id, workspace_id) restrict |
| `design_licenses` | `project_id` pk, `workspace_id`, `source` in (`purchase`,`pro`,`admin`), `order_id` null → orders, `granted_by` → app_users, `granted_at`; FK (`project_id`,`workspace_id`) → projects restrict — ไม่ลบตาม project (soft delete อยู่แล้ว) |

RPC (`public.*`, พารามิเตอร์ตัวแรกเป็น `p_actor_user_id` เสมอ ยกเว้น `fulfil_order` ที่รับ null ได้สำหรับ webhook ในอนาคต):

| RPC | พฤติกรรม |
| --- | --- |
| `get_entitlements(p_actor_user_id, p_workspace_id) → jsonb` | `assert_workspace_access(read)` แล้วคืน `{workspaceId, plan: 'free'\|'pro', proUntil, credits, licensedProjectIds: uuid[] (เฉพาะ project ที่ยังไม่ถูกลบ), catalog: {design:{kind,amountMinor,currency,credits,periodDays}, pro:{…}}}` |
| `authorize_export(p_actor_user_id, p_project_id) → jsonb` | หา project (ไม่ถูกลบ) → `assert_workspace_access(read)` → มี license อยู่แล้ว → คืน `{projectId, source, entitlements}`; ไม่มีแต่ Pro กำลังใช้งาน → insert license `source='pro'` (granted_by = actor) แล้วคืน; ไม่งั้น raise `EXPORT_PAYMENT_REQUIRED` |
| `reserve_ai_credit(p_actor_user_id, p_workspace_id, p_operation_id) → jsonb` | `assert_workspace_access(write)` → advisory lock ต่อ workspace → upsert `credit_balances` → คืนเครดิตคำขอของ workspace ที่ค้าง `reserved` เกิน 15 นาที (ตั้ง `failed` + ledger `ai_refund`; ไม่มี cron) → ถ้ามี request เดิมด้วย operation_id: `reserved` → raise `AI_REQUEST_IN_PROGRESS`, อื่น ๆ → raise `IDEMPOTENCY_KEY_REUSED` → workspace มีคำขอ `reserved` ค้าง ≥ 2 → raise `AI_CONCURRENCY_LIMIT` (ไม่หักเครดิต; ค่าจำกัดเขียนตายตัวใน RPC เปลี่ยนต้องทำ migration ใหม่) → lock `credit_balances` `for update` → `balance < 1` → raise `AI_CREDITS_EXHAUSTED` → หัก 1, ledger `ai_request` (ref = request id), insert `ai_requests` reserved → คืน `{requestId, credits}` |
| `settle_ai_request(p_actor_user_id, p_request_id, p_outcome 'succeeded'\|'failed', p_model, p_input_tokens, p_output_tokens, p_cache_read_tokens, p_cache_creation_tokens, p_has_image) → jsonb` (6 ตัวท้าย default null) | lock request; ต้องเป็นของ actor และ state `reserved` (ไม่งั้น raise `AI_REQUEST_NOT_RESERVED`); `failed` → คืน 1 เครดิต + ledger `ai_refund` (เก็บแค่ `has_image`); `succeeded` → เก็บ model/โทเคน/`has_image`; ตั้ง state/settled_at → คืน `{credits}` |
| `create_order(p_actor_user_id, p_workspace_id, p_operation_id, p_kind, p_project_id) → jsonb` | `assert_workspace_access(write)` → ซ้ำ operation_id เดิม: kind/project ตรง → คืน order เดิม ไม่ตรง → `IDEMPOTENCY_KEY_REUSED` → `design`: project ต้องอยู่ใน workspace และไม่ถูกลบ (`PROJECT_NOT_FOUND`), มี license แล้ว → `ALREADY_LICENSED` → อ่านราคา/เครดิตจาก catalog → insert `pending`, provider `none` → คืน order json |
| `fulfil_order(p_actor_user_id uuid null, p_order_id, p_provider, p_provider_ref) → jsonb` | lock order (`ORDER_NOT_FOUND`); ถ้า actor ไม่ null ต้องเป็น purchaser (ไม่งั้น `ORDER_NOT_FOUND`); `paid` แล้ว → คืนเดิม (idempotent); `canceled` → `ORDER_NOT_PAYABLE`; ตั้ง paid/provider/provider_ref/paid_at; `design` → insert license `purchase` (on conflict do nothing); `pro` → insert subscription รอบใหม่ `period_start = greatest(now(), pro_until ปัจจุบัน)`, `period_end = start + period_days`; เติมเครดิต `orders.credits` + ledger (`design_purchase`/`pro_period`, ref = order id) → คืน order json |

order json: `{id, workspaceId, kind, projectId, amountMinor, currency, credits, status, provider, providerRef, createdAt, paidAt}`

Open access (migration `supabase/migrations/20261015000700_open_access.sql` — เพิ่ม function อย่างเดียว ไม่แก้ตาราง/ฟังก์ชันเดิม):

| RPC | พฤติกรรม |
| --- | --- |
| `app_private.ensure_complimentary_pro(p_workspace_id) → void` (ภายใน) | advisory lock คีย์เดียวกับ `fulfil_order` → มี Pro ที่ใช้งานอยู่ (จ่ายเงินหรือฟรี) → ไม่ทำอะไร; ไม่งั้น insert subscription `order_id = null` รอบ `now()` ถึง `now() + period_days` และเติม `credit_balances` ให้ถึง `plan_catalog.pro.credits` (ledger `pro_period` เฉพาะส่วนที่เติม, ref = subscription id; ยอดเกินโควตาอยู่แล้ว = ไม่แตะ) |
| `ensure_open_access(p_actor_user_id, p_workspace_id) → jsonb` | `assert_workspace_access(read)` → `ensure_complimentary_pro` → คืน entitlements shape เดียวกับ `get_entitlements` |
| `authorize_open_access_export(p_actor_user_id, p_project_id) → jsonb` | หา project (ไม่ถูกลบ, ไม่งั้น `PROJECT_NOT_FOUND`) → `assert_workspace_access(read)` → `ensure_complimentary_pro` → คืน `{projectId, source: license เดิมถ้ามี ไม่งั้น 'pro', entitlements}` **ไม่ insert license** |

## 3. HTTP API (`server/http/router.ts`, bearer ทุกเส้น)

| เส้นทาง | ผล |
| --- | --- |
| `GET /api/v1/billing/entitlements?workspaceId=` | 200 `Entitlements` (`devFulfilAvailable` และ `purchasesEnabled` = `appEnv ∈ {development,test}`, `openAccess` = ตรงข้าม ผ่าน `billingFlags(config)`); open access → ใช้ `ensure_open_access` แทน `get_entitlements` |
| `POST /api/v1/projects/:id/export-authorizations` (body ไม่มี / `{}` / `{ format: 'spec'\|'dxf'\|'pdf'\|'svg'\|'ai' }`) | 200 `ExportAuthorization`; 402 `PAYMENT_REQUIRED` พร้อม `details: { projectId, price: CatalogItem }`; 402 `PRO_REQUIRED` เมื่อ `format` เป็น svg/ai แต่ plan ไม่ใช่ `pro` (ตรวจหลังผ่านด่านสิทธิ์ปกติใน `BillingService.authorizeExport`, `details: { projectId, format, price: catalog.pro }`); 404 `NOT_FOUND`; open access → `authorize_open_access_export` (ไม่มี 402, ไม่ออก license; plan เป็น pro จึงได้ svg/ai) |
| `POST /api/v1/billing/orders` body `CreateOrderInput` | `purchasesEnabled` = false → 503 `PURCHASE_UNAVAILABLE` ก่อนแตะฐานข้อมูล; 201 `Order` (`checkoutUrl: null` จนกว่าจะมี provider); 409 `ALREADY_LICENSED` / `IDEMPOTENCY_KEY_REUSED`; 404 `NOT_FOUND` |
| `POST /api/v1/billing/orders/:id/dev-fulfil` | เฉพาะ `appEnv ∈ {development,test}`; อื่น ๆ 404 `NOT_FOUND` เหมือนไม่มีเส้นทางนี้ → 200 `Order` (paid) หลัง `fulfil_order(actor, id, 'dev', requestId)`; 409 `ORDER_NOT_PAYABLE` |
| `POST /api/v1/ai/box-spec` body `{ workspaceId, operationId, prompt, current?, image? }` | ไม่มี `config.ai` → 503 `CONFIGURATION_ERROR`; ลำดับ: authenticate → validate body → (open access: `ensure_open_access` ต่อรอบที่หมดก่อน) → `reserve_ai_credit` → เรียก provider ด้วยคีย์ server → `settle succeeded` → 200 `{ …BoxSpecResult, credits }`; ผล provider กลับมาแล้วแต่ `settle succeeded` ล้ม → ยังตอบ 200 พร้อมยอดจากตอนจอง (ไม่คืนเครดิต ไม่ทิ้งผล); provider ล้ม (timeout 50 วินาที ไม่ retry — สั้นกว่า `maxDuration` 60 ของ `api/backend.js` ใน vercel.json) → `settle failed` (best-effort, log เมื่อล้ม) แล้ว 429 `AI_RATE_LIMITED` / 502 `AI_PROVIDER_UNAVAILABLE` / คีย์ server ผิด → 503 `CONFIGURATION_ERROR`; โมเดลตอบกลับมาแต่ไม่มีสเปกให้ใช้ (`stop_reason` `refusal`, JSON ถูกตัดที่ `max_tokens`, ไม่มี JSON) ก็นับเป็น provider ล้ม (คืนเครดิต) — refusal ตอบ 502 `AI_PROVIDER_UNAVAILABLE` ข้อความ "AI ไม่รับคำขอนี้ ลองปรับคำอธิบายแล้วส่งใหม่" (log `kind: refusal` พร้อมหมวด) ที่เหลือข้อความ "บริการ AI ขัดข้อง" ตามเดิม; เครดิตหมด → 402 `AI_CREDITS_EXHAUSTED` พร้อม `details: { credits: 0, plan }`; คำขอค้างครบ 2 → 429 `AI_RATE_LIMITED`; ซ้ำ operation → 409; settle `succeeded` ส่ง model/โทเคน/`hasImage` ไปเก็บ แต่ response ไม่มีข้อมูลการใช้งาน |

Error code ใหม่ใน `shared/contracts/errors.ts`: `PAYMENT_REQUIRED`, `PURCHASE_UNAVAILABLE`, `AI_CREDITS_EXHAUSTED`, `AI_REQUEST_IN_PROGRESS`, `ALREADY_LICENSED`, `ORDER_NOT_FOUND`, `ORDER_NOT_PAYABLE` (client มีรหัสของตัวเองเพิ่ม `NETWORK_ERROR` เมื่อ fetch ล้ม ไม่อยู่ใน union); ถอด `AI_API_KEY_REQUIRED`/`AI_API_KEY_INVALID` ออกจาก union (`server/modules/ai/requestApiKey.ts` ยังอยู่เพราะ legacy `/api/box-spec` ของ local-demo ใช้อ่าน BYOK header และไม่ได้ใช้ union นี้)

`ServerConfig.ai: null | { anthropicApiKey, model }` อ่านจาก `ANTHROPIC_API_KEY` + `BOX_SPEC_MODEL` (default `claude-opus-5-5` = `DEFAULT_AI_MODEL`; ตัวเลือกรุ่นและข้อแลกเปลี่ยน §6); `createApiRouter` รับ `billingService` หรือ `billingRepository` (เทสต์) เพิ่มแบบ DI เหมือน service อื่น (`server/modules/billing/billingService.ts` + adapter `server/adapters/supabase/billingRepository.ts`; ตัวแปลง error เป็น pure function `mapBillingDatabaseError`)

Log ฝั่ง server (`server/logging.ts`): JSON บรรทัดเดียวต่อเหตุการณ์ ตัดคีย์ API/Supabase, bearer token, JWT และอีเมลทิ้งก่อนเขียน; event: `api_unexpected_error`, `ai_provider_error`, `billing_database_error`, `billing_contract_error`, `ai_refund_failed`, `ai_settle_failed`, `order_created`, `order_fulfilled`

รายงานต้นทุน AI: `npm run ops:ai-usage:report` (`scripts/report-ai-usage.mjs`, อ่านอย่างเดียว) สรุปคำขอ/โทเคนเฉลี่ย-p95/สัดส่วนแนบรูป/การคืนเครดิตต่อโมเดล; ค่าใช้จ่ายคำนวณเฉพาะเมื่อส่ง `--input-usd-per-mtok` + `--output-usd-per-mtok` เอง (ไม่ hardcode ราคา); ฐานข้อมูล cloud ส่งผ่าน env `PACKIT_REPORT_DATABASE_URL` เท่านั้น ไม่ตั้ง = Supabase local

## 4. ฝั่ง client (cloud mode เท่านั้น)

- `src/services/api/billing.ts`: `getEntitlements`, `authorizeExport`, `createOrder`, `devFulfilOrder`; `src/services/api/ai.ts` ส่ง `{workspaceId, operationId, prompt, current, image}` ไม่มี header คีย์ และคืน `AiBoxSpec & { credits }`
- `CloudWorkspace` โหลด entitlements ก่อนตั้ง workspace `ready` (ล้มเหลวหรือเริ่มแบบออฟไลน์ → `entitlementsStatus = 'error'` แต่เปิดงานได้) และรีเฟรชเมื่อกลับมาออนไลน์ (ทุกครั้ง), เมื่อ focus/กลับมาที่แท็บ (ห่างกันอย่างน้อย 30 วินาที) และเมื่อเปิดหน้าแพ็กเกจหรือ paywall; รีเฟรชที่ล้มตอนมีข้อมูลแล้วคงข้อมูลเดิม; เพิ่มใน `CloudProjectBridge`: `entitlements`, `entitlementsStatus` (`loading`/`ready`/`error`), `refreshEntitlements()`, `authorizeExport(projectId)`, `createOrder(kind, projectId?)`, `devFulfilOrder(orderId)`; `requestAiSpec(prompt, current?, imageBase64?)` อัปเดต `entitlements.credits` จาก response
- `App`:
  - `entitlements = cloud?.entitlements ?? null` → `gatePlan` (`'free'` เมื่อ null) / `gateCredits` / `licensed` (Set ของ `licensedProjectIds`) / `openAccess` / `watermarkOn = cloud !== undefined && previewWatermarked(entitlements, entitlementsStatus === 'ready', activeId)` — ลายน้ำเฉพาะเมื่อโหลดสิทธิ์สำเร็จแล้วรู้แน่ว่าไม่ใช่ Pro ไม่ใช่ open access และแบบนี้ยังไม่ซื้อ (ระหว่างโหลด/โหลดไม่ได้ไม่ติด จึงไม่โผล่แวบก่อนรู้ว่าเป็น Pro; server ยังตัดสินไฟล์ผลิตทุกครั้ง) — ไม่มี `cloud` (local) = ไม่มี paywall/ลายน้ำ
  - ปุ่มดาวน์โหลด 4 ปุ่มผ่าน `gatedDownload`: local → ทำทันที; cloud ออฟไลน์ → ปุ่มปิดพร้อมคำใบ้ "ต้องออนไลน์เพื่อดาวน์โหลดไฟล์ผลิต"; cloud ออนไลน์ → `authorizeExport` ก่อนเสมอ (server ตัดสิน) → อนุญาตแล้วค่อยสร้างไฟล์; `PAYMENT_REQUIRED` → รีเฟรชสิทธิ์แล้วเปิด `PaywallModal` แบบ `design`; ปุ่มมีป้าย `149 ฿` เมื่อยังไม่มีสิทธิ์; `.genpkg.json` ไม่ gate; fetch ล้ม → `ApiClientError` รหัส `NETWORK_ERROR` ข้อความอ่านเข้าใจได้ (AbortError ส่งต่อเหมือนเดิม)
  - เตือนก่อนเสียสิทธิ์: ลบงานที่ซื้อแล้ว และกด "เก็บเป็นสำเนา" ตอนบันทึกชนของงานที่ซื้อแล้ว (สำเนาเป็นงานใหม่ไม่มีสิทธิ์) — ข้อความจาก `src/core/designLicense.ts` (pure); ถ้ายังโหลดสิทธิ์ไม่ได้จะเตือนแบบมีเงื่อนไข
  - `PaywallModal` (`src/components/PaywallModal.tsx`): สองโหมด `design` (149 → ดาวน์โหลดแบบนี้ + แถม N เครดิต) และ `pro` (399/เดือน → ทุกแบบ + N เครดิต/เดือน) อ่านราคา/เครดิตจาก `entitlements.catalog`; `purchasesEnabled` ไม่ใช่ true → ไม่มีปุ่มชำระ มีข้อความ "ยังไม่เปิดขาย" และปุ่มปิดอย่างเดียว; เปิดขาย (dev/test) → ปุ่มชำระ → `createOrder` → ถ้า `devFulfilAvailable` มีปุ่ม "จำลองการชำระ (dev)" → `devFulfilOrder` → `refreshEntitlements` → ทำ action ที่ค้าง (ดาวน์โหลด) ต่อ; Pro ไม่ถูกเสนอซื้อรายแบบ; สถานะ order และรหัส error ที่รู้จักแปลผ่าน `t()`
  - แถบ header: ชิปแพ็กเกจ (`Freemium` / `Pro ถึง d/m/y` / open access: `Pro · ใช้ฟรีช่วงนี้`) + `เครดิต AI n` + ป้าย `อัปเกรด Pro` (หรือ `ดูแพ็กเกจ` เมื่อยังไม่เปิดขาย) — กดแล้วเปิดหน้าแพ็กเกจ; `entitlementsStatus = 'error'` → ชิป "โหลดแพ็กเกจไม่สำเร็จ · ลองใหม่" กดแล้วโหลดซ้ำ
  - `PromptBar`: ถอด prop `apiKeyRequired` และ `disabledReason`; เพิ่ม `allowApiKey` (true เฉพาะ local = โชว์ช่องคีย์เดิม), `credits?: number | null`, `onError?(code, message)`, `blockedReason`/`onBlocked`; cloud ที่สิทธิ์โหลดแล้ว (`ready`) และ `credits === 0` → ปุ่ม AI ยังกดได้ มีป้าย `0` และกดแล้วเปิดหน้าแพ็กเกจ (ข้อความตามแพ็กเกจ: Freemium "ต้องมีเครดิต AI — ดูแพ็กเกจ" / Pro "เครดิต AI รอบนี้หมดแล้ว"); สถานะอื่นไม่บล็อกฝั่ง client (server ตัดสิน); ได้ `AI_CREDITS_EXHAUSTED` → รีเฟรชสิทธิ์แล้วเปิดหน้าแพ็กเกจ
  - `ProjectGallery` รับ `licensedIds?: ReadonlySet<string>` → ป้าย "ซื้อแล้ว" บนการ์ด
  - หน้าแพ็กเกจ `PricingPage` (prop `purchasesEnabled` บังคับ): การ์ด 3 แพ็กเกจ (Pro แนะนำ + จุดคุ้มทุน = floor(ราคา Pro ÷ ราคาแบบ) + 1 แบบ/เดือน), ตารางเปรียบเทียบ, FAQ; ยังไม่เปิดขาย → ปุ่มแพ็กเกจที่ต้องจ่ายเป็น "เปิดขายเร็ว ๆ นี้" แบบปิด มีประกาศใต้หัวข้อ และ FAQ ชำระเงินบอกว่าจะประกาศเมื่อเปิด; เปิดจากชิปแพ็กเกจ, ปุ่ม AI ตอนเครดิต 0 และลิงก์ใน PaywallModal; หน้าเข้าสู่ระบบ cloud มีลิงก์เปิดแบบผู้เยี่ยมชม (`purchasesEnabled` = false, อยู่ใน `LangCtx` จาก `loadLang()`, ไม่แสดงจำนวนเครดิตเพราะยังไม่มี catalog); สมาชิกช่วง open access (`viewer.openAccess`) → ประกาศ "ตอนนี้ใช้ Pro ได้ฟรี" พร้อมโควตาเครดิตและบอกว่าแบบที่ยังไม่ซื้อจะกลับไปใช้กติกาปกติเมื่อเปิดขาย, การ์ด Pro "ใช้ฟรีอยู่" + "ต่อรอบให้อัตโนมัติ" (ผู้เยี่ยมชมไม่รู้สถานะ open access จึงเห็นแบบยังไม่เปิดขาย)
  - ข้อความใหม่ใน App ผ่าน `t(th, en)`
- **ลายน้ำ** (`src/core/watermark.ts` pure + test): `watermarkTiles(w, h)` คืนตำแหน่ง/มุม/ขนาดตัวอักษรของข้อความซ้ำเฉียง −30° ให้เห็น ~3–5 แถวบนแผ่น (ขนาดตัวอักษร ≈ clamp(min(w,h)/10, 6, 40) มม., ระยะแถว ≈ 2.2×ขนาด) ใช้ร่วม 3 พื้นผิว: (a) `DielineSVG` prop `watermark?: string` → `<g className="watermark" pointerEvents="none">` วาดหลังสุดใน rotor (ไม่ไปถึงไฟล์ส่งออกเพราะไฟล์ใช้ `dielineSVGString` คนละทาง), (b) `useArtTexture` option `watermark?: string | null` → `drawWatermark(ctx, sheetW, sheetH, s, text)` หลัง `draw` ทุก viewer (Viewer3D/PouchViewer3D/VesselViewer3D ส่งผ่าน prop; Viewer3D ต้อง `enabled` เมื่อมีลายน้ำแม้กล่องเปล่า), (c) `StickerSheetPreview` overlay ด้วย helper เดียวกัน; ข้อความ `PackIt · ตัวอย่าง` / `PackIt · PREVIEW`; opacity 0.18, ตัวอักษรเข้ม stroke ขาวบาง ๆ; **ห้าม** ทำเป็น Deco (Deco ไหลเข้า snap/DPI/contour/ไฟล์)
- fixture ตรวจด้วยตา `tests/browser/paywall.html` + `.tsx` (แบบเดียวกับ `loading-continuity`): mount `App` ด้วย fake `CloudProjectBridge` สลับสถานะ free / licensed / pro / pro-หมดเครดิต / open-access + ปุ่มเปิด-ปิด `purchases off`, `offline`, `plan error` และหน้าแพ็กเกจแบบผู้เยี่ยมชม โดยไม่ต้องมี Supabase

## 5. เทสต์และสคริปต์ที่ต้องตามแก้

- `server/http/router.test.ts`: AI route ใหม่ (ไม่มี BYOK, 503 ไม่มีคีย์, 402 เครดิตหมด, settle failed เมื่อ provider ล้ม, response มี `credits`), billing routes กับ fake `BillingService`, dev-fulfil 404 บน staging/production
- pgTAP `supabase/tests/database/0006_billing.test.sql` `plan(131)` (ตาราง/RLS/grant/catalog, order idempotent, fulfil ให้ license+เครดิต ครั้งเดียวแม้เรียกซ้ำ, authorize_export ปฏิเสธ→อนุญาต, Pro สร้าง license `pro`, reserve หัก/exhausted/refund, sweep 15 นาที, เก็บการใช้งานตอน settle, cap 2 คำขอ)
- pgTAP `supabase/tests/database/0007_open_access.test.sql` `plan(41)` (grant, รอบ Pro ฟรีไม่มี order + เครดิตเต็มโควตา, เรียกซ้ำกลางรอบไม่เพิ่ม, หมดรอบเติมเฉพาะส่วนที่ขาด/ยอดเกินโควตาไม่แตะ, export ไม่ออก license และรายงาน license เดิม, คนนอก/โปรเจกต์ที่ไม่มีหรือถูกลบ = `PROJECT_NOT_FOUND`, export เริ่มรอบเองได้, Pro ที่จ่ายแล้วไม่ซ้อนรอบฟรี)
- `server/adapters/supabase/billingRepository.test.ts` (ทุกข้อความ P0001 → HTTP), `server/logging.test.ts` (ตัดความลับ), `src/core/designLicense.test.ts`, `src/services/api/client.test.ts` (`NETWORK_ERROR`)
- `tests/integration/billing.lifecycle.test.ts` (ต้องมี Supabase local; PASS 14 ต.ค. 2026) + เคส open access ผ่าน `BillingService` จริง (บัญชีใหม่: export ก่อนโหลดสิทธิ์ได้, ไม่มี license/order, หักเครดิตตามปกติ, ยังขายไม่ได้, คนอื่นเห็น 404)
- `scripts/e2e-local-cloud.mjs` ขั้น paywall: Freemium ดาวน์โหลด → paywall → สั่งซื้อรายแบบ → จำลองชำระ → ได้ SVG ไม่มีลายน้ำ + ตรวจ license `purchase`/เครดิตใน DB
- รายการลบตารางใน `scripts/e2e-local-cloud.mjs`, `scripts/verify-local-http.mjs`, `scripts/cleanup-local-test-fixtures.mjs`, `scripts/report-local-cleanup.mjs`, `tests/integration/*.test.ts` ต้องเพิ่ม `design_licenses`, `orders`, `subscriptions`, `ai_requests`, `credit_ledger`, `credit_balances` (ลบก่อน `projects`/`workspace_members`); `verify-local-http.mjs` เปลี่ยนความคาดหวัง AI route (ไม่มี bearer → 401; มี bearer แต่ server ไม่มีคีย์ → 503) และ billing smoke ตรวจ `purchasesEnabled`, export-authorizations 402 ตอนฟรี → 200 หลัง dev-fulfil Pro
- `npm run build:api` หลังแก้ server แล้ว commit `api/backend.js`
- env: `.env.example`/`.env.cloud.example`/README อธิบาย `ANTHROPIC_API_KEY` สำหรับ AI บน cloud
- `server/boxSpec.test.ts`: รูปแบบคำขอที่ออกจาก SDK จริงต่อรุ่น (stub `fetch`: URL/header `anthropic-beta`/body) + อ่านคำตอบ (thinking นำหน้า, block `fallback`, refusal ก่อน/กลางคำตอบ, `max_tokens`, ไม่มี JSON) + `AnthropicAiService` แปลงเป็น `AiProviderError`; `server/boxSpec.live.test.ts` เช็คสด (ข้ามเสมอถ้าไม่ตั้ง env — §6)

## 6. โมเดล AI (`BOX_SPEC_MODEL`) — ตัวเลือกและข้อแลกเปลี่ยน

สถานะ 16 ต.ค. 2026: **ค่าเริ่มต้นเป็น `claude-opus-5-5`** (เจ้าของผลิตภัณฑ์เลือก 16 ต.ค. 2026; ก่อนหน้านั้น `claude-opus-4-8`) — โค้ดรองรับ 4 รุ่นในตาราง เปลี่ยนรุ่นด้วย env ได้ (ตั้ง `BOX_SPEC_MODEL` ใน Vercel ทุก environment ที่ใช้ แล้ว redeploy)

`BOX_SPEC_MODEL` คือรุ่น Claude ที่ server เรียกในทุกคำขอ AI (cloud `/api/v1/ai/box-spec` และ legacy `/api/box-spec` backend api; backend cli ส่งต่อเป็น `claude --model`) — 1 คำขอ = 1 เครดิตเท่ากันทุกรุ่น รุ่นจึงมีผลแค่ **ต้นทุนต่อเครดิตของเรา ความเร็ว และคุณภาพสเปก** ไม่กระทบราคาที่ผู้ใช้จ่าย

รูปคำขอ (`askClaudeWithUsage` ใน `server/boxSpec.ts`): ทุกรุ่นใช้ structured outputs (`output_config.format` = JSON schema ของสเปก) แทนการบังคับเรียก tool `box_spec` เดิม — Opus 5.5 / Sonnet 5.5 ตอบ 400 กับ `tool_choice` แบบ `tool`/`any` ทำให้ทุกคำขอล้มและคืนเครดิต; structured outputs บังคับ JSON ตาม schema ทุกรุ่นจึงไม่มีกรณี "โมเดลไม่เรียก tool"; ไม่ส่ง `thinking`/`temperature`; `max_tokens` 16000 (thinking นับรวม จ่ายเฉพาะที่ใช้จริง และถูกตัดที่ timeout 50 วินาทีอยู่แล้ว)

| `BOX_SPEC_MODEL` | ราคา input / output (USD ต่อ 1M โทเคน) | การคิดก่อนตอบ | refusal | หมายเหตุ |
| --- | --- | --- | --- | --- |
| `claude-opus-4-8` | 5 / 25 | ไม่คิด (ไม่ส่ง `thinking` = ปิดบนรุ่นนี้) ไม่ตั้ง effort | ไม่ส่ง fallbacks | ค่าเริ่มต้นเดิมก่อน 16 ต.ค. 2026 แพงสุดในสี่รุ่น |
| `claude-opus-5-5` (ค่าเริ่มต้น) | 4 / 20 | คิดเสมอ (ปิดไม่ได้) `effort: "low"` (ค่าเริ่มต้นของ API = medium) | `fallbacks: "default"` — classifier ปฏิเสธแล้ว API ส่งต่อให้รุ่นที่ Anthropic แนะนำตามหมวดในคำขอเดียว | ฉลาดสุด ถูกกว่า 4.8 ต่อโทเคน 20% แต่มีโทเคน thinking เพิ่ม |
| `claude-sonnet-5-5` | 2 / 10 | adaptive `effort: "low"` (ค่าเริ่มต้นของ API = high) | `fallbacks: "default"` — ส่งต่อเฉพาะหมวด `cyber`/`frontier_llm` (ไป Sonnet 5); `bio`/`reasoning_extraction`/`general_harms` ไม่ส่งต่อ | ราคาครึ่งหนึ่งของ Opus 5.5 |
| `claude-haiku-5-5` | 0.10 / 0.50 (prompt ≤ 100K โทเคน) | adaptive `effort: "low"` (ค่าเริ่มต้นของ API = medium) | ไม่มี server-side fallback — refusal = ล้ม คืนเครดิต | ถูกสุด (≈ 1/50 ของ Opus 4.8 ต่อโทเคน) และเร็วสุด แต่ต้องวัดว่าคำนวณ layout/fit check ได้ดีพอ |

ข้อแลกเปลี่ยน:

- **ต้นทุนต่อเครดิตเทียบจากราคาต่อโทเคนอย่างเดียวไม่ได้**: system prompt ภาษาไทย (~12K ตัวอักษร) ถูกส่งทุกคำขอจึงเป็นก้อนใหญ่ของ input, รูปแนบเพิ่ม input, และรุ่นตระกูล 5 คิดก่อนตอบ — โทเคน thinking คิดเงินเป็น output และรวมอยู่ใน `output_tokens` ที่เก็บใน `ai_requests` แล้ว (ทาง Opus 4.8 ไม่มี) จำนวนโทเคนของข้อความเดียวกันยังต่างกันตามรุ่นได้ — ให้วัดจริงด้วย `npm run ops:ai-usage:report` ใส่ราคาของรุ่นนั้นเป็น flag
- **ความเร็ว**: รุ่นตระกูล 5 คิดก่อนตอบ (`low` ทำให้สั้น) เวลาถึงคำตอบจึงอาจนานขึ้นแม้ output สั้น; ทั้งหมดเป็นคำขอแบบไม่ stream ผู้ใช้รอคำตอบเต็มอยู่แล้ว; เกิน 50 วินาที = ล้ม คืนเครดิต (ไม่ retry); คำขอแรกหลัง deploy หรือหลังว่าง 24 ชม. ช้ากว่าปกติเพราะ API คอมไพล์ grammar ของ schema
- **คุณภาพ**: เลือก `low` ตามคำแนะนำสำหรับงานแปลงข้อความเป็นข้อมูลที่ต้องการความเร็ว — ถ้าขนาด/การจัดวาง/fit check ผิดบ่อย คันโยกแรกคือขยับเป็น `medium` (ตอนนี้ต้องแก้โค้ดที่ `boxSpecModelOptions`) ก่อนเปลี่ยนไปรุ่นที่แพงกว่า
- **refusal**: Opus 5.5 / Sonnet 5.5 / Haiku 5.5 มี safety classifier — งานบรรจุภัณฑ์โดนน้อย แต่หมวด `general_harms` (Sonnet/Haiku 5.5) โดนงานปกติได้; refusal = คำขอล้ม คืนเครดิต ผู้ใช้เห็น "AI ไม่รับคำขอนี้ ลองปรับคำอธิบายแล้วส่งใหม่"; Anthropic คิดเงิน refusal ที่เกิดก่อนมี output เฉพาะหมวด `bio`/`frontier_llm`/`reasoning_extraction` (กลางคำตอบคิดปกติ) และโทเคนของคำขอที่ล้มไม่ถูกเก็บใน `ai_requests`; ช่องคำอธิบายที่ให้โมเดลกรอกจึงชื่อ `explanation` ไม่ใช่ `reasoning` (ช่อง JSON ชื่อ reasoning เป็นตัวกระตุ้น `reasoning_extraction` ที่พบบ่อย — หมวดนี้ไม่มี fallback) แล้วแปลงกลับเป็น `reasoning` ใน response เดิม
- **fallback (Opus/Sonnet 5.5, beta `server-side-fallback-2026-07-01`)**: คำขอที่ถูกส่งต่อถูกบันทึก `ai_requests.model` เป็นรุ่นที่ตอบจริง (รายงานจะมีแถวของรุ่นนั้นแยก เช่น `claude-opus-4-8`) และเก็บโทเคนเฉพาะรอบที่ตอบ — รอบที่ถูกปฏิเสธ (ถ้าคิดเงิน) ไม่ถูกนับ
- **rate limit**: แต่ละรุ่นมีโควตาแยกกันที่ Anthropic — เช็ค limit ของ tier สำหรับรุ่นใหม่ก่อนสลับ
- รุ่นอื่นนอกตาราง: ตระกูล 5 ได้ `effort: "low"` (`claude-opus-5` / `claude-fable-5-1` ได้ fallback ด้วย) ตระกูล 4.x ไม่ตั้ง effort — ไม่ได้ทดสอบ; `claude-haiku-4-5` ($1/$5) แพงกว่า Haiku 5.5 แล้ว

เช็คสดก่อนเลือกรุ่น (เสียเงินจริง 4 รุ่น × 2 คำขอ รวมไม่ถึง 1 USD — คำขอภาษาไทยหนึ่ง แนบรูปหนึ่ง; พิมพ์รุ่นที่ตอบจริง เวลา และโทเคน):

```bash
PACKIT_LIVE_AI=1 ANTHROPIC_API_KEY=sk-ant-... npx vitest run server/boxSpec.live.test.ts
```

ผลเช็คสด: **ยังไม่ได้รัน (14 ต.ค. 2026)** — เครื่องพัฒนายังไม่มี `ANTHROPIC_API_KEY`; ที่ยืนยันแล้วคือรูปคำขอต่อรุ่นตามเอกสาร Claude API ผ่าน unit test (stub `fetch` ตรวจคำขอที่ SDK ส่งจริง)
