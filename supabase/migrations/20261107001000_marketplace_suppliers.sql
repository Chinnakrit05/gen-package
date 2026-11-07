-- Phase 2: supplier onboarding, explicit Marketplace membership, and review.
-- The server verifies identity and AAL2 before invoking the reviewer RPCs.

alter table app_private.workspaces
  add constraint workspaces_id_kind_unique unique (id, kind);

create table app_private.supplier_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique,
  workspace_kind text generated always as ('team'::text) stored,
  kind text not null check (kind in ('factory', 'print_shop')),
  name text not null check (name = btrim(name) and char_length(name) between 1 and 100),
  slug text not null constraint supplier_profiles_slug_unique unique,
  description text not null check (char_length(description) <= 1000),
  contact_email text not null check (
    char_length(contact_email) between 3 and 254
    and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  status text not null default 'draft' check (status in ('draft', 'pending', 'approved', 'suspended')),
  revision integer not null default 1 check (revision >= 1),
  review_note text check (review_note = btrim(review_note) and char_length(review_note) between 1 and 500),
  updated_at timestamptz not null default statement_timestamp(),
  constraint supplier_profiles_slug_format
    check (char_length(slug) between 3 and 64 and slug collate "C" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint supplier_profiles_team_workspace
    foreign key (workspace_id, workspace_kind) references app_private.workspaces (id, kind) on delete restrict
);

create index supplier_profiles_status_id_idx on app_private.supplier_profiles (status, id);

create table app_private.supplier_capabilities (
  supplier_id uuid not null references app_private.supplier_profiles(id) on delete cascade,
  capability text not null check (capability in (
    'offset_printing', 'digital_printing', 'flexographic_printing', 'die_cutting', 'lamination', 'foil_stamping'
  )),
  primary key (supplier_id, capability)
);

create table app_private.workspace_marketplace_members (
  workspace_id uuid not null,
  user_id uuid not null,
  role text not null check (role in ('manager', 'staff', 'viewer')),
  primary key (workspace_id, user_id),
  foreign key (workspace_id, user_id) references app_private.workspace_members (workspace_id, user_id) on delete cascade
);

create index workspace_marketplace_members_user_idx
  on app_private.workspace_marketplace_members (user_id, workspace_id);

create table app_private.platform_staff (
  user_id uuid not null references app_private.app_users(id) on delete restrict,
  role text not null check (role = 'supplier_reviewer'),
  primary key (user_id, role)
);

create table app_private.supplier_create_operations (
  actor_user_id uuid not null references app_private.app_users(id) on delete restrict,
  operation_id uuid not null,
  request_hash bytea not null check (octet_length(request_hash) = 32),
  supplier_id uuid not null references app_private.supplier_profiles(id) on delete restrict,
  primary key (actor_user_id, operation_id)
);

create table app_private.activity_events (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references app_private.supplier_profiles(id) on delete restrict,
  actor_user_id uuid not null references app_private.app_users(id) on delete restrict,
  action text not null check (action in ('created', 'reopened', 'submitted', 'approve', 'request_changes', 'suspend', 'resume')),
  from_status text check (from_status in ('draft', 'pending', 'approved', 'suspended')),
  to_status text not null check (to_status in ('draft', 'pending', 'approved', 'suspended')),
  revision integer not null check (revision >= 1),
  -- Restricted review history. Never copied to the notification outbox.
  reason text check (reason = btrim(reason) and char_length(reason) between 1 and 500),
  created_at timestamptz not null default statement_timestamp(),
  unique (supplier_id, revision),
  check ((action in ('approve', 'request_changes', 'suspend', 'resume')) = (reason is not null))
);

create table app_private.notification_outbox (
  event_id uuid primary key references app_private.activity_events(id) on delete restrict,
  audience text not null check (audience in ('supplier_workspace', 'supplier_reviewers')),
  created_at timestamptz not null default statement_timestamp(),
  processed_at timestamptz
);

create index notification_outbox_pending_idx
  on app_private.notification_outbox (created_at, event_id) where processed_at is null;

alter table app_private.supplier_profiles enable row level security;
alter table app_private.supplier_capabilities enable row level security;
alter table app_private.workspace_marketplace_members enable row level security;
alter table app_private.platform_staff enable row level security;
alter table app_private.supplier_create_operations enable row level security;
alter table app_private.activity_events enable row level security;
alter table app_private.notification_outbox enable row level security;

revoke all on table app_private.supplier_profiles, app_private.supplier_capabilities,
  app_private.workspace_marketplace_members, app_private.platform_staff, app_private.supplier_create_operations,
  app_private.activity_events, app_private.notification_outbox from public, anon, authenticated;

grant select, insert, update, delete on table app_private.supplier_profiles, app_private.supplier_capabilities,
  app_private.workspace_marketplace_members to service_role;
revoke all on table app_private.platform_staff, app_private.supplier_create_operations, app_private.activity_events,
  app_private.notification_outbox from service_role;
grant select on table app_private.platform_staff to service_role;
-- FOR SHARE requires UPDATE on a column. The only allowed role value cannot grant new access.
grant update (role) on table app_private.platform_staff to service_role;
grant select, insert on table app_private.supplier_create_operations, app_private.activity_events,
  app_private.notification_outbox to service_role;
grant update (processed_at) on table app_private.notification_outbox to service_role;

create function app_private.marketplace_normalize_profile(p_profile jsonb)
returns jsonb
language plpgsql immutable security invoker set search_path = ''
as $$
declare
  v_keys text[] := array['kind', 'name', 'slug', 'description', 'contactEmail', 'capabilities'];
  v_capabilities jsonb;
  v_count integer;
  v_distinct integer;
begin
  if jsonb_typeof(p_profile) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  if not (p_profile ?& v_keys) or p_profile - v_keys <> '{}'::jsonb
    or jsonb_typeof(p_profile->'kind') <> 'string'
    or p_profile->>'kind' not in ('factory', 'print_shop')
    or jsonb_typeof(p_profile->'name') <> 'string'
    or p_profile->>'name' <> btrim(p_profile->>'name')
    or char_length(p_profile->>'name') not between 1 and 100
    or jsonb_typeof(p_profile->'slug') <> 'string'
    or char_length(p_profile->>'slug') not between 3 and 64
    or (p_profile->>'slug') collate "C" !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or jsonb_typeof(p_profile->'description') <> 'string'
    or char_length(p_profile->>'description') > 1000
    or jsonb_typeof(p_profile->'contactEmail') <> 'string'
    or char_length(p_profile->>'contactEmail') not between 3 and 254
    or p_profile->>'contactEmail' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or jsonb_typeof(p_profile->'capabilities') <> 'array'
  then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  if jsonb_array_length(p_profile->'capabilities') > 6 or exists (
    select 1 from jsonb_array_elements_text(p_profile->'capabilities') as item(capability)
    where capability is null or capability not in (
      'offset_printing', 'digital_printing', 'flexographic_printing', 'die_cutting', 'lamination', 'foil_stamping'
    )
  ) then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  select count(*), count(distinct capability), coalesce(jsonb_agg(capability order by capability collate "C"), '[]'::jsonb)
  into v_count, v_distinct, v_capabilities
  from jsonb_array_elements_text(p_profile->'capabilities') as item(capability);
  if v_count <> v_distinct then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  return jsonb_set(p_profile, '{capabilities}', v_capabilities);
end;
$$;

create function app_private.marketplace_profile_json(p_supplier app_private.supplier_profiles, p_public boolean)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'id', (p_supplier).id, 'kind', (p_supplier).kind, 'name', (p_supplier).name,
    'slug', (p_supplier).slug, 'description', (p_supplier).description,
    'capabilities', coalesce((
      select jsonb_agg(capability order by capability collate "C")
      from app_private.supplier_capabilities where supplier_id = (p_supplier).id
    ), '[]'::jsonb)
  ) || case when p_public then '{}'::jsonb else jsonb_build_object(
    'workspaceId', (p_supplier).workspace_id, 'contactEmail', (p_supplier).contact_email,
    'status', (p_supplier).status, 'revision', (p_supplier).revision, 'reviewNote', (p_supplier).review_note,
    'updatedAt', to_char((p_supplier).updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) end;
$$;

create function app_private.marketplace_assert_active(p_actor_user_id uuid)
returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  perform 1 from app_private.app_users where id = p_actor_user_id and status = 'active' for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_FORBIDDEN';
  end if;
end;
$$;

create function app_private.marketplace_member_role(p_actor_user_id uuid, p_supplier_id uuid, p_manager_only boolean)
returns text
language plpgsql security invoker set search_path = ''
as $$
declare
  v_role text;
begin
  select market.role into v_role
  from app_private.supplier_profiles supplier
  join app_private.workspace_members member on member.workspace_id = supplier.workspace_id
  join app_private.workspace_marketplace_members market
    on market.workspace_id = member.workspace_id and market.user_id = member.user_id
  join app_private.app_users actor on actor.id = member.user_id
  where supplier.id = p_supplier_id and member.user_id = p_actor_user_id and actor.status = 'active'
  for share of actor, member, market;
  if not found then
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_NOT_FOUND';
  end if;
  if p_manager_only and v_role <> 'manager' then
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_FORBIDDEN';
  end if;
  return v_role;
end;
$$;

create function app_private.marketplace_assert_reviewer(p_actor_user_id uuid)
returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  perform app_private.marketplace_assert_active(p_actor_user_id);
  perform 1 from app_private.platform_staff where user_id = p_actor_user_id and role = 'supplier_reviewer' for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_FORBIDDEN';
  end if;
end;
$$;

create function app_private.marketplace_lock_supplier(p_supplier_id uuid, p_expected_revision integer)
returns app_private.supplier_profiles
language plpgsql security invoker set search_path = ''
as $$
declare
  v_supplier app_private.supplier_profiles%rowtype;
begin
  select * into v_supplier from app_private.supplier_profiles where id = p_supplier_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_NOT_FOUND';
  end if;
  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  if v_supplier.revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'REVISION_CONFLICT',
      detail = jsonb_build_object('currentRevision', v_supplier.revision)::text;
  end if;
  return v_supplier;
end;
$$;

create function app_private.marketplace_record_transition(
  p_actor_user_id uuid, p_supplier app_private.supplier_profiles, p_action text, p_from_status text, p_reason text
)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_event_id uuid;
begin
  insert into app_private.activity_events (supplier_id, actor_user_id, action, from_status, to_status, revision, reason)
  values (p_supplier.id, p_actor_user_id, p_action, p_from_status, p_supplier.status, p_supplier.revision, p_reason)
  returning id into v_event_id;

  insert into app_private.notification_outbox (event_id, audience)
  values (v_event_id, case when p_action = 'submitted' then 'supplier_reviewers' else 'supplier_workspace' end);
end;
$$;

create function public.marketplace_context(p_actor_user_id uuid)
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
  join app_private.workspace_members member using (workspace_id, user_id)
  join app_private.supplier_profiles supplier on supplier.workspace_id = market.workspace_id
  where market.user_id = p_actor_user_id;

  return jsonb_build_object('suppliers', v_suppliers, 'isSupplierReviewer', exists (
    select 1 from app_private.platform_staff where user_id = p_actor_user_id and role = 'supplier_reviewer'
  ));
end;
$$;

create function public.marketplace_create_supplier(p_actor_user_id uuid, p_operation_id uuid, p_profile jsonb)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_operation app_private.supplier_create_operations%rowtype;
  v_supplier app_private.supplier_profiles%rowtype;
  v_hash bytea;
  v_role text;
begin
  perform app_private.marketplace_assert_active(p_actor_user_id);
  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  p_profile := app_private.marketplace_normalize_profile(p_profile);
  v_hash := sha256(convert_to(p_profile::text, 'UTF8'));
  perform pg_advisory_xact_lock(hashtextextended('marketplace-supplier-create:' || p_actor_user_id::text || ':' || p_operation_id::text, 0));

  select * into v_operation from app_private.supplier_create_operations
  where actor_user_id = p_actor_user_id and operation_id = p_operation_id;
  if found then
    v_role := app_private.marketplace_member_role(p_actor_user_id, v_operation.supplier_id, true);
    if v_operation.request_hash <> v_hash then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    select * into v_supplier from app_private.supplier_profiles where id = v_operation.supplier_id;
    return jsonb_build_object('profile', app_private.marketplace_profile_json(v_supplier, false), 'role', v_role);
  end if;

  insert into app_private.workspaces (kind, owner_user_id, name)
  values ('team', p_actor_user_id, p_profile->>'name') returning id into v_workspace_id;
  insert into app_private.supplier_profiles (workspace_id, kind, name, slug, description, contact_email)
  values (v_workspace_id, p_profile->>'kind', p_profile->>'name', p_profile->>'slug', p_profile->>'description', p_profile->>'contactEmail')
  on conflict on constraint supplier_profiles_slug_unique do nothing
  returning * into v_supplier;
  if not found then
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_CONFLICT';
  end if;

  insert into app_private.workspace_members (workspace_id, user_id, role) values (v_workspace_id, p_actor_user_id, 'owner');
  insert into app_private.workspace_marketplace_members (workspace_id, user_id, role) values (v_workspace_id, p_actor_user_id, 'manager');
  insert into app_private.supplier_capabilities (supplier_id, capability)
  select v_supplier.id, value from jsonb_array_elements_text(p_profile->'capabilities');
  insert into app_private.supplier_create_operations (actor_user_id, operation_id, request_hash, supplier_id)
  values (p_actor_user_id, p_operation_id, v_hash, v_supplier.id);
  perform app_private.marketplace_record_transition(p_actor_user_id, v_supplier, 'created', null, null);

  return jsonb_build_object('profile', app_private.marketplace_profile_json(v_supplier, false), 'role', 'manager');
end;
$$;

create function public.marketplace_get_supplier(p_actor_user_id uuid, p_supplier_id uuid)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_role text;
  v_supplier app_private.supplier_profiles%rowtype;
begin
  v_role := app_private.marketplace_member_role(p_actor_user_id, p_supplier_id, false);
  select * into v_supplier from app_private.supplier_profiles where id = p_supplier_id;
  return jsonb_build_object('profile', app_private.marketplace_profile_json(v_supplier, false), 'role', v_role);
end;
$$;

create function public.marketplace_update_supplier(
  p_actor_user_id uuid, p_supplier_id uuid, p_expected_revision integer, p_profile jsonb
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_role text;
  v_supplier app_private.supplier_profiles%rowtype;
  v_current jsonb;
  v_previous_status text;
  v_constraint text;
begin
  v_role := app_private.marketplace_member_role(p_actor_user_id, p_supplier_id, true);
  v_supplier := app_private.marketplace_lock_supplier(p_supplier_id, p_expected_revision);
  if v_supplier.status not in ('draft', 'approved') then
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_CONFLICT';
  end if;
  p_profile := app_private.marketplace_normalize_profile(p_profile);
  v_current := app_private.marketplace_profile_json(v_supplier, false);
  if v_current - array['id', 'workspaceId', 'status', 'revision', 'reviewNote', 'updatedAt'] = p_profile then
    return jsonb_build_object('profile', v_current, 'role', v_role);
  end if;
  v_previous_status := v_supplier.status;

  begin
    update app_private.supplier_profiles
    set kind = p_profile->>'kind', name = p_profile->>'name', slug = p_profile->>'slug',
        description = p_profile->>'description', contact_email = p_profile->>'contactEmail', status = 'draft',
        review_note = case when v_previous_status = 'draft' then review_note else null end,
        revision = revision + 1, updated_at = statement_timestamp()
    where id = p_supplier_id returning * into v_supplier;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'supplier_profiles_slug_unique' then
      raise exception using errcode = 'P0001', message = 'MARKETPLACE_CONFLICT';
    end if;
    raise;
  end;

  delete from app_private.supplier_capabilities where supplier_id = p_supplier_id;
  insert into app_private.supplier_capabilities (supplier_id, capability)
  select p_supplier_id, value from jsonb_array_elements_text(p_profile->'capabilities');
  if v_previous_status = 'approved' then
    perform app_private.marketplace_record_transition(p_actor_user_id, v_supplier, 'reopened', v_previous_status, null);
  end if;

  return jsonb_build_object('profile', app_private.marketplace_profile_json(v_supplier, false), 'role', v_role);
end;
$$;

create function public.marketplace_submit_supplier(p_actor_user_id uuid, p_supplier_id uuid, p_expected_revision integer)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_role text;
  v_supplier app_private.supplier_profiles%rowtype;
begin
  v_role := app_private.marketplace_member_role(p_actor_user_id, p_supplier_id, true);
  v_supplier := app_private.marketplace_lock_supplier(p_supplier_id, p_expected_revision);
  if v_supplier.status <> 'draft' then
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_CONFLICT';
  end if;
  if not exists (select 1 from app_private.supplier_capabilities where supplier_id = p_supplier_id) then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  update app_private.supplier_profiles
  set status = 'pending', review_note = null, revision = revision + 1, updated_at = statement_timestamp()
  where id = p_supplier_id returning * into v_supplier;
  perform app_private.marketplace_record_transition(p_actor_user_id, v_supplier, 'submitted', 'draft', null);
  return jsonb_build_object('profile', app_private.marketplace_profile_json(v_supplier, false), 'role', v_role);
end;
$$;

create function public.marketplace_public_supplier(p_slug text)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_profile jsonb;
begin
  select app_private.marketplace_profile_json(supplier, true) into v_profile
  from app_private.supplier_profiles supplier where supplier.slug = p_slug and supplier.status = 'approved';
  if not found then
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_NOT_FOUND';
  end if;
  return v_profile;
end;
$$;

create function public.marketplace_admin_suppliers(p_actor_user_id uuid, p_status text, p_after uuid)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_ids uuid[];
  v_items jsonb;
begin
  perform app_private.marketplace_assert_reviewer(p_actor_user_id);
  if p_status is not null and p_status not in ('draft', 'pending', 'approved', 'suspended') then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  select array_agg(id order by id) into v_ids from (
    select id from app_private.supplier_profiles
    where (p_status is null or status = p_status) and (p_after is null or id > p_after)
    order by id limit 25
  ) page;
  select coalesce(jsonb_agg(app_private.marketplace_profile_json(supplier, false) order by supplier.id), '[]'::jsonb)
  into v_items from app_private.supplier_profiles supplier where supplier.id = any(v_ids[1:24]);

  return jsonb_build_object('items', v_items, 'nextCursor', case when cardinality(v_ids) > 24 then v_ids[24] end);
end;
$$;

create function public.marketplace_review_supplier(
  p_actor_user_id uuid, p_supplier_id uuid, p_expected_revision integer, p_action text, p_reason text
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_supplier app_private.supplier_profiles%rowtype;
  v_from_status text;
  v_to_status text;
begin
  perform app_private.marketplace_assert_reviewer(p_actor_user_id);
  p_reason := btrim(p_reason);
  if p_action is null or p_action not in ('approve', 'request_changes', 'suspend', 'resume')
    or p_reason is null or char_length(p_reason) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  v_supplier := app_private.marketplace_lock_supplier(p_supplier_id, p_expected_revision);
  v_from_status := v_supplier.status;
  v_to_status := case
    when p_action = 'approve' and v_from_status = 'pending' then 'approved'
    when p_action = 'request_changes' and v_from_status = 'pending' then 'draft'
    when p_action = 'suspend' and v_from_status = 'approved' then 'suspended'
    when p_action = 'resume' and v_from_status = 'suspended' then 'approved'
  end;
  if v_to_status is null then
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_CONFLICT';
  end if;

  update app_private.supplier_profiles
  set status = v_to_status, review_note = p_reason, revision = revision + 1, updated_at = statement_timestamp()
  where id = p_supplier_id returning * into v_supplier;
  perform app_private.marketplace_record_transition(p_actor_user_id, v_supplier, p_action, v_from_status, p_reason);
  return app_private.marketplace_profile_json(v_supplier, false);
end;
$$;

revoke all on function app_private.marketplace_normalize_profile(jsonb),
  app_private.marketplace_profile_json(app_private.supplier_profiles, boolean),
  app_private.marketplace_assert_active(uuid), app_private.marketplace_member_role(uuid, uuid, boolean),
  app_private.marketplace_assert_reviewer(uuid), app_private.marketplace_lock_supplier(uuid, integer),
  app_private.marketplace_record_transition(uuid, app_private.supplier_profiles, text, text, text)
from public, anon, authenticated;

grant execute on function app_private.marketplace_normalize_profile(jsonb),
  app_private.marketplace_profile_json(app_private.supplier_profiles, boolean),
  app_private.marketplace_assert_active(uuid), app_private.marketplace_member_role(uuid, uuid, boolean),
  app_private.marketplace_assert_reviewer(uuid), app_private.marketplace_lock_supplier(uuid, integer),
  app_private.marketplace_record_transition(uuid, app_private.supplier_profiles, text, text, text)
to service_role;

revoke all on function public.marketplace_context(uuid), public.marketplace_create_supplier(uuid, uuid, jsonb),
  public.marketplace_get_supplier(uuid, uuid), public.marketplace_update_supplier(uuid, uuid, integer, jsonb),
  public.marketplace_submit_supplier(uuid, uuid, integer), public.marketplace_public_supplier(text),
  public.marketplace_admin_suppliers(uuid, text, uuid), public.marketplace_review_supplier(uuid, uuid, integer, text, text)
from public, anon, authenticated;

grant execute on function public.marketplace_context(uuid), public.marketplace_create_supplier(uuid, uuid, jsonb),
  public.marketplace_get_supplier(uuid, uuid), public.marketplace_update_supplier(uuid, uuid, integer, jsonb),
  public.marketplace_submit_supplier(uuid, uuid, integer), public.marketplace_public_supplier(text),
  public.marketplace_admin_suppliers(uuid, text, uuid), public.marketplace_review_supplier(uuid, uuid, integer, text, text)
to service_role;
