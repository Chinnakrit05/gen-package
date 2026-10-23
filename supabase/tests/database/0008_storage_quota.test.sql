begin;

select plan(38);

select has_table('app_private', 'storage_quotas', 'storage quota table exists');
select has_column('app_private', 'projects', 'document_bytes', 'projects keep their document size');
select has_function(
  'public', 'check_storage_quota',
  array['uuid', 'uuid', 'uuid', 'uuid', 'jsonb', 'bigint', 'boolean'],
  'check_storage_quota exists'
);
select ok(
  not has_function_privilege('anon', 'public.check_storage_quota(uuid,uuid,uuid,uuid,jsonb,bigint,boolean)', 'EXECUTE'),
  'anon cannot check storage directly'
);
select ok(
  not has_function_privilege(
    'authenticated', 'public.check_storage_quota(uuid,uuid,uuid,uuid,jsonb,bigint,boolean)', 'EXECUTE'
  ),
  'authenticated cannot check storage directly'
);
select ok(
  not has_function_privilege('authenticated', 'app_private.workspace_storage_bytes(uuid,uuid,jsonb)', 'EXECUTE'),
  'authenticated cannot read workspace usage'
);
select ok(
  has_function_privilege('service_role', 'public.check_storage_quota(uuid,uuid,uuid,uuid,jsonb,bigint,boolean)', 'EXECUTE'),
  'service role can check storage'
);
select is(
  (select quota_bytes from app_private.storage_quotas where plan = 'free'),
  20971520::bigint,
  'freemium stores 20 MB of work'
);
select is(
  (select quota_bytes from app_private.storage_quotas where plan = 'pro'),
  1073741824::bigint,
  'pro stores 1 GB of work'
);

create temporary table quota_actor as
select * from public.bootstrap_personal_workspace(
  'https://quota.test/auth/v1', 'quota-owner', 'Quota owner', 'quota-owner@example.test'
);
create temporary table quota_other as
select * from public.bootstrap_personal_workspace(
  'https://quota.test/auth/v1', 'quota-other', 'Quota other', 'quota-other@example.test'
);

-- รูป ready สองรูปของ workspace (ใส่ตรงในสถานะ ready — ขั้นอัปโหลดจริงตรวจใน 0004_assets)
insert into app_private.assets (
  id, workspace_id, created_by, purpose, state, staging_key, object_key,
  declared_mime, declared_size, mime_type, byte_size, sha256, width, height, ticket_expires_at
)
select images.id, actor.personal_workspace_id, actor.app_user_id, 'project-decoration', 'ready',
  'staging/quota/' || images.id::text, 'assets/quota/' || images.id::text || '.png',
  'image/png', images.bytes, 'image/png', images.bytes, repeat('a', 64), 10, 10,
  statement_timestamp() + interval '1 hour'
from quota_actor actor
cross join (values
  ('c0000000-0000-4000-8000-000000000001'::uuid, 4000::bigint),
  ('c0000000-0000-4000-8000-000000000002'::uuid, 600::bigint)
) as images(id, bytes);

create temporary table project_a as
select public.create_project(
  (select app_user_id from quota_actor),
  (select personal_workspace_id from quota_actor),
  'c1000000-0000-4000-8000-000000000001', repeat('a', 64),
  'Quota A', 1,
  '{"decos":[{"type":"image","assetId":"c0000000-0000-4000-8000-000000000001"}]}'::jsonb
) as result;
create temporary table project_b as
select public.create_project(
  (select app_user_id from quota_actor),
  (select personal_workspace_id from quota_actor),
  'c1000000-0000-4000-8000-000000000002', repeat('b', 64),
  'Quota B', 1,
  '{"fillImage":{"assetId":"c0000000-0000-4000-8000-000000000002"},"decos":[{"type":"image","assetId":"c0000000-0000-4000-8000-000000000001"}]}'::jsonb
) as result;

select is(
  (select document_bytes from app_private.projects where id = (select (result->>'id')::uuid from project_a)),
  octet_length('{"decos":[{"type":"image","assetId":"c0000000-0000-4000-8000-000000000001"}]}'::jsonb::text)::bigint,
  'creating work stores the document size'
);
select is(
  app_private.workspace_storage_bytes((select personal_workspace_id from quota_actor)),
  (select sum(document_bytes)::bigint from app_private.projects
    where workspace_id = (select personal_workspace_id from quota_actor) and deleted_at is null) + 4600,
  'usage = live documents + referenced images, an image used twice counted once'
);

