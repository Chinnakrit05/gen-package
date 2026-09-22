begin;

select plan(12);

select has_table('app_private', 'legacy_imports', 'legacy import journal exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'app_private.legacy_imports'::regclass),
  'legacy import journal has RLS enabled'
);
select ok(
  not has_table_privilege('authenticated', 'app_private.legacy_imports', 'SELECT'),
  'browser role cannot read the migration journal'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.import_legacy_project(uuid,uuid,uuid,text,uuid,text,text,text,integer,jsonb)',
    'EXECUTE'
  ),
  'browser role cannot call legacy import directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.import_legacy_project(uuid,uuid,uuid,text,uuid,text,text,text,integer,jsonb)',
    'EXECUTE'
  ),
  'service role can call legacy import'
);

create temporary table legacy_actor as
select * from public.bootstrap_personal_workspace(
  'https://legacy.test/auth/v1', 'legacy-owner', 'Legacy owner', 'legacy@example.test'
);
create temporary table legacy_other as
select * from public.bootstrap_personal_workspace(
  'https://legacy.test/auth/v1', 'legacy-other', 'Other owner', 'other@example.test'
);

create temporary table imported_legacy as
select public.import_legacy_project(
  (select app_user_id from legacy_actor),
  (select personal_workspace_id from legacy_actor),
  '10000000-0000-4000-8000-000000000001', repeat('1', 64),
  '20000000-0000-4000-8000-000000000001', 'projects:0', repeat('a', 64),
  'Imported project', 1, '{"decos":[]}'::jsonb
) as result;

select is(
  (select result->>'sourceProjectKey' from imported_legacy),
  'projects:0',
  'import returns the stable source key'
);
select is(
  (select count(*)::integer from app_private.legacy_imports
    where user_id = (select app_user_id from legacy_actor)),
  1,
  'import stores one durable source mapping'
);
select is(
  (select count(*)::integer from app_private.projects
    where workspace_id = (select personal_workspace_id from legacy_actor)),
  1,
  'import creates one project'
);
select is(
  (public.import_legacy_project(
    (select app_user_id from legacy_actor),
    (select personal_workspace_id from legacy_actor),
    '10000000-0000-4000-8000-000000000002', repeat('2', 64),
    '20000000-0000-4000-8000-000000000001', 'projects:0', repeat('a', 64),
    'Ignored retry name', 1, '{"decos":[]}'::jsonb
  )->'project'->>'id')::uuid,
  (select (result->'project'->>'id')::uuid from imported_legacy),
  'retry with another operation ID returns the mapped project'
);
select is(
  (select count(*)::integer from app_private.projects
    where workspace_id = (select personal_workspace_id from legacy_actor)),
  1,
  'source retry does not duplicate the project'
);
select throws_ok(
  $$select public.import_legacy_project(
    (select app_user_id from legacy_actor),
    (select personal_workspace_id from legacy_actor),
    '10000000-0000-4000-8000-000000000003', repeat('3', 64),
    '20000000-0000-4000-8000-000000000001', 'projects:0', repeat('b', 64),
    'Changed source', 1, '{"decos":[]}'::jsonb
  )$$,
  'P0001', 'LEGACY_SOURCE_CHANGED',
  'changed content under the same source key conflicts'
);
select throws_ok(
  $$select public.import_legacy_project(
    (select app_user_id from legacy_other),
    (select personal_workspace_id from legacy_actor),
    '10000000-0000-4000-8000-000000000004', repeat('4', 64),
    '20000000-0000-4000-8000-000000000001', 'projects:0', repeat('a', 64),
    'Unauthorized', 1, '{"decos":[]}'::jsonb
  )$$,
  'P0001', 'PROJECT_NOT_FOUND',
  'another actor cannot import into this workspace'
);

select * from finish();
rollback;
