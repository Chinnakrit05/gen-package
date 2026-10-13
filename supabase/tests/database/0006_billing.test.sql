begin;

select plan(112);

select has_table('app_private', 'plan_catalog', 'plan_catalog exists');
select has_table('app_private', 'subscriptions', 'subscriptions exists');
select has_table('app_private', 'credit_balances', 'credit_balances exists');
select has_table('app_private', 'credit_ledger', 'credit_ledger exists');
select has_table('app_private', 'ai_requests', 'ai_requests exists');
select has_table('app_private', 'orders', 'orders exists');
select has_table('app_private', 'design_licenses', 'design_licenses exists');
select ok((select relrowsecurity from pg_class where oid = 'app_private.plan_catalog'::regclass), 'plan catalog has RLS');
select ok((select relrowsecurity from pg_class where oid = 'app_private.subscriptions'::regclass), 'subscriptions has RLS');
select ok((select relrowsecurity from pg_class where oid = 'app_private.credit_balances'::regclass), 'credit balances has RLS');
select ok((select relrowsecurity from pg_class where oid = 'app_private.credit_ledger'::regclass), 'credit ledger has RLS');
select ok((select relrowsecurity from pg_class where oid = 'app_private.ai_requests'::regclass), 'ai requests has RLS');
select ok((select relrowsecurity from pg_class where oid = 'app_private.orders'::regclass), 'orders has RLS');
select ok((select relrowsecurity from pg_class where oid = 'app_private.design_licenses'::regclass), 'design licenses has RLS');
select ok(not has_table_privilege('anon', 'app_private.orders', 'SELECT'), 'anon cannot read orders');
select ok(not has_table_privilege('authenticated', 'app_private.orders', 'SELECT'), 'authenticated cannot read orders');
select ok(not has_table_privilege('anon', 'app_private.credit_balances', 'SELECT'), 'anon cannot read credit balances');
select ok(not has_table_privilege('authenticated', 'app_private.design_licenses', 'SELECT'), 'authenticated cannot read licenses');
select ok(has_table_privilege('service_role', 'app_private.orders', 'SELECT'), 'service role can read orders');
select ok(
  not has_function_privilege('anon', 'public.get_entitlements(uuid,uuid)', 'EXECUTE'),
  'anon cannot read entitlements directly'
);
select ok(
  not has_function_privilege('authenticated', 'public.fulfil_order(uuid,uuid,text,text)', 'EXECUTE'),
  'authenticated cannot fulfil orders directly'
);
select ok(
  not has_function_privilege('authenticated', 'public.reserve_ai_credit(uuid,uuid,uuid)', 'EXECUTE'),
  'authenticated cannot reserve AI credits directly'
);
select ok(
  has_function_privilege('service_role', 'public.get_entitlements(uuid,uuid)', 'EXECUTE'),
  'service role can read entitlements'
);
select ok(
  has_function_privilege('service_role', 'public.authorize_export(uuid,uuid)', 'EXECUTE'),
  'service role can authorize exports'
);
select ok(
  has_function_privilege('service_role', 'public.reserve_ai_credit(uuid,uuid,uuid)', 'EXECUTE'),
  'service role can reserve AI credits'
);
select ok(
  has_function_privilege('service_role', 'public.settle_ai_request(uuid,uuid,text)', 'EXECUTE'),
  'service role can settle AI requests'
);
select ok(
  has_function_privilege('service_role', 'public.create_order(uuid,uuid,uuid,text,uuid)', 'EXECUTE'),
  'service role can create orders'
);
select ok(
  has_function_privilege('service_role', 'public.fulfil_order(uuid,uuid,text,text)', 'EXECUTE'),
  'service role can fulfil orders'
);
select is(
  (select (amount_minor, currency, credits, period_days)::text from app_private.plan_catalog where code = 'design'),
  '(14900,THB,10,)',
  'catalog seeds the design purchase'
);
select is(
  (select (amount_minor, currency, credits, period_days)::text from app_private.plan_catalog where code = 'pro'),
  '(39900,THB,100,30)',
  'catalog seeds the pro subscription'
);

