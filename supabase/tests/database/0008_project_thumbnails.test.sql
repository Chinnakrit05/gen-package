begin;

select plan(16);

select has_table('app_private', 'project_thumbnails', 'project_thumbnails exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'app_private.project_thumbnails'::regclass),
  'project_thumbnails has RLS enabled'
);
select ok(not has_table_privilege('anon', 'app_private.project_thumbnails', 'SELECT'), 'anon cannot read thumbnails');
select ok(
  not has_function_privilege('authenticated', 'public.put_project_thumbnail(uuid,uuid,text,text,text,text)', 'EXECUTE'),
  'authenticated cannot write thumbnails directly'
);
select ok(
  has_function_privilege('service_role', 'public.get_project_thumbnails(uuid,uuid,uuid[])', 'EXECUTE'),
  'service role can read thumbnails'
);

create temporary table thumb_actor as
select * from public.bootstrap_personal_workspace(
  'https://thumbs.test/auth/v1', 'thumb-owner', 'Thumb owner', 'thumb-owner@example.test'
);
create temporary table thumb_other as
select * from public.bootstrap_personal_workspace(
  'https://thumbs.test/auth/v1', 'thumb-other', 'Other user', 'thumb-other@example.test'
);
create temporary table thumb_project as
select (public.create_project(
  (select app_user_id from thumb_actor),
  (select personal_workspace_id from thumb_actor),
  '18000000-0000-4000-8000-000000000001',
  repeat('c', 64),
  'Thumb project',
  1,
  '{"kind":"test"}'::jsonb
)->>'id')::uuid as id;

-- 'UklGRgAAAABXRUJQ' = RIFF....WEBP
create temporary table first_put as
select public.put_project_thumbnail(
  (select app_user_id from thumb_actor),
  (select id from thumb_project),
  'image/webp', 'UklGRgAAAABXRUJQ', 'pouch', 'ถุงตั้งได้'
) as receipt;

select is(
  (select (receipt->>'projectId')::uuid from first_put),
  (select id from thumb_project),
  'owner can store a thumbnail'
);
select is(
  (select octet_length(image) from app_private.project_thumbnails where project_id = (select id from thumb_project)),
  12,
  'thumbnail bytes are decoded from base64'
);

create temporary table second_put as
select public.put_project_thumbnail(
  (select app_user_id from thumb_actor),
  (select id from thumb_project),
  'image/jpeg', '/9j/4AAQ', 'box', 'กล่อง'
) as receipt;
select is(
  (select count(*)::integer from app_private.project_thumbnails where project_id = (select id from thumb_project)),
  1,
  'storing again overwrites the single thumbnail row'
);
select ok(
  (select updated_at > (select (receipt->>'version')::timestamptz from first_put)
    from app_private.project_thumbnails where project_id = (select id from thumb_project)),
  'overwrite advances the version'
);

select is(
  (select kind from public.list_project_thumbnail_meta(
    (select app_user_id from thumb_actor),
    (select personal_workspace_id from thumb_actor),
    array[(select id from thumb_project)]
  )),
  'box',
  'meta returns the latest kind for listed projects'
);
select is(
  (select image_base64 from public.get_project_thumbnails(
    (select app_user_id from thumb_actor),
    (select personal_workspace_id from thumb_actor),
    array[(select id from thumb_project)]
  )),
  '/9j/4AAQ',
  'image round-trips as base64'
);

select throws_ok(
  $$select public.put_project_thumbnail(
    (select app_user_id from thumb_other),
    (select id from thumb_project),
    'image/webp', 'UklGRgAAAABXRUJQ', 'box', 'x'
  )$$,
  'P0001',
  'PROJECT_NOT_FOUND',
  'another workspace cannot overwrite the thumbnail'
);
select throws_ok(
  $$select * from public.get_project_thumbnails(
    (select app_user_id from thumb_other),
    (select personal_workspace_id from thumb_actor),
    array[(select id from thumb_project)]
  )$$,
  'P0001',
  'PROJECT_NOT_FOUND',
  'another user cannot read thumbnails of a workspace they are not in'
);
select is(
  (select count(*)::integer from public.get_project_thumbnails(
    (select app_user_id from thumb_other),
    (select personal_workspace_id from thumb_other),
    array[(select id from thumb_project)]
  )),
  0,
  'asking through your own workspace does not leak another workspace thumbnail'
);
select throws_ok(
  $$select public.put_project_thumbnail(
    (select app_user_id from thumb_actor),
    (select id from thumb_project),
    'image/png', 'iVBORw0KGgo=', 'box', 'x'
  )$$,
  '23514',
  null,
  'only WebP/JPEG thumbnails are accepted'
);

create temporary table thumb_deleted as
select public.delete_project(
  (select app_user_id from thumb_actor),
  (select id from thumb_project),
  '18000000-0000-4000-8000-000000000002',
  repeat('d', 64),
  (select revision from app_private.projects where id = (select id from thumb_project))
) as receipt;
select is(
  (select count(*)::integer from public.get_project_thumbnails(
    (select app_user_id from thumb_actor),
    (select personal_workspace_id from thumb_actor),
    array[(select id from thumb_project)]
  )),
  0,
  'thumbnails of deleted projects are not returned'
);

select * from finish();
rollback;
