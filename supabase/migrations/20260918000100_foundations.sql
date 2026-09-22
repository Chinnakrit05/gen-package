-- P0.3 foundation: business data is private and can only be reached through
-- explicitly granted server-side RPCs. Phase 1 migrations add the tables.

create extension if not exists pgtap with schema extensions;

create schema if not exists app_private;
comment on schema app_private is
  'PackIt business data. Not exposed through the browser Data API.';

revoke create on schema public from public;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to service_role;

-- Existing and future private objects are inaccessible to browser roles.
revoke all on all tables in schema app_private from public, anon, authenticated;
revoke all on all sequences in schema app_private from public, anon, authenticated;
revoke all on all functions in schema app_private from public, anon, authenticated;

-- PostgreSQL grants EXECUTE on functions to PUBLIC as a global default. A
-- schema-scoped default ACL can add privileges but cannot subtract that global
-- grant, so revoke it at role scope before adding server-only grants below.
alter default privileges for role postgres
  revoke execute on functions from public, anon, authenticated;

alter default privileges for role postgres in schema app_private
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema app_private
  grant select, insert, update, delete on tables to service_role;

alter default privileges for role postgres in schema app_private
  revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema app_private
  grant usage, select on sequences to service_role;

alter default privileges for role postgres in schema app_private
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema app_private
  grant execute on functions to service_role;

-- Public is reserved for narrow RPC wrappers. Remove Supabase's automatic
-- table/sequence/function grants so every client-facing object is opt-in.
revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public
  grant execute on functions to service_role;