create temporary table billing_actor as
select * from public.bootstrap_personal_workspace(
  'https://billing.test/auth/v1', 'billing-owner', 'Billing owner', 'billing-owner@example.test'
);
create temporary table billing_other as
select * from public.bootstrap_personal_workspace(
  'https://billing.test/auth/v1', 'billing-other', 'Billing other', 'billing-other@example.test'
);
create temporary table billing_project as
select public.create_project(
  (select app_user_id from billing_actor),
  (select personal_workspace_id from billing_actor),
  '80000000-0000-4000-8000-000000000001', repeat('a', 64),
  'Billing project', 1, '{"kind":"billing"}'::jsonb
) as result;
create temporary table billing_project_two as
select public.create_project(
  (select app_user_id from billing_actor),
  (select personal_workspace_id from billing_actor),
  '80000000-0000-4000-8000-000000000002', repeat('b', 64),
  'Billing project two', 1, '{"kind":"billing"}'::jsonb
) as result;
create temporary table billing_project_three as
select public.create_project(
  (select app_user_id from billing_actor),
  (select personal_workspace_id from billing_actor),
  '80000000-0000-4000-8000-000000000003', repeat('c', 64),
  'Billing project three', 1, '{"kind":"billing"}'::jsonb
) as result;

-- workspace ใหม่ = Freemium: เครดิต 0 ไม่มี license ดาวน์โหลดไม่ได้
create temporary table fresh_entitlements as
select public.get_entitlements(
  (select app_user_id from billing_actor),
  (select personal_workspace_id from billing_actor)
) as result;

select is((select result->>'plan' from fresh_entitlements), 'free', 'fresh workspace is on the free plan');
select is((select (result->>'credits')::integer from fresh_entitlements), 0, 'fresh workspace has no AI credits');
select is((select result->'licensedProjectIds' from fresh_entitlements), '[]'::jsonb, 'fresh workspace has no licenses');
select is((select result->'proUntil' from fresh_entitlements), 'null'::jsonb, 'fresh workspace has no pro expiry');
select is(
  (select result->'catalog'->'design' from fresh_entitlements),
  '{"kind":"design","amountMinor":14900,"currency":"THB","credits":10,"periodDays":null}'::jsonb,
  'entitlements carry the design catalog item'
);
select is(
  (select result->'catalog'->'pro'->>'periodDays' from fresh_entitlements)::integer,
  30,
  'entitlements carry the pro period'
);
select throws_ok(
  $$select public.get_entitlements(
    (select app_user_id from billing_other),
    (select personal_workspace_id from billing_actor)
  )$$,
  'P0001', 'PROJECT_NOT_FOUND',
  'non-member cannot read entitlements of another workspace'
);
select throws_ok(
  $$select public.authorize_export(
    (select app_user_id from billing_actor),
    (select (result->>'id')::uuid from billing_project)
  )$$,
  'P0001', 'EXPORT_PAYMENT_REQUIRED',
  'free workspace cannot export production files'
);
select throws_ok(
  $$select public.authorize_export(
    (select app_user_id from billing_other),
    (select (result->>'id')::uuid from billing_project)
  )$$,
  'P0001', 'PROJECT_NOT_FOUND',
  'non-member cannot authorize export of another workspace project'
);
select is((select count(*)::integer from app_private.design_licenses), 0, 'refused export grants no license');

-- สั่งซื้อรายแบบ: pending + provider none, ซ้ำ operation_id คืนเดิม
create temporary table design_order as
select public.create_order(
  (select app_user_id from billing_actor),
  (select personal_workspace_id from billing_actor),
  '90000000-0000-4000-8000-000000000001', 'design',
  (select (result->>'id')::uuid from billing_project)
) as result;

