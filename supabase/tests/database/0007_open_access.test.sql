begin;

select plan(41);

select has_function('public', 'ensure_open_access', array['uuid', 'uuid'], 'ensure_open_access exists');
select has_function(
  'public', 'authorize_open_access_export', array['uuid', 'uuid'], 'authorize_open_access_export exists'
);
select ok(
  not has_function_privilege('anon', 'public.ensure_open_access(uuid,uuid)', 'EXECUTE'),
  'anon cannot get open access directly'
);
select ok(
  not has_function_privilege('authenticated', 'public.ensure_open_access(uuid,uuid)', 'EXECUTE'),
  'authenticated cannot get open access directly'
);
select ok(
  not has_function_privilege('authenticated', 'public.authorize_open_access_export(uuid,uuid)', 'EXECUTE'),
  'authenticated cannot authorize open access exports directly'
);
select ok(
  not has_function_privilege('authenticated', 'app_private.ensure_complimentary_pro(uuid)', 'EXECUTE'),
  'authenticated cannot start complimentary pro periods'
);
select ok(
  has_function_privilege('service_role', 'public.ensure_open_access(uuid,uuid)', 'EXECUTE'),
  'service role can get open access'
);
select ok(
  has_function_privilege('service_role', 'public.authorize_open_access_export(uuid,uuid)', 'EXECUTE'),
  'service role can authorize open access exports'
);

create temporary table open_actor as
select * from public.bootstrap_personal_workspace(
  'https://open.test/auth/v1', 'open-owner', 'Open owner', 'open-owner@example.test'
);
create temporary table open_other as
select * from public.bootstrap_personal_workspace(
  'https://open.test/auth/v1', 'open-other', 'Open other', 'open-other@example.test'
);
create temporary table open_third as
select * from public.bootstrap_personal_workspace(
  'https://open.test/auth/v1', 'open-third', 'Open third', 'open-third@example.test'
);
create temporary table open_project as
select public.create_project(
  (select app_user_id from open_actor),
  (select personal_workspace_id from open_actor),
  'a0000000-0000-4000-8000-000000000001', repeat('a', 64),
  'Open project', 1, '{"kind":"open"}'::jsonb
) as result;
create temporary table open_project_two as
select public.create_project(
  (select app_user_id from open_actor),
  (select personal_workspace_id from open_actor),
  'a0000000-0000-4000-8000-000000000002', repeat('b', 64),
  'Open project two', 1, '{"kind":"open"}'::jsonb
) as result;
create temporary table third_project as
select public.create_project(
  (select app_user_id from open_third),
  (select personal_workspace_id from open_third),
  'a0000000-0000-4000-8000-000000000003', repeat('c', 64),
  'Third project', 1, '{"kind":"open"}'::jsonb
) as result;

-- ครั้งแรกของ workspace Freemium: ได้รอบ Pro ฟรีตาม catalog (30 วัน) + เครดิตเต็มโควตา ไม่มี order
create temporary table first_grant as
select public.ensure_open_access(
  (select app_user_id from open_actor),
  (select personal_workspace_id from open_actor)
) as result;

select is((select result->>'plan' from first_grant), 'pro', 'open access puts a free workspace on pro');
select is((select (result->>'credits')::integer from first_grant), 100, 'open access tops credits up to the pro allowance');
select ok((select result->>'proUntil' from first_grant) is not null, 'open access reports when the period ends');
select is(
  (select count(*)::integer from app_private.subscriptions
    where workspace_id = (select personal_workspace_id from open_actor) and order_id is null),
  1,
  'complimentary period is a subscription without an order'
);
select is(
  (select period_end - period_start from app_private.subscriptions
    where workspace_id = (select personal_workspace_id from open_actor)),
  interval '30 days',
  'complimentary period lasts the pro period'
);
select is(
  (select count(*)::integer from app_private.credit_ledger ledger
    join app_private.subscriptions subscriptions on subscriptions.id = ledger.ref_id
    where ledger.workspace_id = (select personal_workspace_id from open_actor)
      and ledger.reason = 'pro_period'
      and ledger.delta = 100),
  1,
  'ledger records the period credits against the complimentary period'
);
select is(
  (select count(*)::integer from app_private.orders
    where workspace_id = (select personal_workspace_id from open_actor)),
  0,
  'open access creates no orders'
);

