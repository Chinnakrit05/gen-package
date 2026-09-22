begin;

select plan(16);

select has_schema('app_private', 'app_private schema exists');
select ok(
  not has_schema_privilege('anon', 'app_private', 'USAGE'),
  'anon cannot use app_private'
);
select ok(
  not has_schema_privilege('authenticated', 'app_private', 'USAGE'),
  'authenticated cannot use app_private'
);
select ok(
  has_schema_privilege('service_role', 'app_private', 'USAGE'),
  'service_role can use app_private'
);
select ok(
  not has_schema_privilege('anon', 'public', 'CREATE'),
  'anon cannot create objects in public schema through PUBLIC privileges'
);

-- Probe default ACLs inside a transaction so future migrations inherit the
-- intended API-only boundary without leaving test objects behind. The pgTAP
-- runner connects as supabase_admin; migrations create objects as postgres.
set local role postgres;

create table app_private._default_acl_probe (
  id bigint generated always as identity primary key,
  value text not null
);

select ok(
  not has_table_privilege('anon', 'app_private._default_acl_probe', 'SELECT'),
  'anon receives no private table privileges by default'
);
select ok(
  not has_table_privilege('authenticated', 'app_private._default_acl_probe', 'INSERT'),
  'authenticated receives no private table privileges by default'
);
select ok(
  has_table_privilege('service_role', 'app_private._default_acl_probe', 'SELECT'),
  'service_role receives private table read privilege'
);
select ok(
  has_table_privilege('service_role', 'app_private._default_acl_probe', 'INSERT'),
  'service_role receives private table write privilege'
);

create table public._default_table_acl_probe (
  id bigint generated always as identity primary key,
  value text not null
);

select ok(
  not has_table_privilege('anon', 'public._default_table_acl_probe', 'SELECT'),
  'anon receives no public table read privilege by default'
);
select ok(
  not has_table_privilege('authenticated', 'public._default_table_acl_probe', 'INSERT'),
  'authenticated receives no public table write privilege by default'
);
select ok(
  has_table_privilege('service_role', 'public._default_table_acl_probe', 'SELECT'),
  'service_role receives public table read privilege'
);
select ok(
  has_table_privilege('service_role', 'public._default_table_acl_probe', 'INSERT'),
  'service_role receives public table write privilege'
);

create function public._default_acl_probe()
returns integer
language sql
immutable
as $$ select 1 $$;

select ok(
  not has_function_privilege('anon', 'public._default_acl_probe()', 'EXECUTE'),
  'anon cannot execute new public RPCs by default'
);
select ok(
  not has_function_privilege('authenticated', 'public._default_acl_probe()', 'EXECUTE'),
  'authenticated cannot execute new public RPCs by default'
);
select ok(
  has_function_privilege('service_role', 'public._default_acl_probe()', 'EXECUTE'),
  'service_role can execute new public RPCs by default'
);

select * from finish();
rollback;