select is((select result->>'status' from design_order), 'pending', 'new order starts pending');
select is((select result->>'provider' from design_order), 'none', 'new order has no payment provider yet');
select is((select (result->>'amountMinor')::integer from design_order), 14900, 'design order snapshots the catalog price');
select is((select (result->>'credits')::integer from design_order), 10, 'design order snapshots the catalog credits');
select is(
  (select (result->>'projectId')::uuid from design_order),
  (select (result->>'id')::uuid from billing_project),
  'design order references the project'
);
select is((select result->'paidAt' from design_order), 'null'::jsonb, 'pending order has no paidAt');
select is(
  (public.create_order(
    (select app_user_id from billing_actor),
    (select personal_workspace_id from billing_actor),
    '90000000-0000-4000-8000-000000000001', 'design',
    (select (result->>'id')::uuid from billing_project)
  )->>'id')::uuid,
  (select (result->>'id')::uuid from design_order),
  'order retry returns the original order'
);
select is(
  (select count(*)::integer from app_private.orders
    where workspace_id = (select personal_workspace_id from billing_actor)),
  1,
  'order retry does not duplicate the order'
);
select throws_ok(
  $$select public.create_order(
    (select app_user_id from billing_actor),
    (select personal_workspace_id from billing_actor),
    '90000000-0000-4000-8000-000000000001', 'pro', null
  )$$,
  'P0001', 'IDEMPOTENCY_KEY_REUSED',
  'order operation cannot be reused with another kind'
);
select throws_ok(
  $$select public.create_order(
    (select app_user_id from billing_actor),
    (select personal_workspace_id from billing_actor),
    '90000000-0000-4000-8000-000000000002', 'design',
    '00000000-0000-4000-8000-000000000000'
  )$$,
  'P0001', 'PROJECT_NOT_FOUND',
  'design order needs a live project in the workspace'
);
select throws_ok(
  $$select public.create_order(
    (select app_user_id from billing_other),
    (select personal_workspace_id from billing_actor),
    '90000000-0000-4000-8000-000000000003', 'design',
    (select (result->>'id')::uuid from billing_project)
  )$$,
  'P0001', 'PROJECT_NOT_FOUND',
  'non-member cannot order for another workspace'
);
select throws_ok(
  $$select public.fulfil_order(
    (select app_user_id from billing_other),
    (select (result->>'id')::uuid from design_order),
    'dev', 'request-0'
  )$$,
  'P0001', 'ORDER_NOT_FOUND',
  'only the purchaser can fulfil an order'
);
select throws_ok(
  $$select public.fulfil_order(
    (select app_user_id from billing_actor),
    '00000000-0000-4000-8000-000000000000', 'dev', null
  )$$,
  'P0001', 'ORDER_NOT_FOUND',
  'unknown order cannot be fulfilled'
);

-- ชำระรายแบบ: license purchase + เครดิต ครั้งเดียวแม้เรียกซ้ำ
create temporary table design_paid as
select public.fulfil_order(
  (select app_user_id from billing_actor),
  (select (result->>'id')::uuid from design_order),
  'dev', 'request-1'
) as result;

select is((select result->>'status' from design_paid), 'paid', 'fulfil marks the order paid');
select is((select result->>'provider' from design_paid), 'dev', 'fulfil records the provider');
select is((select result->>'providerRef' from design_paid), 'request-1', 'fulfil records the provider reference');
select ok((select result->>'paidAt' is not null from design_paid), 'paid order records paidAt');
select is(
  (select source from app_private.design_licenses
    where project_id = (select (result->>'id')::uuid from billing_project)),
  'purchase',
  'design purchase grants a purchase license'
);
select is(
  (public.get_entitlements(
    (select app_user_id from billing_actor),
    (select personal_workspace_id from billing_actor)
  )->>'credits')::integer,
  10,
  'design purchase adds the catalog credits'
);
select is(
  public.fulfil_order(
    (select app_user_id from billing_actor),
    (select (result->>'id')::uuid from design_order),
    'dev', 'request-2'
  )->>'providerRef',
  'request-1',
  'fulfil retry returns the original paid order'
);
select is(
  (public.get_entitlements(
    (select app_user_id from billing_actor),
    (select personal_workspace_id from billing_actor)
  )->>'credits')::integer,
  10,
  'fulfil retry does not add credits twice'
);
select is(
  (select count(*)::integer from app_private.credit_ledger
    where workspace_id = (select personal_workspace_id from billing_actor)
      and reason = 'design_purchase'),
  1,
  'purchase is audited once'
);
select is(
  public.authorize_export(
    (select app_user_id from billing_actor),
    (select (result->>'id')::uuid from billing_project)
  )->>'source',
  'purchase',
  'licensed project exports with source purchase'
);
select is(
  public.get_entitlements(
    (select app_user_id from billing_actor),
    (select personal_workspace_id from billing_actor)
  )->'licensedProjectIds',
  jsonb_build_array((select (result->>'id')::uuid from billing_project)),
  'entitlements list the licensed project'
);
select throws_ok(
  $$select public.create_order(
    (select app_user_id from billing_actor),
    (select personal_workspace_id from billing_actor),
    '90000000-0000-4000-8000-000000000004', 'design',
    (select (result->>'id')::uuid from billing_project)
  )$$,
  'P0001', 'ALREADY_LICENSED',
  'licensed project cannot be purchased again'
);