-- เรียกซ้ำระหว่างรอบ: ไม่สร้างรอบหรือเครดิตเพิ่ม
select is(
  (public.ensure_open_access(
    (select app_user_id from open_actor),
    (select personal_workspace_id from open_actor)
  )->>'credits')::integer,
  100,
  'second call within the period keeps the credits'
);
select is(
  (select count(*)::integer from app_private.subscriptions
    where workspace_id = (select personal_workspace_id from open_actor)),
  1,
  'second call within the period adds no period'
);
select is(
  (select count(*)::integer from app_private.credit_ledger
    where workspace_id = (select personal_workspace_id from open_actor)),
  1,
  'second call within the period adds no ledger rows'
);

-- เครดิตของรอบฟรีหักเหมือนเครดิต Pro และไม่ถูกเติมกลางรอบ
create temporary table open_spent as
select public.reserve_ai_credit(
  (select app_user_id from open_actor),
  (select personal_workspace_id from open_actor),
  'b0000000-0000-4000-8000-000000000001'
) as result;

select is((select (result->>'credits')::integer from open_spent), 99, 'open access credits are spent like pro credits');
select is(
  (public.ensure_open_access(
    (select app_user_id from open_actor),
    (select personal_workspace_id from open_actor)
  )->>'credits')::integer,
  99,
  'credits are not topped up mid-period'
);

-- หมดรอบ: รอบใหม่ + เติมเฉพาะส่วนที่ขาดให้ถึงโควตา (ไม่บวกสะสม)
update app_private.subscriptions
set period_start = now() - interval '31 days',
    period_end = now() - interval '1 day'
where workspace_id = (select personal_workspace_id from open_actor);

select is(
  (public.ensure_open_access(
    (select app_user_id from open_actor),
    (select personal_workspace_id from open_actor)
  )->>'credits')::integer,
  100,
  'a new period tops credits back up to the allowance'
);
select is(
  (select count(*)::integer from app_private.subscriptions
    where workspace_id = (select personal_workspace_id from open_actor) and order_id is null),
  2,
  'a lapsed period renews with a new complimentary period'
);
select is(
  (select delta from app_private.credit_ledger
    where ref_id = (
      select id from app_private.subscriptions
      where workspace_id = (select personal_workspace_id from open_actor) and period_end > now()
    )),
  1,
  'the top-up records only the missing credits'
);

-- ยอดเกินโควตาอยู่แล้ว: รอบใหม่ไม่ลดและไม่เติม
update app_private.credit_balances
set balance = 150
where workspace_id = (select personal_workspace_id from open_actor);
update app_private.subscriptions
set period_start = now() - interval '31 days',
    period_end = now() - interval '1 day'
where workspace_id = (select personal_workspace_id from open_actor)
  and period_end > now();

select is(
  (public.ensure_open_access(
    (select app_user_id from open_actor),
    (select personal_workspace_id from open_actor)
  )->>'credits')::integer,
  150,
  'a balance above the allowance is left alone'
);
select is(
  (select count(*)::integer from app_private.credit_ledger
    where workspace_id = (select personal_workspace_id from open_actor) and reason = 'pro_period'),
  2,
  'nothing to top up writes no ledger row'
);

-- ดาวน์โหลดตอน open access: ได้สิทธิ์จากรอบ Pro ฟรีโดยไม่ออก license ถาวร
create temporary table open_export as
select public.authorize_open_access_export(
  (select app_user_id from open_actor),
  (select (result->>'id')::uuid from open_project)
) as result;

select is((select result->>'source' from open_export), 'pro', 'open access export comes from the pro period');
select is(
  (select result->>'projectId' from open_export),
  (select result->>'id' from open_project),
  'open access export echoes the project'
);
select is((select result->'entitlements'->>'plan' from open_export), 'pro', 'open access export returns pro entitlements');
select is(
  (select result->'entitlements'->'licensedProjectIds' from open_export),
  '[]'::jsonb,
  'open access export leaves licensedProjectIds empty'
);
select is((select count(*)::integer from app_private.design_licenses), 0, 'open access export grants no lasting license');

