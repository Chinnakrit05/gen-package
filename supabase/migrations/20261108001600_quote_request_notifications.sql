-- A publication grant is the durable alert. Store only account-specific read
-- receipts, so historical grants appear immediately without an outbox replay.

create table app_private.quote_request_notification_reads (
  request_id uuid not null,
  supplier_id uuid not null,
  user_id uuid not null references app_private.app_users(id) on delete cascade,
  read_at timestamptz not null default clock_timestamp(),
  primary key (request_id, supplier_id, user_id),
  foreign key (request_id, supplier_id)
    references app_private.quote_request_supplier_access(request_id, supplier_id) on delete cascade
);

create index quote_request_notification_reads_user_idx on app_private.quote_request_notification_reads (user_id);

alter table app_private.quote_request_notification_reads enable row level security;
revoke all on table app_private.quote_request_notification_reads from public, anon, authenticated, service_role;
grant select, insert on table app_private.quote_request_notification_reads to service_role;

create function public.marketplace_list_quote_request_notifications(
  p_actor_user_id uuid, p_after_created_at timestamptz, p_after_request_id uuid, p_after_supplier_id uuid
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_items jsonb;
  v_cursor jsonb;
  v_has_unread boolean;
begin
  perform app_private.marketplace_assert_active(p_actor_user_id);
  if ((p_after_created_at is null) <> (p_after_request_id is null))
    or ((p_after_created_at is null) <> (p_after_supplier_id is null))
    or (p_after_created_at is not null and not isfinite(p_after_created_at))
  then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  -- Evaluate the page and the inbox-wide unread flag in the same snapshot.
  with eligible as materialized (
    select supplier.id
    from app_private.workspace_marketplace_members member
    join app_private.supplier_profiles supplier on supplier.workspace_id = member.workspace_id
    where member.user_id = p_actor_user_id and supplier.status = 'approved'
  ), page as (
    select publication.published_at, access.request_id, access.supplier_id, access.supplier_name, draft.title, receipt.read_at
    from eligible
    join app_private.quote_request_supplier_access access on access.supplier_id = eligible.id
    join app_private.quote_request_publications publication on publication.request_id = access.request_id
    join app_private.quote_request_drafts draft on draft.id = publication.request_id
    left join app_private.quote_request_notification_reads receipt
      on receipt.request_id = access.request_id and receipt.supplier_id = access.supplier_id and receipt.user_id = p_actor_user_id
    where p_after_created_at is null or
      (publication.published_at, access.request_id, access.supplier_id) < (p_after_created_at, p_after_request_id, p_after_supplier_id)
    order by publication.published_at desc, access.request_id desc, access.supplier_id desc
    limit 25
  )
  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'requestId', page.request_id,
      'supplierId', page.supplier_id,
      'supplierName', page.supplier_name,
      'requestTitle', page.title,
      'createdAt', to_char(page.published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'readAt', to_char(page.read_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    ) order by page.published_at desc, page.request_id desc, page.supplier_id desc)
    from page
  ), '[]'::jsonb), exists (
    select 1 from eligible
    join app_private.quote_request_supplier_access access on access.supplier_id = eligible.id
    where not exists (
      select 1 from app_private.quote_request_notification_reads receipt
      where receipt.request_id = access.request_id and receipt.supplier_id = access.supplier_id and receipt.user_id = p_actor_user_id
    )
  )
  into v_items, v_has_unread;

  if jsonb_array_length(v_items) > 24 then
    v_cursor := jsonb_build_object(
      'createdAt', v_items->23->>'createdAt',
      'requestId', v_items->23->>'requestId',
      'supplierId', v_items->23->>'supplierId'
    );
    v_items := v_items - 24;
  end if;
  return jsonb_build_object('items', v_items, 'nextCursor', v_cursor, 'hasUnread', v_has_unread);
end;
$$;

create function public.marketplace_mark_quote_request_notification_read(
  p_actor_user_id uuid, p_supplier_id uuid, p_request_id uuid
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_read_at timestamptz;
begin
  perform app_private.marketplace_assert_quote_request_supplier(p_actor_user_id, p_supplier_id);
  if not exists (
    select 1 from app_private.quote_request_supplier_access where request_id = p_request_id and supplier_id = p_supplier_id
  ) then
    raise exception using errcode = 'P0001', message = 'QUOTE_REQUEST_NOT_FOUND';
  end if;

  begin
    insert into app_private.quote_request_notification_reads (request_id, supplier_id, user_id)
    values (p_request_id, p_supplier_id, p_actor_user_id)
    on conflict (request_id, supplier_id, user_id) do nothing
    returning read_at into v_read_at;
  exception when foreign_key_violation then
    -- A trusted deletion of the parent grant won the race.
    raise exception using errcode = 'P0001', message = 'QUOTE_REQUEST_NOT_FOUND';
  end;
  if not found then
    select read_at into v_read_at from app_private.quote_request_notification_reads
    where request_id = p_request_id and supplier_id = p_supplier_id and user_id = p_actor_user_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'QUOTE_REQUEST_NOT_FOUND';
    end if;
  end if;

  return jsonb_build_object(
    'requestId', p_request_id, 'supplierId', p_supplier_id,
    'readAt', to_char(v_read_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  );
end;
$$;

revoke all on function public.marketplace_list_quote_request_notifications(uuid, timestamptz, uuid, uuid),
  public.marketplace_mark_quote_request_notification_read(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.marketplace_list_quote_request_notifications(uuid, timestamptz, uuid, uuid),
  public.marketplace_mark_quote_request_notification_read(uuid, uuid, uuid) to service_role;