select public.save_project(
  (select app_user_id from quota_actor),
  (select (result->>'id')::uuid from project_b),
  'c1000000-0000-4000-8000-000000000003', repeat('c', 64),
  1, 'Quota B', 1, '{"decos":[]}'::jsonb
);
select is(
  (select document_bytes from app_private.projects where id = (select (result->>'id')::uuid from project_b)),
  octet_length('{"decos":[]}'::jsonb::text)::bigint,
  'saving work updates the stored document size'
);
select is(
  app_private.workspace_storage_bytes((select personal_workspace_id from quota_actor)),
  (select sum(document_bytes)::bigint from app_private.projects
    where workspace_id = (select personal_workspace_id from quota_actor) and deleted_at is null) + 4000,
  'an image no saved work references stops counting'
);
select is(
  app_private.workspace_storage_bytes(
    (select personal_workspace_id from quota_actor),
    (select (result->>'id')::uuid from project_a),
    '{"decos":[]}'::jsonb
  ),
  (select document_bytes from app_private.projects where id = (select (result->>'id')::uuid from project_b))
    + octet_length('{"decos":[]}'::jsonb::text),
  'projected usage replaces the saved project''s document and images'
);
select is(
  app_private.workspace_storage_bytes(
    (select personal_workspace_id from quota_actor),
    null,
    '{"fillImage":{"assetId":"c0000000-0000-4000-8000-000000000002"}}'::jsonb
  ),
  app_private.workspace_storage_bytes((select personal_workspace_id from quota_actor))
    + octet_length('{"fillImage":{"assetId":"c0000000-0000-4000-8000-000000000002"}}'::jsonb::text) + 600,
  'projected usage of new work adds its document and images not counted yet'
);

-- Freemium: งานเล็กผ่าน และรายงานแพ็กเกจ/เพดาน/ที่ใช้
create temporary table small_check as
select public.check_storage_quota(
  (select app_user_id from quota_actor),
  (select personal_workspace_id from quota_actor),
  null, 'c2000000-0000-4000-8000-000000000001', '{"decos":[]}'::jsonb, 0, false
) as result;
select is((select result->>'ok' from small_check), 'true', 'small new work fits the free quota');
select is((select result->>'plan' from small_check), 'free', 'a workspace without pro uses the free quota');
select is((select (result->>'limitBytes')::bigint from small_check), 20971520::bigint, 'the free limit is reported');
select is(
  (select (result->>'usedBytes')::bigint from small_check),
  app_private.workspace_storage_bytes((select personal_workspace_id from quota_actor)),
  'current usage is reported'
);

-- เหลือที่ว่าง 50 ไบต์: งาน/รูปที่ล้นไม่ผ่าน รูปที่พอดีผ่าน
update app_private.storage_quotas
set quota_bytes = app_private.workspace_storage_bytes((select personal_workspace_id from quota_actor)) + 50
where plan = 'free';
select is(
  public.check_storage_quota(
    (select app_user_id from quota_actor),
    (select personal_workspace_id from quota_actor),
    null, 'c2000000-0000-4000-8000-000000000002', jsonb_build_object('note', repeat('x', 200)), 0, false
  )->>'ok',
  'false',
  'new work that would exceed the quota is refused'
);
select is(
  public.check_storage_quota(
    (select app_user_id from quota_actor),
    (select personal_workspace_id from quota_actor),
    null, 'c2000000-0000-4000-8000-000000000003', null, 51, false
  )->>'ok',
  'false',
  'an upload larger than the space left is refused'
);
select is(
  public.check_storage_quota(
    (select app_user_id from quota_actor),
    (select personal_workspace_id from quota_actor),
    null, 'c2000000-0000-4000-8000-000000000004', null, 50, false
  )->>'ok',
  'true',
  'an upload that fits the space left passes'
);

-- เกินโควตาอยู่แล้ว (เช่น Pro หมดอายุ): บันทึกที่เท่าเดิม/เล็กลงยังผ่าน บันทึกที่ใหญ่ขึ้นไม่ผ่าน
update app_private.storage_quotas set quota_bytes = 1 where plan = 'free';
select is(
  public.check_storage_quota(
    (select app_user_id from quota_actor), null,
    (select (result->>'id')::uuid from project_a),
    'c2000000-0000-4000-8000-000000000005',
    (select document from app_private.projects where id = (select (result->>'id')::uuid from project_a)),
    0, false
  )->>'ok',
  'true',
  'saving the same document passes over the quota'
);
select is(
  public.check_storage_quota(
    (select app_user_id from quota_actor), null,
    (select (result->>'id')::uuid from project_a),
    'c2000000-0000-4000-8000-000000000006', '{}'::jsonb, 0, false
  )->>'ok',
  'true',
  'a save that shrinks the work passes over the quota'
);
select is(
  public.check_storage_quota(
    (select app_user_id from quota_actor), null,
    (select (result->>'id')::uuid from project_a),
    'c2000000-0000-4000-8000-000000000007',
    jsonb_build_object(
      'decos', '[{"type":"image","assetId":"c0000000-0000-4000-8000-000000000001"}]'::jsonb,
      'note', repeat('x', 500)
    ),
    0, false
  )->>'ok',
  'false',
  'a save that grows the work is refused over the quota'
);
-- เอกสารใหม่ที่ใหญ่ขึ้นแต่เลิกใช้รูป 4000 ไบต์ = ผลรวมลดลง จึงผ่าน
select is(
  public.check_storage_quota(
    (select app_user_id from quota_actor), null,
    (select (result->>'id')::uuid from project_a),
    'c2000000-0000-4000-8000-00000000000e', jsonb_build_object('note', repeat('x', 500)), 0, false
  )->>'ok',
  'true',
  'dropping an image counts toward the save shrinking the work'
);

