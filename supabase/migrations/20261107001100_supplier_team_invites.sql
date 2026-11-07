-- Supplier team access is independent of design access for new invitees.
-- Existing Marketplace roles remain linked to their original workspace membership.
alter table app_private.workspace_marketplace_members
  add column requires_workspace_membership boolean not null default true,
  add column workspace_member_user_id uuid generated always as (
    case when requires_workspace_membership then user_id end
  ) stored,
  drop constraint workspace_marketplace_members_workspace_id_user_id_fkey,
  add foreign key (workspace_id) references app_private.workspaces(id) on delete restrict,
  add foreign key (user_id) references app_private.app_users(id) on delete restrict,
  add foreign key (workspace_id, workspace_member_user_id)
    references app_private.workspace_members(workspace_id, user_id) on delete cascade;

create index workspace_marketplace_members_legacy_membership_idx
  on app_private.workspace_marketplace_members (workspace_id, workspace_member_user_id)
  where workspace_member_user_id is not null;

create table app_private.supplier_team_invites (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references app_private.supplier_profiles(id) on delete restrict,
  email text not null check (
    email = lower(btrim(email) collate "C")
    and char_length(email) between 3 and 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  role text not null check (role in ('manager', 'staff', 'viewer')),
  token_hash text not null unique check (token_hash collate "C" ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references app_private.app_users(id) on delete restrict,
  created_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > created_at),
  accepted_by uuid references app_private.app_users(id) on delete restrict,
  accepted_at timestamptz check (accepted_at >= created_at and accepted_at < expires_at),
  revoked_by uuid references app_private.app_users(id) on delete restrict,
  revoked_at timestamptz check (revoked_at >= created_at),
  check ((accepted_at is null) = (accepted_by is null)),
  check ((revoked_at is null) = (revoked_by is null)),
  check (accepted_at is null or revoked_at is null)
);

create unique index supplier_team_invites_pending_email_idx
  on app_private.supplier_team_invites (supplier_id, email) where accepted_at is null and revoked_at is null;

alter table app_private.supplier_team_invites enable row level security;
revoke all on table app_private.supplier_team_invites from public, anon, authenticated, service_role;
grant select, insert on table app_private.supplier_team_invites to service_role;
grant update (accepted_by, accepted_at, revoked_by, revoked_at) on app_private.supplier_team_invites to service_role;

create table app_private.supplier_team_member_removals (
  supplier_id uuid not null references app_private.supplier_profiles(id) on delete cascade,
  user_id uuid not null references app_private.app_users(id) on delete cascade,
  removed_at timestamptz not null,
  primary key (supplier_id, user_id)
);

create index supplier_team_member_removals_user_idx on app_private.supplier_team_member_removals (user_id);

alter table app_private.supplier_team_member_removals enable row level security;
revoke all on table app_private.supplier_team_member_removals from public, anon, authenticated, service_role;
grant select, insert on table app_private.supplier_team_member_removals to service_role;
grant update (removed_at) on table app_private.supplier_team_member_removals to service_role;

create function app_private.marketplace_record_member_removal()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  insert into app_private.supplier_team_member_removals as removal (supplier_id, user_id, removed_at)
  select id, old.user_id, clock_timestamp() from app_private.supplier_profiles where workspace_id = old.workspace_id
  on conflict (supplier_id, user_id) do update set removed_at = greatest(removal.removed_at, excluded.removed_at);
  return old;
end;
$$;

-- Also runs for Marketplace roles removed by the legacy workspace-member cascade.
create trigger workspace_marketplace_members_removal_cutoff
after delete on app_private.workspace_marketplace_members
for each row execute function app_private.marketplace_record_member_removal();

revoke all on function app_private.marketplace_record_member_removal() from public, anon, authenticated;
grant execute on function app_private.marketplace_record_member_removal() to service_role;

create or replace function app_private.marketplace_member_role(
  p_actor_user_id uuid, p_supplier_id uuid, p_manager_only boolean
)
returns text
language plpgsql security invoker set search_path = ''
as $$
declare
  v_role text;
begin
  select market.role into v_role
  from app_private.supplier_profiles supplier
  join app_private.workspace_marketplace_members market on market.workspace_id = supplier.workspace_id
  join app_private.app_users actor on actor.id = market.user_id
  where supplier.id = p_supplier_id and market.user_id = p_actor_user_id and actor.status = 'active'
  for share of actor, market;
  if not found then
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_NOT_FOUND';
  end if;
  if p_manager_only and v_role <> 'manager' then
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_FORBIDDEN';
  end if;
  return v_role;
end;
$$;

create or replace function public.marketplace_context(p_actor_user_id uuid)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_suppliers jsonb;
begin
  perform app_private.marketplace_assert_active(p_actor_user_id);
  select coalesce(jsonb_agg(jsonb_build_object(
    'profile', app_private.marketplace_profile_json(supplier, false), 'role', market.role
  ) order by supplier.id), '[]'::jsonb) into v_suppliers
  from app_private.workspace_marketplace_members market
  join app_private.supplier_profiles supplier on supplier.workspace_id = market.workspace_id
  where market.user_id = p_actor_user_id;

  return jsonb_build_object('suppliers', v_suppliers, 'isSupplierReviewer', exists (
    select 1 from app_private.platform_staff where user_id = p_actor_user_id and role = 'supplier_reviewer'
  ));
end;
$$;

create function app_private.marketplace_lock_supplier_team(p_supplier_id uuid)
returns void
language sql security invoker set search_path = ''
as $$
  -- Acquire before any membership row locks, including those for the manager
  -- authorizing a change, so reciprocal removals cannot deadlock.
  select pg_advisory_xact_lock(hashtextextended('marketplace-supplier-team:' || p_supplier_id::text, 0));
$$;

create function app_private.marketplace_managed_supplier_workspace(
  p_actor_user_id uuid, p_supplier_id uuid, p_mutate boolean
)
returns app_private.workspaces
language plpgsql security invoker set search_path = ''
as $$
declare
  v_workspace app_private.workspaces%rowtype;
begin
  if p_mutate then
    perform app_private.marketplace_lock_supplier_team(p_supplier_id);
  end if;
  perform app_private.marketplace_member_role(p_actor_user_id, p_supplier_id, true);
  select workspace.* into v_workspace
  from app_private.supplier_profiles supplier
  join app_private.workspaces workspace on workspace.id = supplier.workspace_id
  where supplier.id = p_supplier_id;
  return v_workspace;
end;
$$;

create function app_private.marketplace_supplier_member_json(
  p_member app_private.workspace_marketplace_members, p_owner_user_id uuid
)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'userId', member.id, 'displayName', member.display_name, 'role', (p_member).role,
    'isWorkspaceOwner', member.id = p_owner_user_id
  )
  from app_private.app_users member where member.id = (p_member).user_id;
