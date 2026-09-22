begin;

select plan(38);

select has_table('app_private', 'projects', 'projects exists');
select has_table('app_private', 'project_operations', 'project_operations exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'app_private.projects'::regclass),
  'projects has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'app_private.project_operations'::regclass),
  'project operations has RLS enabled'
);
select ok(not has_table_privilege('anon', 'app_private.projects', 'SELECT'), 'anon cannot read projects');
select ok(not has_table_privilege('authenticated', 'app_private.projects', 'SELECT'), 'authenticated cannot read projects');
select ok(
  not has_table_privilege('anon', 'app_private.project_operations', 'SELECT'),
  'anon cannot read project operation receipts'
);
select ok(
  not has_table_privilege('authenticated', 'app_private.project_operations', 'SELECT'),
  'authenticated cannot read project operation receipts'
);
select ok(has_table_privilege('service_role', 'app_private.projects', 'SELECT'), 'service role can read projects');
select ok(
  not has_function_privilege('anon', 'public.resolve_app_actor(text,text)', 'EXECUTE'),
  'anon cannot resolve internal actors'
);
select ok(
  not has_function_privilege('authenticated', 'public.get_me(uuid)', 'EXECUTE'),
  'authenticated cannot call get_me directly'
);
select ok(
  not has_function_privilege('anon', 'public.create_project(uuid,uuid,uuid,text,text,integer,jsonb)', 'EXECUTE'),
  'anon cannot create projects'
);
select ok(
  not has_function_privilege('authenticated', 'public.save_project(uuid,uuid,uuid,text,bigint,text,integer,jsonb)', 'EXECUTE'),
  'authenticated cannot save projects'
);
select ok(
  has_function_privilege('service_role', 'public.create_project(uuid,uuid,uuid,text,text,integer,jsonb)', 'EXECUTE'),
  'service role can create projects'
);
select ok(
  has_function_privilege('service_role', 'public.list_projects(uuid,uuid,timestamptz,uuid,integer)', 'EXECUTE'),
  'service role can list projects'
);
select ok(
  has_function_privilege('service_role', 'public.get_me(uuid)', 'EXECUTE'),
  'service role can load the current profile'
);

create temporary table project_actor as
select * from public.bootstrap_personal_workspace(
  'https://projects.test/auth/v1', 'owner-subject', 'Project owner', 'owner@example.test'
);
create temporary table other_actor as
select * from public.bootstrap_personal_workspace(
  'https://projects.test/auth/v1', 'other-subject', 'Other user', 'other@example.test'
);

create temporary table created_project as
select public.create_project(
  (select app_user_id from project_actor),
  (select personal_workspace_id from project_actor),
  '10000000-0000-4000-8000-000000000001',
  repeat('a', 64),
  'Project one',
  1,
  '{"kind":"test"}'::jsonb
) as result;

select is((select (result->>'revision')::bigint from created_project), 1::bigint, 'create starts at revision one');
select is(
  (select count(*)::integer from app_private.projects
    where id = (select (result->>'id')::uuid from created_project)),
  1,
  'create inserts one project'
);
select is(
  (select count(*)::integer from app_private.project_operations
    where operation_id = '10000000-0000-4000-8000-000000000001'),
  1,
  'create stores one durable operation receipt'
);
select is(
  (public.create_project(
    (select app_user_id from project_actor),
    (select personal_workspace_id from project_actor),
    '10000000-0000-4000-8000-000000000001',
    repeat('a', 64),
    'Project one',
    1,
    '{"kind":"test"}'::jsonb
  )->>'id')::uuid,
  (select (result->>'id')::uuid from created_project),
  'create retry returns the original project'
);
select is(
  (select count(*)::integer from app_private.projects
    where workspace_id = (select personal_workspace_id from project_actor)),
  1,
  'create retry does not duplicate the project'
);
select throws_ok(
  $$select public.create_project(
    (select app_user_id from project_actor),
    (select personal_workspace_id from project_actor),
    '10000000-0000-4000-8000-000000000001',
    repeat('b', 64), 'Different', 1, '{"kind":"different"}'::jsonb
  )$$,
  'P0001',
  'IDEMPOTENCY_KEY_REUSED',
  'create rejects reuse of an operation ID with another payload'
);
select is(
  (public.get_project(
    (select app_user_id from project_actor),
    (select (result->>'id')::uuid from created_project)
  )->>'id')::uuid,
  (select (result->>'id')::uuid from created_project),
  'owner can get the project'
);
select throws_ok(
  $$select public.get_project(
    (select app_user_id from other_actor),
    (select (result->>'id')::uuid from created_project)
  )$$,
  'P0001',
  'PROJECT_NOT_FOUND',
  'another workspace cannot read the project'
);
select throws_ok(
  $$select public.save_project(
    (select app_user_id from other_actor),
    (select (result->>'id')::uuid from created_project),
    '10000000-0000-4000-8000-000000000002', repeat('2', 64),
    1, 'Unauthorized save', 1, '{"kind":"unauthorized"}'::jsonb
  )$$,
  'P0001',
  'PROJECT_NOT_FOUND',
  'another workspace cannot save the project'
);
select throws_ok(
  $$select public.delete_project(
    (select app_user_id from other_actor),
    (select (result->>'id')::uuid from created_project),
    '10000000-0000-4000-8000-000000000003', repeat('3', 64), 1
  )$$,
  'P0001',
  'PROJECT_NOT_FOUND',
  'another workspace cannot delete the project'
);
select is(
  (select count(*)::integer from public.list_projects(
    (select app_user_id from project_actor),
    (select personal_workspace_id from project_actor), null, null, 21
  )),
  1,
  'list returns the active project'
);