-- เครดิต AI: จองหัก 1, ซ้ำระหว่างค้าง → in progress, failed คืน, succeeded ไม่คืน
create temporary table ai_first as
select public.reserve_ai_credit(
  (select app_user_id from billing_actor),
  (select personal_workspace_id from billing_actor),
  'a0000000-0000-4000-8000-000000000001'
) as result;

select is((select (result->>'credits')::integer from ai_first), 9, 'reserve deducts one credit');
select is(
  (select state from app_private.ai_requests
    where id = (select (result->>'requestId')::uuid from ai_first)),
  'reserved',
  'reserve records a reserved request'
);
select is(
  (select count(*)::integer from app_private.credit_ledger
    where workspace_id = (select personal_workspace_id from billing_actor)
      and reason = 'ai_request'),
  1,
  'reserve writes an ai_request ledger entry'
);
select throws_ok(
  $$select public.reserve_ai_credit(
    (select app_user_id from billing_actor),
    (select personal_workspace_id from billing_actor),
    'a0000000-0000-4000-8000-000000000001'
  )$$,
  'P0001', 'AI_REQUEST_IN_PROGRESS',
  'duplicate operation while reserved is rejected'
);
select throws_ok(
  $$select public.settle_ai_request(
    (select app_user_id from billing_other),
    (select (result->>'requestId')::uuid from ai_first),
    'failed'
  )$$,
  'P0001', 'AI_REQUEST_NOT_RESERVED',
  'another user cannot settle the request'
);
select is(
  (public.settle_ai_request(
    (select app_user_id from billing_actor),
    (select (result->>'requestId')::uuid from ai_first),
    'failed'
  )->>'credits')::integer,
  10,
  'failed settle refunds the credit'
);
select is(
  (select count(*)::integer from app_private.credit_ledger
    where workspace_id = (select personal_workspace_id from billing_actor)
      and reason = 'ai_refund'),
  1,
  'refund is audited'
);
select throws_ok(
  $$select public.settle_ai_request(
    (select app_user_id from billing_actor),
    (select (result->>'requestId')::uuid from ai_first),
    'failed'
  )$$,
  'P0001', 'AI_REQUEST_NOT_RESERVED',
  'settled request cannot be settled twice'
);
select throws_ok(
  $$select public.reserve_ai_credit(
    (select app_user_id from billing_actor),
    (select personal_workspace_id from billing_actor),
    'a0000000-0000-4000-8000-000000000001'
  )$$,
  'P0001', 'IDEMPOTENCY_KEY_REUSED',
  'settled operation id cannot be reserved again'
);

create temporary table ai_second as
select public.reserve_ai_credit(
  (select app_user_id from billing_actor),
  (select personal_workspace_id from billing_actor),
  'a0000000-0000-4000-8000-000000000002'
) as result;

select is((select (result->>'credits')::integer from ai_second), 9, 'second reserve deducts again');
select is(
  (public.settle_ai_request(
    (select app_user_id from billing_actor),
    (select (result->>'requestId')::uuid from ai_second),
    'succeeded'
  )->>'credits')::integer,
  9,
  'succeeded settle keeps the deduction'
);
select is(
  (select balance from app_private.credit_balances
    where workspace_id = (select personal_workspace_id from billing_actor)),
  9,
  'balance reflects the settled request'
);
select ok(
  (select settled_at is not null and state = 'succeeded' from app_private.ai_requests
    where id = (select (result->>'requestId')::uuid from ai_second)),
  'settle stamps the final state'
);

-- คำขอที่ค้าง reserved เกิน 15 นาที (function ถูก kill) ถูกคืนเครดิตเองตอนจองครั้งถัดไปของ workspace
create temporary table ai_stale as
select public.reserve_ai_credit(
  (select app_user_id from billing_actor),
  (select personal_workspace_id from billing_actor),
  'a0000000-0000-4000-8000-000000000004'
) as result;
update app_private.ai_requests
set created_at = statement_timestamp() - interval '20 minutes'
where id = (select (result->>'requestId')::uuid from ai_stale);

create temporary table ai_after_stale as
select public.reserve_ai_credit(
  (select app_user_id from billing_actor),
  (select personal_workspace_id from billing_actor),
  'a0000000-0000-4000-8000-000000000005'
) as result;

