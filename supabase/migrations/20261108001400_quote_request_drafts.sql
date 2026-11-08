-- Private buyer drafts capture the persisted project spec at one revision.
-- Artwork, project history, assets and previews are outside this snapshot.

create function app_private.marketplace_quote_request_spec_valid(p_spec jsonb)
returns boolean
language plpgsql immutable security invoker set search_path = ''
as $$
declare
  v_keys constant text[] := array['template','materialId','W','D','H','handle'];
begin
  if jsonb_typeof(p_spec) is distinct from 'object'
    or not (p_spec ?& v_keys)
    or p_spec - v_keys <> '{}'::jsonb
    or jsonb_typeof(p_spec->'template') <> 'string'
    or jsonb_typeof(p_spec->'materialId') <> 'string'
    or jsonb_typeof(p_spec->'W') <> 'number'
    or jsonb_typeof(p_spec->'D') <> 'number'
    or jsonb_typeof(p_spec->'H') <> 'number'
    or jsonb_typeof(p_spec->'handle') <> 'boolean'
  then
    return false;
  end if;
  return char_length(p_spec->>'template') between 1 and 120
    and char_length(p_spec->>'materialId') between 1 and 120
    and (p_spec->>'W')::numeric between 10 and 250
    and (p_spec->>'D')::numeric between 20 and 150
    and (p_spec->>'H')::numeric between 10 and 300
    and ((p_spec->>'template') = 'sticker' or
         ((p_spec->>'W')::numeric >= 30 and (p_spec->>'H')::numeric >= 30));
end;
$$;

create table app_private.quote_request_drafts (
  id uuid primary key,
  workspace_id uuid not null,
  project_id uuid not null,
  created_by uuid not null references app_private.app_users(id) on delete restrict,
  project_name text not null check (char_length(btrim(project_name)) between 1 and 60),
  project_revision bigint not null check (project_revision between 1 and 9007199254740991),
  title text not null check (title = btrim(title) and char_length(title) between 1 and 100),
  quantity integer not null check (quantity between 1 and 1000000),
  notes text not null check (char_length(notes) <= 1000),
  spec jsonb not null check (app_private.marketplace_quote_request_spec_valid(spec)),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (project_id, workspace_id) references app_private.projects(id, workspace_id) on delete restrict
);

create index quote_request_drafts_workspace_page_idx
  on app_private.quote_request_drafts (workspace_id, created_at desc, id desc);
create index quote_request_drafts_project_idx on app_private.quote_request_drafts (project_id, workspace_id);
create index quote_request_drafts_creator_idx on app_private.quote_request_drafts (created_by);

alter table app_private.quote_request_drafts enable row level security;
revoke all on table app_private.quote_request_drafts from public, anon, authenticated, service_role;
grant select, insert on table app_private.quote_request_drafts to service_role;

create function app_private.marketplace_assert_quote_request_owner(p_actor_user_id uuid, p_workspace_id uuid)
returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  perform 1
  from app_private.workspaces workspace
  join app_private.workspace_members member on member.workspace_id = workspace.id and member.user_id = workspace.owner_user_id
  join app_private.app_users actor on actor.id = member.user_id
  where workspace.id = p_workspace_id and actor.id = p_actor_user_id
    and actor.status = 'active' and member.role = 'owner'
  for share of workspace, member, actor;
  if not found then
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_NOT_FOUND';
  end if;
end;
$$;

create function app_private.marketplace_quote_request_draft_json(p_draft app_private.quote_request_drafts)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'id', (p_draft).id, 'workspaceId', (p_draft).workspace_id, 'projectId', (p_draft).project_id,
    'projectName', (p_draft).project_name, 'projectRevision', (p_draft).project_revision,
    'title', (p_draft).title, 'quantity', (p_draft).quantity, 'notes', (p_draft).notes, 'spec', (p_draft).spec,
    'createdAt', to_char((p_draft).created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  );
$$;