$$;

create function app_private.marketplace_supplier_invite_json(p_invite app_private.supplier_team_invites)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'id', (p_invite).id, 'email', (p_invite).email, 'role', (p_invite).role,
    'createdAt', to_char((p_invite).created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expiresAt', to_char((p_invite).expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
$$;

create function app_private.marketplace_lock_managed_supplier_member(
  p_workspace_id uuid, p_owner_user_id uuid, p_member_user_id uuid, p_keep_manager boolean
)
returns app_private.workspace_marketplace_members
language plpgsql security invoker set search_path = ''
as $$
declare
  v_member app_private.workspace_marketplace_members%rowtype;
begin
  select * into v_member from app_private.workspace_marketplace_members
  where workspace_id = p_workspace_id and user_id = p_member_user_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_NOT_FOUND';
  end if;
  if p_member_user_id = p_owner_user_id then
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_OWNER_PROTECTED';
  end if;
  if v_member.role = 'manager' and not p_keep_manager then
    perform 1
    from app_private.workspace_marketplace_members market
    join app_private.app_users actor on actor.id = market.user_id and actor.status = 'active'
    where market.workspace_id = p_workspace_id and market.user_id <> p_member_user_id and market.role = 'manager'
    limit 1 for share of market, actor;
    if not found then
      raise exception using errcode = 'P0001', message = 'MARKETPLACE_MANAGER_REQUIRED';
    end if;
  end if;
  return v_member;
end;
$$;

create function app_private.marketplace_revoke_issued_supplier_invites(
  p_actor_user_id uuid, p_supplier_id uuid, p_issuer_user_id uuid
)
returns void
language sql security invoker set search_path = ''
as $$
  update app_private.supplier_team_invites
  set revoked_at = clock_timestamp(), revoked_by = p_actor_user_id
  where supplier_id = p_supplier_id and created_by = p_issuer_user_id
    and accepted_at is null and revoked_at is null and expires_at > clock_timestamp();
$$;

create function public.marketplace_supplier_team(p_actor_user_id uuid, p_supplier_id uuid)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_workspace app_private.workspaces%rowtype;
  v_members jsonb;
  v_invites jsonb;
begin
  v_workspace := app_private.marketplace_managed_supplier_workspace(p_actor_user_id, p_supplier_id, false);

  select coalesce(jsonb_agg(
    app_private.marketplace_supplier_member_json(member, v_workspace.owner_user_id)
    order by (member.user_id = v_workspace.owner_user_id) desc, member.user_id
  ), '[]'::jsonb) into v_members
  from app_private.workspace_marketplace_members member where member.workspace_id = v_workspace.id;

  select coalesce(jsonb_agg(
    app_private.marketplace_supplier_invite_json(invite) order by invite.created_at desc, invite.id
  ), '[]'::jsonb) into v_invites
  from app_private.supplier_team_invites invite
  where invite.supplier_id = p_supplier_id and invite.accepted_at is null and invite.revoked_at is null
    and invite.expires_at > statement_timestamp();

  return jsonb_build_object('members', v_members, 'invites', v_invites);
end;
$$;

create function public.marketplace_create_supplier_invite(
  p_actor_user_id uuid, p_supplier_id uuid, p_email text, p_role text, p_token_hash text
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_now timestamptz;
  v_invite app_private.supplier_team_invites%rowtype;
begin
  perform app_private.marketplace_managed_supplier_workspace(p_actor_user_id, p_supplier_id, true);
  p_email := lower(btrim(p_email) collate "C");
  if p_email is null or char_length(p_email) not between 3 and 254
    or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_role is null or p_role not in ('manager', 'staff', 'viewer')
    or p_token_hash is null or p_token_hash collate "C" !~ '^[0-9a-f]{64}$'
  then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  v_now := clock_timestamp();

  update app_private.supplier_team_invites
  set revoked_at = v_now, revoked_by = p_actor_user_id
  where supplier_id = p_supplier_id and email = p_email and accepted_at is null and revoked_at is null
    and expires_at <= v_now;

  insert into app_private.supplier_team_invites (
    supplier_id, email, role, token_hash, created_by, created_at, expires_at
  ) values (
    p_supplier_id, p_email, p_role, p_token_hash, p_actor_user_id, v_now, v_now + interval '7 days'
  )
  on conflict (supplier_id, email) where accepted_at is null and revoked_at is null do nothing
  returning * into v_invite;
  if not found then
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_INVITE_EXISTS';
  end if;
  return app_private.marketplace_supplier_invite_json(v_invite);
end;
$$;

create function public.marketplace_accept_supplier_invite(
  p_actor_user_id uuid, p_verified_email text, p_token_hash text
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_invite app_private.supplier_team_invites%rowtype;
  v_supplier app_private.supplier_profiles%rowtype;
  v_supplier_id uuid;
  v_member_role text;
  v_now timestamptz;
begin
  perform app_private.marketplace_assert_active(p_actor_user_id);
  -- The API passes the confirmed email from the verified Auth user, never the request body.
  p_verified_email := lower(btrim(p_verified_email) collate "C");
  select supplier_id into v_supplier_id from app_private.supplier_team_invites
  where token_hash = p_token_hash and email = p_verified_email;
  if not found then
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_INVITE_INVALID';
  end if;

  perform app_private.marketplace_lock_supplier_team(v_supplier_id);
  v_now := clock_timestamp();
  select * into v_invite from app_private.supplier_team_invites
  where token_hash = p_token_hash and email = p_verified_email and revoked_at is null and expires_at > v_now
  for update;
  if not found or (v_invite.accepted_by is not null and v_invite.accepted_by <> p_actor_user_id) then
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_INVITE_INVALID';
  end if;
  select * into v_supplier from app_private.supplier_profiles where id = v_supplier_id;

  select role into v_member_role from app_private.workspace_marketplace_members
  where workspace_id = v_supplier.workspace_id and user_id = p_actor_user_id for share;
  -- Read after the membership row lock, so a concurrent legacy cascade's cutoff is visible.
  if exists (
    select 1 from app_private.supplier_team_member_removals
    where supplier_id = v_supplier_id and user_id = p_actor_user_id and removed_at >= v_invite.created_at
  ) then
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_INVITE_INVALID';
  end if;
  if v_invite.accepted_by is not null then
    if v_member_role is null then
      raise exception using errcode = 'P0001', message = 'MARKETPLACE_INVITE_INVALID';
    end if;
    return jsonb_build_object('profile', app_private.marketplace_profile_json(v_supplier, false), 'role', v_member_role);
  end if;
  -- Authorization must still exist when an unconsumed invite is redeemed.
  -- An already accepted receipt remains retryable while its member still has access.
  perform 1 from app_private.workspace_marketplace_members issuer
  join app_private.app_users account on account.id = issuer.user_id and account.status = 'active'
  where issuer.workspace_id = v_supplier.workspace_id and issuer.user_id = v_invite.created_by and issuer.role = 'manager'
  for share of issuer, account;
  if not found then
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_INVITE_INVALID';
  end if;
  if v_member_role is not null then
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_MEMBER_EXISTS';
  end if;
  if exists (
    select 1 from app_private.workspaces where id = v_supplier.workspace_id and owner_user_id = p_actor_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_OWNER_PROTECTED';
  end if;

  insert into app_private.workspace_marketplace_members (
    workspace_id, user_id, role, requires_workspace_membership
  ) values (v_supplier.workspace_id, p_actor_user_id, v_invite.role, false)
  on conflict (workspace_id, user_id) do nothing;
  if not found then
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_MEMBER_EXISTS';
  end if;
  update app_private.supplier_team_invites
  set accepted_at = v_now, accepted_by = p_actor_user_id where id = v_invite.id;

  return jsonb_build_object('profile', app_private.marketplace_profile_json(v_supplier, false), 'role', v_invite.role);
end;
$$;

create function public.marketplace_change_supplier_member(
  p_actor_user_id uuid, p_supplier_id uuid, p_member_user_id uuid, p_role text
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_workspace app_private.workspaces%rowtype;
  v_member app_private.workspace_marketplace_members%rowtype;
begin
  v_workspace := app_private.marketplace_managed_supplier_workspace(p_actor_user_id, p_supplier_id, true);
  if p_role is null or p_role not in ('manager', 'staff', 'viewer') then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  v_member := app_private.marketplace_lock_managed_supplier_member(
    v_workspace.id, v_workspace.owner_user_id, p_member_user_id, p_role = 'manager'
  );
  if v_member.role <> p_role then
    if v_member.role = 'manager' then
      perform app_private.marketplace_revoke_issued_supplier_invites(p_actor_user_id, p_supplier_id, p_member_user_id);
    end if;
    update app_private.workspace_marketplace_members set role = p_role
    where workspace_id = v_workspace.id and user_id = p_member_user_id returning * into v_member;
  end if;
  return app_private.marketplace_supplier_member_json(v_member, v_workspace.owner_user_id);
end;
$$;

create function public.marketplace_remove_supplier_member(
  p_actor_user_id uuid, p_supplier_id uuid, p_member_user_id uuid
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_workspace app_private.workspaces%rowtype;
begin
  v_workspace := app_private.marketplace_managed_supplier_workspace(p_actor_user_id, p_supplier_id, true);
  perform app_private.marketplace_lock_managed_supplier_member(v_workspace.id, v_workspace.owner_user_id, p_member_user_id, false);
  perform app_private.marketplace_revoke_issued_supplier_invites(p_actor_user_id, p_supplier_id, p_member_user_id);
  delete from app_private.workspace_marketplace_members where workspace_id = v_workspace.id and user_id = p_member_user_id;
  return jsonb_build_object('userId', p_member_user_id);
end;
$$;

create function public.marketplace_revoke_supplier_invite(
  p_actor_user_id uuid, p_supplier_id uuid, p_invite_id uuid
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_now timestamptz;
begin
  perform app_private.marketplace_managed_supplier_workspace(p_actor_user_id, p_supplier_id, true);
  v_now := clock_timestamp();
  update app_private.supplier_team_invites set revoked_at = v_now, revoked_by = p_actor_user_id
  where id = p_invite_id and supplier_id = p_supplier_id and accepted_at is null and revoked_at is null
    and expires_at > v_now;
  if not found then
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_INVITE_INVALID';
  end if;
  return jsonb_build_object('id', p_invite_id);
end;
$$;

revoke all on function app_private.marketplace_lock_supplier_team(uuid),
  app_private.marketplace_managed_supplier_workspace(uuid, uuid, boolean),
  app_private.marketplace_supplier_member_json(app_private.workspace_marketplace_members, uuid),
  app_private.marketplace_supplier_invite_json(app_private.supplier_team_invites),
  app_private.marketplace_lock_managed_supplier_member(uuid, uuid, uuid, boolean),
  app_private.marketplace_revoke_issued_supplier_invites(uuid, uuid, uuid)
from public, anon, authenticated;

grant execute on function app_private.marketplace_lock_supplier_team(uuid),
  app_private.marketplace_managed_supplier_workspace(uuid, uuid, boolean),
  app_private.marketplace_supplier_member_json(app_private.workspace_marketplace_members, uuid),
  app_private.marketplace_supplier_invite_json(app_private.supplier_team_invites),
  app_private.marketplace_lock_managed_supplier_member(uuid, uuid, uuid, boolean),
  app_private.marketplace_revoke_issued_supplier_invites(uuid, uuid, uuid)
to service_role;

revoke all on function public.marketplace_supplier_team(uuid, uuid),
  public.marketplace_create_supplier_invite(uuid, uuid, text, text, text),
  public.marketplace_accept_supplier_invite(uuid, text, text),
  public.marketplace_change_supplier_member(uuid, uuid, uuid, text),
  public.marketplace_remove_supplier_member(uuid, uuid, uuid), public.marketplace_revoke_supplier_invite(uuid, uuid, uuid)
from public, anon, authenticated;

grant execute on function public.marketplace_supplier_team(uuid, uuid),
  public.marketplace_create_supplier_invite(uuid, uuid, text, text, text),
  public.marketplace_accept_supplier_invite(uuid, text, text),
  public.marketplace_change_supplier_member(uuid, uuid, uuid, text),
  public.marketplace_remove_supplier_member(uuid, uuid, uuid), public.marketplace_revoke_supplier_invite(uuid, uuid, uuid)
to service_role;