select is(
  (select (result->>'credits')::integer from ai_after_stale),
  8,
  'next reserve refunds the stale reservation before deducting'
);
select ok(
  (select state = 'failed' and settled_at is not null from app_private.ai_requests
    where id = (select (result->>'requestId')::uuid from ai_stale)),
  'stale reservation is closed as failed'
);
select is(
  (select count(*)::integer from app_private.credit_ledger
    where reason = 'ai_refund'
      and ref_id = (select (result->>'requestId')::uuid from ai_stale)),
  1,
  'stale refund is audited against its request'
);
select is(
  (public.settle_ai_request(
    (select app_user_id from billing_actor),
    (select (result->>'requestId')::uuid from ai_after_stale),
    'failed'
  )->>'credits')::integer,
  9,
  'fresh reservation still settles normally'
);
select throws_ok(
  $$select public.reserve_ai_credit(
    (select app_user_id from billing_other),
    (select personal_workspace_id from billing_actor),
    'a0000000-0000-4000-8000-000000000003'
  )$$,
  'P0001', 'PROJECT_NOT_FOUND',
  'non-member cannot reserve credits of another workspace'
);
select throws_ok(
  $$select public.reserve_ai_credit(
    (select app_user_id from billing_other),
    (select personal_workspace_id from billing_other),
    'a0000000-0000-4000-8000-000000000003'
  )$$,
  'P0001', 'AI_CREDITS_EXHAUSTED',
  'free workspace has no credits to reserve'
);
select is(
  (select count(*)::integer from app_private.ai_requests
    where workspace_id = (select personal_workspace_id from billing_other)),
  0,
  'exhausted reserve leaves no request behind'
);

-- Pro: รอบ 30 วัน + เครดิต, license 'pro' ออกให้ตอน export, ต่ออายุต่อจากวันหมดเดิม
create temporary table pro_order as
select public.create_order(
  (select app_user_id from billing_actor),
  (select personal_workspace_id from billing_actor),
  'b0000000-0000-4000-8000-000000000001', 'pro', null
) as result;

select is((select result->>'kind' from pro_order), 'pro', 'pro order has kind pro');
select is((select result->'projectId' from pro_order), 'null'::jsonb, 'pro order has no project');
select is((select (result->>'amountMinor')::integer from pro_order), 39900, 'pro order snapshots the pro price');

create temporary table pro_paid as
select public.fulfil_order(
  (select app_user_id from billing_actor),
  (select (result->>'id')::uuid from pro_order),
  'dev', 'request-3'
) as result;
create temporary table pro_entitlements as
select public.get_entitlements(
  (select app_user_id from billing_actor),
  (select personal_workspace_id from billing_actor)
) as result;

select is((select result->>'status' from pro_paid), 'paid', 'pro order is paid');
select is((select result->>'plan' from pro_entitlements), 'pro', 'paid pro order activates the pro plan');
select ok(
  (select (result->>'proUntil')::timestamptz
      between now() + interval '29 days' and now() + interval '31 days'
    from pro_entitlements),
  'pro period runs 30 days from now'
);
select is((select (result->>'credits')::integer from pro_entitlements), 109, 'pro purchase adds its credits on top');
select is(
  (select count(*)::integer from app_private.subscriptions
    where workspace_id = (select personal_workspace_id from billing_actor)
      and status = 'active'),
  1,
  'pro purchase inserts one active subscription'
);
select is(
  public.authorize_export(
    (select app_user_id from billing_actor),
    (select (result->>'id')::uuid from billing_project_two)
  )->>'source',
  'pro',
  'pro workspace licenses an unlicensed project on export'
);
select is(
  (select source from app_private.design_licenses
    where project_id = (select (result->>'id')::uuid from billing_project_two)),
  'pro',
  'pro export inserts a pro license'
);
select is(
  public.authorize_export(
    (select app_user_id from billing_actor),
    (select (result->>'id')::uuid from billing_project_two)
  )->>'source',
  'pro',
  'repeated pro export reuses the license'
);
select is(
  (select count(*)::integer from app_private.design_licenses
    where workspace_id = (select personal_workspace_id from billing_actor)),
  2,
  'repeated export does not duplicate licenses'
);
select is(
  jsonb_array_length(public.get_entitlements(
    (select app_user_id from billing_actor),
    (select personal_workspace_id from billing_actor)
  )->'licensedProjectIds'),
  2,
  'entitlements list both licensed projects'
);
select throws_ok(
  $$select public.create_order(
    (select app_user_id from billing_actor),
    (select personal_workspace_id from billing_actor),
    'b0000000-0000-4000-8000-000000000002', 'design',
    (select (result->>'id')::uuid from billing_project_two)
  )$$,
  'P0001', 'ALREADY_LICENSED',
  'pro-licensed project cannot be purchased again'
);

