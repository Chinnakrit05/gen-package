create table app_private.app_users (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  email text,
  status text not null default 'active',
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint app_users_display_name_length
    check (char_length(btrim(display_name)) between 1 and 100),
  constraint app_users_email_length
    check (email is null or char_length(email) between 3 and 320),
  constraint app_users_status
    check (status in ('active', 'suspended', 'deleted'))
);

create table app_private.auth_identities (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null references app_private.app_users(id) on delete restrict,
  provider text not null,
  issuer text not null,
  subject text not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint auth_identities_provider_length
    check (char_length(provider) between 1 and 40),
  constraint auth_identities_issuer_length
    check (char_length(issuer) between 1 and 255),
  constraint auth_identities_subject_length
    check (char_length(subject) between 1 and 255),
  constraint auth_identities_issuer_subject_unique unique (issuer, subject)
);

create index auth_identities_app_user_id_idx
  on app_private.auth_identities (app_user_id);

create table app_private.workspaces (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  owner_user_id uuid not null references app_private.app_users(id) on delete restrict,
  name text not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint workspaces_kind check (kind in ('personal', 'team')),
  constraint workspaces_name_length check (char_length(btrim(name)) between 1 and 100)
);

create unique index workspaces_one_personal_per_owner_idx
  on app_private.workspaces (owner_user_id)
  where kind = 'personal';

create table app_private.workspace_members (
  workspace_id uuid not null references app_private.workspaces(id) on delete restrict,
  user_id uuid not null references app_private.app_users(id) on delete restrict,
  role text not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (workspace_id, user_id),
  constraint workspace_members_role check (role in ('owner', 'editor', 'viewer'))
);

create index workspace_members_user_workspace_idx
  on app_private.workspace_members (user_id, workspace_id);

alter table app_private.app_users enable row level security;
alter table app_private.auth_identities enable row level security;
alter table app_private.workspaces enable row level security;
alter table app_private.workspace_members enable row level security;

revoke all on table
  app_private.app_users,
  app_private.auth_identities,
  app_private.workspaces,
  app_private.workspace_members
from public, anon, authenticated;

grant select, insert, update, delete on table
  app_private.app_users,
  app_private.auth_identities,
  app_private.workspaces,
  app_private.workspace_members
to service_role;

create function app_private.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create trigger app_users_touch_updated_at
before update on app_private.app_users
for each row execute function app_private.touch_updated_at();

create function public.bootstrap_personal_workspace(
  p_identity_issuer text,
  p_identity_subject text,
  p_display_name text default null,
  p_email text default null
)
returns table (
  app_user_id uuid,
  personal_workspace_id uuid,
  profile_display_name text,
  profile_email text,
  user_status text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_workspace_id uuid;
  v_display_name text;
  v_email text;
  v_status text;
  v_requested_display_name text;
  v_requested_email text;
begin
  p_identity_issuer := btrim(p_identity_issuer);
  p_identity_subject := btrim(p_identity_subject);
  v_requested_display_name := coalesce(nullif(btrim(p_display_name), ''), 'ผู้ใช้ PackIt');
  v_requested_email := nullif(btrim(p_email), '');

  if char_length(p_identity_issuer) not between 1 and 255 then
    raise exception using errcode = '22023', message = 'IDENTITY_ISSUER_INVALID';
  end if;
  if char_length(p_identity_subject) not between 1 and 255 then
    raise exception using errcode = '22023', message = 'IDENTITY_SUBJECT_INVALID';
  end if;
  if char_length(v_requested_display_name) not between 1 and 100 then
    raise exception using errcode = '22023', message = 'DISPLAY_NAME_INVALID';
  end if;
  if v_requested_email is not null and char_length(v_requested_email) not between 3 and 320 then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID';
  end if;

  -- Serialize bootstrap for one verified external identity. The unique
  -- constraint remains the final invariant; the lock prevents orphan rows.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_identity_issuer || pg_catalog.chr(31) || p_identity_subject, 0)
  );

  select users.id, users.display_name, users.email, users.status
    into v_user_id, v_display_name, v_email, v_status
  from app_private.auth_identities identities
  join app_private.app_users users on users.id = identities.app_user_id
  where identities.issuer = p_identity_issuer
    and identities.subject = p_identity_subject;

  if v_user_id is null then
    insert into app_private.app_users (display_name, email)
    values (v_requested_display_name, v_requested_email)
    returning id, display_name, email, status
      into v_user_id, v_display_name, v_email, v_status;

    insert into app_private.auth_identities (
      app_user_id, provider, issuer, subject
    ) values (
      v_user_id, 'supabase', p_identity_issuer, p_identity_subject
    );

    insert into app_private.workspaces (kind, owner_user_id, name)
    values ('personal', v_user_id, 'พื้นที่ส่วนตัว')
    returning id into v_workspace_id;

    insert into app_private.workspace_members (workspace_id, user_id, role)
    values (v_workspace_id, v_user_id, 'owner');
  else
    select workspaces.id into v_workspace_id
    from app_private.workspaces workspaces
    where workspaces.owner_user_id = v_user_id
      and workspaces.kind = 'personal';

    if v_workspace_id is null then
      raise exception using errcode = 'P0001', message = 'PERSONAL_WORKSPACE_MISSING';
    end if;
  end if;

  if v_status <> 'active' then
    raise exception using errcode = 'P0001', message = 'APP_USER_NOT_ACTIVE';
  end if;

  return query select
    v_user_id,
    v_workspace_id,
    v_display_name,
    v_email,
    v_status;
end;
$$;

revoke all on function public.bootstrap_personal_workspace(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.bootstrap_personal_workspace(text, text, text, text)
  to service_role;

comment on function public.bootstrap_personal_workspace(text, text, text, text) is
  'Server-only idempotent bootstrap from a verified Supabase identity.';
