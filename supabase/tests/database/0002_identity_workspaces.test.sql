begin;

select plan(28);

select has_table('app_private', 'app_users', 'app_users exists');
select has_table('app_private', 'auth_identities', 'auth_identities exists');
select has_table('app_private', 'workspaces', 'workspaces exists');
select has_table('app_private', 'workspace_members', 'workspace_members exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'app_private.app_users'::regclass),
  'app_users has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'app_private.auth_identities'::regclass),
  'auth_identities has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'app_private.workspaces'::regclass),
  'workspaces has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'app_private.workspace_members'::regclass),
  'workspace_members has RLS enabled'
);

select ok(
  not has_table_privilege('anon', 'app_private.app_users', 'SELECT'),
  'anon cannot read app users'
);
select ok(
  not has_table_privilege('authenticated', 'app_private.workspaces', 'SELECT'),
  'authenticated cannot read workspaces directly'
);
select ok(
  has_table_privilege('service_role', 'app_private.workspace_members', 'SELECT'),
  'service_role can read memberships'
);
select ok(
  not has_function_privilege('anon', 'public.bootstrap_personal_workspace(text,text,text,text)', 'EXECUTE'),
  'anon cannot call bootstrap'
);
select ok(
  not has_function_privilege('authenticated', 'public.bootstrap_personal_workspace(text,text,text,text)', 'EXECUTE'),
  'authenticated cannot call bootstrap'
);
select ok(
  has_function_privilege('service_role', 'public.bootstrap_personal_workspace(text,text,text,text)', 'EXECUTE'),
  'service_role can call bootstrap'
);

create temporary table first_bootstrap as
select * from public.bootstrap_personal_workspace(
  'https://test.supabase.local/auth/v1',
  'identity-one',
  'ผู้ใช้ทดสอบ',
  'same@example.test'
);

select is((select count(*)::integer from first_bootstrap), 1, 'bootstrap returns one row');
select is(
  (select count(*)::integer from app_private.app_users where id = (select app_user_id from first_bootstrap)),
  1,
  'bootstrap creates one app user'
);
select is(
  (select count(*)::integer from app_private.auth_identities where app_user_id = (select app_user_id from first_bootstrap)),
  1,
  'bootstrap creates one identity mapping'
);
select is(
  (select count(*)::integer from app_private.workspaces where id = (select personal_workspace_id from first_bootstrap)),
  1,
  'bootstrap creates one personal workspace'
);
select is(
  (select count(*)::integer from app_private.workspace_members where workspace_id = (select personal_workspace_id from first_bootstrap)),
  1,
  'bootstrap creates one membership'
);
select is(
  (select role from app_private.workspace_members where workspace_id = (select personal_workspace_id from first_bootstrap)),
  'owner',
  'personal membership is owner'
);
select is(
  (select owner_user_id from app_private.workspaces where id = (select personal_workspace_id from first_bootstrap)),
  (select app_user_id from first_bootstrap),
  'workspace owner is the bootstrapped user'
);

create temporary table retry_bootstrap as
select * from public.bootstrap_personal_workspace(
  'https://test.supabase.local/auth/v1',
  'identity-one',
  'ชื่อที่ไม่ควรเขียนทับ',
  'different@example.test'
);

select is(
  (select app_user_id from retry_bootstrap),
  (select app_user_id from first_bootstrap),
  'retry returns the same app user'
);
select is(
  (select personal_workspace_id from retry_bootstrap),
  (select personal_workspace_id from first_bootstrap),
  'retry returns the same personal workspace'
);
select is(
  (select display_name from app_private.app_users where id = (select app_user_id from first_bootstrap)),
  'ผู้ใช้ทดสอบ',
  'retry does not overwrite profile metadata'
);

create temporary table second_identity as
select * from public.bootstrap_personal_workspace(
  'https://test.supabase.local/auth/v1',
  'identity-two',
  'ผู้ใช้คนที่สอง',
  'same@example.test'
);

select isnt(
  (select app_user_id from second_identity),
  (select app_user_id from first_bootstrap),
  'matching email does not auto-link identities'
);
select is(
  (select count(*)::integer from app_private.auth_identities where issuer = 'https://test.supabase.local/auth/v1'),
  2,
  'distinct subjects create distinct identity mappings'
);

select throws_ok(
  $$select * from public.bootstrap_personal_workspace('', 'subject', null, null)$$,
  '22023',
  'IDENTITY_ISSUER_INVALID',
  'empty issuer is rejected'
);

update app_private.app_users
set status = 'suspended'
where id = (select app_user_id from first_bootstrap);

select throws_ok(
  $$select * from public.bootstrap_personal_workspace(
    'https://test.supabase.local/auth/v1', 'identity-one', null, null
  )$$,
  'P0001',
  'APP_USER_NOT_ACTIVE',
  'suspended users are rejected'
);

select * from finish();
rollback;
