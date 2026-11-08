-- One immutable publication per private draft, visible only to explicitly
-- selected suppliers and their current authorized Marketplace members.

create table app_private.quote_request_publications (
  request_id uuid primary key references app_private.quote_request_drafts(id) on delete restrict,
  revision_id uuid not null unique default gen_random_uuid(),
  published_by uuid not null references app_private.app_users(id) on delete restrict,
  published_at timestamptz not null default clock_timestamp()
);

create table app_private.quote_request_supplier_access (
  request_id uuid not null references app_private.quote_request_publications(request_id) on delete restrict,
  supplier_id uuid not null references app_private.supplier_profiles(id) on delete restrict,
  supplier_name text not null check (char_length(btrim(supplier_name)) between 1 and 100),
  primary key (request_id, supplier_id)
);

create index quote_request_publications_publisher_idx on app_private.quote_request_publications (published_by);
create index quote_request_supplier_access_supplier_idx on app_private.quote_request_supplier_access (supplier_id, request_id);

alter table app_private.quote_request_publications enable row level security;
alter table app_private.quote_request_supplier_access enable row level security;
revoke all on table app_private.quote_request_publications, app_private.quote_request_supplier_access
  from public, anon, authenticated, service_role;
grant select, insert on table app_private.quote_request_publications, app_private.quote_request_supplier_access to service_role;

create function app_private.marketplace_assert_quote_request_buyer(p_actor_user_id uuid, p_request_id uuid)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_workspace_id uuid;
begin
  select workspace_id into v_workspace_id from app_private.quote_request_drafts where id = p_request_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_NOT_FOUND';
  end if;
  perform app_private.marketplace_assert_quote_request_owner(p_actor_user_id, v_workspace_id);
end;
$$;

create function app_private.marketplace_assert_quote_request_supplier(p_actor_user_id uuid, p_supplier_id uuid)
returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  -- The supplier acts through its own Marketplace membership, with no
  -- membership or access grant to the buyer's Editor workspace.
  perform 1 from app_private.supplier_profiles supplier
  join app_private.workspace_marketplace_members member on member.workspace_id = supplier.workspace_id
  join app_private.app_users actor on actor.id = member.user_id
  where supplier.id = p_supplier_id and supplier.status = 'approved'
    and actor.id = p_actor_user_id and actor.status = 'active'
  for share of supplier, member, actor;
  if not found then
    raise exception using errcode = 'P0001', message = 'QUOTE_REQUEST_NOT_FOUND';
  end if;
end;
$$;

create function app_private.marketplace_quote_request_publication_json(p_request_id uuid)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'revisionId', publication.revision_id,
    'publishedAt', to_char(publication.published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'suppliers', coalesce((
      select jsonb_agg(jsonb_build_object('id', access.supplier_id, 'name', access.supplier_name) order by access.supplier_id)
      from app_private.quote_request_supplier_access access where access.request_id = publication.request_id
    ), '[]'::jsonb)
  )
  from app_private.quote_request_publications publication where publication.request_id = p_request_id;
$$;

create function app_private.marketplace_supplier_quote_request_summary(
  p_draft app_private.quote_request_drafts, p_publication app_private.quote_request_publications
)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'id', (p_draft).id,
    'revisionId', (p_publication).revision_id,
    'title', (p_draft).title,
    'quantity', (p_draft).quantity,
    'publishedAt', to_char((p_publication).published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  );
$$;

create function public.marketplace_quote_request_publication(p_actor_user_id uuid, p_request_id uuid)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
begin
  perform app_private.marketplace_assert_quote_request_buyer(p_actor_user_id, p_request_id);
  return jsonb_build_object('publication', app_private.marketplace_quote_request_publication_json(p_request_id));
end;
$$;

create function public.marketplace_quote_request_eligible_suppliers(
  p_actor_user_id uuid, p_request_id uuid, p_after uuid
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_items jsonb;
  v_cursor jsonb;
begin
  perform app_private.marketplace_assert_quote_request_buyer(p_actor_user_id, p_request_id);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', page.id, 'name', page.name, 'kind', page.kind, 'capabilities', coalesce((
      select jsonb_agg(capability order by capability collate "C")
      from app_private.supplier_capabilities where supplier_id = page.id
    ), '[]'::jsonb)
  ) order by page.id), '[]'::jsonb)
  into v_items
  from (
    select id, name, kind from app_private.supplier_profiles
    where status = 'approved' and (p_after is null or id > p_after)
    order by id limit 25
  ) page;

  if jsonb_array_length(v_items) > 24 then
    v_cursor := v_items->23->'id';
    v_items := v_items - 24;
  end if;
  return jsonb_build_object('items', v_items, 'nextCursor', v_cursor);
end;
$$;