create function public.marketplace_create_quote_request_draft(
  p_actor_user_id uuid, p_workspace_id uuid, p_project_id uuid, p_expected_project_revision bigint,
  p_operation_id uuid, p_title text, p_quantity integer, p_notes text
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_draft app_private.quote_request_drafts%rowtype;
  v_project_name text;
  v_project_revision bigint;
  v_live jsonb;
  v_spec jsonb;
begin
  perform app_private.marketplace_assert_quote_request_owner(p_actor_user_id, p_workspace_id);
  p_title := btrim(p_title);
  if p_project_id is null or p_operation_id is null or p_expected_project_revision is null
    or p_expected_project_revision not between 1 and 9007199254740991
    or p_title is null or char_length(p_title) not between 1 and 100
    or p_quantity is null or p_quantity not between 1 and 1000000
    or p_notes is null or char_length(p_notes) > 1000
  then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  -- Serialize attempts with the same ID so a retry sees the original snapshot
  -- before looking at the source again, even after an edit or soft deletion.
  perform pg_advisory_xact_lock(hashtextextended('marketplace-quote-request-draft:' || p_operation_id::text, 0));
  select * into v_draft from app_private.quote_request_drafts where id = p_operation_id and workspace_id = p_workspace_id;
  if found then
    if v_draft.created_by <> p_actor_user_id or v_draft.project_id <> p_project_id
      or v_draft.project_revision <> p_expected_project_revision or v_draft.title <> p_title
      or v_draft.quantity <> p_quantity or v_draft.notes <> p_notes
    then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return app_private.marketplace_quote_request_draft_json(v_draft);
  end if;

  select project.name, project.revision, project.document->'live'
  into v_project_name, v_project_revision, v_live
  from app_private.projects project
  where project.id = p_project_id and project.workspace_id = p_workspace_id and project.deleted_at is null
  for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_NOT_FOUND';
  end if;
  if v_project_revision <> p_expected_project_revision then
    raise exception using errcode = 'P0001', message = 'REVISION_CONFLICT',
      detail = jsonb_build_object('currentRevision', v_project_revision)::text;
  end if;

  v_spec := jsonb_build_object(
    'template', v_live->'template', 'materialId', v_live->'materialId', 'W', v_live->'W',
    'D', v_live->'D', 'H', v_live->'H', 'handle', v_live->'handle'
  );
  if not app_private.marketplace_quote_request_spec_valid(v_spec) then
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_CONFLICT';
  end if;

  insert into app_private.quote_request_drafts (
    id, workspace_id, project_id, created_by, project_name, project_revision, title, quantity, notes, spec
  ) values (
    p_operation_id, p_workspace_id, p_project_id, p_actor_user_id, v_project_name, v_project_revision,
    p_title, p_quantity, p_notes, v_spec
  )
  on conflict (id) do nothing
  returning * into v_draft;
  if not found then
    -- IDs are global for get-by-ID. Never return another workspace's receipt.
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_CONFLICT';
  end if;
  return app_private.marketplace_quote_request_draft_json(v_draft);
end;
$$;

create function public.marketplace_get_quote_request_draft(p_actor_user_id uuid, p_request_id uuid)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_draft app_private.quote_request_drafts%rowtype;
begin
  select * into v_draft from app_private.quote_request_drafts where id = p_request_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_NOT_FOUND';
  end if;
  perform app_private.marketplace_assert_quote_request_owner(p_actor_user_id, v_draft.workspace_id);
  return app_private.marketplace_quote_request_draft_json(v_draft);
end;
$$;

create function public.marketplace_list_quote_request_drafts(
  p_actor_user_id uuid, p_workspace_id uuid, p_after_created_at timestamptz, p_after_id uuid
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_items jsonb;
  v_cursor jsonb;
begin
  perform app_private.marketplace_assert_quote_request_owner(p_actor_user_id, p_workspace_id);
  if ((p_after_created_at is null) <> (p_after_id is null))
    or (p_after_created_at is not null and not isfinite(p_after_created_at))
  then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', page.id, 'projectName', page.project_name, 'title', page.title, 'quantity', page.quantity,
    'createdAt', to_char(page.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  ) order by page.created_at desc, page.id desc), '[]'::jsonb)
  into v_items
  from (
    select id, project_name, title, quantity, created_at
    from app_private.quote_request_drafts
    where workspace_id = p_workspace_id
      and (p_after_created_at is null or (created_at, id) < (p_after_created_at, p_after_id))
    order by created_at desc, id desc
    limit 25
  ) page;

  if jsonb_array_length(v_items) > 24 then
    v_cursor := jsonb_build_object('createdAt', v_items->23->>'createdAt', 'id', v_items->23->>'id');
    v_items := v_items - 24;
  end if;
  return jsonb_build_object('items', v_items, 'nextCursor', v_cursor);
end;
$$;

revoke all on function app_private.marketplace_quote_request_spec_valid(jsonb),
  app_private.marketplace_assert_quote_request_owner(uuid, uuid),
  app_private.marketplace_quote_request_draft_json(app_private.quote_request_drafts)
from public, anon, authenticated;
grant execute on function app_private.marketplace_quote_request_spec_valid(jsonb),
  app_private.marketplace_assert_quote_request_owner(uuid, uuid),
  app_private.marketplace_quote_request_draft_json(app_private.quote_request_drafts)
to service_role;

revoke all on function public.marketplace_create_quote_request_draft(uuid, uuid, uuid, bigint, uuid, text, integer, text),
  public.marketplace_get_quote_request_draft(uuid, uuid),
  public.marketplace_list_quote_request_drafts(uuid, uuid, timestamptz, uuid)
from public, anon, authenticated;
grant execute on function public.marketplace_create_quote_request_draft(uuid, uuid, uuid, bigint, uuid, text, integer, text),
  public.marketplace_get_quote_request_draft(uuid, uuid),
  public.marketplace_list_quote_request_drafts(uuid, uuid, timestamptz, uuid)
to service_role;