-- license ที่มีอยู่แล้วรายงานตามจริง
insert into app_private.design_licenses (project_id, workspace_id, source, granted_by)
values (
  (select (result->>'id')::uuid from open_project),
  (select personal_workspace_id from open_actor),
  'admin',
  (select app_user_id from open_actor)
);

select is(
  public.authorize_open_access_export(
    (select app_user_id from open_actor),
    (select (result->>'id')::uuid from open_project)
  )->>'source',
  'admin',
  'an existing license keeps its source'
);

-- ผู้ที่ไม่ใช่สมาชิก/โปรเจกต์ที่ไม่มีหรือถูกลบ = ไม่พบ (ไม่บอกว่ามีอยู่)
select throws_ok(
  $$select public.ensure_open_access(
    (select app_user_id from open_other),
    (select personal_workspace_id from open_actor)
  )$$,
  'P0001', 'PROJECT_NOT_FOUND',
  'non-member cannot get open access for another workspace'
);
select throws_ok(
  $$select public.authorize_open_access_export(
    (select app_user_id from open_other),
    (select (result->>'id')::uuid from open_project)
  )$$,
  'P0001', 'PROJECT_NOT_FOUND',
  'non-member cannot export another workspace project under open access'
);
select throws_ok(
  $$select public.authorize_open_access_export(
    (select app_user_id from open_actor),
    'a0000000-0000-4000-8000-0000000000ff'
  )$$,
  'P0001', 'PROJECT_NOT_FOUND',
  'unknown project cannot be exported under open access'
);

create temporary table open_deleted as
select public.delete_project(
  (select app_user_id from open_actor),
  (select (result->>'id')::uuid from open_project_two),
  'a0000000-0000-4000-8000-000000000009', repeat('d', 64), 1
) as result;

select throws_ok(
  $$select public.authorize_open_access_export(
    (select app_user_id from open_actor),
    (select (result->>'id')::uuid from open_project_two)
  )$$,
  'P0001', 'PROJECT_NOT_FOUND',
  'deleted project cannot be exported under open access'
);
select is(
  (select count(*)::integer from app_private.subscriptions
    where workspace_id = (select personal_workspace_id from open_actor)),
  3,
  'refused calls start no period'
);

-- ดาวน์โหลดก่อนเคยโหลดสิทธิ์: export เริ่มรอบ Pro ฟรีให้เอง
create temporary table third_export as
select public.authorize_open_access_export(
  (select app_user_id from open_third),
  (select (result->>'id')::uuid from third_project)
) as result;

select is(
  (select result->'entitlements'->>'plan' from third_export),
  'pro',
  'export starts the complimentary period when it is missing'
);
select is(
  (select (result->'entitlements'->>'credits')::integer from third_export),
  100,
  'export-started period carries the allowance'
);

-- Pro ที่จ่ายเงินอยู่แล้ว: ไม่ซ้อนรอบฟรีและไม่เติมเครดิตซ้ำ
create temporary table other_order as
select public.create_order(
  (select app_user_id from open_other),
  (select personal_workspace_id from open_other),
  'c0000000-0000-4000-8000-000000000001', 'pro', null
) as result;
create temporary table other_paid as
select public.fulfil_order(
  (select app_user_id from open_other),
  (select (result->>'id')::uuid from other_order),
  'dev', 'request-open'
) as result;
create temporary table other_open as
select public.ensure_open_access(
  (select app_user_id from open_other),
  (select personal_workspace_id from open_other)
) as result;

select is(
  (select count(*)::integer from app_private.subscriptions
    where workspace_id = (select personal_workspace_id from open_other) and order_id is null),
  0,
  'an active paid pro gets no complimentary period'
);
select is((select (result->>'credits')::integer from other_open), 100, 'paid pro keeps the credits from its order');
select is((select result->>'plan' from other_open), 'pro', 'paid pro stays pro under open access');

select * from finish();
rollback;