create function public.marketplace_publish_quote_request(
  p_actor_user_id uuid, p_request_id uuid, p_supplier_ids uuid[]
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_requested uuid[];
  v_existing uuid[];
  v_selected uuid[];
  v_names text[];
begin
  perform app_private.marketplace_assert_quote_request_buyer(p_actor_user_id, p_request_id);
  if p_supplier_ids is null or array_ndims(p_supplier_ids) is distinct from 1
    or cardinality(p_supplier_ids) not between 1 and 5
    or exists (select 1 from unnest(p_supplier_ids) as input(id) where id is null)
  then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  select array_agg(distinct id order by id) into v_requested from unnest(p_supplier_ids) as input(id);
  if cardinality(v_requested) <> cardinality(p_supplier_ids) then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  -- Drafts are immutable. A separate transaction lock serializes the first
  -- publication and any concurrent retries without rewriting the draft.
  perform pg_advisory_xact_lock(hashtextextended('marketplace-quote-request-publication:' || p_request_id::text, 0));
  if exists (select 1 from app_private.quote_request_publications where request_id = p_request_id) then
    select array_agg(supplier_id order by supplier_id) into v_existing
    from app_private.quote_request_supplier_access where request_id = p_request_id;
    if v_existing is distinct from v_requested then
      raise exception using errcode = 'P0001', message = 'QUOTE_REQUEST_ALREADY_PUBLISHED';
    end if;
    return app_private.marketplace_quote_request_publication_json(p_request_id);
  end if;

  -- Keep approval and the names used in the receipt stable through commit.
  -- Consistent ID order also avoids lock-order inversions across publications.
  select array_agg(id order by id), array_agg(name order by id) into v_selected, v_names
  from (
    select id, name from app_private.supplier_profiles
    where id = any(v_requested) and status = 'approved'
    order by id for share
  ) approved;
  if coalesce(cardinality(v_selected), 0) <> cardinality(v_requested) then
    raise exception using errcode = 'P0001', message = 'QUOTE_REQUEST_SUPPLIER_UNAVAILABLE';
  end if;

  insert into app_private.quote_request_publications (request_id, published_by)
  values (p_request_id, p_actor_user_id);
  insert into app_private.quote_request_supplier_access (request_id, supplier_id, supplier_name)
  select p_request_id, supplier.id, supplier.name from unnest(v_selected, v_names) as supplier(id, name);
  return app_private.marketplace_quote_request_publication_json(p_request_id);
end;
$$;

create function public.marketplace_list_supplier_quote_requests(
  p_actor_user_id uuid, p_supplier_id uuid, p_after_created_at timestamptz, p_after_id uuid
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_items jsonb;
  v_cursor jsonb;
begin
  perform app_private.marketplace_assert_quote_request_supplier(p_actor_user_id, p_supplier_id);
  if ((p_after_created_at is null) <> (p_after_id is null))
    or (p_after_created_at is not null and not isfinite(p_after_created_at))
  then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  select coalesce(jsonb_agg(page.summary order by page.published_at desc, page.request_id desc), '[]'::jsonb)
  into v_items
  from (
    select publication.published_at, publication.request_id,
      app_private.marketplace_supplier_quote_request_summary(draft, publication) as summary
    from app_private.quote_request_supplier_access access
    join app_private.quote_request_publications publication on publication.request_id = access.request_id
    join app_private.quote_request_drafts draft on draft.id = publication.request_id
    where access.supplier_id = p_supplier_id
      and (p_after_created_at is null or (publication.published_at, publication.request_id) < (p_after_created_at, p_after_id))
    order by publication.published_at desc, publication.request_id desc
    limit 25
  ) page;

  if jsonb_array_length(v_items) > 24 then
    v_cursor := jsonb_build_object('createdAt', v_items->23->>'publishedAt', 'id', v_items->23->>'id');
    v_items := v_items - 24;
  end if;
  return jsonb_build_object('items', v_items, 'nextCursor', v_cursor);
end;
$$;

create function public.marketplace_get_supplier_quote_request(
  p_actor_user_id uuid, p_supplier_id uuid, p_request_id uuid
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform app_private.marketplace_assert_quote_request_supplier(p_actor_user_id, p_supplier_id);
  select app_private.marketplace_supplier_quote_request_summary(draft, publication)
    || jsonb_build_object('notes', draft.notes, 'spec', draft.spec)
  into v_result
  from app_private.quote_request_supplier_access access
  join app_private.quote_request_publications publication on publication.request_id = access.request_id
  join app_private.quote_request_drafts draft on draft.id = publication.request_id
  where access.supplier_id = p_supplier_id and access.request_id = p_request_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'QUOTE_REQUEST_NOT_FOUND';
  end if;
  return v_result;
end;
$$;

revoke all on function app_private.marketplace_assert_quote_request_buyer(uuid, uuid),
  app_private.marketplace_assert_quote_request_supplier(uuid, uuid),
  app_private.marketplace_quote_request_publication_json(uuid),
  app_private.marketplace_supplier_quote_request_summary(app_private.quote_request_drafts, app_private.quote_request_publications)
from public, anon, authenticated;
grant execute on function app_private.marketplace_assert_quote_request_buyer(uuid, uuid),
  app_private.marketplace_assert_quote_request_supplier(uuid, uuid),
  app_private.marketplace_quote_request_publication_json(uuid),
  app_private.marketplace_supplier_quote_request_summary(app_private.quote_request_drafts, app_private.quote_request_publications)
to service_role;

revoke all on function public.marketplace_quote_request_publication(uuid, uuid),
  public.marketplace_quote_request_eligible_suppliers(uuid, uuid, uuid),
  public.marketplace_publish_quote_request(uuid, uuid, uuid[]),
  public.marketplace_list_supplier_quote_requests(uuid, uuid, timestamptz, uuid),
  public.marketplace_get_supplier_quote_request(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.marketplace_quote_request_publication(uuid, uuid),
  public.marketplace_quote_request_eligible_suppliers(uuid, uuid, uuid),
  public.marketplace_publish_quote_request(uuid, uuid, uuid[]),
  public.marketplace_list_supplier_quote_requests(uuid, uuid, timestamptz, uuid),
  public.marketplace_get_supplier_quote_request(uuid, uuid, uuid)
to service_role;