-- operation ที่เคยสำเร็จแล้ว (client ส่ง create ของงาน A ซ้ำ) ผ่านเสมอและไม่นับซ้ำ
create temporary table replay_check as
select public.check_storage_quota(
  (select app_user_id from quota_actor),
  (select personal_workspace_id from quota_actor),
  null, 'c1000000-0000-4000-8000-000000000001',
  '{"decos":[{"type":"image","assetId":"c0000000-0000-4000-8000-000000000001"}]}'::jsonb, 0, false
) as result;
select is((select result->>'ok' from replay_check), 'true', 'a replayed operation passes');
select is(
  (select (result->>'projectedBytes')::bigint from replay_check),
  (select (result->>'usedBytes')::bigint from replay_check),
  'a replayed operation adds nothing'
);

-- Pro ที่ใช้งานอยู่ใช้โควตา Pro
insert into app_private.subscriptions (workspace_id, period_start, period_end)
values (
  (select personal_workspace_id from quota_actor),
  statement_timestamp() - interval '1 day',
  statement_timestamp() + interval '29 days'
);
create temporary table pro_check as
select public.check_storage_quota(
  (select app_user_id from quota_actor),
  (select personal_workspace_id from quota_actor),
  null, 'c2000000-0000-4000-8000-000000000008', jsonb_build_object('note', repeat('x', 500)), 0, false
) as result;
select is((select result->>'plan' from pro_check), 'pro', 'an active pro period uses the pro quota');
select is((select (result->>'limitBytes')::bigint from pro_check), 1073741824::bigint, 'the pro limit is reported');
select is((select result->>'ok' from pro_check), 'true', 'work refused on freemium fits pro');

-- open access: เปิดรอบ Pro ฟรีก่อนคิดแพ็กเกจ (workspace ที่ยังไม่เคยได้รอบ)
select is(
  public.check_storage_quota(
    (select app_user_id from quota_other),
    (select personal_workspace_id from quota_other),
    null, 'c2000000-0000-4000-8000-000000000009', '{}'::jsonb, 0, true
  )->>'plan',
  'pro',
  'open access starts the complimentary pro period before choosing the quota'
);
select is(
  (select count(*)::integer from app_private.subscriptions
    where workspace_id = (select personal_workspace_id from quota_other) and order_id is null),
  1,
  'the open access check creates one complimentary period'
);

select throws_ok(
  $$select public.check_storage_quota(
    (select app_user_id from quota_other),
    (select personal_workspace_id from quota_actor),
    null, 'c2000000-0000-4000-8000-00000000000a', '{}'::jsonb, 0, false
  )$$,
  'P0001', 'PROJECT_NOT_FOUND',
  'a non-member cannot check another workspace'
);
select throws_ok(
  $$select public.check_storage_quota(
    (select app_user_id from quota_other), null,
    (select (result->>'id')::uuid from project_a),
    'c2000000-0000-4000-8000-00000000000b', '{}'::jsonb, 0, false
  )$$,
  'P0001', 'PROJECT_NOT_FOUND',
  'a non-member cannot check a project of another workspace'
);
select throws_ok(
  $$select public.check_storage_quota(
    (select app_user_id from quota_actor),
    (select personal_workspace_id from quota_actor),
    null, 'c2000000-0000-4000-8000-00000000000c', null, -1, false
  )$$,
  '22023', 'STORAGE_EXTRA_BYTES_INVALID',
  'a negative upload size is rejected'
);

-- ลบงานแล้วพื้นที่คืนทันที (เอกสาร + รูปที่ไม่มีงานอื่นอ้าง)
select public.delete_project(
  (select app_user_id from quota_actor),
  (select (result->>'id')::uuid from project_a),
  'c1000000-0000-4000-8000-000000000004', repeat('d', 64), 1
);
select is(
  app_private.workspace_storage_bytes((select personal_workspace_id from quota_actor)),
  (select document_bytes from app_private.projects where id = (select (result->>'id')::uuid from project_b)),
  'deleting work frees its document and images'
);
select throws_ok(
  $$select public.check_storage_quota(
    (select app_user_id from quota_actor), null,
    (select (result->>'id')::uuid from project_a),
    'c2000000-0000-4000-8000-00000000000d', '{}'::jsonb, 0, false
  )$$,
  'P0001', 'PROJECT_NOT_FOUND',
  'deleted work cannot be checked for saving'
);

select * from finish();
rollback;