create temporary table saved_project as
select public.save_project(
  (select app_user_id from project_actor),
  (select (result->>'id')::uuid from created_project),
  '20000000-0000-4000-8000-000000000001',
  repeat('c', 64),
  1,
  'Project saved',
  1,
  '{"kind":"saved"}'::jsonb
) as result;

select is((select (result->>'revision')::bigint from saved_project), 2::bigint, 'save increments the revision');
select is(
  (public.save_project(
    (select app_user_id from project_actor),
    (select (result->>'id')::uuid from created_project),
    '20000000-0000-4000-8000-000000000001', repeat('c', 64),
    1, 'Project saved', 1, '{"kind":"saved"}'::jsonb
  )->>'revision')::bigint,
  2::bigint,
  'save retry returns the original receipt before checking stale revision'
);
select is(
  (select count(*)::integer from app_private.project_operations
    where project_id = (select (result->>'id')::uuid from created_project)),
  2,
  'save retry does not insert another receipt'
);
select throws_ok(
  $$select public.save_project(
    (select app_user_id from project_actor),
    (select (result->>'id')::uuid from created_project),
    '20000000-0000-4000-8000-000000000002', repeat('d', 64),
    1, 'Stale save', 1, '{"kind":"stale"}'::jsonb
  )$$,
  'P0001',
  'REVISION_CONFLICT',
  'stale expected revision conflicts'
);
select throws_ok(
  $$select public.save_project(
    (select app_user_id from project_actor),
    (select (result->>'id')::uuid from created_project),
    '20000000-0000-4000-8000-000000000001', repeat('e', 64),
    2, 'Different payload', 1, '{"kind":"different"}'::jsonb
  )$$,
  'P0001',
  'IDEMPOTENCY_KEY_REUSED',
  'save rejects operation reuse with another payload'
);

delete from app_private.workspace_members
where workspace_id = (select personal_workspace_id from project_actor)
  and user_id = (select app_user_id from project_actor);
select throws_ok(
  $$select public.save_project(
    (select app_user_id from project_actor),
    (select (result->>'id')::uuid from created_project),
    '20000000-0000-4000-8000-000000000001', repeat('c', 64),
    1, 'Project saved', 1, '{"kind":"saved"}'::jsonb
  )$$,
  'P0001',
  'PROJECT_NOT_FOUND',
  'receipt replay is denied after workspace access is removed'
);
insert into app_private.workspace_members (workspace_id, user_id, role)
values (
  (select personal_workspace_id from project_actor),
  (select app_user_id from project_actor),
  'owner'
);

create temporary table deleted_project as
select public.delete_project(
  (select app_user_id from project_actor),
  (select (result->>'id')::uuid from created_project),
  '30000000-0000-4000-8000-000000000001',
  repeat('f', 64),
  2
) as result;

select is((select (result->>'revision')::bigint from deleted_project), 3::bigint, 'delete increments the revision');
select is(
  (public.delete_project(
    (select app_user_id from project_actor),
    (select (result->>'id')::uuid from created_project),
    '30000000-0000-4000-8000-000000000001', repeat('f', 64), 2
  )->>'revision')::bigint,
  3::bigint,
  'delete retry returns the original tombstone receipt'
);
select throws_ok(
  $$select public.get_project(
    (select app_user_id from project_actor),
    (select (result->>'id')::uuid from created_project)
  )$$,
  'P0001',
  'PROJECT_NOT_FOUND',
  'deleted project is no longer readable'
);
select throws_ok(
  $$select public.save_project(
    (select app_user_id from project_actor),
    (select (result->>'id')::uuid from created_project),
    '40000000-0000-4000-8000-000000000001', repeat('1', 64),
    3, 'No resurrection', 1, '{"kind":"resurrect"}'::jsonb
  )$$,
  'P0001',
  'PROJECT_NOT_FOUND',
  'save cannot resurrect a deleted project'
);
select is(
  (select count(*)::integer from public.list_projects(
    (select app_user_id from project_actor),
    (select personal_workspace_id from project_actor), null, null, 21
  )),
  0,
  'list excludes soft-deleted projects'
);

select * from finish();
rollback;