create temporary table pro_renewal as
select public.fulfil_order(
  null,
  (public.create_order(
    (select app_user_id from billing_actor),
    (select personal_workspace_id from billing_actor),
    'b0000000-0000-4000-8000-000000000003', 'pro', null
  )->>'id')::uuid,
  'manual', 'slip-1'
) as result;

select is((select result->>'provider' from pro_renewal), 'manual', 'fulfil without an actor (webhook) is accepted');
select is(
  (select count(*)::integer from app_private.subscriptions
    where workspace_id = (select personal_workspace_id from billing_actor)),
  2,
  'renewal adds a second period'
);
select ok(
  (select max(period_end) between now() + interval '59 days' and now() + interval '61 days'
    from app_private.subscriptions
    where workspace_id = (select personal_workspace_id from billing_actor)),
  'renewal extends from the current period end'
);
select ok(
  (select bool_and(period_start >= now()) from app_private.subscriptions
    where workspace_id = (select personal_workspace_id from billing_actor)),
  'renewal period does not overlap the current one'
);
select is(
  (public.get_entitlements(
    (select app_user_id from billing_actor),
    (select personal_workspace_id from billing_actor)
  )->>'credits')::integer,
  209,
  'renewal adds another round of credits'
);

-- order ที่ถูกยกเลิกชำระไม่ได้
create temporary table canceled_order as
select public.create_order(
  (select app_user_id from billing_actor),
  (select personal_workspace_id from billing_actor),
  'b0000000-0000-4000-8000-000000000004', 'pro', null
) as result;
update app_private.orders
set status = 'canceled'
where id = (select (result->>'id')::uuid from canceled_order);
select throws_ok(
  $$select public.fulfil_order(
    (select app_user_id from billing_actor),
    (select (result->>'id')::uuid from canceled_order),
    'dev', 'request-4'
  )$$,
  'P0001', 'ORDER_NOT_PAYABLE',
  'canceled order cannot be fulfilled'
);

-- Pro หมด: แบบที่ได้ license ตอนเป็น Pro ยังดาวน์โหลดได้ แบบใหม่กลับเป็น Freemium
update app_private.subscriptions
set status = 'canceled'
where workspace_id = (select personal_workspace_id from billing_actor);
select is(
  public.get_entitlements(
    (select app_user_id from billing_actor),
    (select personal_workspace_id from billing_actor)
  )->>'plan',
  'free',
  'canceled subscriptions end the pro plan'
);
select is(
  public.authorize_export(
    (select app_user_id from billing_actor),
    (select (result->>'id')::uuid from billing_project_two)
  )->>'source',
  'pro',
  'pro license survives the end of the subscription'
);
select throws_ok(
  $$select public.authorize_export(
    (select app_user_id from billing_actor),
    (select (result->>'id')::uuid from billing_project_three)
  )$$,
  'P0001', 'EXPORT_PAYMENT_REQUIRED',
  'new project needs payment after pro ends'
);
select is(
  (public.get_entitlements(
    (select app_user_id from billing_actor),
    (select personal_workspace_id from billing_actor)
  )->>'credits')::integer,
  209,
  'credits do not expire with the pro plan'
);

-- license ของ project ที่ลบแล้วไม่โชว์ใน licensedProjectIds (แถวยังอยู่)
create temporary table deleted_two as
select public.delete_project(
  (select app_user_id from billing_actor),
  (select (result->>'id')::uuid from billing_project_two),
  '80000000-0000-4000-8000-000000000009', repeat('d', 64), 1
) as result;
select is(
  public.get_entitlements(
    (select app_user_id from billing_actor),
    (select personal_workspace_id from billing_actor)
  )->'licensedProjectIds',
  jsonb_build_array((select (result->>'id')::uuid from billing_project)),
  'deleted projects drop out of licensedProjectIds'
);
select is(
  (select count(*)::integer from app_private.design_licenses
    where project_id = (select (result->>'id')::uuid from billing_project_two)),
  1,
  'license row is kept for the soft-deleted project'
);
select throws_ok(
  $$select public.authorize_export(
    (select app_user_id from billing_actor),
    (select (result->>'id')::uuid from billing_project_two)
  )$$,
  'P0001', 'PROJECT_NOT_FOUND',
  'deleted project cannot be exported'
);

select * from finish();
rollback;
